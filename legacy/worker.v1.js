// bars-vault — persistent 1-minute bar archive
// Cloudflare Worker + D1 (SQLite) + Cron Trigger
//
// Every bar that is ever fetched is stored permanently in D1. Reads come
// from the database, never from Yahoo, so a Yahoo outage or block does not
// lose history. A cron pull re-fetches the full day on every run, so any
// minute missed by one run is filled by the next.
//
// Routes (all GET):
//   /                          health, tracked symbols, last run
//   /status                    per-symbol freshness + row counts + recent runs
//   /days/NVDA                 dates that have data for NVDA, with bar counts
//   /day/NVDA                  CSV of NVDA's latest stored day
//   /day/NVDA/2026-08-31       CSV of a specific day (add ?format=json for JSON)
//   /sync                      pull today for all tracked symbols
//   /sync/NVDA                 pull today for one symbol (adds it to tracking)
//   /backfill/NVDA             pull the last 5 days for one symbol
//
// Bindings required:  D1 database bound as  DB
// Cron triggers:      */5 13-21 * * 1-5   (every 5 min, US session, both DST cases)
//                     30 22 * * 1-5       (nightly 5-day backfill)

const DEFAULT_SYMBOLS = 'NVDA,GOOGL,AAPL,MSFT,AMZN,AVGO,META,TSLA,BRK-B,JPM,VOO,SPMO,TQQQ';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TZ = 'America/New_York';
const STALE_LIMIT = 180;
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
  `CREATE TABLE IF NOT EXISTS symbols (
     symbol TEXT PRIMARY KEY, added_at INTEGER NOT NULL,
     last_fetch_at INTEGER, last_bar_unix INTEGER, last_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL,
     kind TEXT NOT NULL, symbols INTEGER NOT NULL, rows_written INTEGER NOT NULL,
     errors TEXT)`
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  schemaReady = true;
}

async function trackedSymbols(db, env) {
  const { results } = await db.prepare('SELECT symbol FROM symbols ORDER BY symbol').all();
  if (results.length) return results.map(r => r.symbol);
  // First run: seed from env or defaults.
  const seed = String(env?.SYMBOLS || DEFAULT_SYMBOLS).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const t = nowSec();
  await db.batch(seed.map(s => db.prepare('INSERT OR IGNORE INTO symbols (symbol, added_at) VALUES (?, ?)').bind(s, t)));
  return seed;
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

// Returns { bars: [{unix,o,h,l,c,v}], error }. Only closed bars are returned;
// the forming bar changes on every poll and would be re-written constantly.
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
    if (ts[i] + 60 > now) continue;
    bars.push({ unix: ts[i], o: rnd(o, 4), h: rnd(h, 4), l: rnd(l, 4), c: rnd(c, 4), v: q.volume?.[i] ?? 0 });
  }
  return { bars, error: null };
}

// ---------------------------------------------------------------- write

const UPSERT = `INSERT INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  ON CONFLICT(symbol, unix) DO UPDATE SET
    revisions = revisions + (CASE WHEN open != excluded.open OR high != excluded.high
                                    OR low != excluded.low OR close != excluded.close
                                    OR volume != excluded.volume THEN 1 ELSE 0 END),
    open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
    volume = excluded.volume, updated_at = excluded.updated_at`;

