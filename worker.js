// bars-vault — persistent 1-minute bar archive
// Cloudflare Worker + D1 (SQLite) + Cron Trigger
//
// Every bar ever fetched is stored permanently in D1. Reads come from the
// database, never from Yahoo, so an upstream outage does not lose history.
//
// Designed around the Workers Free plan limits, which are enforced as hard
// failures since 2026-09-01:
//   - 50 subrequests per invocation (every D1 call counts, not just fetch)
//   - 100,000 D1 rows written / day
//   - 5,000,000 D1 rows read / day
// So: one fetch + one D1 batch per symbol, bars are written only when they
// actually changed, and /status never scans the bars table.
//
// Routes (GET):
//   /                          health, tracked symbols, last run
//   /view/NVDA[/2026-08-31]    phone-first page: chart, table, freshness
//   /radar                     market radar: all tracked symbols by attention
//   /db                        what is stored: counts per symbol and per day
//   /data                      browse the database: bars by symbol/day, and the small tables
//   /table/:name               read-only rows from a whitelisted table
//   /log                       system log from KV — answers even when D1 is down
//   /book/NVDA                 top-5 bids/asks from the four Cboe venues
//   /bookprobe/NVDA            which Cboe JSON path answered (diagnostic)
//   /selfcheck                 per-subsystem health, to locate a failure
//   /status                    per-symbol freshness, counts, recent runs (cheap)
//   /days/NVDA                 stored dates with bar counts
//   /board                     every tracked symbol in one request (?since= for new bars only)
//   /day/NVDA                  CSV of today (tops up from Yahoo if stale)
//   /day/NVDA/2026-08-31       CSV of a specific day     (?format=json)
//   /sync          [key]       incremental pull, all tracked symbols
//   /sync/NVDA     [key]       incremental pull, one symbol (adds to tracking)
//   /backfill/NVDA [key]       full 5-day pull, one symbol
//
// [key] = if the API_KEY secret is set, these need ?key=... or X-Api-Key.
// Reads of stored data are always open. Until API_KEY is set, everything is open.
//
// Bindings: D1 as DB.  Secret (optional): API_KEY.
// Cron:  */5 13-21 * * 1-5   intraday, all symbols, incremental
//        */5 22-23 * * 1-5   nightly, ONE symbol per run, full 5-day backfill

import { VIEW_HTML, RADAR_HTML, DB_HTML, DATA_HTML } from './view.js';

const DEFAULT_SYMBOLS = 'NVDA,GOOGL,AAPL,MSFT,AMZN,AVGO,META,TSLA,BRK-B,JPM,VOO,SPMO,TQQQ';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TZ = 'America/New_York';
const STALE_LIMIT = 180;        // seconds before data is flagged stale
const TOPUP_AFTER = 120;        // /day/today re-pulls if last bar older than this
const OVERLAP_BARS = 15;        // incremental pulls re-check this many trailing bars
const BATCH = 100;              // statements per D1 batch call
const COLS = 'symbol,date,time,open,high,low,close,volume,dir,body_pct,upper_wick_pct,lower_wick_pct,range,vol_x';

const rnd = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const nowSec = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- schema

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bars (
     symbol TEXT NOT NULL, unix INTEGER NOT NULL,
     date TEXT NOT NULL, time TEXT NOT NULL,
     open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
     volume INTEGER NOT NULL,
     first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     revisions INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (symbol, unix))`,
  // (symbol, date) alone is not enough: the read orders by unix, so SQLite
  // preferred the primary key (symbol, unix) and scanned EVERY bar for the
  // symbol across every stored day. The composite index that fixes it is in
  // HEAVY_INDEXES, not here: creating it writes a row per existing bar.
  // Per-day counters so /status and /days never scan bars.
  `CREATE TABLE IF NOT EXISTS days (
     symbol TEXT NOT NULL, date TEXT NOT NULL,
     bars INTEGER NOT NULL, revisions INTEGER NOT NULL DEFAULT 0,
     first TEXT, last TEXT, PRIMARY KEY (symbol, date))`,
  `CREATE TABLE IF NOT EXISTS symbols (
     symbol TEXT PRIMARY KEY, added_at INTEGER NOT NULL,
     last_fetch_at INTEGER, last_bar_unix INTEGER, last_error TEXT,
     last_backfill_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0, queries INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS usage_route (day TEXT NOT NULL, route TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, route))`,
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     started_at INTEGER NOT NULL, finished_at INTEGER,
     kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
     symbols INTEGER NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0,
     errors TEXT)`
];

// Bump this whenever SCHEMA changes. Forgetting to is what left an existing
// database without the usage_route table: the version matched, so ensureSchema
// short-circuited and the CREATE never ran. A test now guards it.
const SCHEMA_VERSION = '5';

// Index builds are deliberately separated from table creation. Creating an
// index writes one row per existing bar; doing that inside whichever request
// happened to be first after a deploy cost 46,821 writes in a single page load
// and froze the day's budget.
const HEAVY_INDEXES = [
  { name: 'bars_symbol_date_unix', sql: 'CREATE INDEX IF NOT EXISTS bars_symbol_date_unix ON bars (symbol, date, unix)' }
];
const INDEX_BUDGET = 0.40;          // only build when the day is under this
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  // One indexed single-row lookup. Everything below runs once in the database's
  // lifetime, not once per cold isolate: the previous version ran
  // COUNT(*) FROM bars here, which scanned the whole table on every request and
  // is what exhausted the daily row-read budget.
  try {
    const v = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    if (v && v.value === SCHEMA_VERSION) { schemaReady = true; return; }
  } catch (e) { /* meta does not exist yet: fall through and build it */ }
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  // Migrations for a database created by v1.
  try { await db.prepare('ALTER TABLE symbols ADD COLUMN last_backfill_at INTEGER').run(); } catch (e) { /* already there */ }
  try { await db.prepare('ALTER TABLE runs ADD COLUMN finished_at INTEGER').run(); } catch (e) { /* already there */ }
  try { await db.prepare("ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'").run(); } catch (e) { /* already there */ }
  // v1 stored bars but had no days table. Probe with LIMIT 1 on each side —
  // constant cost — and only then pay for the one-time rebuild.
  const anyDay = await db.prepare('SELECT 1 AS x FROM days LIMIT 1').first();
  const anyBar = await db.prepare('SELECT 1 AS x FROM bars LIMIT 1').first();
  if (!anyDay && anyBar) {
    await db.prepare(`INSERT OR REPLACE INTO days (symbol, date, bars, revisions, first, last)
      SELECT symbol, date, COUNT(*), SUM(revisions), MIN(time), MAX(time) FROM bars GROUP BY symbol, date`).run();
  }
  // Index work is NOT done here. It writes a row per existing bar, and doing
  // that inside whichever request happens to be first after a deploy is what
  // spent a whole day's write budget in one page load.
  await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").bind(SCHEMA_VERSION).run();
  schemaReady = true;
}

// Runs the outstanding index builds if today can afford them. Called from cron
// and from an explicit route, never from an ordinary request: creating an index
// writes one row per existing bar, which on this database was 46,821 writes in
// a single page load.
async function buildIndexes(db, env, force) {
  const built = [];
  const have = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()).results.map(r => r.name));
  const missing = HEAVY_INDEXES.filter(x => !have.has(x.name));
  if (!missing.length) {
    if (have.has('bars_symbol_date')) {
      try { await db.prepare('DROP INDEX IF EXISTS bars_symbol_date').run(); built.push('dropped superseded bars_symbol_date'); } catch (e) {}
    }
    return { done: true, built: built, note: 'all indexes present' };
  }
  const u = await usageToday(db);
  if (!force && u.writes > WRITE_LIMIT * INDEX_BUDGET) {
    await logEvent(env, 'warn', 'index_deferred',
      missing.map(x => x.name).join(',') + ' deferred: writes already at ' + u.write_pct + '%', { writes: u.writes });
    return { done: false, built: [], deferred: missing.map(x => x.name), reason: 'writes at ' + u.write_pct + '% of the daily budget' };
  }
  for (const ix of missing) {
    try {
      await db.prepare(ix.sql).run();
      built.push(ix.name);
      await logEvent(env, 'info', 'index_built', ix.name + ' created');
    } catch (e) {
      await logEvent(env, 'error', 'index_failed', ix.name + ': ' + ((e && e.message) || e));
    }
  }
  try { await db.prepare('DROP INDEX IF EXISTS bars_symbol_date').run(); } catch (e) {}
  return { done: true, built: built };
}

async function trackedSymbols(db, env) {
  const { results } = await db.prepare('SELECT symbol, last_bar_unix FROM symbols ORDER BY symbol').all();
  if (results.length) return results;
  const seed = String(env?.SYMBOLS || DEFAULT_SYMBOLS).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const t = nowSec();
  await db.batch(seed.map(s => db.prepare('INSERT OR IGNORE INTO symbols (symbol, added_at) VALUES (?, ?)').bind(s, t)));
  return seed.map(symbol => ({ symbol, last_bar_unix: null }));
}

