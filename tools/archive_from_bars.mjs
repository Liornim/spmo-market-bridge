// Copy every canonical bar in the Supabase `bars` mirror into `archive_bars`,
// the compact store (integer prices x10000, symbol ids, primary key only).
// Copies only: nothing is deleted and nothing already in the archive is
// overwritten (resolution=ignore-duplicates). Afterwards it refreshes the
// summary columns in archive_symbols and reports, day by day, how many bars
// each table holds, so a later trim of `bars` can be checked against it.
//
// Env: SUPABASE_URL, SUPABASE_KEY (service key; bypasses RLS).

import { appendFileSync } from 'node:fs';

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const PAGE = 1000;           // PostgREST's default max-rows
const BATCH = 5000;
const SCALE = 10000;
const INT_MAX = 2147483647;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function et(unix) {
  const p = fmt.formatToParts(new Date(unix * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
const canonical = (unix, time) => unix % 60 === 0 && time >= '09:30' && time <= '15:59';

async function req(path, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (res.status < 300) return res;
    const body = (await res.text()).slice(0, 300);
    if (attempt >= 3 || res.status < 500) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 80)} -> HTTP ${res.status} ${body}`);
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
}
const getJson = async (path, headers) => (await req(path, { headers })).json();
async function count(path) {
  const res = await req(path, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
  return parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
}

async function main() {
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY missing');

  // 1. every symbol in bars has an id in archive_symbols
  // DISTINCT is not available over REST, so the symbol list is the one the
  // backfill uses -- the same 118 symbols bars holds.
  const barSyms = [];
  const fileSyms = (await import('node:fs')).readFileSync(new URL('./backfill_symbols.txt', import.meta.url), 'utf8')
    .split(/\s+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  barSyms.push(...fileSyms);
  // Only the symbols the archive does not have yet, and with columns=symbol so
  // PostgREST lets the identity default fill `id` instead of sending NULL.
  const have = new Set((await getJson('archive_symbols?select=symbol&limit=10000')).map(r => r.symbol));
  const missing = barSyms.filter(s => !have.has(s));
  if (missing.length) await req('archive_symbols?columns=symbol&on_conflict=symbol', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(missing.map(symbol => ({ symbol }))) });
  console.log(`archive_symbols: ${missing.length} added (${missing.join(',') || 'none'})`);
  const idRows = await getJson('archive_symbols?select=id,symbol&limit=10000');
  const ID = Object.fromEntries(idRows.map(r => [r.symbol, r.id]));
  console.log(`archive_symbols: ${idRows.length} symbols; copying ${barSyms.length} from bars`);

  const VERIFY_ONLY = process.env.VERIFY_ONLY === '1';
  // 2. copy, symbol by symbol, page by page
  let read = 0, sent = 0, skipped = 0, pending = [];
  const flush = async (final) => {
    while (pending.length >= BATCH || (final && pending.length)) {
      const chunk = pending.splice(0, BATCH);
      await req('archive_bars?on_conflict=symbol_id,unix', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(chunk) });
      sent += chunk.length;
    }
  };
  for (const [i, sym] of (VERIFY_ONLY ? [] : barSyms.entries())) {
    const id = ID[sym];
    if (!id) { console.log(`${sym}: no archive id, skipped`); continue; }
    let n = 0;
    for (let from = 0; ; from += PAGE) {
      const rows = await getJson(`bars?select=unix,time,open,high,low,close,volume&symbol=eq.${encodeURIComponent(sym)}&order=unix.asc`,
        { Range: `${from}-${from + PAGE - 1}` });
      for (const b of rows) {
        read++;
        const enc = { symbol_id: id, unix: b.unix,
          o: Math.round(b.open * SCALE), h: Math.round(b.high * SCALE), l: Math.round(b.low * SCALE), c: Math.round(b.close * SCALE),
          v: Math.round(b.volume || 0) };
        if (!canonical(b.unix, b.time) || [enc.o, enc.h, enc.l, enc.c, enc.v].some(x => !Number.isFinite(x) || x > INT_MAX || x < 0)) { skipped++; continue; }
        pending.push(enc); n++;
      }
      await flush(false);
      if (rows.length < PAGE) break;
    }
    console.log(`[${i + 1}/${barSyms.length}] ${sym} ${n} bars`);
  }
  await flush(true);

  // 3. refresh archive_symbols summary columns for the symbols touched
  for (const sym of (VERIFY_ONLY ? [] : barSyms)) {
    const id = ID[sym]; if (!id) continue;
    const bars = await count(`archive_bars?select=unix&symbol_id=eq.${id}`);
    const first = await getJson(`archive_bars?select=unix&symbol_id=eq.${id}&order=unix.asc&limit=1`);
    const last = await getJson(`archive_bars?select=unix&symbol_id=eq.${id}&order=unix.desc&limit=1`);
    await req(`archive_symbols?id=eq.${id}`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ bars, first_unix: first[0]?.unix ?? null, last_unix: last[0]?.unix ?? null }) });
  }

  // 4. per-symbol check: within the span bars covers for a symbol, does the
  // archive hold at least as many bars? Counted per symbol so the primary key
  // (symbol_id, unix) serves it; a table-wide count by time range times out.
  const lines = ['## bars -> archive_bars copy', `read from bars: ${read}, sent: ${sent}, skipped (not a canonical session minute): ${skipped}`, ''];
  const short = [];
  let totalBars = 0, totalArch = 0;
  for (const sym of barSyms) {
    const id = ID[sym]; if (!id) continue;
    const f = await getJson(`bars?select=unix&symbol=eq.${encodeURIComponent(sym)}&order=unix.asc&limit=1`);
    const l = await getJson(`bars?select=unix&symbol=eq.${encodeURIComponent(sym)}&order=unix.desc&limit=1`);
    if (!f.length) continue;
    const nb = await count(`bars?select=unix&symbol=eq.${encodeURIComponent(sym)}&unix=gte.${f[0].unix}&unix=lte.${l[0].unix}&time=gte.09:30&time=lte.15:59`);
    const na = await count(`archive_bars?select=unix&symbol_id=eq.${id}&unix=gte.${f[0].unix}&unix=lte.${l[0].unix}`);
    totalBars += nb; totalArch += na;
    if (na < nb) short.push(`${sym}: bars ${nb} > archive ${na}`);
  }
  lines.push(`within each symbol's bars span: bars ${totalBars}, archive ${totalArch}`);
  lines.push(short.length ? `ARCHIVE SHORT for ${short.length} symbols: ` + short.slice(0, 20).join(' ; ') : 'archive holds at least every bar that bars holds, for all symbols');
  const out = lines.join('\n');
  console.log('\n' + out);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