async function syncSymbol(db, sym, range, incremental = false) {
  const t = nowSec();
  const { bars: all, error } = await fetchYahoo(sym, range);
  // Incremental mode (intraday cron) writes only bars newer than what is
  // stored, plus a 15-bar overlap so late corrections are still caught.
  // Full mode (backfill, first contact) rewrites the whole range.
  let bars = all;
  if (incremental && !error) {
    const prev = await db.prepare('SELECT last_bar_unix FROM symbols WHERE symbol = ?').bind(sym).first();
    if (prev?.last_bar_unix) bars = all.filter(b => b.unix > prev.last_bar_unix - 15 * 60);
  }
  if (error) {
    // Only symbols that have succeeded at least once are tracked, so a typo
    // never becomes a permanent cron failure.
    await db.prepare('UPDATE symbols SET last_fetch_at = ?, last_error = ? WHERE symbol = ?').bind(t, error, sym).run();
    return { symbol: sym, rows: 0, error };
  }
  const stmts = bars.map(b => {
    const { date, time } = localDateTime(b.unix);
    return db.prepare(UPSERT).bind(sym, b.unix, date, time, b.o, b.h, b.l, b.c, b.v, t, t);
  });
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  const last = bars.length ? bars[bars.length - 1].unix : null;
  await db.prepare('INSERT INTO symbols (symbol, added_at, last_fetch_at, last_bar_unix, last_error) VALUES (?, ?, ?, ?, NULL) ' +
    'ON CONFLICT(symbol) DO UPDATE SET last_fetch_at = excluded.last_fetch_at, ' +
    'last_bar_unix = NULLIF(MAX(COALESCE(symbols.last_bar_unix, 0), COALESCE(excluded.last_bar_unix, 0)), 0), last_error = NULL')
    .bind(sym, t, t, last).run();
  return { symbol: sym, rows: bars.length, error: null };
}

async function syncMany(db, syms, range, kind, incremental = false) {
  const started = nowSec();
  const results = [];
  // Sequential on purpose: ten parallel hits on Yahoo from one IP is how
  // you get rate-limited. Cron has plenty of time.
  for (const s of syms) results.push(await syncSymbol(db, s, range, incremental));
  const errors = results.filter(r => r.error).map(r => `${r.symbol}: ${r.error}`);
  await db.prepare('INSERT INTO runs (started_at, kind, symbols, rows_written, errors) VALUES (?, ?, ?, ?, ?)')
    .bind(started, kind, syms.length, results.reduce((a, r) => a + r.rows, 0), errors.length ? errors.join(' | ') : null).run();
  return { kind, started_at: started, results };
}

// ---------------------------------------------------------------- read

// Derived columns are computed at read time from stored OHLCV, so the
// database stays compact and vol_x is always normalised over the full day.
function toCsvRows(sym, rows) {
  const avg = rows.length ? rows.reduce((s, r) => s + r.volume, 0) / rows.length : 0;
  return rows.map(r => {
    const range = r.high - r.low;
    const pct = x => (range > 0 ? rnd((x / range) * 100, 1) : 0);
    const dir = r.close > r.open ? 'BULL' : r.close < r.open ? 'BEAR' : 'FLAT';
    return [sym, r.date, r.time, r.open, r.high, r.low, r.close, r.volume, dir,
      pct(Math.abs(r.close - r.open)),
      pct(r.high - Math.max(r.open, r.close)),
      pct(Math.min(r.open, r.close) - r.low),
      rnd(range, 4), avg > 0 ? rnd(r.volume / avg, 2) : 0].join(',');
  });
}

async function readDay(db, sym, date) {
  return (await db.prepare('SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix').bind(sym, date).all()).results;
}

// ---------------------------------------------------------------- http

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o, null, 2), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra }
});
const text = (s, status = 200, extra = {}) => new Response(s, {
  status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra }
});
const validSym = s => /^[A-Z0-9.\-]{1,10}$/.test(s);

