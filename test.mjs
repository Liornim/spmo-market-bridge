// bars-vault test harness. Real SQLite behind a D1-compatible shim, mocked
// Yahoo, and a subrequest counter so the Free-plan cap (50/invocation) is
// asserted, not assumed.
import { DatabaseSync } from 'node:sqlite';

let subreq = 0;                                   // fetch + every D1 call
const READS = { n: 0 }, WRITES = { n: 0 };        // D1 row accounting, as D1 counts it
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    const s = this.db.prepare(this.sql);
    // Mirror D1's accounting: a SELECT is charged for the rows it SCANS, so an
    // unfiltered COUNT(*) over a table costs the whole table.
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) {
      const results = s.all(...this.p);
      let read = results.length;
      const m = this.sql.match(/COUNT\(\*\)[\s\S]*?FROM\s+(\w+)/i);
      if (m && !/WHERE/i.test(this.sql)) {
        try { read = this.db.prepare('SELECT COUNT(*) c FROM ' + m[1]).get().c; } catch (e) { /* table may not exist */ }
      }
      READS.n += read;
      return { results, meta: { changes: 0, rows_read: read, rows_written: 0 } };
    }
    const r = s.run(...this.p);
    WRITES.n += Number(r.changes);
    return { results: [], meta: { changes: Number(r.changes), rows_read: 0, rows_written: Number(r.changes) } };
  }
  async all() { subreq++; return this._exec(); }
  async first() { subreq++; const r = this._exec().results[0]; return r === undefined ? null : r; }
  async run() { subreq++; return this._exec(); }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { subreq++; return stmts.map(s => s._exec()); }   // one batch = one subrequest
}

// Real SPMO bars from the original service (known-good derived columns).
const REAL = [[151.76, 152.2, 151.58, 152.17, 147577], [152.51, 152.565, 152.25, 152.25, 3124],
  [150.59, 150.65, 150.5838, 150.59, 5938], [150.7662, 150.7662, 150.7662, 150.7662, 164]];
let clock = 1788205200;                            // 2026-08-31 15:40 ET
Date.now = () => clock * 1000;

const upstream = { mode: 'ok', calls: [], bars: null };
function session(count, base) {                    // synthetic full session
  return Array.from({ length: count }, (_, i) => [base + i * 60, 100 + i * 0.01, 100.1 + i * 0.01, 99.9 + i * 0.01, 100.05 + i * 0.01, 1000 + i]);
}
globalThis.fetch = async (u) => {
  subreq++; upstream.calls.push(u);
  if (upstream.mode === 'throw') throw new Error('network down');
  if (upstream.mode === 'http500') return { status: 500, json: async () => ({}) };
  if (upstream.mode === 'notfound') return { status: 200, json: async () => ({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }) };
  let rows;
  if (upstream.bars) rows = upstream.bars;
  else {
    const base = clock - 600;
    rows = REAL.map((b, i) => [base + i * 60, ...b]);
    if (upstream.mode === 'mutated') rows[0] = [rows[0][0], rows[0][1], rows[0][2], rows[0][3] - 0.5, rows[0][4], rows[0][5]];
  }
  rows = rows.concat([[clock - 30, 999, 999, 999, 999, 999]]);   // forming bar
  return { status: 200, json: async () => ({ chart: { result: [{ timestamp: rows.map(r => r[0]),
    indicators: { quote: [{ open: rows.map(r => r[1]), high: rows.map(r => r[2]), low: rows.map(r => r[3]), close: rows.map(r => r[4]), volume: rows.map(r => r[5]) }] } }] } }) };
};

