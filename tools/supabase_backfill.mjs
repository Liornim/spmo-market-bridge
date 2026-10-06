// Fill the Supabase mirror straight from Yahoo: 1-minute bars for the last
// seven days (the most Yahoo serves at 1m with range=), for every tracked
// symbol. Runs from GitHub Actions, not the Worker, so it spends none of the
// Worker's 50 subrequests and none of D1's reads or writes.
//
// Rows are built exactly as the Worker builds them (fetchYahoo + mirrorRows in
// worker.js): session minutes only (09:30 <= t < 16:00 ET), prices rounded to
// four places, a no-trade minute carried forward flat at the previous close with
// zero volume, the forming minute skipped.
//
// Existing rows are NEVER overwritten (resolution=ignore-duplicates). A row the
// Worker already mirrored carries revisions / first_seen / updated_at from D1,
// which this script cannot know; it only fills the holes.
//
// Env:
//   SUPABASE_URL, SUPABASE_KEY   required unless DRY_RUN=1
//   WORKER_URL                   where to read the symbol list (default below)
//   SYMBOLS                      optional comma list; overrides the Worker list
//   RANGE                        Yahoo range, default 7d
//   DRY_RUN=1                    fetch and report, write nothing

import { appendFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const WORKER = (process.env.WORKER_URL || 'https://spmo-market-bridge.noamharelnim.workers.dev').replace(/\/$/, '');
const RANGE = process.env.RANGE || '7d';
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_KEY || '';
const BATCH = 5000;
const PAUSE_MS = 400;          // sequential and spaced: Yahoo throttles bursts from one IP

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});
export function localDateTime(unix) {
  const p = fmt.formatToParts(new Date(unix * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}
const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
function isSessionMinute(unix) {
  if (unix % 60 !== 0) return false;
  const { time } = localDateTime(unix);
  return time >= '09:30' && time < '16:00';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same shape and rules as fetchYahoo in worker.js.
export function parseYahoo(j, now) {
  const r = j?.chart?.result?.[0];
  if (!r) return { bars: [], error: j?.chart?.error?.description || 'no result from upstream' };
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const bars = [];
  let lastClose = null, noTrade = 0;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] + 60 > now) continue;
    if (!isSessionMinute(ts[i])) continue;
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) {
      if (lastClose == null) continue;
      noTrade++;
      bars.push({ unix: ts[i], o: lastClose, h: lastClose, l: lastClose, c: lastClose, v: 0 });
      continue;
    }
    lastClose = rnd(c, 4);
    bars.push({ unix: ts[i], o: rnd(o, 4), h: rnd(h, 4), l: rnd(l, 4), c: rnd(c, 4), v: q.volume?.[i] ?? 0 });
  }
  return { bars, noTrade, error: null };
}

export function toRows(sym, bars) {
  return bars.map(b => {
    const { date, time } = localDateTime(b.unix);
    return { symbol: sym, unix: b.unix, date, time, open: b.o, high: b.h, low: b.l, close: b.c,
      volume: b.v, revisions: 0, first_seen: null, updated_at: null };
  });
}

