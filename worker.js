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
//   /log                       system log from KV — answers even when D1 is down
//   /book/NVDA                 top-5 bids/asks from the four Cboe venues
//   /bookprobe/NVDA            which Cboe JSON path answered (diagnostic)
//   /selfcheck                 per-subsystem health, to locate a failure
//   /status                    per-symbol freshness, counts, recent runs (cheap)
//   /days/NVDA                 stored dates with bar counts
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

import { VIEW_HTML, RADAR_HTML, DB_HTML } from './view.js';

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
  `CREATE INDEX IF NOT EXISTS bars_symbol_date ON bars (symbol, date)`,
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
const SCHEMA_VERSION = '3';
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
  await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").bind(SCHEMA_VERSION).run();
  schemaReady = true;
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
let meter = { day: null, reads: 0, writes: 0, queries: 0, dirty: 0 };
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
function tierFor(reads, writes) {
  const r = reads / READ_LIMIT, wr = writes / WRITE_LIMIT, worst = Math.max(r, wr);
  return worst >= TIER_FROZEN ? 'frozen' : worst >= TIER_FRUGAL ? 'frugal' : worst >= TIER_WARN ? 'warn' : 'normal';
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
  if (meter.day !== d) meter = { day: d, reads: 0, writes: 0, queries: 0, dirty: 0 };
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
async function flushRoute(db, route, r) {
  if (!r || (r.reads + r.writes) < 50) return;      // ignore trivial requests
  try {
    await db.prepare(`INSERT INTO usage_route (day, route, hits, reads, writes) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(day, route) DO UPDATE SET hits = hits + 1, reads = reads + excluded.reads, writes = writes + excluded.writes`)
      .bind(utcDay(), route, r.reads, r.writes).run();
  } catch (e) { /* accounting must never break a request */ }
}

async function flushUsage(db) {
  if (meter.dirty < 200) return;
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
      over_read_guard: reads > READ_LIMIT * TIER_FRUGAL };
  } catch (e) { return { day: utcDay(), error: String((e && e.message) || e) }; }
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

  let changes = 0;
  for (let i = 0; i < stmts.length; i += BATCH) {
    const res = await db.batch(stmts.slice(i, i + BATCH));
    for (const r of res) changes += r?.meta?.changes || 0;
  }
  // changes includes the days rows and the symbols row; report bars only.
  return { symbol: sym, rows: bars.length, written: Math.max(0, changes - 1 - dates.size), error: null };
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
      if (env.DB) {
        const snapshot = { reads: reqMeter.reads, writes: reqMeter.writes, queries: reqMeter.queries, top: reqMeter.top.slice() };
        const routeName = routeOf(new URL(req.url).pathname);
        ctx.waitUntil((async () => {
          const d = metered(env.DB);
          await flushRoute(d, routeName, snapshot);
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
        usage: ['/radar', '/db', '/log', '/view/NVDA', '/book/NVDA', '/selfcheck', '/status', '/days/NVDA', '/day/NVDA', '/day/NVDA/2026-08-31', '/sync', '/sync/NVDA', '/backfill/NVDA'] });
    }

    if (route === 'usage') {
      const routes = (await db.prepare('SELECT route, hits, reads, writes FROM usage_route WHERE day = ? ORDER BY reads DESC LIMIT 20')
        .bind(utcDay()).all()).results;
      return json(Object.assign({}, budget, {
        by_route: routes.map(x => Object.assign({}, x, {
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

    if (route === 'day' && sym && validSym(sym)) {
      // Frozen budget: answer from the last good snapshot instead of failing.
      if (budget.tier === 'frozen') {
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
      const recentlyFetched = !!(s?.last_fetch_at && t - s.last_fetch_at < 60);
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
      if (budget.tier === 'frugal' && !since && date && date === todayLocal()) {
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
        'X-Fetched-Now': fetched ? (fetched.error ? 'error: ' + fetched.error : 'yes') : 'no' };
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
      if (u.tier === 'frugal' || u.tier === 'frozen') {
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
    const db = env.DB ? metered(env.DB) : null;
    if (!db) return;
    await ensureSchema(db);
    const budget = await usageToday(db);
    if (budget.tier === 'frugal' || budget.tier === 'frozen') {
      await logEvent(env, 'quota', 'cron_skipped', 'cron stood down at ' + budget.tier + ' budget',
        { reads: budget.reads, read_pct: budget.read_pct, writes: budget.writes, write_pct: budget.write_pct });
      return;
    }
    const nightly = /^\*\/5 22-23/.test(event.cron || '');
    if (!nightly) {
      ctx.waitUntil(syncMany(db, await trackedSymbols(db, env), '1d', 'cron', { incremental: true })
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
