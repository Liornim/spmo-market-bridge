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

import { VIEW_HTML, RADAR_HTML } from './view.js';

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
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     started_at INTEGER NOT NULL, finished_at INTEGER,
     kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
     symbols INTEGER NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0,
     errors TEXT)`
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  // Migrations for a database created by v1.
  try { await db.prepare('ALTER TABLE symbols ADD COLUMN last_backfill_at INTEGER').run(); } catch (e) { /* already there */ }
  try { await db.prepare('ALTER TABLE runs ADD COLUMN finished_at INTEGER').run(); } catch (e) { /* already there */ }
  try { await db.prepare("ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'").run(); } catch (e) { /* already there */ }
  // v1 stored bars but had no days table: build it once from what exists.
  const d = await db.prepare('SELECT (SELECT COUNT(*) FROM days) AS days, (SELECT COUNT(*) FROM bars LIMIT 1) AS bars').first();
  if (d && d.days === 0 && d.bars > 0) {
    await db.prepare(`INSERT OR REPLACE INTO days (symbol, date, bars, revisions, first, last)
      SELECT symbol, date, COUNT(*), SUM(revisions), MIN(time), MAX(time) FROM bars GROUP BY symbol, date`).run();
  }
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
const readDay = async (db, sym, date) =>
  (await db.prepare('SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix').bind(sym, date).all()).results;

// ---------------------------------------------------------------- http

const H = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o, null, 2), { status, headers: { ...H, 'Content-Type': 'application/json', ...extra } });
const text = (s, status = 200, extra = {}) => new Response(s, { status, headers: { ...H, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
const validSym = s => /^[A-Z0-9.\-]{1,10}$/.test(s);

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
      return await handle(req, env, ctx);
    } catch (e) {
      return new Response(JSON.stringify({
        error: true, where: 'worker.fetch', path: new URL(req.url).pathname,
        message: String((e && e.message) || e),
        stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6) : null,
        time: new Date().toISOString()
      }, null, 2), { status: 500, headers: { ...H, 'Content-Type': 'application/json' } });
    }
  },

  async scheduled(event, env, ctx) {
    try { await scheduledRun(event, env, ctx); } catch (e) { console.log('cron failed: ' + ((e && e.message) || e)); }
  }
};

async function handle(req, env, ctx) {
  {
    const db = env.DB;
    if (!db) return json({ error: 'D1 binding "DB" is missing. Worker Settings → Bindings → D1 → name it DB.' }, 500);
    await ensureSchema(db);

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
        usage: ['/radar', '/view/NVDA', '/book/NVDA', '/selfcheck', '/status', '/days/NVDA', '/day/NVDA', '/day/NVDA/2026-08-31', '/sync', '/sync/NVDA', '/backfill/NVDA'] });
    }

    if (route === 'selfcheck') {
      // Which subsystem is broken, one at a time.
      const out = {};
      const step = async function (name, fn) { try { out[name] = await fn(); } catch (e) { out[name] = 'FAILED: ' + ((e && e.message) || e); } };
      await step('d1_binding', async function () { return env.DB ? 'present' : 'MISSING'; });
      await step('schema', async function () { const r = await db.prepare('SELECT COUNT(*) AS n FROM symbols').first(); return 'ok, ' + r.n + ' symbols'; });
      await step('bars_table', async function () { const r = await db.prepare('SELECT COUNT(*) AS n FROM bars').first(); return r.n + ' bars'; });
      await step('days_table', async function () { const r = await db.prepare('SELECT COUNT(*) AS n FROM days').first(); return r.n + ' day rows'; });
      await step('runs_table', async function () { const r = await db.prepare('SELECT COUNT(*) AS n FROM runs').first(); return r.n + ' runs'; });
      await step('yahoo', async function () { const r = await fetchYahoo('SPY', '1d'); return r.error ? 'FAILED: ' + r.error : r.bars.length + ' bars'; });
      await step('cboe', async function () { const v = await fetchVenueBook('bzx', 'SPY'); return v.error ? 'FAILED: ' + v.error : 'ok via ' + v.url; });
      await step('view_html', async function () { return VIEW_HTML.length + ' bytes'; });
      await step('radar_html', async function () { return RADAR_HTML.length + ' bytes'; });
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
      return json({ time: new Date().toISOString(), today_et: todayLocal(), worst_stale_seconds: worst || null,
        total_bars: rows.reduce((a, r) => a + r.bars, 0), symbols: rows, recent_runs: runs });
    }

    if (route === 'days' && sym && validSym(sym)) {
      const { results } = await db.prepare('SELECT date, bars, first, last, revisions FROM days WHERE symbol = ? ORDER BY date DESC').bind(sym).all();
      return json({ symbol: sym, days: results });
    }

    if (route === 'day' && sym && validSym(sym)) {
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

      const rows = date ? await readDay(db, sym, date) : [];
      const lastUnix = rows.length ? rows[rows.length - 1].unix : null;
      const stale = lastUnix ? t - lastUnix : null;
      const hdr = { 'X-Symbol': sym, 'X-Date': date || 'none', 'X-Bars': String(rows.length),
        'X-Stale-Seconds': stale == null ? 'unknown' : String(stale),
        'X-Data-Stale': String(stale == null || stale > STALE_LIMIT),
        'X-Fetched-Now': fetched ? (fetched.error ? 'error: ' + fetched.error : 'yes') : 'no' };
      if (asJson) return json({ symbol: sym, date, bars: rows.length, stale_seconds: stale, fetched_now: fetched, rows }, 200, hdr);
      if (!rows.length) return text(`${COLS}\n`, 404, hdr);
      return text([COLS, ...toCsvRows(sym, rows)].join('\n') + '\n', 200, hdr);
    }

    if (route === 'sync' || route === 'backfill') {
      if (!authorized(req, url, env)) return json({ error: 'API key required' }, 401);
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
    const db = env.DB;
    if (!db) return;
    await ensureSchema(db);
    const nightly = /^\*\/5 22-23/.test(event.cron || '');
    if (!nightly) {
      ctx.waitUntil(syncMany(db, await trackedSymbols(db, env), '1d', 'cron', { incremental: true }));
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