async function fetchYahoo(sym) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=${RANGE}&includePrePost=false`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * attempt); continue; }
      if (res.status !== 200) return { bars: [], error: 'yahoo HTTP ' + res.status };
      return parseYahoo(await res.json(), Math.floor(Date.now() / 1000));
    } catch (e) {
      if (attempt === 3) return { bars: [], error: String(e?.message || e) };
      await sleep(2000 * attempt);
    }
  }
  return { bars: [], error: 'yahoo: retries exhausted' };
}

async function sbPost(rows) {
  const res = await fetch(SB_URL + '/rest/v1/bars?on_conflict=symbol,unix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
      Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  if (res.status >= 300) throw new Error('supabase HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
}

async function sbCount(filter) {
  const res = await fetch(SB_URL + '/rest/v1/bars?select=symbol&' + filter, {
    method: 'HEAD', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, Prefer: 'count=exact', Range: '0-0' }
  });
  const cr = res.headers.get('content-range') || '';
  const n = parseInt(cr.split('/')[1], 10);
  return Number.isFinite(n) ? n : null;
}

async function symbolList() {
  if (process.env.SYMBOLS) return process.env.SYMBOLS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const res = await fetch(WORKER + '/table/symbols?limit=1000&cb=' + Date.now(), { headers: { 'User-Agent': UA } });
  if (res.status !== 200) throw new Error('symbol list: worker HTTP ' + res.status);
  const j = await res.json();
  return (j.rows || []).map(r => r.symbol).filter(Boolean);
}

async function main() {
  if (!DRY && (!SB_URL || !SB_KEY)) {
    throw new Error('SUPABASE_URL / SUPABASE_KEY are not set (DRY_RUN=' + JSON.stringify(process.env.DRY_RUN) + '). Add them as repository secrets, or run with DRY_RUN=1.');
  }
  const syms = await symbolList();
  console.log(`${syms.length} symbols, range=${RANGE}, ${DRY ? 'DRY RUN (nothing written)' : 'writing to ' + SB_URL.replace(/^https:\/\/(\w{4})\w*/, 'https://$1…')}`);
  const perDate = {};               // date -> { symbols, bars }
  const failed = [];
  let pending = [], sent = 0, fetched = 0;
  const flush = async () => {
    while (pending.length >= BATCH || (pending.length && flush.final)) {
      const chunk = pending.splice(0, BATCH);
      if (!DRY) await sbPost(chunk);
      sent += chunk.length;
    }
  };
  for (const [i, sym] of syms.entries()) {
    const r = await fetchYahoo(sym);
    if (r.error) { failed.push(sym + ': ' + r.error); console.log(`[${i + 1}/${syms.length}] ${sym} FAILED ${r.error}`); await sleep(PAUSE_MS); continue; }
    const rows = toRows(sym, r.bars);
    const byDate = {};
    for (const row of rows) byDate[row.date] = (byDate[row.date] || 0) + 1;
    for (const [d, n] of Object.entries(byDate)) {
      const e = perDate[d] || (perDate[d] = { symbols: 0, bars: 0, full: 0 });
      e.symbols++; e.bars += n; if (n >= 390) e.full++;
    }
    fetched += rows.length;
    pending = pending.concat(rows);
    await flush();
    console.log(`[${i + 1}/${syms.length}] ${sym} ${rows.length} bars  ` + Object.entries(byDate).map(([d, n]) => d.slice(5) + ':' + n).join(' '));
    await sleep(PAUSE_MS);
  }
  flush.final = true; await flush();

  const dates = Object.keys(perDate).sort();
  const lines = [];
  lines.push(`## Supabase backfill from Yahoo (${RANGE}, 1m)${DRY ? ' — DRY RUN' : ''}`);
  lines.push(`symbols: ${syms.length}, fetched OK: ${syms.length - failed.length}, failed: ${failed.length}`);
  lines.push(`bars fetched: ${fetched}, ${DRY ? 'would send' : 'sent (new rows inserted, existing left alone)'}: ${sent}`);
  lines.push('');
  lines.push('| date | symbols | bars from Yahoo | symbols with full 390 |' + (DRY ? '' : ' rows in Supabase after |'));
  lines.push('|---|---|---|---|' + (DRY ? '' : '---|'));
  for (const d of dates) {
    const after = DRY ? '' : ` ${await sbCount('date=eq.' + d)} |`;
    lines.push(`| ${d} | ${perDate[d].symbols} | ${perDate[d].bars} | ${perDate[d].full} |${after}`);
  }
  if (failed.length) { lines.push(''); lines.push('failed: ' + failed.join(' ; ')); }
  const out = lines.join('\n');
  console.log('\n' + out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
  if (failed.length > syms.length / 2) { summary('\nfirst log lines:\n```\n' + early.join('\n') + '\n```'); process.exit(1); }
}

// Raw logs need a GitHub login; the step summary does not. So everything that
// matters -- including a crash -- is also written there.
const _log = console.log; const early = [];
console.log = (...a) => { _log(...a); if (early.length < 25) early.push(a.join(' ')); };
function summary(text) { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n'); }
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => {
  console.error(e);
  summary('## supabase-backfill FAILED\n\n```\n' + String((e && e.stack) || e).slice(0, 1500) + '\n```\n\nfirst log lines:\n```\n' + early.join('\n') + '\n```');
  process.exit(1);
});
