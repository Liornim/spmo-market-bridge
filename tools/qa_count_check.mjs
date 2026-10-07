#!/usr/bin/env node
// tools/qa_count_check.mjs
//
// Independent completeness check of the Supabase 1-minute archive.
// Method: server-side exact COUNTs (PostgREST `Prefer: count=exact` + Content-Range),
// one per symbol per trading day for the regular session (09:30–16:00 ET) and one
// per symbol per calendar day (00:00–24:00 ET). No rows are downloaded. This file
// deliberately shares no code with the archive writer/auditor tools.
//
// Env:  SUPABASE_URL, SUPABASE_KEY            (required)
//       QA_START=YYYY-MM-DD  (default 2026-08-26)
//       QA_END=YYYY-MM-DD    (default: most recent NYSE session whose 16:00 ET close has passed)
//       QA_CONCURRENCY       (default 8)
//       QA_OUT               (default .github/audit/qa_count.csv, relative to repo root)
//
// Exit 0 when the check completes (whatever it finds); exit 1 only on a crash.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TZ = 'America/New_York';
const EXPECTED_REGULAR = 390;   // 09:30..15:59 → 390 one-minute bars
const MAX_LIST = 300;

// ---------------------------------------------------------------- time helpers
const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Offset (ms) of America/New_York from UTC at the given UTC instant (EDT → -4h, EST → -5h).
function tzOffsetMs(utcMs) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Epoch seconds of wall-clock time `hh:mm` in New York on date `ymd` (YYYY-MM-DD).
// Two-pass so it stays correct even across a DST transition.
function etToUnix(ymd, hh, mm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utc = wall - tzOffsetMs(wall);
  utc = wall - tzOffsetMs(utc);
  return Math.round(utc / 1000);
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const dow = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const ymdOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

function etDateOf(unixSec) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(unixSec * 1000)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// ---------------------------------------------------------------- NYSE calendar
// Holidays derived from the NYSE rules (Rule 7.2), not from a hard-coded list:
//   New Year's Day, MLK Day (3rd Mon Jan), Washington's Birthday (3rd Mon Feb),
//   Good Friday, Memorial Day (last Mon May), Juneteenth (Jun 19), Independence Day,
//   Labor Day (1st Mon Sep), Thanksgiving (4th Thu Nov), Christmas.
//   Fixed-date holidays on Saturday → observed Friday before; on Sunday → Monday after.
//   (Exception: New Year's Day on a Saturday is NOT observed on Dec 31.)
//   Columbus Day and Veterans Day are bank holidays only — NYSE is open.
// Early closes (13:00 ET) only occur: day before Independence Day (if a weekday),
//   day after Thanksgiving, Christmas Eve. None of these fall between Aug 26 and
//   early October, so every session in the default window is a full 390-minute day.
//   They are still modelled below so a different QA_START/QA_END stays correct.
function nthWeekday(y, m, weekday, n) {           // n>=1, or n=-1 for last
  if (n > 0) {
    const first = dow(ymdOf(y, m, 1));
    return ymdOf(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = dow(ymdOf(y, m, lastDay));
  return ymdOf(y, m, lastDay - ((lastDow - weekday + 7) % 7));
}
function easterSunday(y) {                        // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymdOf(y, month, day);
}
function observed(ymd, allowFridayBefore = true) {
  const w = dow(ymd);
  if (w === 6) return allowFridayBefore ? addDays(ymd, -1) : null;
  if (w === 0) return addDays(ymd, 1);
  return ymd;
}
function nyseHolidays(y) {
  const h = new Map();
  const put = (d, name) => { if (d) h.set(d, name); };
  put(observed(ymdOf(y, 1, 1), false), "New Year's Day");   // Saturday → not observed (no Dec 31 closure)
  put(nthWeekday(y, 1, 1, 3), 'MLK Day');
  put(nthWeekday(y, 2, 1, 3), "Washington's Birthday");
  put(addDays(easterSunday(y), -2), 'Good Friday');
  put(nthWeekday(y, 5, 1, -1), 'Memorial Day');
  if (y >= 2022) put(observed(ymdOf(y, 6, 19)), 'Juneteenth');
  put(observed(ymdOf(y, 7, 4)), 'Independence Day');
  put(nthWeekday(y, 9, 1, 1), 'Labor Day');
  put(nthWeekday(y, 11, 4, 4), 'Thanksgiving');
  put(observed(ymdOf(y, 12, 25)), 'Christmas');
  return h;
}
function nyseEarlyCloses(y) {
  const s = new Set();
  const jul3 = ymdOf(y, 7, 3);
  if (dow(jul3) >= 1 && dow(jul3) <= 5 && !nyseHolidays(y).has(jul3)) s.add(jul3);
  s.add(addDays(nthWeekday(y, 11, 4, 4), 1));
  const dec24 = ymdOf(y, 12, 24);
  if (dow(dec24) >= 1 && dow(dec24) <= 5) s.add(dec24);
  return s;
}
function tradingDays(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const w = dow(d); if (w === 0 || w === 6) continue;
    const y = +d.slice(0, 4);
    if (nyseHolidays(y).has(d)) continue;
    const early = nyseEarlyCloses(y).has(d);
    out.push({ date: d, closeH: early ? 13 : 16, expected: early ? 210 : EXPECTED_REGULAR });
  }
  return out;
}
// Most recent session whose close has already passed at `nowMs`.
function lastCompletedSession(nowMs) {
  let d = etDateOf(Math.floor(nowMs / 1000));
  for (let i = 0; i < 15; i++, d = addDays(d, -1)) {
    const td = tradingDays(d, d)[0];
    if (td && etToUnix(d, td.closeH, 0) * 1000 <= nowMs) return d;
  }
  throw new Error('could not find a completed session in the last 15 days');
}

// ---------------------------------------------------------------- HTTP
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient(base, key) {
  const root = base.replace(/\/+$/, '') + '/rest/v1/';
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  let requests = 0, retries = 0;

  async function req(path, extra = {}, method = 'GET') {
    for (let attempt = 0; ; attempt++) {
      requests++;
      let res, err;
      try { res = await fetch(root + path, { method, headers: { ...headers, ...extra } }); }
      catch (e) { err = e; }
      const retryable = err || res.status === 429 || res.status >= 500;
      if (!retryable) return res;
      if (attempt >= 3) {
        if (err) throw new Error(`network error on ${path}: ${err.message}`);
        throw new Error(`HTTP ${res.status} on ${path} after 3 retries: ${(await res.text()).slice(0, 200)}`);
      }
      retries++;
      const ra = res && Number(res.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : 500 * 2 ** attempt + Math.random() * 250);
    }
  }

  async function count(path) {
    const res = await req(path, { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }, 'HEAD');
    // 200/206 normally; 416 is what some PostgREST versions send for an empty result with Range 0-0.
    if (![200, 206, 416].includes(res.status)) throw new Error(`count HTTP ${res.status} on ${path}`);
    const cr = res.headers.get('content-range') || '';
    const m = cr.match(/\/(\d+)$/);
    if (!m) throw new Error(`no exact total in Content-Range "${cr}" on ${path}`);
    return Number(m[1]);
  }

  async function getAll(pathNoPaging) {
    const rows = [];
    for (let off = 0; ; off += 1000) {
      const res = await req(`${pathNoPaging}&limit=1000&offset=${off}`);
      if (!res.ok) throw new Error(`GET HTTP ${res.status} on ${pathNoPaging}: ${(await res.text()).slice(0, 200)}`);
      const batch = await res.json();
      rows.push(...batch);
      if (batch.length < 1000) return rows;
    }
  }
  return { count, getAll, stats: () => ({ requests, retries }) };
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------- main
export async function main({ now = Date.now(), env = process.env, log = console.log } = {}) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY are required');
  const start = env.QA_START || '2026-08-26';
  const end = env.QA_END || lastCompletedSession(now);
  const conc = Number(env.QA_CONCURRENCY) || 8;
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outPath = resolve(repoRoot, env.QA_OUT || '.github/audit/qa_count.csv');

  const days = tradingDays(start, end);
  if (!days.length) throw new Error(`no trading days between ${start} and ${end}`);
  for (const d of days) {
    d.s0 = etToUnix(d.date, 9, 30);
    d.s1 = etToUnix(d.date, d.closeH, 0);
    d.d0 = etToUnix(d.date, 0, 0);
    d.d1 = etToUnix(addDays(d.date, 1), 0, 0);
    // sanity: session length must equal expected minutes exactly
    if ((d.s1 - d.s0) / 60 !== d.expected) throw new Error(`session window wrong for ${d.date}`);
  }

  const api = makeClient(url, key);
  const symbols = (await api.getAll('archive_symbols?select=id,symbol,bars,first_unix,last_unix&order=symbol.asc'))
    .filter(s => s && s.id != null && s.symbol)
    // SYMBOLS (optional): check only these
    .filter(s => { const only = new Set(String(env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean)); return !only.size || only.has(s.symbol); });
  if (!symbols.length) throw new Error('archive_symbols returned no rows');

  const t0 = Date.now();
  const cells = [];
  for (const s of symbols) for (const d of days) cells.push({ s, d });
  const jobs = [];
  for (const c of cells) {
    jobs.push({ c, kind: 'session', path: `archive_bars?select=unix&symbol_id=eq.${c.s.id}&unix=gte.${c.d.s0}&unix=lt.${c.d.s1}` });
    jobs.push({ c, kind: 'day', path: `archive_bars?select=unix&symbol_id=eq.${c.s.id}&unix=gte.${c.d.d0}&unix=lt.${c.d.d1}` });
  }
  let done = 0;
  await pool(jobs, conc, async j => {
    j.c[j.kind] = await api.count(j.path);
    if (++done % 1000 === 0 && process.stderr.isTTY) process.stderr.write(`  ${done}/${jobs.length} counts\r`);
  });

  // classify
  for (const c of cells) {
    const exp = c.d.expected;
    // Missing session minutes take precedence over extra rows (SHORT beats OVER); any
    // outside-session rows on a short day are still called out in the report note.
    if (c.day === 0) c.status = 'EMPTY';
    else if (c.session < exp) c.status = 'SHORT';
    else if (c.session > exp || c.day > c.session) c.status = 'OVER';   // >390 in session, or rows outside session
    else c.status = 'OK';
  }

  // CSV
  mkdirSync(dirname(outPath), { recursive: true });
  const csvEsc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = ['symbol,date,session_count,day_count,expected,status'];
  for (const c of cells) lines.push([c.s.symbol, c.d.date, c.session, c.day, c.d.expected, c.status].map(csvEsc).join(','));
  writeFileSync(outPath, lines.join('\n') + '\n');

  // first data day per symbol (from our own counts, not from archive_symbols metadata)
  const firstDay = new Map();
  for (const c of cells) if (c.day > 0 && !firstDay.has(c.s.symbol)) firstDay.set(c.s.symbol, c.d.date);
  const isPreListing = c => { const f = firstDay.get(c.s.symbol); return !f || c.d.date < f; };

  // report
  const tot = { OK: 0, SHORT: 0, OVER: 0, EMPTY: 0 };
  for (const c of cells) tot[c.status]++;
  const emptyPre = cells.filter(c => c.status === 'EMPTY' && isPreListing(c) && firstDay.has(c.s.symbol)).length;
  const neverData = symbols.filter(s => !firstDay.has(s.symbol));

  log(`QA count check — ${symbols.length} symbols × ${days.length} sessions (${start} → ${end}), method: exact server-side COUNT per symbol-day`);
  log(`Requests: ${api.stats().requests} (retries ${api.stats().retries}), ${((Date.now() - t0) / 1000).toFixed(1)}s. CSV: ${outPath}`);
  log('');
  log(`Symbol-days checked: ${cells.length}`);
  log(`  OK    ${tot.OK}`);
  log(`  SHORT ${tot.SHORT}`);
  log(`  OVER  ${tot.OVER}`);
  log(`  EMPTY ${tot.EMPTY}${emptyPre ? `  (of which ${emptyPre} are before the symbol's first data day in the window)` : ''}`);
  const sumSess = cells.reduce((a, c) => a + c.session, 0), sumDay = cells.reduce((a, c) => a + c.day, 0);
  const sumExp = cells.reduce((a, c) => a + c.d.expected, 0);
  log(`  Bars: session ${sumSess} / expected ${sumExp} (${(100 * sumSess / sumExp).toFixed(2)}%); outside-session ${sumDay - sumSess}`);
  log('');

  log('Per date:');
  log('date         OK/total   session bars / expected     outside-session');
  for (const d of days) {
    const cs = cells.filter(c => c.d === d);
    const ok = cs.filter(c => c.status === 'OK').length;
    const sb = cs.reduce((a, c) => a + c.session, 0), db = cs.reduce((a, c) => a + c.day, 0);
    const ex = cs.length * d.expected;
    log(`${d.date}   ${String(ok).padStart(3)}/${String(cs.length).padEnd(4)}  ${String(sb).padStart(7)} / ${String(ex).padEnd(7)} ${(100 * sb / ex).toFixed(2).padStart(6)}%   ${db - sb}`);
  }
  log('');

  const bad = cells.filter(c => c.status !== 'OK')
    .sort((a, b) => (isPreListing(a) - isPreListing(b)) || a.s.symbol.localeCompare(b.s.symbol) || a.d.date.localeCompare(b.d.date));
  log(`Non-OK symbol-days: ${bad.length}${bad.length > MAX_LIST ? ` (showing first ${MAX_LIST}; full list in CSV)` : ''}`);
  log('symbol   date         status  session  day  expected  note');
  for (const c of bad.slice(0, MAX_LIST)) {
    const notes = [];
    if (c.status === 'EMPTY' && isPreListing(c)) notes.push(firstDay.has(c.s.symbol) ? 'before first data day' : 'symbol has no data in window');
    if (c.status === 'SHORT') notes.push(`missing ${c.d.expected - c.session}`);
    if (c.session > c.d.expected) notes.push(`+${c.session - c.d.expected} in session (dupes/misaligned?)`);
    if (c.day > c.session) notes.push(`${c.day - c.session} outside 09:30-16:00`);
    log(`${c.s.symbol.padEnd(8)} ${c.d.date}   ${c.status.padEnd(6)}  ${String(c.session).padStart(7)}  ${String(c.day).padStart(4)}  ${String(c.d.expected).padStart(8)}  ${notes.join('; ')}`);
  }
  log('');

  const late = symbols.filter(s => firstDay.has(s.symbol) && firstDay.get(s.symbol) > days[0].date)
    .map(s => ({ s, f: firstDay.get(s.symbol) })).sort((a, b) => a.f.localeCompare(b.f) || a.s.symbol.localeCompare(b.s.symbol));
  log(`Symbols whose first data day is after ${days[0].date}: ${late.length}`);
  for (const { s, f } of late) {
    const meta = s.first_unix ? ` (archive_symbols.first_unix → ${etDateOf(Number(s.first_unix))})` : '';
    log(`  ${s.symbol.padEnd(8)} ${f}${meta}`);
  }
  if (neverData.length) {
    log(`Symbols with NO data in the window: ${neverData.length}`);
    for (const s of neverData) log(`  ${s.symbol}`);
  }

  return { cells, tot, days, symbols, outPath };
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().then(() => process.exit(0), e => { console.error('qa_count_check crashed:', e?.stack || e); process.exit(1); });
}

// exported for tests
export { etToUnix, tradingDays, nyseHolidays, nyseEarlyCloses, lastCompletedSession, tzOffsetMs };