export default {
  async fetch(req, env, ctx) {
    const db = env.DB;
    if (!db) return json({ error: 'D1 binding "DB" is missing. Worker Settings → Bindings → D1 → name it DB.' }, 500);
    await ensureSchema(db);

    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [route, a, b] = parts;
    const sym = a ? a.toUpperCase() : null;
    const asJson = url.searchParams.get('format') === 'json';

    if (!route) {
      const syms = await trackedSymbols(db, env);
      const last = await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').first();
      return json({ ok: true, time: new Date().toISOString(), today_et: todayLocal(), tracked: syms, last_run: last,
        usage: ['/status', '/days/NVDA', '/day/NVDA', '/day/NVDA/2026-08-31', '/sync', '/sync/NVDA', '/backfill/NVDA'] });
    }

    if (route === 'status') {
      const t = nowSec();
      const { results } = await db.prepare(
        `SELECT s.symbol, s.last_fetch_at, s.last_bar_unix, s.last_error,
                (SELECT COUNT(*) FROM bars b WHERE b.symbol = s.symbol) AS bars,
                (SELECT COUNT(DISTINCT date) FROM bars b WHERE b.symbol = s.symbol) AS days,
                (SELECT SUM(revisions) FROM bars b WHERE b.symbol = s.symbol) AS revisions
         FROM symbols s ORDER BY s.symbol`).all();
      const runs = (await db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 10').all()).results;
      const rows = results.map(r => ({ ...r, stale_seconds: r.last_bar_unix ? t - r.last_bar_unix : null,
        data_stale: r.last_bar_unix ? t - r.last_bar_unix > STALE_LIMIT : true }));
      const worst = rows.filter(r => r.stale_seconds != null).reduce((m, r) => Math.max(m, r.stale_seconds), 0);
      return json({ time: new Date().toISOString(), worst_stale_seconds: worst || null, symbols: rows, recent_runs: runs });
    }

    if (route === 'days' && sym && validSym(sym)) {
      const { results } = await db.prepare('SELECT date, COUNT(*) AS bars, MIN(time) AS first, MAX(time) AS last FROM bars WHERE symbol = ? GROUP BY date ORDER BY date DESC')
        .bind(sym).all();
      return json({ symbol: sym, days: results });
    }

    if (route === 'day' && sym && validSym(sym)) {
      let date = b;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date must be YYYY-MM-DD' }, 400);
      let rows = date ? await readDay(db, sym, date) : [];
      let fetched = null;

      if (!date) {
        // Latest stored day; if there is none, or it is older than today
        // and the session might be open, pull first.
        const latest = await db.prepare('SELECT MAX(date) AS d FROM bars WHERE symbol = ?').bind(sym).first();
        date = latest?.d || null;
        const s = await db.prepare('SELECT last_fetch_at FROM symbols WHERE symbol = ?').bind(sym).first();
        const recentlyFetched = s?.last_fetch_at && nowSec() - s.last_fetch_at < 60;
        if ((!date || date < todayLocal()) && !recentlyFetched) {
          fetched = await syncSymbol(db, sym, '1d');
          const again = await db.prepare('SELECT MAX(date) AS d FROM bars WHERE symbol = ?').bind(sym).first();
          date = again?.d || date;
        }
        rows = date ? await readDay(db, sym, date) : [];
      } else if (!rows.length && date >= todayLocal()) {
        // Asking for today and nothing stored yet: pull on demand.
        fetched = await syncSymbol(db, sym, '1d');
        rows = await readDay(db, sym, date);
      }

      const lastUnix = rows.length ? rows[rows.length - 1].unix : null;
      const stale = lastUnix ? nowSec() - lastUnix : null;
      const hdr = {
        'X-Symbol': sym, 'X-Date': date || 'none', 'X-Bars': String(rows.length),
        'X-Stale-Seconds': stale == null ? 'unknown' : String(stale),
        'X-Data-Stale': String(stale == null || stale > STALE_LIMIT),
        'X-Fetched-Now': fetched ? (fetched.error ? 'error: ' + fetched.error : 'yes') : 'no'
      };
      if (asJson) return json({ symbol: sym, date, bars: rows.length, stale_seconds: stale, fetched_now: fetched, rows }, 200, hdr);
      if (!rows.length) return text(`${COLS}\n`, 404, hdr);
      return text([COLS, ...toCsvRows(sym, rows)].join('\n') + '\n', 200, hdr);
    }

    if (route === 'sync') {
      if (sym && !validSym(sym)) return json({ error: 'bad symbol' }, 400);
      const syms = sym ? [sym] : await trackedSymbols(db, env);
      return json(await syncMany(db, syms, '1d', sym ? 'manual-one' : 'manual-all', true));
    }

    if (route === 'backfill' && sym && validSym(sym)) {
      return json(await syncMany(db, [sym], '5d', 'backfill-one'));
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    const db = env.DB;
    if (!db) return;
    await ensureSchema(db);
    const syms = await trackedSymbols(db, env);
    const backfill = /^30 22/.test(event.cron || '');
    ctx.waitUntil(syncMany(db, syms, backfill ? '5d' : '1d', backfill ? 'cron-backfill' : 'cron', !backfill));
  }
};