// ---------------------------------------------------------------- time

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});
function localDateTime(unix) {
  const p = fmt.formatToParts(new Date(unix * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const todayLocal = () => localDateTime(nowSec()).date;

// Fetching upstream outside the session returns the same bars every time: no
// new data, but the bookkeeping rows are written anyway. Left running
// overnight that alone spent more than half a day's write budget.
function marketOpen(unix) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date((unix || nowSec()) * 1000)).reduce((a, x) => (a[x.type] = x.value, a), {});
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const hm = p.hour + ':' + p.minute;
  return hm >= '09:30' && hm < '16:01';
}

// ---------------------------------------------------------------- upstream

async function fetchYahoo(sym, range) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=${range}&includePrePost=false`;
  let r;
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status !== 200) return { bars: [], error: `upstream HTTP ${res.status}` };
    const j = await res.json();
    r = j?.chart?.result?.[0];
    if (!r) return { bars: [], error: j?.chart?.error?.description || 'no result from upstream' };
  } catch (e) {
    return { bars: [], error: String(e?.message || e) };
  }
  const now = nowSec();
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (ts[i] + 60 > now) continue;                       // forming bar: never stored
    bars.push({ unix: ts[i], o: rnd(o, 4), h: rnd(h, 4), l: rnd(l, 4), c: rnd(c, 4), v: q.volume?.[i] ?? 0 });
  }
  return { bars, error: null };
}




// ---------------------------------------------------------------- system log
//
// Deliberately NOT in D1. A log that lives inside the database it is supposed to
// report on goes dark exactly when it matters — which is what happened when the
// D1 read budget ran out and both the service and its own run history became
// unreadable at the same moment. This writes to Workers KV: separate product,
// separate quota, separate failure mode.
//
// KV free tier is 1,000 writes/day, so only notable events are recorded: errors,
// quota trouble, cron outcomes, migrations. A day is one key holding a capped
// array; reading it never touches D1.
const LOG_KEEP_DAYS = 30, LOG_MAX_PER_DAY = 300, LOG_WRITE_CAP = 400;
let logWrites = { day: null, n: 0 };

async function logEvent(env, level, code, message, extra) {
  if (!env || !env.LOG) return false;                     // no KV bound: silently skip
  const day = new Date().toISOString().slice(0, 10);
  if (logWrites.day !== day) logWrites = { day: day, n: 0 };
  if (logWrites.n >= LOG_WRITE_CAP) return false;         // never burn the KV write budget
  const key = 'log:' + day;
  try {
    const cur = await env.LOG.get(key, 'json');
    const list = Array.isArray(cur) ? cur : [];
    list.push({ t: new Date().toISOString(), level: level, code: code, message: String(message || ''),
      extra: extra || null });
    // newest kept, oldest dropped, so a noisy day cannot push out the whole file
    const trimmed = list.length > LOG_MAX_PER_DAY ? list.slice(list.length - LOG_MAX_PER_DAY) : list;
    await env.LOG.put(key, JSON.stringify(trimmed), { expirationTtl: LOG_KEEP_DAYS * 86400 });
    logWrites.n++;
    return true;
  } catch (e) { return false; }
}

// The last good payload per symbol/day, kept in KV. Written at most once a
// minute per symbol, and served when the budget is frozen or D1 fails, so the
// screen keeps showing real data instead of an error.
const SNAP_TTL = 3 * 86400;
let snapWrote = {};
async function snapshotPut(env, sym, date, payload) {
  if (!env || !env.LOG) return;
  const k = sym + ':' + date, now = Date.now();
  if (snapWrote[k] && now - snapWrote[k] < 60000) return;
  snapWrote[k] = now;
  try { await env.LOG.put('snap:' + k, JSON.stringify({ saved_at: new Date().toISOString(), payload: payload }),
    { expirationTtl: SNAP_TTL }); } catch (e) { /* best effort */ }
}
async function snapshotGet(env, sym, date) {
  if (!env || !env.LOG) return null;
  try { return await env.LOG.get('snap:' + sym + ':' + date, 'json'); } catch (e) { return null; }
}

async function readLog(env, days) {
  if (!env || !env.LOG) return { available: false, reason: 'KV binding "LOG" is not configured', entries: [] };
  const out = [];
  const today = new Date();
  for (let i = 0; i < (days || 7); i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    try {
      const list = await env.LOG.get('log:' + d, 'json');
      if (Array.isArray(list)) list.forEach(e => out.push(e));
    } catch (e) { /* a missing day is normal */ }
  }
  out.sort((a, b) => (a.t < b.t ? 1 : -1));
  return { available: true, days: days || 7, count: out.length, entries: out };
}

// ---------------------------------------------------------------- usage meter
//
// D1 free tier: 5,000,000 rows READ and 100,000 rows WRITTEN per day, resetting
// at 00:00 UTC. Every D1 result carries meta.rows_read / meta.rows_written, so
// the Worker measures its own consumption instead of guessing, records the
// daily total, and refuses expensive work before it hits the wall.
const READ_LIMIT = 5000000, WRITE_LIMIT = 100000;
// Tiers, not a single switch. The old guard only covered /sync and /backfill,
// so a client looping /day could still drain the day unopposed.
//   normal   < 55%   everything
//   warn     < 75%   everything, but the response says so and it is logged
//   frugal   < 90%   expensive work refused; incremental reads still served
//   frozen  >= 90%   no D1 at all; reads answered from the KV snapshot
const TIER_WARN = 0.55, TIER_FRUGAL = 0.75, TIER_FROZEN = 0.90;
const RATE_PER_MIN_DEFAULT = 240;    // per-isolate ceiling on D1-backed requests
let meter = { day: null, reads: 0, writes: 0, queries: 0, dirty: 0, lastFlush: 0 };
// Per-request accounting, so every response can state its own cost, and a
// per-route tally so an expensive endpoint cannot hide inside a daily total.
let reqMeter = { reads: 0, writes: 0, queries: 0, top: [] };
function reqStart() { reqMeter = { reads: 0, writes: 0, queries: 0, top: [] }; }

function utcDay() { return new Date().toISOString().slice(0, 10); }
// /day/NVDA/2026-09-01 -> /day/:sym/:date, so the tally groups by shape.
function routeOf(pathname) {
  const p = pathname.split('/').filter(Boolean);
  if (!p.length) return '/';
  const head = '/' + p[0];
  if (p.length === 1) return head;
  const rest = p.slice(1).map(x => /^\d{4}-\d{2}-\d{2}$/.test(x) ? ':date' : ':sym');
  return head + '/' + rest.join('/');
}
function grade(fraction) {
  return fraction >= TIER_FROZEN ? 'frozen' : fraction >= TIER_FRUGAL ? 'frugal' : fraction >= TIER_WARN ? 'warn' : 'normal';
}
// Reads and writes are separate budgets and must be graded separately. Grading
// on the worse of the two meant a spent WRITE budget also froze reading, so
// stored history became unviewable for no reason. Reading is governed by the
// read budget; anything that writes is governed by the write budget.
function tierFor(reads, writes) {
  return grade(Math.max(reads / READ_LIMIT, writes / WRITE_LIMIT));   // overall, for display
}

// A runaway loop is the realistic way to burn a day's budget in minutes, so
// D1-backed requests are also capped per minute inside each isolate.
let rate = { minute: null, n: 0 };
function rateExceeded(env) {
  const cap = Number((env && env.RATE_PER_MIN) || RATE_PER_MIN_DEFAULT);
  const m = Math.floor(Date.now() / 60000);
  if (rate.minute !== m) rate = { minute: m, n: 0 };
  rate.n++;
  return rate.n > cap;
}
function count(res) {
  const d = utcDay();
  if (meter.day !== d) meter = { day: d, reads: 0, writes: 0, queries: 0, dirty: 0, lastFlush: 0 };
  const list = Array.isArray(res) ? res : [res];
  list.forEach(r => {
    const m = r && r.meta;
    if (!m) return;
    const rd = m.rows_read || 0, wr = m.rows_written || 0;
    meter.reads += rd; meter.writes += wr; meter.queries++;
    meter.dirty += rd + wr;
    reqMeter.reads += rd; reqMeter.writes += wr; reqMeter.queries++;
    if (rd >= 200) reqMeter.top.push({ rows: rd, sql: String(r._sql || '').replace(/\s+/g, ' ').slice(0, 110) });
  });
  return res;
}
// Wraps a D1 binding so every query is metered without touching call sites.
function tag(res, sql) { if (res && typeof res === 'object') { try { res._sql = sql; } catch (e) {} } return res; }
function metered(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      const wrap = (s) => ({
        _sql: sql,
        bind: (...a) => wrap(s.bind(...a)),
        all: async () => count(tag(await s.all(), sql)),
        first: async (...a) => { const r = await s.all(); count(tag(r, sql)); const rows = r.results || []; return rows.length ? rows[0] : null; },
        run: async () => count(tag(await s.run(), sql)),
        raw: s.raw ? (...a) => s.raw(...a) : undefined,
        _inner: s
      });
      return wrap(st);
    },
    batch: async (stmts) => count((await db.batch(stmts.map(s => s._inner || s))).map((r, i) => tag(r, 'batch:' + (stmts[i] && stmts[i]._sql || '')))),
    _raw: db
  };
}
// The running total is persisted only when a request actually consumed a
// meaningful number of rows, so the meter itself stays cheap.
// Accumulated in memory and flushed at most once a minute. Writing a tally row
// per request made the accounting itself one of the biggest writers: a night of
// polling would have spent thousands of writes describing the polling.
let routeMeter = { day: null, map: {}, lastFlush: 0 };
function tallyRoute(route, r) {
  if (!r || (r.reads + r.writes) < 50) return;      // ignore trivial requests
  const d = utcDay();
  if (routeMeter.day !== d) routeMeter = { day: d, map: {}, lastFlush: 0 };
  const e = routeMeter.map[route] || (routeMeter.map[route] = { hits: 0, reads: 0, writes: 0 });
  e.hits++; e.reads += r.reads; e.writes += r.writes;
}
async function flushRoute(db) {
  const routes = Object.keys(routeMeter.map);
  if (!routes.length) return;
  const now = Date.now();
  if (now - routeMeter.lastFlush < 60000) return;
  routeMeter.lastFlush = now;
  const pending = routeMeter.map;
  routeMeter.map = {};
  try {
    await db.batch(routes.map(rt => db.prepare(
      `INSERT INTO usage_route (day, route, hits, reads, writes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day, route) DO UPDATE SET hits = hits + excluded.hits, reads = reads + excluded.reads, writes = writes + excluded.writes`)
      .bind(routeMeter.day, rt, pending[rt].hits, pending[rt].reads, pending[rt].writes)));
  } catch (e) { /* accounting must never break a request */ }
}

async function flushUsage(db) {
  // Time-based as well as size-based: a stream of 390-row reads crosses the
  // size threshold on every request, which made the meter write once per read.
  const now = Date.now();
  if (meter.dirty < 200 || now - (meter.lastFlush || 0) < 60000) return;
  meter.lastFlush = now;
  meter.dirty = 0;
  try {
    await db.prepare(`INSERT INTO usage (day, reads, writes, queries) VALUES (?, ?, ?, ?)
      ON CONFLICT(day) DO UPDATE SET reads = reads + excluded.reads, writes = writes + excluded.writes, queries = queries + excluded.queries`)
      .bind(meter.day, meter.reads, meter.writes, meter.queries).run();
    meter.reads = 0; meter.writes = 0; meter.queries = 0;
  } catch (e) { /* never let bookkeeping break a request */ }
}
async function usageToday(db) {
  try {
    const r = await db.prepare('SELECT reads, writes, queries FROM usage WHERE day = ?').bind(utcDay()).first();
    const reads = (r ? r.reads : 0) + meter.reads, writes = (r ? r.writes : 0) + meter.writes;
    return { day: utcDay(), reads, writes, queries: (r ? r.queries : 0) + meter.queries,
      read_limit: READ_LIMIT, write_limit: WRITE_LIMIT,
      read_pct: Math.round(reads / READ_LIMIT * 1000) / 10,
      write_pct: Math.round(writes / WRITE_LIMIT * 1000) / 10,
      tier: tierFor(reads, writes),
      read_tier: grade(reads / READ_LIMIT),
      write_tier: grade(writes / WRITE_LIMIT),
      over_read_guard: reads > READ_LIMIT * TIER_FRUGAL };
  } catch (e) { return { day: utcDay(), error: String((e && e.message) || e) }; }
}


// ---------------------------------------------------------------- mirror
//
// A second copy of every bar, in a database that has nothing to do with
// Cloudflare. D1 stays the fast local store the radar reads from; this is the
// one you can open from a phone, query yourself, and keep if this Worker is
// deleted tomorrow.
//
// Off unless SUPABASE_URL and SUPABASE_KEY are set, so the Worker deploys and
// runs normally without it.
function mirrorOn(env) { return !!(env && env.SUPABASE_URL && env.SUPABASE_KEY); }

async function mirrorBars(env, sym, bars) {
  if (!mirrorOn(env) || !bars || !bars.length) return { skipped: true };
  const rows = bars.map(b => {
    const { date, time } = localDateTime(b.unix);
    // revisions / first_seen / updated_at cannot be recomputed from OHLCV, so a
    // mirror without them is a copy of the prices but not of the history.
    return { symbol: sym, unix: b.unix, date: date, time: time,
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
      revisions: b.revisions == null ? 0 : b.revisions,
      first_seen: b.first_seen == null ? null : b.first_seen,
      updated_at: b.updated_at == null ? null : b.updated_at };
  });
  try {
    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/bars?on_conflict=symbol,unix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_KEY,
        Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
    if (res.status >= 300) return { error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160) };
    return { mirrored: rows.length };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

// Reads straight from the mirror, so the answer proves the copy is real and
// readable without touching D1 at all.
async function mirrorRead(env, sym, date, limit) {
  if (!mirrorOn(env)) return { available: false, reason: 'SUPABASE_URL / SUPABASE_KEY are not set' };
  const q = new URLSearchParams({ select: '*', symbol: 'eq.' + sym, order: 'unix.asc', limit: String(limit || 500) });
  if (date) q.set('date', 'eq.' + date);
  try {
    const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/bars?' + q.toString(), {
      headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY }
    });
    const txt = await res.text();
    if (res.status >= 300) return { available: true, error: 'HTTP ' + res.status + ' ' + txt.slice(0, 200) };
    return { available: true, rows: JSON.parse(txt) };
  } catch (e) { return { available: true, error: String((e && e.message) || e) }; }
}

// The SQL to run once in the Supabase editor. Served rather than documented so
// it cannot drift from the columns actually written.
const MIRROR_SCHEMA = `create table if not exists bars (
  symbol text not null,
  unix   bigint not null,
  date   text not null,
  time   text not null,
  open   double precision,
  high   double precision,
  low    double precision,
  close  double precision,
  volume bigint,
  revisions   integer default 0,
  first_seen  bigint,
  updated_at  bigint,
  primary key (symbol, unix)
);
create index if not exists bars_symbol_date_unix on bars (symbol, date, unix);

-- read-only access for the anon key, so a phone can read but not change
alter table bars enable row level security;
drop policy if exists "read bars" on bars;
create policy "read bars" on bars for select to anon using (true);`;


// ---------------------------------------------------------------- archive
//
// The long-term store for many symbols, in Supabase. Separate from the mirror:
// the mirror is a like-for-like copy of what D1 holds for the radar's handful
// of symbols; this is a narrow, high-volume archive built to hold a hundred
// symbols for a rolling two months without approaching the 500 MB ceiling.
//
// The schema is deliberately lean. Every byte is multiplied by 1.6 million:
//   - symbol_id  a small integer, not the text symbol (a lookup table holds it)
//   - unix       one integer; date and time are derived, never stored
//   - o/h/l/c    integers at 1/10000 of a currency unit, not floats
// That takes a bar from roughly 139 bytes in the current wide schema to ~70.
// The starting universe: the 100 largest US listings by market capitalisation.
// Held here rather than fetched, because a list that changes under you silently
// is worse than one you can see and edit. Roughly 110 MB at a rolling two
// months, about a fifth of the free Supabase tier.
const ARCHIVE_UNIVERSE = [
  'NVDA','MSFT','AAPL','GOOGL','AMZN','META','AVGO','TSLA','BRK-B','JPM',
  'WMT','LLY','V','ORCL','MA','NFLX','XOM','COST','JNJ','HD',
  'PG','PLTR','ABBV','BAC','KO','UNH','CVX','TMUS','CRM','CSCO',
  'WFC','PM','IBM','ABT','MCD','LIN','GE','MRK','AXP','DIS',
  'NOW','MS','ISRG','PEP','T','GS','AMD','RTX','INTU','QCOM',
  'BKNG','TXN','ADBE','CAT','SPGI','VZ','BSX','PGR','BLK','SCHW',
  'AMGN','HON','NEE','TJX','SYK','UNP','ETN','C','LOW','BX',
  'DE','ADP','COP','FI','PANW','MDT','GILD','VRTX','LMT','ADI',
  'MU','BMY','CB','SBUX','PLD','MMC','KKR','ANET','MDLZ','SO',
  'INTC','CRWD','ICE','AMT','DUK','APH','KLAC','WM','ELV','CME'
];
const ARCHIVE_DAYS = 42;             // a rolling two months of trading days
const PRICE_SCALE = 10000;

const ARCHIVE_SCHEMA = `-- run once in the Supabase SQL editor
create table if not exists archive_symbols (
  id     smallint primary key,
  symbol text not null unique
);

create table if not exists archive_bars (
  symbol_id smallint not null references archive_symbols(id),
  unix      integer  not null,
  o integer not null, h integer not null, l integer not null, c integer not null,
  v integer not null,
  primary key (symbol_id, unix)
);

-- the archive is read by symbol and time range, which the primary key already
-- serves; no second index, because an index on 1.6M rows is not free either

alter table archive_bars    enable row level security;
alter table archive_symbols enable row level security;

-- dropped first so the whole script can be re-run safely; Postgres has no
-- an "if not exists" form for policies, and a half-applied script is worse than none
drop policy if exists "read bars"    on archive_bars;
drop policy if exists "read symbols" on archive_symbols;
create policy "read bars"    on archive_bars    for select to anon using (true);
create policy "read symbols" on archive_symbols for select to anon using (true);`;

function encodeBar(b) {
  return { unix: b.unix,
    o: Math.round(b.o * PRICE_SCALE), h: Math.round(b.h * PRICE_SCALE),
    l: Math.round(b.l * PRICE_SCALE), c: Math.round(b.c * PRICE_SCALE),
    v: Math.round(b.v || 0) };
}
function decodeBar(r, sym) {
  const { date, time } = localDateTime(r.unix);
  return { symbol: sym, unix: r.unix, date, time,
    open: r.o / PRICE_SCALE, high: r.h / PRICE_SCALE,
    low: r.l / PRICE_SCALE, close: r.c / PRICE_SCALE, volume: r.v };
}

async function sb(env, path, opts) {
  // The options are spread FIRST and the headers built afterwards. Doing it the
  // other way round let an opts.headers containing Prefer or Range replace the
  // whole header object, apikey included — which reads as "No API key found".
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ apikey: env.SUPABASE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_KEY, 'Content-Type': 'application/json' },
    (opts && opts.headers) || {});
  const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, o);
  const txt = await res.text();
  if (res.status >= 300) throw new Error('supabase HTTP ' + res.status + ': ' + txt.slice(0, 200));
  return { status: res.status, text: txt, headers: res.headers };
}

// Where the nightly pass left off, so successive cron invocations continue
// through the universe instead of all starting at the top.
async function archiveCursor(db, set) {
  if (set != null) {
    await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('archive_cursor', ?)").bind(String(set)).run();
    return set;
  }
  const r = await db.prepare("SELECT value FROM meta WHERE key = 'archive_cursor'").first();
  return r ? parseInt(r.value, 10) || 0 : 0;
}

// symbol -> small integer, cached for the life of the isolate
let archiveIds = null;
async function archiveId(env, sym) {
  if (!archiveIds) {
    const r = await sb(env, 'archive_symbols?select=id,symbol');
    archiveIds = {};
    JSON.parse(r.text).forEach(x => { archiveIds[x.symbol] = x.id; });
  }
  if (archiveIds[sym] != null) return archiveIds[sym];
  // A miss may just mean this isolate's cache predates another isolate adding
  // the symbol. Re-read once before minting a new id, or two isolates race and
  // the archive ends up with the same symbol under two ids.
  const fresh = await sb(env, 'archive_symbols?select=id,symbol');
  archiveIds = {};
  JSON.parse(fresh.text).forEach(x => { archiveIds[x.symbol] = x.id; });
  if (archiveIds[sym] != null) return archiveIds[sym];
  const next = Object.keys(archiveIds).length
    ? Math.max(...Object.values(archiveIds)) + 1 : 1;
  await sb(env, 'archive_symbols?on_conflict=symbol', { method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: next, symbol: sym }]) });
  archiveIds[sym] = next;
  return next;
}

async function archiveWrite(env, sym, bars) {
  if (!mirrorOn(env) || !bars || !bars.length) return { written: 0 };
  const id = await archiveId(env, sym);
  let written = 0;
  for (let i = 0; i < bars.length; i += 1000) {
    const chunk = bars.slice(i, i + 1000).map(b => Object.assign({ symbol_id: id }, encodeBar(b)));
    await sb(env, 'archive_bars?on_conflict=symbol_id,unix', { method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk) });
    written += chunk.length;
  }
  return { written };
}

async function archiveRead(env, sym, fromUnix, toUnix, limit) {
  const id = await archiveId(env, sym);
  const q = new URLSearchParams({ select: 'unix,o,h,l,c,v', symbol_id: 'eq.' + id,
    order: 'unix.asc', limit: String(limit || 5000) });
  if (fromUnix) q.append('unix', 'gte.' + fromUnix);
  if (toUnix) q.append('unix', 'lte.' + toUnix);
  const r = await sb(env, 'archive_bars?' + q.toString());
  return JSON.parse(r.text).map(x => decodeBar(x, sym));
}

// Drops whatever has fallen out of the rolling window, so storage reaches a
// steady state instead of growing until the ceiling is hit.
async function archivePrune(env) {
  const cutoff = nowSec() - ARCHIVE_DAYS * 86400 * (7 / 5);   // calendar days for 42 trading days
  const r = await sb(env, 'archive_bars?unix=lt.' + Math.floor(cutoff),
    { method: 'DELETE', headers: { Prefer: 'count=exact,return=minimal' } });
  const cr = r.headers.get('content-range') || '';
  return { cutoff: Math.floor(cutoff), deleted: cr.indexOf('/') >= 0 ? cr.split('/')[1] : 'unknown' };
}

// ---------------------------------------------------------------- order book (Cboe)
//
// The Cboe Book Viewer publishes the top five bids and asks for each of the four
// Cboe US equity venues. That is a REAL order book, but only Cboe's share of the
// tape — ARCA, NYSE and Nasdaq are not in it, and the books are shallow. Treat
// it as one window on the market, never as the NBBO.
//
// The viewer loads its data from a JSON endpoint. The exact path has moved
// between site versions, so several known shapes are tried in order and the
// first one that parses wins; /bookprobe reports what each one returned.
const BOOK_VENUES = ['bzx', 'byx', 'edgx', 'edga'];
const BOOK_URLS = [
  function (mkt, sym) { return 'https://www.cboe.com/json/' + mkt + '/book/' + sym; },
  function (mkt, sym) { return 'https://www.cboe.com/json/' + mkt + '/book/' + sym + '.json'; },
  function (mkt, sym) { return 'https://markets.cboe.com/json/' + mkt + '/book/' + sym; },
  function (mkt, sym) { return 'https://www.cboe.com/us/equities/market_statistics/book/' + mkt + '/json/' + sym; }
];
const BOOK_HEADERS = { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', Referer: 'https://www.cboe.com/us/equities/market_statistics/book_viewer/' };

// Cboe returns rows as [price, shares] or [shares, price] depending on version;
// the side is decided by magnitude, not by position, so both shapes work.
function parseLevels(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(function (r) {
    if (Array.isArray(r)) {
      var a = Number(r[0]), b = Number(r[1]);
      if (!isFinite(a) || !isFinite(b)) return null;
      // shares are whole and usually larger; price carries decimals
      var price = (a % 1 !== 0 || a < b) ? a : b;
      var shares = price === a ? b : a;
      return { price: price, shares: Math.round(shares) };
    }
    if (r && typeof r === 'object') {
      var p = Number(r.price != null ? r.price : r.p), s = Number(r.shares != null ? r.shares : r.size);
      if (!isFinite(p) || !isFinite(s)) return null;
      return { price: p, shares: Math.round(s) };
    }
    return null;
  }).filter(Boolean).slice(0, 5);
}

async function fetchVenueBook(mkt, sym) {
  for (var i = 0; i < BOOK_URLS.length; i++) {
    var url = BOOK_URLS[i](mkt, sym);
    try {
      var res = await fetch(url, { headers: BOOK_HEADERS });
      if (res.status !== 200) continue;
      var txt = await res.text();
      var j;
      try { j = JSON.parse(txt); } catch (e) { continue; }
      var d = j.data || j;
      var bids = parseLevels(d.bids || d.bid), asks = parseLevels(d.asks || d.ask);
      if (!bids.length && !asks.length) continue;
      return { venue: mkt.toUpperCase(), url: url, bids: bids, asks: asks,
        volume: d.volume != null ? d.volume : null, last: d.last_price != null ? d.last_price : null };
    } catch (e) { /* try the next shape */ }
  }
  return { venue: mkt.toUpperCase(), error: 'no usable response', bids: [], asks: [] };
}

function summariseBook(venues) {
  var bidShares = 0, askShares = 0, bestBid = null, bestAsk = null, ok = [];
  venues.forEach(function (v) {
    if (v.error) return;
    ok.push(v.venue);
    v.bids.forEach(function (l) { bidShares += l.shares; });
    v.asks.forEach(function (l) { askShares += l.shares; });
    if (v.bids[0] && (bestBid == null || v.bids[0].price > bestBid)) bestBid = v.bids[0].price;
    if (v.asks[0] && (bestAsk == null || v.asks[0].price < bestAsk)) bestAsk = v.asks[0].price;
  });
  var tot = bidShares + askShares;
  return {
    venues_ok: ok, venues_failed: venues.filter(function (v) { return v.error; }).map(function (v) { return v.venue; }),
    bid_shares: bidShares, ask_shares: askShares,
    bid_pct: tot > 0 ? Math.round(bidShares / tot * 100) : null,
    ask_pct: tot > 0 ? 100 - Math.round(bidShares / tot * 100) : null,
    imbalance: tot > 0 ? Math.round((bidShares - askShares) / tot * 100) : null,
    best_bid: bestBid, best_ask: bestAsk,
    spread: bestBid != null && bestAsk != null ? Math.round((bestAsk - bestBid) * 10000) / 10000 : null,
    depth_levels: 5,
    coverage: 'Cboe BZX/BYX/EDGX/EDGA only — not the consolidated book (no ARCA/NYSE/Nasdaq)'
  };
}

// ---------------------------------------------------------------- write

// A row is written only when it is new or one of its values changed.
// Unchanged re-fetches cost zero writes, which is what keeps 13 symbols
// polled every 5 minutes at ~5k writes/day instead of ~50k.
const UPSERT = `INSERT INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  ON CONFLICT(symbol, unix) DO UPDATE SET
    open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
    volume = excluded.volume, updated_at = excluded.updated_at, revisions = revisions + 1
  WHERE open != excluded.open OR high != excluded.high OR low != excluded.low
     OR close != excluded.close OR volume != excluded.volume`;

const DAYS_REFRESH = `INSERT INTO days (symbol, date, bars, revisions, first, last)
  SELECT symbol, date, COUNT(*), SUM(revisions), MIN(time), MAX(time)
  FROM bars WHERE symbol = ? AND date = ? GROUP BY symbol, date
  ON CONFLICT(symbol, date) DO UPDATE SET
    bars = excluded.bars, revisions = excluded.revisions, first = excluded.first, last = excluded.last`;

// Subrequest budget per symbol: 1 fetch + ceil(stmts/BATCH) D1 batches.
// Incremental: ~20 rows -> 2 subrequests. Full 5-day: ~1950 rows -> ~21.
let mirrorQueue = [], env0 = null;
async function syncSymbol(db, sym, range, { incremental = false, lastBarUnix = null, backfill = false } = {}) {
  const t = nowSec();
  const { bars: all, error } = await fetchYahoo(sym, range);
  if (error) {
    // Never auto-track a symbol that has not succeeded once: a typo would
    // otherwise become a permanent cron failure.
    await db.prepare('UPDATE symbols SET last_fetch_at = ?, last_error = ? WHERE symbol = ?').bind(t, error, sym).run();
    return { symbol: sym, rows: 0, error };
  }
  let bars = all;
  if (incremental && lastBarUnix) bars = all.filter(b => b.unix > lastBarUnix - OVERLAP_BARS * 60);

  const dates = new Set();
  const stmts = bars.map(b => {
    const { date, time } = localDateTime(b.unix);
    dates.add(date);
    return db.prepare(UPSERT).bind(sym, b.unix, date, time, b.o, b.h, b.l, b.c, b.v, t, t);
  });
  for (const d of dates) stmts.push(db.prepare(DAYS_REFRESH).bind(sym, d));
  const last = bars.length ? bars[bars.length - 1].unix : null;
  stmts.push(db.prepare(
    'INSERT INTO symbols (symbol, added_at, last_fetch_at, last_bar_unix, last_error, last_backfill_at) VALUES (?, ?, ?, ?, NULL, ?) ' +
    'ON CONFLICT(symbol) DO UPDATE SET last_fetch_at = excluded.last_fetch_at, last_error = NULL, ' +
    'last_bar_unix = NULLIF(MAX(COALESCE(symbols.last_bar_unix, 0), COALESCE(excluded.last_bar_unix, 0)), 0), ' +
    'last_backfill_at = COALESCE(excluded.last_backfill_at, symbols.last_backfill_at)')
    .bind(sym, t, t, last, backfill ? t : null));

  // The bars are written first. The day counters and the symbol bookkeeping
  // row are only touched if a bar actually changed, so a poll that finds
  // nothing new costs zero writes instead of two per symbol per call.
  let changes = 0;
  const barStmts = stmts.slice(0, bars.length);
  for (let i = 0; i < barStmts.length; i += BATCH) {
    const res = await db.batch(barStmts.slice(i, i + BATCH));
    for (const r of res) changes += r?.meta?.changes || 0;
  }
  const bookkeeping = stmts.slice(bars.length);
  const firstContact = !lastBarUnix;
  if (changes > 0 || firstContact) {
    for (let i = 0; i < bookkeeping.length; i += BATCH) {
      const res = await db.batch(bookkeeping.slice(i, i + BATCH));
      for (const r of res) changes += r?.meta?.changes || 0;
    }
  } else {
    // Nothing changed. Record that we looked, at most once every five minutes,
    // and always clear a stale error so a recovered symbol stops reading as
    // broken.
    await db.prepare('UPDATE symbols SET last_fetch_at = ?, last_error = NULL WHERE symbol = ? AND (last_error IS NOT NULL OR last_fetch_at IS NULL OR ? - last_fetch_at > 300)')
      .bind(t, sym, t).run();
  }
  // Send the same bars to the mirror. Only when something actually changed, so
  // a quiet poll costs no upstream call here either.
  if (changes > 0 && mirrorOn(env0)) {
    // re-read what was actually stored, so the mirror carries the bookkeeping
    // columns rather than just what came off the wire
    const { results: stored } = await db.prepare(
      'SELECT unix, open, high, low, close, volume, revisions, first_seen, updated_at FROM bars WHERE symbol = ? AND unix >= ? ORDER BY unix')
      .bind(sym, bars.length ? bars[0].unix : 0).all();
    mirrorQueue.push({ sym: sym, bars: stored.map(x => ({ unix: x.unix, o: x.open, h: x.high, l: x.low, c: x.close, v: x.volume,
      revisions: x.revisions, first_seen: x.first_seen, updated_at: x.updated_at })) });
  }

  // changes includes the day counters and the symbol row when they ran.
  const overhead = (changes > 0 || firstContact) ? 1 + dates.size : 0;
  return { symbol: sym, rows: bars.length, written: Math.max(0, changes - overhead), error: null };
}

// Logs the run BEFORE doing work, so a crash mid-way (e.g. a platform limit)
// still leaves a visible 'running' row instead of silence.
async function syncMany(db, entries, range, kind, opts = {}) {
  const started = nowSec();
  const run = await db.prepare('INSERT INTO runs (started_at, kind, symbols, rows_written, status) VALUES (?, ?, ?, 0, ?) RETURNING id')
    .bind(started, kind, entries.length, 'running').first();
  const results = [];
  for (const e of entries) {
    // Sequential on purpose: parallel hits on Yahoo from one IP get throttled.
    try {
      results.push(await syncSymbol(db, e.symbol, range, { ...opts, lastBarUnix: e.last_bar_unix }));
    } catch (err) {
      results.push({ symbol: e.symbol, rows: 0, error: 'exception: ' + String(err?.message || err) });
    }
  }
  const errors = results.filter(r => r.error).map(r => `${r.symbol}: ${r.error}`);
  const written = results.reduce((a, r) => a + (r.written || 0), 0);
  const status = results.length && errors.length === results.length ? 'failed' : errors.length ? 'partial' : 'ok';
  await db.prepare('UPDATE runs SET finished_at = ?, status = ?, rows_written = ?, errors = ? WHERE id = ?')
    .bind(nowSec(), status, written, errors.length ? errors.join(' | ') : null, run.id).run();
  return { kind, run_id: run.id, status, started_at: started, rows_written: written, results };
}

// ---------------------------------------------------------------- read

function toCsvRows(sym, rows) {
  const avg = rows.length ? rows.reduce((s, r) => s + r.volume, 0) / rows.length : 0;
  return rows.map(r => {
    const range = r.high - r.low;
    const pct = x => (range > 0 ? rnd((x / range) * 100, 1) : 0);
    const dir = r.close > r.open ? 'BULL' : r.close < r.open ? 'BEAR' : 'FLAT';
    return [sym, r.date, r.time, r.open, r.high, r.low, r.close, r.volume, dir,
      pct(Math.abs(r.close - r.open)), pct(r.high - Math.max(r.open, r.close)),
      pct(Math.min(r.open, r.close) - r.low), rnd(range, 4), avg > 0 ? rnd(r.volume / avg, 2) : 0].join(',');
  });
}
// Reading a whole session costs ~390 row reads. The radar refreshes every
// minute, so it asks for `since` and gets only what it does not already hold.
const readDay = async (db, sym, date, since) =>
  since
    ? (await db.prepare('SELECT * FROM bars WHERE symbol = ? AND date = ? AND unix > ? ORDER BY unix').bind(sym, date, since).all()).results
    : (await db.prepare('SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix').bind(sym, date).all()).results;

// ---------------------------------------------------------------- http

const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o, null, 2), { status, headers: { ...H, 'Content-Type': 'application/json', ...extra } });
const text = (s, status = 200, extra = {}) => new Response(s, { status, headers: { ...H, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
const validSym = s => /^[A-Z0-9.\-]{1,10}$/.test(s);
const intParam = (params, name) => { const v = parseInt(params.get(name), 10); return Number.isFinite(v) && v > 0 ? v : null; };

function authorized(req, url, env) {
  if (!env?.API_KEY) return true;                       // not configured yet: open
  const k = url.searchParams.get('key') || req.headers.get('X-Api-Key');
  return k === env.API_KEY;
}

export default {
  // Any uncaught error becomes Cloudflare's opaque 1101 page, which says
  // nothing. Wrap the whole handler so a failure returns the actual message,
  // the route and the stack instead.
  async fetch(req, env, ctx) {
    try {
      reqStart();
      env0 = env;                       // syncSymbol needs it to know whether to mirror
      const res = await handle(req, env, ctx);
      // Every response states what it cost. A single expensive endpoint can no
      // longer hide inside a daily total.
      try {
        res.headers.set('X-Rows-Read', String(reqMeter.reads));
        res.headers.set('X-Rows-Written', String(reqMeter.writes));
        res.headers.set('X-Queries', String(reqMeter.queries));
        if (reqMeter.top.length) {
          const worst = reqMeter.top.slice().sort((a, b) => b.rows - a.rows)[0];
          res.headers.set('X-Top-Query', worst.rows + ' rows: ' + worst.sql);
        }
      } catch (e) { /* immutable headers on some responses */ }
      if (mirrorQueue.length) {
        const q = mirrorQueue; mirrorQueue = [];
        ctx.waitUntil((async () => {
          for (const item of q) {
            const r = await mirrorBars(env, item.sym, item.bars);
            if (r && r.error) await logEvent(env, 'warn', 'mirror_failed', item.sym + ': ' + r.error);
          }
        })());
      }
      if (env.DB) {
        const snapshot = { reads: reqMeter.reads, writes: reqMeter.writes, queries: reqMeter.queries, top: reqMeter.top.slice() };
        const routeName = routeOf(new URL(req.url).pathname);
        ctx.waitUntil((async () => {
          tallyRoute(routeName, snapshot);
          const d = metered(env.DB);
          await flushRoute(d);
          await flushUsage(d);
          if (snapshot.reads >= 20000) {
            await logEvent(env, 'warn', 'expensive_request', routeName + ' read ' + snapshot.reads + ' rows',
              { reads: snapshot.reads, top: snapshot.top.sort((a, b) => b.rows - a.rows).slice(0, 3) });
          }
        })());
      }
      return res;
    } catch (e) {
      const msg = String((e && e.message) || e);
      const quota = /exceeded|limit/i.test(msg);
      // Recorded in KV, which survives a dead D1.
      ctx.waitUntil(logEvent(env, quota ? 'quota' : 'error', quota ? 'd1_limit' : 'exception', msg,
        { path: new URL(req.url).pathname, stack: e && e.stack ? String(e.stack).split('\n').slice(1, 4) : null }));
      return new Response(JSON.stringify({
        error: true, where: 'worker.fetch', path: new URL(req.url).pathname,
        message: String((e && e.message) || e),
        stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6) : null,
        time: new Date().toISOString()
      }, null, 2), { status: 500, headers: { ...H, 'Content-Type': 'application/json' } });
    }
  },

  async scheduled(event, env, ctx) {
    try {
      await scheduledRun(event, env, ctx);
    } catch (e) {
      const msg = String((e && e.message) || e);
      await logEvent(env, /exceeded|limit/i.test(msg) ? 'quota' : 'error', 'cron_failed', msg, { cron: event.cron });
    }
  }
};

async function handle(req, env, ctx) {
  {
    // These answer without touching D1 on purpose: they must work when the
    // database is the thing that is broken.
    const url0 = new URL(req.url);
    const early = url0;
    const p0 = early.pathname.split('/').filter(Boolean);
    if (p0[0] === 'log') {
      const d = parseInt(early.searchParams.get('days'), 10);
      return json(await readLog(env, Number.isFinite(d) && d > 0 ? Math.min(d, LOG_KEEP_DAYS) : 7));
    }
    if (p0[0] === 'logtest') {
      const ok = await logEvent(env, 'info', 'manual_test', 'written from /logtest');
      return json({ wrote: ok, kv_bound: !!env.LOG,
        note: ok ? 'check /log' : (env.LOG ? 'write failed or daily cap reached' : 'bind a KV namespace named LOG') });
    }
    // Browsers request this on every page load. It has nothing to do with the
    // database, and answering it through the D1 path was quietly spending the
    // read budget on an icon — found by the KV log, which recorded two D1
    // quota failures whose path was /favicon.ico.
    if (p0[0] === 'favicon.ico') return new Response(null, { status: 204, headers: { 'Cache-Control': 'public, max-age=86400' } });
    // Static pages are served before any D1 work for the same reason.
    if (p0[0] === 'radar') return new Response(RADAR_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    if (p0[0] === 'data') return new Response(DATA_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    if (p0[0] === 'db') return new Response(DB_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    if (p0[0] === 'view') {
      if (p0[1] && !validSym(p0[1].toUpperCase())) return json({ error: 'bad symbol' }, 400);
      return new Response(VIEW_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    const db = env.DB ? metered(env.DB) : null;
    if (!db) return json({ error: 'D1 binding "DB" is missing. Worker Settings → Bindings → D1 → name it DB.' }, 500);

    // Everything below touches the database, so the budget is checked once here
    // rather than route by route.
    if (rateExceeded(env)) {
      const cap = Number(env.RATE_PER_MIN || RATE_PER_MIN_DEFAULT);
      ctx.waitUntil(logEvent(env, 'warn', 'rate_limited', 'more than ' + cap + ' D1 requests in a minute', { path: url0.pathname }));
      return json({ error: 'too many requests', limit_per_minute: cap,
        note: 'this cap exists so a runaway loop cannot drain the daily database budget' }, 429);
    }
    await ensureSchema(db);
    const budget = await usageToday(db);
    if (budget.tier === 'warn') ctx.waitUntil(logEvent(env, 'warn', 'budget_warn', 'past ' + Math.round(TIER_WARN * 100) + '% of the daily budget',
      { reads: budget.reads, read_pct: budget.read_pct, writes: budget.writes, write_pct: budget.write_pct }));

    const url = new URL(req.url);
    const [route, a, b] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const sym = a ? a.toUpperCase() : null;
    const asJson = url.searchParams.get('format') === 'json';
    const t = nowSec();

    if (!route) {
      const syms = await trackedSymbols(db, env);
      const last = await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').first();
      return json({ ok: true, time: new Date().toISOString(), today_et: todayLocal(), tracked: syms.map(s => s.symbol),
        auth: env?.API_KEY ? 'writes require key' : 'OPEN — set the API_KEY secret', last_run: last,
        usage: ['/radar', '/data', '/board', '/db', '/log', '/mirror', '/export/NVDA', '/table/symbols', '/view/NVDA', '/book/NVDA', '/selfcheck', '/status', '/days/NVDA', '/day/NVDA', '/day/NVDA/2026-08-31', '/sync', '/sync/NVDA', '/backfill/NVDA'] });
    }


    if (route === 'migrate') {
      if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
      return json(await buildIndexes(db, env, url.searchParams.get('force') === '1'));
    }

    if (route === 'table') {
      // Read-only browsing of the small tables. bars is deliberately not here:
      // it is the only large one, and it is served by /day and /board, which
      // are indexed. A whitelist rather than free SQL, so no query can scan.
      const ALLOWED = { symbols: 'symbol', days: 'symbol, date', runs: 'id DESC', usage: 'day DESC', usage_route: 'reads DESC', meta: 'key' };
      if (!a) return json({ tables: Object.keys(ALLOWED), note: 'bars is served by /day and /board so a browse cannot scan it' });
      const name = String(a).toLowerCase();
      if (!(name in ALLOWED)) return json({ error: 'unknown table', tables: Object.keys(ALLOWED) }, 404);
      const limit = Math.min(intParam(url.searchParams, 'limit') || 200, 1000);
      const offset = intParam(url.searchParams, 'offset') || 0;
      const { results } = await db.prepare(
        'SELECT * FROM ' + name + ' ORDER BY ' + ALLOWED[name] + ' LIMIT ? OFFSET ?').bind(limit, offset).all();
      return json({ table: name, limit, offset, count: results.length,
        columns: results.length ? Object.keys(results[0]) : [], rows: results });
    }

    if (route === 'export' && sym && validSym(sym)) {
      // Everything stored for one symbol as a single CSV, including the
      // bookkeeping columns. Save it anywhere; it depends on nothing.
      const d2 = b;
      if (d2 && !/^\d{4}-\d{2}-\d{2}$/.test(d2)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
      const rows2 = d2
        ? (await db.prepare('SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix').bind(sym, d2).all()).results
        : (await db.prepare('SELECT * FROM bars WHERE symbol = ? ORDER BY date, unix').bind(sym).all()).results;
      const head = 'symbol,date,time,unix,open,high,low,close,volume,revisions,first_seen,updated_at';
      const body = rows2.map(x => [sym, x.date, x.time, x.unix, x.open, x.high, x.low, x.close, x.volume,
        x.revisions, x.first_seen, x.updated_at].join(','));
      return new Response([head].concat(body).join('\n') + '\n', { headers: { ...H,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + sym + (d2 ? '-' + d2 : '-all') + '.csv"',
        'X-Rows': String(rows2.length) } });
    }


    if (route === 'archive') {
      // /archive                    status and size
      // /archive/schema             SQL to paste into Supabase once
      // /archive/read/NVDA[/date]   bars back out of the archive
      // /archive/fill/NVDA[,MSFT]   pull from Yahoo straight into the archive
      // /archive/prune              drop what fell out of the rolling window
      if (a === 'schema') return text(ARCHIVE_SCHEMA);
      if (!mirrorOn(env)) return json({ error: 'archive not configured', note: 'needs SUPABASE_URL and SUPABASE_KEY' }, 400);

      if (a === 'read' && b && validSym(b.toUpperCase())) {
        const s2 = b.toUpperCase();
        const d2 = url.pathname.split('/').filter(Boolean)[3];
        let from = null, to = null;
        if (d2 && /^\d{4}-\d{2}-\d{2}$/.test(d2)) {
          from = Math.floor(Date.parse(d2 + 'T00:00:00Z') / 1000) - 86400;
          to = from + 2 * 86400;
        }
        const rows = await archiveRead(env, s2, from, to, intParam(url.searchParams, 'limit'));
        const wanted = d2 ? rows.filter(r2 => r2.date === d2) : rows;
        return json({ symbol: s2, date: d2 || null, count: wanted.length, rows: wanted });
      }

      if (a === 'fill' && b) {
        if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
        const list = b.toUpperCase().split(',').map(s => s.trim()).filter(validSym);
        if (!list.length) return json({ error: 'no valid symbols' }, 400);
        // Yahoo is one request per symbol and a Worker gets 50 subrequests, so a
        // call takes what it can and names the rest rather than failing halfway.
        const BUDGET = 40;
        const done = [], skipped = [];
        let used = 0;
        for (const s2 of list) {
          if (used >= BUDGET) { skipped.push(s2); continue; }
          try {
            const { bars, error: fe } = await fetchYahoo(s2, url.searchParams.get('range') || '5d');
            used++;
            if (fe) throw new Error(fe);
            const w2 = await archiveWrite(env, s2, bars);
            used += Math.ceil(bars.length / 1000);
            done.push({ symbol: s2, fetched: bars.length, written: w2.written });
          } catch (e) {
            done.push({ symbol: s2, error: String((e && e.message) || e) });
            await logEvent(env, 'warn', 'archive_fill_failed', s2 + ': ' + ((e && e.message) || e));
          }
        }
        return json({ filled: done, skipped,
          note: skipped.length ? 'subrequest budget reached; call again with: ' + skipped.join(',') : 'complete' });
      }

      if (a === 'prune') {
        if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
        return json(await archivePrune(env));
      }

      if (a) return json({ error: 'unknown archive subcommand', got: a,
        usage: ['/archive', '/archive/schema', '/archive/read/NVDA', '/archive/fill/NVDA', '/archive/prune'] }, 404);

      // status: how many symbols, how many bars, how much room is left
      let symbols = [], bars = null;
      try {
        symbols = JSON.parse((await sb(env, 'archive_symbols?select=id,symbol&order=symbol.asc')).text);
        const r2 = await sb(env, 'archive_bars?select=symbol_id&limit=1',
          { headers: { Prefer: 'count=exact', Range: '0-0' } });
        const cr = r2.headers.get('content-range') || '';
        bars = cr.indexOf('/') >= 0 ? parseInt(cr.split('/')[1], 10) : null;
      } catch (e) {
        return json({ error: String((e && e.message) || e),
          note: 'if the tables are missing, run the SQL from /archive/schema' }, 500);
      }
      const estBytes = bars == null ? null : bars * 70;
      const cursor = await archiveCursor(db);
      return json({ symbols: symbols.length, bars,
        universe: ARCHIVE_UNIVERSE.length,
        nightly_cursor: cursor,
        nightly_progress: Math.min(100, Math.round(cursor / ARCHIVE_UNIVERSE.length * 100)) + '%',
        estimated_mb: estBytes == null ? null : Math.round(estBytes / 1048576 * 10) / 10,
        pct_of_free_500mb: estBytes == null ? null : Math.round(estBytes / 1048576 / 500 * 1000) / 10,
        window_days: ARCHIVE_DAYS,
        tracked: symbols.map(s => s.symbol),
        note: 'one row per bar, narrow schema; storage reaches a steady state once the window fills' });
    }

    if (route === 'mirror') {
      // /mirror                 status
      // /mirror/schema          the SQL to paste into Supabase once
      // /mirror/read/NVDA[/date] read straight from the mirror, bypassing D1
      // /mirror/push/NVDA       copy a symbol's stored history into the mirror
      if (a === 'schema') return text(MIRROR_SCHEMA);
      if (a === 'read' && b && validSym(b.toUpperCase())) {
        const d = url.pathname.split('/').filter(Boolean)[3];
        return json(await mirrorRead(env, b.toUpperCase(), d || null, intParam(url.searchParams, 'limit')));
      }
      if (a === 'push') {
        if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
        if (!mirrorOn(env)) return json({ error: 'mirror not configured', note: 'set SUPABASE_URL and SUPABASE_KEY' }, 400);
        // /mirror/push/AAPL            one symbol
        // /mirror/push/AAPL,MSFT,AMZN  several
        // /mirror/push/all             everything tracked, in batches
        const want = String(b || '').toUpperCase();
        if (!want) return json({ error: 'name a symbol, a comma-separated list, or "all"' }, 400);
        let list;
        if (want === 'ALL') list = (await trackedSymbols(db, env)).map(s => s.symbol);
        else list = want.split(',').map(s => s.trim()).filter(Boolean);
        const bad = list.filter(s => !validSym(s));
        if (bad.length) return json({ error: 'bad symbol', bad: bad }, 400);

        // Each 500-bar chunk is one fetch to the mirror, and a Worker gets 50
        // subrequests per invocation. Pushing everything at once would exceed
        // that, so a call takes as many symbols as it can and reports the rest.
        const BUDGET = 40;
        const done = [], skipped = [];
        let used = 0, err = null;
        for (const s2 of list) {
          if (used >= BUDGET) { skipped.push(s2); continue; }
          const { results } = await db.prepare(
            'SELECT unix, open, high, low, close, volume, revisions, first_seen, updated_at FROM bars WHERE symbol = ? ORDER BY unix')
            .bind(s2).all();
          const bars = results.map(r2 => ({ unix: r2.unix, o: r2.open, h: r2.high, l: r2.low, c: r2.close, v: r2.volume,
            revisions: r2.revisions, first_seen: r2.first_seen, updated_at: r2.updated_at }));
          let sent = 0, symErr = null;
          for (let i = 0; i < bars.length && !symErr; i += 500) {
            const r3 = await mirrorBars(env, s2, bars.slice(i, i + 500));
            used++;
            if (r3.error) symErr = r3.error; else sent += r3.mirrored || 0;
          }
          done.push({ symbol: s2, stored: bars.length, mirrored: sent, error: symErr });
          if (symErr && !err) err = s2 + ': ' + symErr;
        }
        return json({ pushed: done, skipped: skipped,
          note: skipped.length ? 'subrequest budget reached; call again to continue with: ' + skipped.join(',') : 'complete',
          error: err });
      }
      if (a === 'verify') {
        // Counts on both sides, per symbol, so "is the backup complete" has an
        // answer instead of an assumption.
        if (!mirrorOn(env)) return json({ error: 'mirror not configured' }, 400);
        const local = (await db.prepare('SELECT symbol, SUM(bars) AS bars FROM days GROUP BY symbol ORDER BY symbol').all()).results;
        const rows = [];
        for (const l of local) {
          const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/bars?select=symbol&symbol=eq.' + l.symbol,
            { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY, Prefer: 'count=exact', Range: '0-0' } });
          const cr = res.headers.get('content-range') || '';
          const mirrored = cr.indexOf('/') >= 0 ? parseInt(cr.split('/')[1], 10) : null;
          rows.push({ symbol: l.symbol, local: l.bars, mirrored: mirrored,
            missing: mirrored == null ? null : Math.max(0, l.bars - mirrored),
            complete: mirrored != null && mirrored >= l.bars });
        }
        const incomplete = rows.filter(x => !x.complete).map(x => x.symbol);
        return json({ symbols: rows, incomplete: incomplete,
          summary: incomplete.length ? incomplete.length + ' symbol(s) not fully mirrored' : 'every symbol fully mirrored',
          push_next: incomplete.length ? '/mirror/push/' + incomplete.slice(0, 8).join(',') : null });
      }

      // An unrecognised subcommand must not fall through to the status page:
      // that made a typo look like a silent failure, which cost us an hour.
      if (a) return json({ error: 'unknown mirror subcommand', got: a,
        usage: ['/mirror', '/mirror/schema', '/mirror/read/NVDA', '/mirror/push/NVDA', '/mirror/push/all', '/mirror/verify'] }, 404);
      return json({ enabled: mirrorOn(env),
        url: env.SUPABASE_URL ? String(env.SUPABASE_URL).replace(/^(https:\/\/[^.]{4}).*/, '$1…') : null,
        note: mirrorOn(env) ? 'bars are copied to the mirror as they are written'
          : 'set SUPABASE_URL and SUPABASE_KEY as Worker secrets to enable',
        usage: ['/mirror/schema', '/mirror/read/NVDA', '/mirror/read/NVDA/2026-09-02',
          '/mirror/push/NVDA', '/mirror/push/AAPL,MSFT,AMZN', '/mirror/push/all', '/mirror/verify'] });
    }

    if (route === 'usage') {
      const routes = (await db.prepare('SELECT route, hits, reads, writes FROM usage_route WHERE day = ? ORDER BY reads DESC LIMIT 20')
        .bind(utcDay()).all()).results;
      const merged = routes.slice();
      Object.keys(routeMeter.map).forEach(rt => {
        const p = routeMeter.map[rt], found = merged.find(x => x.route === rt);
        if (found) { found.hits += p.hits; found.reads += p.reads; found.writes += p.writes; }
        else merged.push({ route: rt, hits: p.hits, reads: p.reads, writes: p.writes });
      });
      merged.sort((a, b) => b.reads - a.reads);
      return json(Object.assign({}, budget, {
        by_route: merged.map(x => Object.assign({}, x, {
          reads_per_hit: x.hits ? Math.round(x.reads / x.hits) : 0,
          pct_of_daily: Math.round(x.reads / READ_LIMIT * 1000) / 10
        })),
        note: 'reads_per_hit is the number to watch — anything in the thousands is scanning'
      }));
    }

    if (route === 'selfcheck') {
      // Which subsystem is broken, one at a time.
      const out = {};
      const step = async function (name, fn) { try { out[name] = await fn(); } catch (e) { out[name] = 'FAILED: ' + ((e && e.message) || e); } };
      await step('d1_binding', async function () { return env.DB ? 'present' : 'MISSING'; });
      await step('schema', async function () { const r = await db.prepare('SELECT COUNT(*) AS n FROM symbols').first(); return 'ok, ' + r.n + ' symbols'; });
      // COUNT(*) over bars is a full scan and D1 charges every row: this one
      // check was costing ~12k reads a hit. The counter table has the same
      // number for the price of a hundred rows.
      await step('bars_table', async function () { const r = await db.prepare('SELECT COALESCE(SUM(bars), 0) AS n FROM days').first(); return r.n + ' bars (from the days counters)'; });
      await step('days_table', async function () { const r = await db.prepare('SELECT COUNT(*) AS n FROM days').first(); return r.n + ' day rows'; });
      await step('runs_table', async function () { const r = await db.prepare('SELECT MAX(id) AS n FROM runs').first(); return (r.n || 0) + ' runs'; });
      await step('yahoo', async function () { const r = await fetchYahoo('SPY', '1d'); return r.error ? 'FAILED: ' + r.error : r.bars.length + ' bars'; });
      await step('cboe', async function () { const v = await fetchVenueBook('bzx', 'SPY'); return v.error ? 'FAILED: ' + v.error : 'ok via ' + v.url; });
      await step('view_html', async function () { return VIEW_HTML.length + ' bytes'; });
      await step('radar_html', async function () { return RADAR_HTML.length + ' bytes'; });
      await step('db_html', async function () { return DB_HTML.length + ' bytes'; });
      await step('data_html', async function () { return DATA_HTML.length + ' bytes'; });
      await step('indexes', async function () {
        const have = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all()).results.map(r => r.name));
        const missing = HEAVY_INDEXES.filter(x => !have.has(x.name)).map(x => x.name);
        return missing.length ? 'PENDING: ' + missing.join(',') + ' (built overnight, or /migrate)' : 'all present'; });
      await step('mirror', async function () { if (!mirrorOn(env)) return 'FAILED: not configured (SUPABASE_URL / SUPABASE_KEY)';
        const r = await mirrorRead(env, 'SPY', null, 1); return r.error ? 'FAILED: ' + r.error : 'ok, reachable'; });
      await step('kv_log', async function () { if (!env.LOG) return 'FAILED: KV binding "LOG" not configured';
        const r = await readLog(env, 1); return r.available ? r.count + ' entries today' : 'FAILED: ' + r.reason; });
      await step('usage_today', async function () { const u = await usageToday(db);
        return u.error ? 'FAILED: ' + u.error : u.reads.toLocaleString() + ' reads (' + u.read_pct + '% of daily) · ' + u.writes.toLocaleString() + ' writes (' + u.write_pct + '%)'; });
      return json({ selfcheck: out, time: new Date().toISOString() });
    }

    if ((route === 'book' || route === 'bookprobe') && sym && validSym(sym)) {
      const venues = await Promise.all(BOOK_VENUES.map(function (m) { return fetchVenueBook(m, sym); }));
      if (route === 'bookprobe') {
        // Diagnostic: which URL shape answered, per venue.
        return json({ symbol: sym, tried: BOOK_URLS.map(function (f) { return f('bzx', sym); }),
          venues: venues.map(function (v) { return { venue: v.venue, ok: !v.error, url: v.url || null,
            bids: v.bids.length, asks: v.asks.length, error: v.error || null }; }) });
      }
      return json({ symbol: sym, fetched_at: new Date().toISOString(),
        source: 'cboe-book-viewer', summary: summariseBook(venues), venues: venues });
    }

    if (route === 'db') {
      return new Response(DB_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (route === 'radar') {
      return new Response(RADAR_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (route === 'view') {
      if (sym && !validSym(sym)) return json({ error: 'bad symbol' }, 400);
      return new Response(VIEW_HTML, { headers: { ...H, 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (route === 'status') {
      // Reads only symbols, days and runs — never the bars table.
      const { results } = await db.prepare(
        `SELECT s.symbol, s.last_fetch_at, s.last_bar_unix, s.last_error, s.last_backfill_at,
                COALESCE(SUM(d.bars), 0) AS bars, COUNT(d.date) AS days, COALESCE(SUM(d.revisions), 0) AS revisions
         FROM symbols s LEFT JOIN days d ON d.symbol = s.symbol GROUP BY s.symbol ORDER BY s.symbol`).all();
      const runs = (await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 10').all()).results;
      const rows = results.map(r => ({ ...r, stale_seconds: r.last_bar_unix ? t - r.last_bar_unix : null,
        data_stale: r.last_bar_unix ? t - r.last_bar_unix > STALE_LIMIT : true }));
      const worst = rows.filter(r => r.stale_seconds != null).reduce((m, r) => Math.max(m, r.stale_seconds), 0);
      const usage = await usageToday(db);
      return json({ time: new Date().toISOString(), today_et: todayLocal(), usage: usage, worst_stale_seconds: worst || null,
        total_bars: rows.reduce((a, r) => a + r.bars, 0), symbols: rows, recent_runs: runs });
    }

    if (route === 'days' && sym && validSym(sym)) {
      const { results } = await db.prepare('SELECT date, bars, first, last, revisions FROM days WHERE symbol = ? ORDER BY date DESC').bind(sym).all();
      return json({ symbol: sym, days: results });
    }


    // One request for the whole board instead of one per symbol. A page refresh
    // used to cost 20 requests and 7,800 rows; with ?since= it costs one
    // request and only the bars that are actually new.
    if (route === 'board') {
      const dateQ = url.searchParams.get('date');
      if (dateQ && !/^\d{4}-\d{2}-\d{2}$/.test(dateQ)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
      const date = dateQ || todayLocal();
      const tracked = (await trackedSymbols(db, env)).map(s => s.symbol);
      const asked = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(validSym);
      const syms = asked.length ? asked.filter(s => tracked.indexOf(s) >= 0 || true) : tracked;
      if (!syms.length) return json({ date, symbols: [], rows: [] });

      const since = intParam(url.searchParams, 'since') || 0;
      if (budget.read_tier === 'frozen') {
        // Serve the last full board from KV rather than an empty answer. The
        // radar moved to this route, so this is the copy that matters now.
        const snap = await snapshotGet(env, 'BOARD', date);
        if (snap) return json(Object.assign({}, snap.payload, { from_snapshot: true, snapshot_saved_at: snap.saved_at,
          note: 'daily database budget spent; this is the last stored copy. resets at 00:00 UTC' }),
          200, { 'X-Budget-Tier': 'frozen', 'X-From-Snapshot': 'yes' });
        return json({ date, symbols: syms, rows: [], frozen: true,
          note: 'daily database budget spent and no board snapshot held; resets at 00:00 UTC' },
          200, { 'X-Budget-Tier': 'frozen', 'X-From-Snapshot': 'no' });
      }

      // One statement for every symbol, so the whole board costs a single query.
      const marks = syms.map(() => '?').join(',');
      let { results } = await db.prepare(
        `SELECT symbol, unix, date, time, open, high, low, close, volume FROM bars
         WHERE symbol IN (${marks}) AND date = ? AND unix > ? ORDER BY symbol, unix`)
        .bind(...syms, date, since).all();

      // D1 holding nothing for today does not mean there is nothing: when its
      // write budget is spent the cron cannot store bars, while the archive —
      // which is in a store with no daily cap — has them. Fall back to it
      // rather than showing an empty board.
      let fromArchive = 0;
      if (mirrorOn(env)) {
        // Per symbol, not per board. Checking whether the whole board was empty
        // meant that as soon as ONE symbol came back from D1, every other symbol
        // was left blank even though the archive held its bars.
        const have = new Set(results.map(r2 => r2.symbol));
        const missing = syms.filter(s => !have.has(s)).slice(0, 25);   // subrequest ceiling
        for (const s2 of missing) {
          try {
            const from = Math.floor(Date.parse(date + 'T00:00:00Z') / 1000) - 86400;
            const rows2 = (await archiveRead(env, s2, from, from + 2 * 86400, 500))
              .filter(r2 => r2.date === date && r2.unix > since);
            rows2.forEach(r2 => results.push(r2));
            fromArchive += rows2.length;
          } catch (e) { /* a symbol the archive does not hold is simply absent */ }
        }
        results.sort((p, q) => (p.symbol === q.symbol ? p.unix - q.unix : (p.symbol < q.symbol ? -1 : 1)));
        if (fromArchive) await logEvent(env, 'info', 'board_from_archive',
          fromArchive + ' bars served from the archive because D1 held none for ' + date);
      }
      const maxUnix = results.reduce((m, r2) => Math.max(m, r2.unix), since);
      const payload = { date, symbols: syms, since, incremental: since > 0, count: results.length,
        last_bar_unix: maxUnix || null, server_time: new Date().toISOString(),
        from_archive: fromArchive || undefined, rows: results };
      // A full board read is the snapshot worth keeping; incremental ones hold
      // only a couple of bars and would replace a good copy with a useless one.
      if (!since && results.length) ctx.waitUntil(snapshotPut(env, 'BOARD', date, payload));
      return json(payload, 200, { 'X-Budget-Tier': budget.tier, 'X-Board-Rows': String(results.length) });
    }

    if (route === 'day' && sym && validSym(sym)) {
      // Frozen budget: answer from the last good snapshot instead of failing.
      if (budget.read_tier === 'frozen') {
        const snap = await snapshotGet(env, sym, b || todayLocal());
        const hdr0 = { 'X-Budget-Tier': 'frozen', 'X-From-Snapshot': snap ? 'yes' : 'no' };
        if (snap) return json(Object.assign({}, snap.payload, { from_snapshot: true, snapshot_saved_at: snap.saved_at,
          note: 'daily database budget spent; this is the last stored copy' }), 200, hdr0);
        return json({ error: 'daily database budget spent and no snapshot held for this day',
          usage: budget, note: 'resets at 00:00 UTC; stored data is unaffected' }, 503, hdr0);
      }
      let date = b;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
      const today = todayLocal();
      const s = await db.prepare('SELECT last_fetch_at, last_bar_unix FROM symbols WHERE symbol = ?').bind(sym).first();
      const open = marketOpen(t);
      // Outside the session there is nothing new upstream, so a read is served
      // from what is stored rather than round-tripping to Yahoo and writing
      // bookkeeping rows for an unchanged answer.
      const writesTight = budget.write_tier === 'frugal' || budget.write_tier === 'frozen';
      const recentlyFetched = !!(s?.last_fetch_at && t - s.last_fetch_at < 60) || writesTight || !open;
      let fetched = null;

      if (!date) {
        const latest = await db.prepare('SELECT MAX(date) AS d FROM days WHERE symbol = ?').bind(sym).first();
        date = latest?.d || null;
        const noData = !date;
        const olderThanToday = !!date && date < today;
        const staleToday = date === today && !!s?.last_bar_unix && t - s.last_bar_unix > TOPUP_AFTER;
        // A new symbol is a write: behind the key. Tracked symbols top up freely.
        if (noData && !authorized(req, url, env)) return json({ error: 'unknown symbol; adding one requires the API key' }, 401);
        if ((noData || olderThanToday || staleToday) && !recentlyFetched) {
          fetched = await syncSymbol(db, sym, '1d', { incremental: !noData, lastBarUnix: s?.last_bar_unix ?? null });
          const again = await db.prepare('SELECT MAX(date) AS d FROM days WHERE symbol = ?').bind(sym).first();
          date = again?.d || date;
        }
      } else if (date === today && s && !recentlyFetched && (!s.last_bar_unix || t - s.last_bar_unix > TOPUP_AFTER)) {
        fetched = await syncSymbol(db, sym, '1d', { incremental: true, lastBarUnix: s.last_bar_unix });
      }

      const since = intParam(url.searchParams, 'since');
      if (budget.read_tier === 'frugal' && !since && date && date === todayLocal()) {
        const snap = await snapshotGet(env, sym, date);
        if (snap) return json(Object.assign({}, snap.payload, { from_snapshot: true, snapshot_saved_at: snap.saved_at,
          note: 'budget is low; serving the stored copy. pass ?since= for live incremental reads' }), 200,
          { 'X-Budget-Tier': 'frugal', 'X-From-Snapshot': 'yes' });
      }
      const rows = date ? await readDay(db, sym, date, since) : [];
      const lastUnix = rows.length ? rows[rows.length - 1].unix : null;
      const stale = lastUnix ? t - lastUnix : null;
      const hdr = { 'X-Symbol': sym, 'X-Date': date || 'none', 'X-Bars': String(rows.length),
        'X-Incremental': since ? 'since=' + since : 'full',
        'X-Stale-Seconds': stale == null ? 'unknown' : String(stale),
        'X-Data-Stale': String(stale == null || stale > STALE_LIMIT),
        'X-Fetched-Now': fetched ? (fetched.error ? 'error: ' + fetched.error : 'yes') : 'no',
        'X-Market-Open': String(open) };
      const payload = { symbol: sym, date, bars: rows.length, stale_seconds: stale,
        fetched_now: fetched, incremental: !!since, since: since || null, rows };
      if (!since && rows.length) ctx.waitUntil(snapshotPut(env, sym, date, payload));
      if (asJson) return json(payload, 200, Object.assign({ 'X-Budget-Tier': budget.tier }, hdr));
      if (!rows.length) return text(`${COLS}\n`, 404, hdr);
      return text([COLS, ...toCsvRows(sym, rows)].join('\n') + '\n', 200, hdr);
    }

    if (route === 'sync' || route === 'backfill') {
      if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
      // Refuse to start expensive work when the day is nearly spent, rather
      // than discovering the wall halfway through a backfill.
      const u = budget;
      if (u.write_tier === 'frugal' || u.write_tier === 'frozen' || u.read_tier === 'frozen') {
        ctx.waitUntil(logEvent(env, 'quota', 'read_guard', 'refused ' + route + ' near the daily read limit', { reads: u.reads, pct: u.read_pct }));
        return json({ error: 'daily D1 read budget nearly spent', usage: u,
        note: 'reads reset at 00:00 UTC; stored data is unaffected' }, 429);
      }
      if (sym && !validSym(sym)) return json({ error: 'bad symbol' }, 400);
      if (route === 'backfill') {
        if (!sym) return json({ error: 'backfill needs a symbol: /backfill/NVDA' }, 400);
        return json(await syncMany(db, [{ symbol: sym, last_bar_unix: null }], '5d', 'backfill-one', { backfill: true }));
      }
      const all = await trackedSymbols(db, env);
      const entries = sym ? [all.find(e => e.symbol === sym) || { symbol: sym, last_bar_unix: null }] : all;
      return json(await syncMany(db, entries, '1d', sym ? 'manual-one' : 'manual-all', { incremental: true }));
    }

    return json({ error: 'not found' }, 404);
  }
}

async function scheduledRun(event, env, ctx) {
  {
    env0 = env;
    const db = env.DB ? metered(env.DB) : null;
    if (!db) return;
    await ensureSchema(db);
    const budget = await usageToday(db);
    // The cron only writes, so it follows the write budget.
    if (budget.write_tier === 'frugal' || budget.write_tier === 'frozen' || budget.read_tier === 'frozen') {
      await logEvent(env, 'quota', 'cron_skipped',
        'cron stood down: writes ' + budget.write_tier + ', reads ' + budget.read_tier,
        { reads: budget.reads, read_pct: budget.read_pct, writes: budget.writes, write_pct: budget.write_pct });
      return;
    }
    // The maintenance window is now 00:00-01:55 UTC, after the quota reset.
    const nightly = /^\*\/5 0-1 /.test(event.cron || '') || /^\*\/5 22-23/.test(event.cron || '');
    // Outstanding index work happens overnight, on a fresh day's budget, and
    // takes that run entirely so it never competes with a sync.
    if (nightly) {
      const ix = await buildIndexes(db, env, false);
      if (ix.built && ix.built.length) return;

      // The archive lives in Supabase, which has no daily write cap, so this
      // runs even when D1's budget is spent — the two are independent.
      if (mirrorOn(env)) {
        const SHARD = 12;                       // symbols per invocation, inside the subrequest ceiling
        let cursor = await archiveCursor(db);
        if (cursor >= ARCHIVE_UNIVERSE.length) {
          cursor = 0;
          const pruned = await archivePrune(env);
          await logEvent(env, 'info', 'archive_pruned', 'window trimmed', pruned);
        }
        const slice = ARCHIVE_UNIVERSE.slice(cursor, cursor + SHARD);
        let ok = 0, failed = [];
        for (const s2 of slice) {
          try {
            const { bars, error: fe } = await fetchYahoo(s2, '1d');
            if (fe) throw new Error(fe);
            await archiveWrite(env, s2, bars);
            ok++;
          } catch (e) { failed.push(s2 + ': ' + ((e && e.message) || e)); }
        }
        await archiveCursor(db, cursor + SHARD);
        await logEvent(env, failed.length ? 'warn' : 'info', 'archive_pass',
          ok + '/' + slice.length + ' symbols archived, cursor ' + (cursor + SHARD) + '/' + ARCHIVE_UNIVERSE.length,
          failed.length ? { failed: failed.slice(0, 5) } : null);
        return;                                 // the archive takes the whole invocation
      }
    }
    if (!nightly && !marketOpen()) {
      await logEvent(env, 'info', 'cron_skipped_closed', 'intraday cron skipped: market closed');
      return;
    }
    if (!nightly) {
      ctx.waitUntil(syncMany(db, await trackedSymbols(db, env), '1d', 'cron', { incremental: true })
      .then(async r => { const q = mirrorQueue; mirrorQueue = [];
        for (const item of q) { const m = await mirrorBars(env, item.sym, item.bars); if (m && m.error) await logEvent(env, 'warn', 'mirror_failed', item.sym + ': ' + m.error); }
        return r; })
        .then(r => { if (r.status !== 'ok') return logEvent(env, 'warn', 'cron_partial', r.status + ': ' + (r.results.filter(x => x.error).map(x => x.symbol + ' ' + x.error).join(' | ') || ''), { run_id: r.run_id }); }));
      return;
    }
    // Nightly: one symbol per invocation keeps each run under the subrequest
    // cap. Pick the symbol whose last backfill is oldest; skip if done today.
    const dayStart = nowSec() - 20 * 3600;
    const pick = await db.prepare('SELECT symbol FROM symbols WHERE COALESCE(last_backfill_at, 0) < ? ORDER BY COALESCE(last_backfill_at, 0) ASC, symbol LIMIT 1')
      .bind(dayStart).first();
    if (!pick) return;
    ctx.waitUntil(syncMany(db, [{ symbol: pick.symbol, last_bar_unix: null }], '5d', 'cron-backfill', { backfill: true }));
  }
}