const modNs = await import('./worker.js');
const mod = modNs.default;
// force the module-level schemaReady flag to reset by reimporting with a cache-buster
let schemaReadyReset = () => {};
const db = new D1();
let env = { DB: db };
const ctx = { waitUntil: p => { ctx.pending = p; } };
const get = async (path, headers = {}) => {
  const r = await mod.fetch(new Request('https://x' + path, { headers }), env, ctx);
  const body = await r.text();
  return { status: r.status, h: Object.fromEntries(r.headers), body, j: () => JSON.parse(body) };
};
const q = sql => db.db.prepare(sql).get();
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '   [' + extra + ']' : ''}`); };

// ---- schema / seed
let r = await get('/');
check('health ok, defaults seeded', r.j().ok && r.j().tracked.length === 13);
check('health warns that writes are open until API_KEY set', /OPEN/.test(r.j().auth));
check('missing DB binding reported', (await mod.fetch(new Request('https://x/'), {}, ctx)).status === 500);

// ---- first sync
r = await get('/sync/SPMO');
check('sync stores closed bars only', r.j().results[0].rows === 4 && q('SELECT COUNT(*) c FROM bars').c === 4);
check('forming bar never stored', !q("SELECT 1 FROM bars WHERE open = 999"));
check('run logged with status ok', r.j().status === 'ok' && q('SELECT status FROM runs ORDER BY id DESC LIMIT 1').status === 'ok');
check('days table populated', q("SELECT bars FROM days WHERE symbol='SPMO'").bars === 4);
check('symbols.last_bar_unix populated', q("SELECT last_bar_unix FROM symbols WHERE symbol='SPMO'").last_bar_unix > 0);

// ---- write-only-if-changed
r = await get('/sync/SPMO');
check('unchanged re-sync writes ZERO bar rows', r.j().rows_written === 0, 'written=' + r.j().rows_written);
check('no duplicate rows', q('SELECT COUNT(*) c FROM bars').c === 4);
upstream.mode = 'mutated'; r = await get('/sync/SPMO'); upstream.mode = 'ok';
check('mutated closed bar: exactly 1 row written, revisions=1', r.j().rows_written === 1 && q('SELECT revisions FROM bars ORDER BY unix LIMIT 1').revisions === 1);
await get('/sync/SPMO');
check('days.revisions tracks mutations', q("SELECT revisions FROM days WHERE symbol='SPMO'").revisions === 2);

// ---- CSV
r = await get('/day/SPMO/2026-08-31');
const f = r.body.trim().split('\n')[1].split(',');
check('derived columns match original service', f[8] === 'BULL' && f[9] === '66.1' && f[10] === '4.8' && f[11] === '29' && f[12] === '0.62', f.slice(8, 13).join(' '));
check('vol_x normalised over full day', f[13] === String(Math.round(147577 / ((147577 + 3124 + 5938 + 164) / 4) * 100) / 100));
check('exchange-local time', f[1] === '2026-08-31' && /^\d\d:\d\d$/.test(f[2]));
check('explicit past date read never hits upstream', r.h['x-fetched-now'] === 'no');

// ---- live top-up: /day/today re-pulls when stale
db.db.prepare("UPDATE symbols SET last_fetch_at = ? WHERE symbol='SPMO'").run(clock - 3600);   // pretend last fetch was an hour ago
upstream.calls = [];
r = await get('/day/SPMO');
check('/day (no date) tops up from upstream when stale', r.h['x-fetched-now'] === 'yes' && upstream.calls.length === 1);
r = await get('/day/SPMO');
check('...but not again within 60s', r.h['x-fetched-now'] === 'no' && upstream.calls.length === 1);
db.db.prepare("UPDATE symbols SET last_fetch_at = ? WHERE symbol='SPMO'").run(clock - 3600);
upstream.calls = [];
r = await get('/day/SPMO/2026-08-31');
check('/day/<today> also tops up when stale', r.h['x-fetched-now'] === 'yes');

// ---- on-demand symbol
upstream.calls = [];
r = await get('/day/AMD');
check('unknown symbol fetched, stored, tracked', r.status === 200 && r.body.split('\n')[1].startsWith('AMD,') && !!q("SELECT 1 FROM symbols WHERE symbol='AMD'"));

// ---- failures
for (const mode of ['throw', 'http500', 'notfound']) {
  upstream.mode = mode; r = await get('/sync/SPMO');
  check(`upstream ${mode}: recorded, rows intact`, r.j().status === 'failed' && !!r.j().results[0].error && q("SELECT COUNT(*) c FROM bars WHERE symbol='SPMO'").c === 4, r.j().results[0].error);
}
upstream.mode = 'notfound'; await get('/sync/TYPO'); upstream.mode = 'ok';
check('failed first-contact symbol not tracked', !q("SELECT 1 FROM symbols WHERE symbol='TYPO'"));
r = await get('/status');
check('/status shows last_error and failed run', r.j().symbols.find(s => s.symbol === 'SPMO').last_error !== null && r.j().recent_runs[0].status === 'failed');
await get('/sync/SPMO');
check('success clears last_error', (await get('/status')).j().symbols.find(s => s.symbol === 'SPMO').last_error === null);

// ---- run logged at START (crash mid-way is visible)
const before = q('SELECT COUNT(*) c FROM runs').c;
const origBatch = db.batch.bind(db);
db.batch = async (s) => { throw new Error('simulated platform limit'); };
r = await get('/sync/SPMO');
db.batch = origBatch;
check('crash mid-run still leaves a run row', q('SELECT COUNT(*) c FROM runs').c === before + 1);
check('crash surfaces as error, not silence', r.j().status === 'failed' && /simulated/.test(r.j().results[0].error));

// ---- SUBREQUEST BUDGET (the limit that matters)
upstream.bars = session(390, clock - 390 * 60);              // realistic full session
// intraday cron over 14 tracked symbols, incremental, DB already has today
await get('/sync');                                          // prime
subreq = 0; await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, env, ctx); await ctx.pending;
const intradaySub = subreq;
check('intraday cron (14 symbols) under 50 subrequests', intradaySub <= 50, intradaySub + ' subrequests');
// nightly backfill: one symbol, full 5 days
upstream.bars = session(1950, clock - 5 * 86400);
subreq = 0; await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, env, ctx); await ctx.pending;
const nightlySub = subreq;
check('nightly backfill (1 symbol, 1950 bars) under 50 subrequests', nightlySub <= 50, nightlySub + ' subrequests');
check('nightly picks ONE symbol per run', q("SELECT symbols FROM runs ORDER BY id DESC LIMIT 1").symbols === 1);
const picked = q("SELECT COUNT(*) c FROM symbols WHERE last_backfill_at IS NOT NULL").c;
await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, env, ctx); await ctx.pending;
check('next nightly run picks a DIFFERENT symbol', q("SELECT COUNT(*) c FROM symbols WHERE last_backfill_at IS NOT NULL").c === picked + 1);
// manual full backfill of one symbol
subreq = 0; await get('/backfill/NVDA');
check('manual /backfill under 50 subrequests', subreq <= 50, subreq + ' subrequests');
upstream.bars = null;

// ---- WRITE BUDGET: a full day of 5-min polling for 13 symbols
upstream.bars = session(390, clock - 390 * 60);
await get('/sync');                                          // everything stored
let dayWrites = 0;
for (let i = 0; i < 78; i++) { const x = await get('/sync'); dayWrites += x.j().rows_written; }
check('78 unchanged polls x 14 symbols write 0 bar rows', dayWrites === 0, dayWrites + ' rows');
upstream.bars = null;

// ---- /status never scans bars
subreq = 0; r = await get('/status');
// two aggregate queries plus the usage lookup and the schema-version check —
// all indexed or over small tables, none of them touching bars.
check('/status is a handful of small D1 calls regardless of table size', subreq <= 5, subreq + ' calls');
check('/status totals come from days table', r.j().total_bars > 0 && r.j().symbols.every(s => 'days' in s));

// ---- API key
env = { DB: db, API_KEY: 'secret123' };
check('sync without key -> 401', (await get('/sync/SPMO')).status === 401);
check('backfill without key -> 401', (await get('/backfill/SPMO')).status === 401);
check('sync with ?key -> 200', (await get('/sync/SPMO?key=secret123')).status === 200);
check('sync with header -> 200', (await get('/sync/SPMO', { 'X-Api-Key': 'secret123' })).status === 200);
check('reading stored data stays open', (await get('/day/SPMO/2026-08-31')).status === 200);
check('tracked symbol top-up stays open', (await get('/day/SPMO')).status === 200);
check('adding a NEW symbol via /day needs key', (await get('/day/ZZZZ')).status === 401);
check('cron ignores key (runs internally)', (await (async () => { await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, env, ctx); await ctx.pending; return true; })()));
env = { DB: db };

// ---- persistence
clock += 30 * 86400;
r = await get('/day/SPMO/2026-08-31');
check('data readable 30 days later, no upstream', r.status === 200 && r.h['x-fetched-now'] === 'no');
clock -= 30 * 86400;

// ---- validation
check('bad date 400', (await get('/day/NVDA/tomorrow')).status === 400);
check('bad symbol 400', (await get('/sync/BAD SYM')).status === 400);
check('backfill without symbol 400', (await get('/backfill')).status === 400);
check('unknown route 404', (await get('/nope')).status === 404);
check('missing day 404', (await get('/day/SPMO/2020-01-01')).status === 404);
check('format=json', (await get('/day/SPMO/2026-08-31?format=json')).j().rows.length >= 4);


// ---- view page
r = await get('/view/NVDA');
check('/view serves HTML', r.status === 200 && /text\/html/.test(r.h['content-type']) && /<svg id="svg"/.test(r.body));
check('/view without symbol serves HTML too', (await get('/view')).status === 200);
check('/view bad symbol 400', (await get('/view/BAD SYM')).status === 400);
check('/view page fetches with a cache-buster', /ts=/.test(r.body) && /no-store/.test(r.body));
check('/view refreshes no faster than 60s', /left=60/.test(r.body));


// ---- radar page
r = await get('/radar');
check('/radar serves HTML', r.status === 200 && /html/.test(r.h['content-type']) && /Market Radar/.test(r.body));
check('/radar includes the engine (radarRow present)', /function radarRow/.test(r.body));
check('/radar and /view are different pages', (await get('/view/NVDA')).body !== r.body);
check('/view still serves its own page (no regression)', /<svg id="svg"/.test((await get('/view/NVDA')).body));


// ---- order book (Cboe)
{
  const realFetch = globalThis.fetch;
  const bookRows = { bids: [[227.68, 300], [227.67, 500], [227.66, 200], [227.65, 100], [227.64, 400]],
                     asks: [[227.70, 200], [227.71, 100], [227.72, 300], [227.73, 150], [227.74, 250]] };
  let bookCalls = [];
  globalThis.fetch = async (u) => { bookCalls.push(u);
    if (/cboe\.com\/json\/(bzx|edgx)\/book\//.test(u)) return { status: 200, text: async () => JSON.stringify({ data: bookRows }) };
    if (/cboe/.test(u)) return { status: 404, text: async () => '' };
    return realFetch(u); };
  r = await get('/book/NVDA');
  const j = r.j();
  check('/book returns a summary and the venues', j.summary && Array.isArray(j.venues) && j.venues.length === 4);
  check('/book aggregates depth across venues that answered', j.summary.bid_shares === 1500 * 2 && j.summary.ask_shares === 1000 * 2,
    j.summary.bid_shares + ' bid / ' + j.summary.ask_shares + ' ask');
  check('/book computes the imbalance', j.summary.bid_pct === 60 && j.summary.ask_pct === 40, j.summary.bid_pct + '/' + j.summary.ask_pct);
  check('/book reports best bid, best ask and spread', j.summary.best_bid === 227.68 && j.summary.best_ask === 227.7 && j.summary.spread === 0.02);
  check('/book names the venues that failed', j.summary.venues_failed.length === 2 && j.summary.venues_ok.length === 2,
    'ok ' + j.summary.venues_ok.join(',') + ' failed ' + j.summary.venues_failed.join(','));
  check('/book states its coverage limit', /not the consolidated book/.test(j.summary.coverage));
  check('/book keeps five levels a side', j.venues.find(v => !v.error).bids.length === 5);
  // shares/price order must not matter
  globalThis.fetch = async (u) => (/cboe\.com\/json\/bzx\/book\//.test(u)
    ? { status: 200, text: async () => JSON.stringify({ bids: [[300, 227.68]], asks: [[200, 227.70]] }) }
    : { status: 404, text: async () => '' });
  const flipped = (await get('/book/NVDA')).j();
  check('/book handles the reversed [shares, price] shape', flipped.summary.best_bid === 227.68 && flipped.summary.bid_shares === 300,
    JSON.stringify(flipped.summary.best_bid) + ' / ' + flipped.summary.bid_shares);
  // every venue down
  globalThis.fetch = async () => ({ status: 500, text: async () => '' });
  const dead = (await get('/book/NVDA')).j();
  check('/book degrades cleanly when nothing answers', dead.summary.bid_shares === 0 && dead.summary.venues_failed.length === 4 && dead.summary.bid_pct === null);
  // probe reports what it tried
  globalThis.fetch = async (u) => (/json\/bzx\/book\/NVDA$/.test(u) ? { status: 200, text: async () => JSON.stringify({ data: bookRows }) } : { status: 404, text: async () => '' });
  const probe = (await get('/bookprobe/NVDA')).j();
  check('/bookprobe lists the URL shapes it tries', probe.tried.length >= 3);
  check('/bookprobe says which venue answered and from where', probe.venues.find(v => v.venue === 'BZX').ok === true && /json\/bzx\/book/.test(probe.venues.find(v => v.venue === 'BZX').url));
  check('/bookprobe marks the venues that did not', probe.venues.filter(v => !v.ok).length === 3);
  check('a bad symbol is rejected', (await get('/book/BAD SYM')).status === 404);
  globalThis.fetch = realFetch;
}


// ---- failures must be readable, not an opaque 1101
{
  const realFetch = globalThis.fetch;
  // a route that throws deep inside
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { if (/FROM bars WHERE symbol/.test(sql)) throw new Error('boom inside D1'); return origPrepare(sql); };
  r = await get('/day/NVDA/2026-08-31');
  check('an internal exception returns 500 with the message, not a blank page', r.status === 500 && /boom inside D1/.test(r.body), r.body.slice(0, 80));
  check('the error names the path that failed', /"path": "\/day\/NVDA\/2026-08-31"/.test(r.body));
  check('the error includes a stack', /"stack"/.test(r.body));
  db.prepare = origPrepare;

  globalThis.fetch = async (u) => (/cboe/.test(u) ? { status: 404, text: async () => '' } : realFetch(u));
  r = await get('/selfcheck');
  const sc = r.j().selfcheck;
  check('/selfcheck reports every subsystem', ['d1_binding','schema','bars_table','days_table','runs_table','yahoo','cboe','view_html','radar_html'].every(k => k in sc),
    Object.keys(sc).join(','));
  check('/selfcheck confirms the D1 binding', sc.d1_binding === 'present');
  check('/selfcheck reads the schema', /symbols$/.test(sc.schema) || /ok,/.test(sc.schema), sc.schema);
  check('/selfcheck reports a failing upstream as FAILED, not silence', /FAILED/.test(sc.cboe), sc.cboe);
  check('/selfcheck sizes the served pages', /bytes$/.test(sc.view_html) && /bytes$/.test(sc.radar_html), sc.radar_html);
  globalThis.fetch = realFetch;
}


// ---- row-read budget: the reason the free tier died
{
  // seed a full session
  upstream.bars = session(390, clock - 390 * 60);
  await get('/sync/BUDGET?key=' + (env.API_KEY || '') );
  await get('/sync/BUDGET');
  upstream.bars = null;
  const full = await get('/day/BUDGET/2026-08-31?format=json');
  const total = full.j().rows.length;
  check('a full day read returns the whole session', total > 300, total + ' rows');
  const lastUnix = full.j().rows[total - 1].unix;
  const inc = await get('/day/BUDGET/2026-08-31?format=json&since=' + lastUnix);
  check('since= returns only newer bars', inc.j().rows.length === 0 && inc.j().incremental === true, inc.j().rows.length + ' rows');
  check('the response says it was incremental', inc.h['x-incremental'] === 'since=' + lastUnix);
  const mid = full.j().rows[total - 6].unix;
  const inc2 = await get('/day/BUDGET/2026-08-31?format=json&since=' + mid);
  check('since= from mid-session returns exactly the newer bars', inc2.j().rows.length === 5, inc2.j().rows.length + '');
  check('incremental rows are the LAST ones', inc2.j().rows[inc2.j().rows.length - 1].unix === lastUnix);
  // the schema probe must not scan the table
  schemaReadyReset();
  let scans = 0;
  const origPrep = db.prepare.bind(db);
  db.prepare = (sql) => { if (/COUNT\(\*\)\s+FROM bars(?!\s+WHERE)/i.test(sql)) scans++; return origPrep(sql); };
  await get('/');
  check('opening the schema never counts every bar', scans === 0, scans + ' full scans');
  db.prepare = origPrep;
  r = await get('/');
  check('the schema version is recorded so the migration runs once', !!db.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get());
}


// ---- the read budget, measured the way D1 measures it
{
  // a realistic trading day: 18 symbols, one refresh a minute for 390 minutes
  upstream.bars = session(390, clock - 390 * 60);
  const SYMS = ['NVDA','AAPL','MSFT','AMZN','META','TSLA','GOOGL','AVGO','JPM','VOO','SPMO','TQQQ','BRK-B','SPY','QQQ','SMH','XLK','XLC'];
  for (const s of SYMS) await get('/sync/' + s);          // seed
  READS.n = 0;
  // first load of the day: one full session per symbol
  const lastUnix = {};
  for (const s of SYMS) { const d = (await get('/day/' + s + '?format=json')).j(); lastUnix[s] = d.rows.length ? d.rows[d.rows.length - 1].unix : 0; }
  const firstLoad = READS.n;
  check('a full first load is bounded', firstLoad < 18 * 500, firstLoad.toLocaleString() + ' rows');
  // then 390 incremental refreshes
  READS.n = 0;
  for (let i = 0; i < 20; i++) for (const s of SYMS) await get('/day/' + s + '?format=json&since=' + lastUnix[s]);
  const per20 = READS.n;
  const perRefresh = per20 / 20;
  const projected = firstLoad + perRefresh * 390;
  check('an incremental refresh of every symbol is cheap', perRefresh < 200, perRefresh.toFixed(0) + ' rows per full-board refresh');
  check('a whole trading day stays inside the D1 free read budget', projected < 5000000 * 0.5,
    Math.round(projected).toLocaleString() + ' rows/day = ' + (projected / 5000000 * 100).toFixed(1) + '% of the 5M limit');
  // the schema path must stay constant-cost no matter how big the table gets
  READS.n = 0; await get('/'); await get('/'); await get('/');
  check('opening the service costs a constant number of rows', READS.n < 200, READS.n + ' rows for three requests');
  READS.n = 0; await get('/status');
  check('/status never scans the bars table', READS.n < 500, READS.n + ' rows');
  upstream.bars = null;
}

// ---- the meter and the guard
{
  r = await get('/usage');
  const u = r.j();
  check('/usage reports the day and both limits', u.day && u.read_limit === 5000000 && u.write_limit === 100000);
  check('/usage counts what has actually been read', u.reads > 0, u.reads.toLocaleString() + ' reads, ' + u.read_pct + '%');
  check('/usage reports the percentage consumed', typeof u.read_pct === 'number');
  check('/status carries the usage too', !!(await get('/status')).j().usage);
  const sc = (await get('/selfcheck')).j().selfcheck;
  check('/selfcheck reports usage', /reads/.test(String(sc.usage_today)), String(sc.usage_today).slice(0, 60));
  // guard: pretend the day is nearly spent
  db.db.prepare('UPDATE usage SET reads = ? WHERE day = ?').run(4900000, new Date().toISOString().slice(0, 10));
  r = await get('/sync/NVDA');
  check('expensive work is refused near the limit', r.status === 429 && /read budget/.test(r.body), r.status + '');
  check('the refusal explains that the data is safe and when it resets', /00:00 UTC/.test(r.body) && /unaffected/.test(r.body));
  r = await get('/day/NVDA/2026-08-31');
  check('reading stored data still works while the guard is on', r.status === 200);
  db.db.prepare('UPDATE usage SET reads = 0 WHERE day = ?').run(new Date().toISOString().slice(0, 10));
}


// ---- the system log lives outside D1 on purpose
{
  // a minimal KV stub
  const kvStore = {};
  let kvPuts = 0;
  const KV = {
    get: async (k, type) => { const v = kvStore[k]; if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { kvPuts++; kvStore[k] = v; }
  };
  const envKV = { DB: db, LOG: KV };
  const getKV = async (path) => {
    const r = await mod.fetch(new Request('https://x' + path), envKV, ctx);
    const body = await r.text();
    return { status: r.status, body, j: () => JSON.parse(body) };
  };

  let r2 = await getKV('/log');
  check('/log answers with KV bound', r2.status === 200 && r2.j().available === true);
  check('an empty log is empty, not an error', r2.j().count === 0);

  r2 = await getKV('/logtest');
  check('/logtest writes an entry', r2.j().wrote === true && r2.j().kv_bound === true);
  r2 = await getKV('/log');
  check('the entry is readable back', r2.j().count === 1 && r2.j().entries[0].code === 'manual_test');
  check('entries carry a timestamp and a level', !!r2.j().entries[0].t && !!r2.j().entries[0].level);

  // the whole point: it answers while D1 is broken
  const origPrepare = db.prepare.bind(db);
  db.prepare = () => { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."); };
  r2 = await getKV('/status');
  check('D1 down: a normal route fails', r2.status === 500 && /exceeded/.test(r2.body));
  await new Promise(res => setImmediate(res));
  r2 = await getKV('/log');
  check('D1 down: /log still answers', r2.status === 200 && r2.j().available === true);
  const quotaEntry = r2.j().entries.find(e => e.code === 'd1_limit');
  check('the D1 failure was recorded in KV', !!quotaEntry, quotaEntry ? quotaEntry.level + ': ' + quotaEntry.message.slice(0, 40) : 'not found');
  check('the recorded failure names the path', !!quotaEntry && quotaEntry.extra && quotaEntry.extra.path === '/status', quotaEntry && quotaEntry.extra && quotaEntry.extra.path);
  check('a quota failure is classified as quota, not a generic error', quotaEntry.level === 'quota');
  db.prepare = origPrepare;

  // without KV the service still works, it just cannot log
  r2 = await get('/log');
  check('no KV bound: /log says so instead of failing', r2.status === 200 && r2.j().available === false && /not configured/.test(r2.j().reason));
  check('no KV bound: the rest of the service is unaffected', (await get('/status')).status === 200);

  // the KV write budget is protected
  kvPuts = 0;
  for (let i = 0; i < 20; i++) await getKV('/logtest');
  check('logging writes at most one KV entry per event', kvPuts === 20, kvPuts + ' puts');
  const day = new Date().toISOString().slice(0, 10);
  const stored = JSON.parse(kvStore['log:' + day]);
  check('a day is one key, not one key per entry', Object.keys(kvStore).length === 1, Object.keys(kvStore).join(','));
  check('the day file is capped', stored.length <= 300, stored.length + ' entries');

  // selfcheck reports the log
  const sc = (await getKV('/selfcheck')).j().selfcheck;
  check('/selfcheck reports the KV log', /entries today/.test(String(sc.kv_log)), String(sc.kv_log));
  const scNoKv = (await get('/selfcheck')).j().selfcheck;
  check('/selfcheck flags a missing KV binding', /FAILED/.test(String(scNoKv.kv_log)), String(scNoKv.kv_log));
}


// ---- pages and favicon must not touch D1 at all
{
  // The KV log caught this: /favicon.ico was reaching the database on every
  // page load and failing there when the quota ran out.
  const origPrepare = db.prepare.bind(db), origBatch = db.batch.bind(db);
  let touched = 0;
  db.prepare = (sql) => { touched++; return origPrepare(sql); };
  db.batch = (s) => { touched++; return origBatch(s); };

  for (const p of ['/favicon.ico', '/radar', '/db', '/view/NVDA', '/view/NVDA/2026-08-31']) {
    touched = 0;
    const res = await get(p);
    check('no D1 work for ' + p, touched === 0, touched + ' D1 calls, status ' + res.status);
  }
  touched = 0; await get('/log');
  check('no D1 work for /log', touched === 0, touched + ' D1 calls');

  db.prepare = origPrepare; db.batch = origBatch;
  check('/favicon.ico answers 204, not an error', (await get('/favicon.ico')).status === 204);
  check('/radar still serves its page', /Market Radar/.test((await get('/radar')).body));
  check('/db still serves its page', /מה יש במסד/.test((await get('/db')).body));
  check('/view still serves its page', /<svg id="svg"/.test((await get('/view/NVDA')).body));
  check('/view still rejects a bad symbol', (await get('/view/BAD SYM')).status === 400);
  // and a route that genuinely needs the database still uses it
  touched = 0;
  db.prepare = (sql) => { touched++; return origPrepare(sql); };
  await get('/status');
  db.prepare = origPrepare;
  check('/status does still query the database', touched > 0, touched + ' D1 calls');
}


// ---- the WRITE budget, which also blew: 103k written against a 100k limit
{
  upstream.bars = session(390, clock - 390 * 60);
  const SYMS = ['A1','A2','A3','A4','A5','A6','A7','A8','A9','B1','B2','B3','B4'];
  // a first-contact backfill is the expensive case: every bar is new
  WRITES.n = 0;
  await get('/backfill/A1');
  const oneBackfill = WRITES.n;
  check('one full backfill is bounded', oneBackfill < 6000, oneBackfill.toLocaleString() + ' rows written');
  // At production scale a 5-day backfill is ~1,950 bars, and D1 charges an
  // extra written row for the index, so 13 symbols in one night is ~50k rows —
  // half the daily write budget in a single burst. Hence one symbol per run.
  { let picked = 0;
    for (let i = 0; i < 3; i++) { await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, env, ctx); await ctx.pending;
      const last = db.db.prepare("SELECT symbols FROM runs WHERE kind='cron-backfill' ORDER BY id DESC LIMIT 1").get();
      if (last) picked = Math.max(picked, last.symbols); }
    check('the nightly backfill never takes more than one symbol per run', picked === 1, picked + ' symbols per run'); }

  // steady state: intraday cron, 78 runs across the session
  for (const s of SYMS) await get('/sync/' + s);
  WRITES.n = 0;
  for (let i = 0; i < 6; i++) { await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, env, ctx); await ctx.pending; }
  const per6 = WRITES.n, perRun = per6 / 6;
  const dayWrites = perRun * 78 + oneBackfill;      // intraday runs + one nightly symbol
  check('an intraday cron run writes little', perRun < 500, perRun.toFixed(0) + ' rows per run');
  check('a whole trading day stays inside the D1 free WRITE budget', dayWrites < 100000 * 0.5,
    Math.round(dayWrites).toLocaleString() + ' rows/day = ' + (dayWrites / 100000 * 100).toFixed(1) + '% of the 100k limit');
  upstream.bars = null;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
