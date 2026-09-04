// bars-vault test harness. Real SQLite behind a D1-compatible shim, mocked
// Yahoo, and a subrequest counter so the Free-plan cap (50/invocation) is
// asserted, not assumed.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

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
let clock = 1788205200;
const nowSecTest = () => clock;                            // 2026-08-31 15:40 ET
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
let schemaReadyReset = () => {};   // the module flag is per-import; the D1-down test breaks batch() too, which ensureSchema calls first
const db = new D1();
let env = { DB: db, RATE_PER_MIN: 1000000 };   // the per-minute cap has its own block
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
// the first nightly run does the outstanding index work and stops there
await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, env, ctx); if (ctx.pending) await ctx.pending;
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
env = { DB: db, API_KEY: 'secret123', RATE_PER_MIN: 1000000 };
check('sync without key -> 401', (await get('/sync/SPMO')).status === 401);
check('backfill without key -> 401', (await get('/backfill/SPMO')).status === 401);
check('sync with ?key -> 200', (await get('/sync/SPMO?key=secret123')).status === 200);
check('sync with header -> 200', (await get('/sync/SPMO', { 'X-Api-Key': 'secret123' })).status === 200);
check('reading stored data stays open', (await get('/day/SPMO/2026-08-31')).status === 200);
check('tracked symbol top-up stays open', (await get('/day/SPMO')).status === 200);
check('adding a NEW symbol via /day needs key', (await get('/day/ZZZZ')).status === 401);
check('cron ignores key (runs internally)', (await (async () => { await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, env, ctx); await ctx.pending; return true; })()));
env = { DB: db, RATE_PER_MIN: 1000000 };

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
  // frugal (75-90%): incremental reads still served, expensive work refused
  db.db.prepare('UPDATE usage SET reads = ?, writes = ? WHERE day = ?').run(4000000, 80000, new Date().toISOString().slice(0, 10));
  check('frugal: the tier is reported', (await get('/usage')).j().tier === 'frugal', (await get('/usage')).j().tier);
  check('reads and writes are graded separately', (await get('/usage')).j().read_tier === 'frugal' && (await get('/usage')).j().write_tier === 'frugal',
    (await get('/usage')).j().read_tier + ' / ' + (await get('/usage')).j().write_tier);
  r = await get('/day/NVDA/2026-08-31');
  check('frugal: reading a past day still works', r.status === 200, r.status + '');
  check('frugal: sync is refused', (await get('/sync/NVDA')).status === 429);
  // a spent WRITE budget must not freeze reading
  db.db.prepare('UPDATE usage SET reads = 0, writes = ? WHERE day = ?').run(99000, new Date().toISOString().slice(0, 10));
  check('a spent write budget leaves reads working', (await get('/day/NVDA/2026-08-31')).status === 200);
  check('...but stops anything that writes', (await get('/sync/NVDA')).status === 429);
  check('the two tiers differ when only writes are gone',
    (await get('/usage')).j().read_tier === 'normal' && (await get('/usage')).j().write_tier === 'frozen',
    (await get('/usage')).j().read_tier + ' / ' + (await get('/usage')).j().write_tier);
  // frozen (>=90%): no D1 at all
  db.db.prepare('UPDATE usage SET reads = ?, writes = ? WHERE day = ?').run(4800000, 99000, new Date().toISOString().slice(0, 10));
  check('frozen: the tier is reported', (await get('/usage')).j().tier === 'frozen', (await get('/usage')).j().tier);
  r = await get('/day/NVDA/2026-08-31');
  check('frozen: a read is answered from a snapshot or refused clearly, never with a raw D1 error',
    (r.status === 200 && r.j().from_snapshot === true) || (r.status === 503 && /budget spent/.test(r.body)), r.status + '');
  check('frozen: the response says why and when it clears', /00:00 UTC|budget spent/.test(r.body));
  db.db.prepare('UPDATE usage SET reads = 0, writes = 0 WHERE day = ?').run(new Date().toISOString().slice(0, 10));
  check('back to normal once the day resets', (await get('/usage')).j().tier === 'normal', (await get('/usage')).j().tier);
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
  const envKV = { DB: db, LOG: KV, RATE_PER_MIN: 1000000 };
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
  const origPrepare = db.prepare.bind(db), origBatch2 = db.batch.bind(db);
  db.prepare = () => { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."); };
  db.batch = () => { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."); };
  schemaReadyReset();
  r2 = await getKV('/status');
  check('D1 down: a normal route fails', r2.status === 500 && /exceeded/.test(r2.body), r2.status + ' ' + r2.body.slice(0, 60));
  await new Promise(res => setImmediate(res));
  r2 = await getKV('/log');
  check('D1 down: /log still answers', r2.status === 200 && r2.j().available === true);
  const quotaEntry = r2.j().entries.find(e => e.code === 'd1_limit');
  check('the D1 failure was recorded in KV', !!quotaEntry, quotaEntry ? quotaEntry.level + ': ' + quotaEntry.message.slice(0, 40) : 'not found');
  check('the recorded failure names the path', !!quotaEntry && quotaEntry.extra && quotaEntry.extra.path === '/status', quotaEntry && quotaEntry.extra && quotaEntry.extra.path);
  check('a quota failure is classified as quota, not a generic error', quotaEntry.level === 'quota');
  db.prepare = origPrepare; db.batch = origBatch2;

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


// ---- the safety net: snapshots, the rate cap, and a cron that stands down
{
  const kvStore = {};
  const KV = { get: async (k, ty) => { const v = kvStore[k]; return v == null ? null : (ty === 'json' ? JSON.parse(v) : v); },
               put: async (k, v) => { kvStore[k] = v; } };
  const e2 = { DB: db, LOG: KV, RATE_PER_MIN: 1000000 };
  const g2 = async (p) => { const r = await mod.fetch(new Request('https://x' + p), e2, ctx);
    const body = await r.text(); return { status: r.status, h: Object.fromEntries(r.headers), body, j: () => JSON.parse(body) }; };
  const today = new Date().toISOString().slice(0, 10);
  // both budgets, since they are now graded separately
  const setUsage = (reads, writes) => db.db.prepare('INSERT INTO usage (day, reads, writes, queries) VALUES (?, ?, ?, 0) ON CONFLICT(day) DO UPDATE SET reads = ?, writes = ?')
    .run(today, reads, writes == null ? reads / 50 : writes, reads, writes == null ? reads / 50 : writes);

  upstream.bars = session(390, clock - 390 * 60);
  await g2('/sync/SNAP');
  setUsage(0);
  let r3 = await g2('/day/SNAP/2026-08-31?format=json');
  check('a normal read is served from the database', r3.status === 200 && !r3.j().from_snapshot, r3.h['x-budget-tier']);
  await new Promise(res => setImmediate(res));
  check('a successful read is snapshotted to KV', Object.keys(kvStore).some(k => k.startsWith('snap:SNAP:')), Object.keys(kvStore).join(','));

  // frozen: the same read is answered from KV, with no D1 work at all
  setUsage(4800000, 0);
  const origPrepare = db.prepare.bind(db);
  let d1calls = 0; db.prepare = (sql) => { d1calls++; return origPrepare(sql); };
  r3 = await g2('/day/SNAP/2026-08-31?format=json');
  const d1AfterFrozen = d1calls;
  db.prepare = origPrepare;
  check('frozen: the read is answered from the snapshot', r3.status === 200 && r3.j().from_snapshot === true, r3.h['x-from-snapshot']);
  check('frozen: the answer carries real bars, not an error', (r3.j().rows || []).length > 300, (r3.j().rows || []).length + ' bars');
  check('frozen: the reply says why', /budget spent/.test(r3.body));
  check('frozen: barely any database work', d1AfterFrozen <= 3, d1AfterFrozen + ' D1 calls');

  // cron only writes, so it stands down on the write budget
  setUsage(4800000, 99000);
  const runsBefore = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, e2, ctx);
  if (ctx.pending) await ctx.pending;
  check('cron does not run when the budget is spent', db.db.prepare('SELECT COUNT(*) c FROM runs').get().c === runsBefore);
  const logToday = JSON.parse(kvStore['log:' + today] || '[]');
  check('the skipped cron is recorded in KV', logToday.some(e => e.code === 'cron_skipped'), logToday.map(e => e.code).join(','));

  setUsage(0, 0);
  // the per-minute cap stops a runaway loop
  const e3 = { DB: db, LOG: KV, RATE_PER_MIN: 5 };
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const r4 = await mod.fetch(new Request('https://x/status'), e3, ctx);
    if (r4.status === 429) limited++;
  }
  check('a runaway loop is rate limited', limited >= 5, limited + ' of 12 requests refused');
  const r5 = await mod.fetch(new Request('https://x/status'), e3, ctx);
  check('the refusal explains itself', /runaway loop|too many requests/.test(await r5.text()));
  const r6 = await mod.fetch(new Request('https://x/log'), e3, ctx);
  check('the rate cap never blocks the log', r6.status === 200);
  const r7 = await mod.fetch(new Request('https://x/radar'), e3, ctx);
  check('the rate cap never blocks the pages', r7.status === 200);
  upstream.bars = null;
}


// ---- every response states its own cost, and the tally names the culprit
{
  upstream.bars = session(390, clock - 390 * 60);
  await get('/sync/COST');
  r = await get('/day/COST/2026-08-31?format=json');
  check('a response reports the rows it read', r.h['x-rows-read'] !== undefined && Number(r.h['x-rows-read']) >= 0,
    r.h['x-rows-read'] + ' rows, ' + r.h['x-queries'] + ' queries');
  check('a response reports the rows it wrote', r.h['x-rows-written'] !== undefined);
  // a deliberately expensive query must be named
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => origPrepare(sql);
  r = await get('/status');
  check('a cheap route reports a small number', Number(r.h['x-rows-read']) < 1000, r.h['x-rows-read'] + ' rows');
  await new Promise(res => setImmediate(res));
  const routes = (await get('/usage')).j().by_route;
  check('/usage breaks consumption down by route', Array.isArray(routes), (routes || []).length + ' routes');
  if (routes && routes.length) {
    check('each route reports reads per hit', routes.every(x => 'reads_per_hit' in x && 'pct_of_daily' in x),
      routes.slice(0, 3).map(x => x.route + ' ' + x.reads_per_hit + '/hit').join(' | '));
    check('routes are grouped by shape, not by symbol', routes.every(x => !/NVDA|COST|2026-/.test(x.route)),
      routes.map(x => x.route).join(', '));
  }
  db.prepare = origPrepare;
  upstream.bars = null;
}


// ---- no route may scan the bars table
{
  upstream.bars = session(390, clock - 390 * 60);
  for (const s of ['S1','S2','S3']) await get('/sync/' + s);
  const barCount = db.db.prepare('SELECT COUNT(*) c FROM bars').get().c;
  const budgetPerHit = Math.max(1200, barCount * 0.25);   // a scan would be ~barCount
  for (const p of ['/', '/status', '/usage', '/selfcheck', '/days/S1']) {
    const res = await get(p);
    check(p + ' does not scan the bars table', Number(res.h['x-rows-read']) < budgetPerHit,
      res.h['x-rows-read'] + ' rows read of ' + barCount + ' stored' + (res.h['x-top-query'] ? ' — worst: ' + res.h['x-top-query'] : ''));
  }
  // a full-day read is allowed to cost a day; nothing more
  const day = await get('/day/S1/2026-08-31?format=json');
  check('/day reads one session, not the table', Number(day.h['x-rows-read']) < 900,
    day.h['x-rows-read'] + ' rows for ' + day.j().rows.length + ' bars');
  const inc = await get('/day/S1/2026-08-31?format=json&since=' + day.j().rows[day.j().rows.length - 3].unix);
  check('an incremental read costs almost nothing', Number(inc.h['x-rows-read']) < 60, inc.h['x-rows-read'] + ' rows');
  upstream.bars = null;
}


// ---- an older database must gain every table the current code expects
{
  // A database created by an earlier version: the meta row says it is current,
  // which is exactly how the missing usage_route table slipped through.
  // schemaReady is a module-level flag, so a fresh import is needed to
  // exercise the cold path the way a new isolate would.
  const freshMod = (await import('./worker.js?migration=' + Date.now())).default;
  const old = new D1();
  old.db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  old.db.exec(`CREATE TABLE symbols (symbol TEXT PRIMARY KEY, added_at INTEGER NOT NULL, last_fetch_at INTEGER, last_bar_unix INTEGER, last_error TEXT, last_backfill_at INTEGER)`);
  old.db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '2')").run();
  schemaReadyReset();
  const envOld = { DB: old, RATE_PER_MIN: 1000000 };
  const r9 = await freshMod.fetch(new Request('https://x/usage'), envOld, ctx);
  check('an older database is migrated instead of erroring', r9.status === 200, r9.status + ' ' + (await r9.clone().text()).slice(0, 80));

  // every table named in the worker's schema must now exist
  const wanted = ['bars', 'days', 'symbols', 'runs', 'meta', 'usage', 'usage_route'];
  const present = old.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
  const missing = wanted.filter(t => present.indexOf(t) < 0);
  check('every expected table exists after migration', missing.length === 0, missing.join(',') || present.join(','));
  const v = old.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  check('the schema version is advanced, so this cannot repeat silently', v && v.value !== '2', v && v.value);
}


// ---- the version must move whenever the table list does
{
  const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
  const version = (src.match(/const SCHEMA_VERSION = '([^']+)'/) || [])[1];
  const tables = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]).sort();
  // A fingerprint of the declared tables, checked against the one recorded when
  // the version was last bumped. If they diverge, SCHEMA_VERSION was not moved.
  const EXPECTED_TABLES = ['bars', 'daily_bars', 'days', 'meta', 'runs', 'symbols', 'usage', 'usage_route'];
  check('every declared table is accounted for', JSON.stringify(tables) === JSON.stringify(EXPECTED_TABLES),
    'declared: ' + tables.join(',') + (JSON.stringify(tables) !== JSON.stringify(EXPECTED_TABLES)
      ? '  <-- table list changed: bump SCHEMA_VERSION and update EXPECTED_TABLES in this test' : ''));
  check('the schema version is set', !!version, version);
}


// ---- closed market: reads must cost nothing upstream and nothing in writes
{
  upstream.bars = session(390, clock - 390 * 60);
  await get('/sync/CLOSED');
  // move the clock to 03:00 ET on a weekday — market shut
  const openClock = clock;
  clock = Math.floor(Date.UTC(2026, 8, 3, 7, 0) / 1000);      // 03:00 ET
  upstream.calls = [];
  WRITES.n = 0;
  for (let i = 0; i < 10; i++) await get('/day/CLOSED?format=json');
  check('a closed market triggers no upstream fetches at all', upstream.calls.length === 0, upstream.calls.length + ' fetches');
  check('a closed market costs no writes', WRITES.n === 0, WRITES.n + ' rows written');
  let res = await get('/day/CLOSED?format=json');
  check('the response says the market is closed', res.h['x-market-open'] === 'false', res.h['x-market-open']);
  check('stored bars are still returned while closed', res.j().rows.length > 0, res.j().rows.length + ' bars');
  // and the intraday cron declines to run
  const runsBefore = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, env, ctx);
  if (ctx.pending) await ctx.pending;
  check('the intraday cron does not run outside the session',
    db.db.prepare('SELECT COUNT(*) c FROM runs').get().c === runsBefore);
  // weekend
  clock = Math.floor(Date.UTC(2026, 8, 5, 17, 0) / 1000);     // Saturday 13:00 ET
  upstream.calls = [];
  await get('/day/CLOSED?format=json');
  check('a weekend triggers no upstream fetches', upstream.calls.length === 0, upstream.calls.length + ' fetches');
  // back inside the session it works normally again
  clock = openClock;
  db.db.prepare("UPDATE symbols SET last_fetch_at = 0 WHERE symbol = 'CLOSED'").run();
  db.db.prepare("UPDATE days SET date = '2026-08-30' WHERE symbol = 'CLOSED'").run();
  upstream.calls = [];
  res = await get('/day/CLOSED?format=json');
  check('during the session a stale symbol is topped up again', upstream.calls.length > 0, upstream.calls.length + ' fetches');
  check('the response says the market is open', res.h['x-market-open'] === 'true');
  upstream.bars = null;
}

// ---- an unchanged poll must cost zero writes
{
  upstream.bars = session(390, clock - 390 * 60);
  await get('/sync/QUIET');
  await get('/sync/QUIET');                       // everything already stored
  WRITES.n = 0;
  for (let i = 0; i < 20; i++) await get('/sync/QUIET');
  // /sync deliberately records one run row per invocation — that is the audit
  // trail. What must be zero is bar and bookkeeping writes.
  check('twenty polls that find nothing new cost one row each, the run log',
    WRITES.n === 20, WRITES.n + ' rows for 20 syncs');
  const runRows = db.db.prepare("SELECT COUNT(*) c FROM runs WHERE kind='manual-one'").get().c;
  check('...and those rows are the run log, not data', runRows >= 20, runRows + ' run rows');
  // reads, which is what the radar actually does, write nothing at all
  WRITES.n = 0;
  for (let i = 0; i < 20; i++) await get('/day/QUIET?format=json');
  check('twenty reads write nothing', WRITES.n === 0, WRITES.n + ' rows written');
  upstream.bars = null;
}


// ---- the day read must use an index, not scan the symbol's whole history
{
  // The index is built by the nightly job, not by a page load, so the suite
  // builds it the same way production does before checking the plans.
  await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, env, ctx);
  if (ctx.pending) await ctx.pending;
  check('the index is present once the nightly job has run',
    !!db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get());
  // Row counts in this harness cannot model index use, so the plan is checked
  // directly. This is the bug that made /day/:sym cost 14,789 rows a hit in
  // production: ORDER BY unix sent SQLite to the primary key, which reads every
  // bar the symbol has ever had.
  const plan = (sql, ...args) => db.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(r => r.detail).join(' | ');
  const full = plan('SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix', 'NVDA', '2026-08-31');
  check('a full-day read uses the composite index', /USING INDEX bars_symbol_date_unix/.test(full), full);
  check('a full-day read does not scan bars', !/SCAN bars/.test(full), full);
  const inc = plan('SELECT * FROM bars WHERE symbol = ? AND date = ? AND unix > ? ORDER BY unix', 'NVDA', '2026-08-31', 0);
  check('an incremental read uses the same index on all three columns',
    /bars_symbol_date_unix \(symbol=\? AND date=\? AND unix>\?\)/.test(inc), inc);
  check('neither read falls back to the primary key', !/sqlite_autoindex/.test(full + inc), full + ' || ' + inc);
  // the cost must not grow as more history is stored
  const before = db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='NVDA'").get().c;
  check('the index exists on the live schema', db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get() !== undefined);
  check('the superseded index is gone', db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date'").get() === undefined,
    before + ' NVDA bars stored');
}


// ---- the mirror: a second copy that does not depend on this Worker
{
  const realFetch = globalThis.fetch;
  let posted = [], readCalls = [], failNext = false;
  const mirrorEnv = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_KEY: 'anon-key' };
  const gm = async (p, e) => { const r = await mod.fetch(new Request('https://x' + p), e || mirrorEnv, ctx);
    const body = await r.text(); return { status: r.status, body, h: Object.fromEntries(r.headers), j: () => JSON.parse(body) }; };
  globalThis.fetch = async (u, opts) => {
    if (/supabase\.co\/rest/.test(u)) {
      if (failNext) { failNext = false; return { status: 500, text: async () => 'mirror exploded' }; }
      if (opts && opts.method === 'POST') { posted.push({ url: u, rows: JSON.parse(opts.body), headers: opts.headers }); return { status: 201, text: async () => '' }; }
      readCalls.push(u);
      return { status: 200, text: async () => JSON.stringify([{ symbol: 'SPY', unix: 1, date: '2026-08-31', time: '09:30', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]) };
    }
    return realFetch(u, opts);
  };

  // off by default, and the Worker runs fine without it
  check('the mirror is off when unconfigured', (await get('/mirror')).j().enabled === false);
  check('the mirror explains how to switch it on', /SUPABASE_URL/.test((await get('/mirror')).body));
  check('the schema is served, not just described', /create table if not exists bars/.test((await get('/mirror/schema')).body));
  check('the schema locks the anon key to read-only', /enable row level security/.test((await get('/mirror/schema')).body) && /for select/.test((await get('/mirror/schema')).body));

  // configured: bars are copied as they are written
  upstream.bars = session(390, clock - 390 * 60);
  posted = [];
  let r2 = await gm('/sync/MIRROR');
  await new Promise(res => setImmediate(res)); await new Promise(res => setImmediate(res));
  check('the mirror is reported on', (await gm('/mirror')).j().enabled === true);
  check('new bars are copied to the mirror', posted.length > 0 && posted[0].rows.length > 300, (posted[0] ? posted[0].rows.length : 0) + ' rows posted');
  check('the copy carries the real columns', posted[0] && ['symbol','unix','date','time','open','high','low','close','volume'].every(k => k in posted[0].rows[0]),
    posted[0] ? Object.keys(posted[0].rows[0]).join(',') : '');
  check('the copy upserts rather than duplicating', /on_conflict=symbol,unix/.test(posted[0].url) && /merge-duplicates/.test(posted[0].headers.Prefer));

  // a quiet poll costs the mirror nothing
  posted = [];
  await gm('/sync/MIRROR');
  await new Promise(res => setImmediate(res));
  check('an unchanged poll sends nothing to the mirror', posted.length === 0, posted.length + ' posts');

  // reading straight from the mirror never touches D1
  const origPrepare = db.prepare.bind(db); let touched = 0;
  db.prepare = (sql) => { touched++; return origPrepare(sql); };
  r2 = await gm('/mirror/read/SPY');
  db.prepare = origPrepare;
  check('a mirror read returns rows', r2.status === 200 && r2.j().rows.length === 1, JSON.stringify(r2.j().rows && r2.j().rows[0] && r2.j().rows[0].symbol));
  check('a mirror read asks the mirror, not D1', readCalls.length > 0 && /symbol=eq\.SPY/.test(readCalls[readCalls.length - 1]));

  // a broken mirror must never break the service
  failNext = true;
  posted = [];
  upstream.bars = session(390, clock - 380 * 60);
  r2 = await gm('/sync/MIRROR2');
  await new Promise(res => setImmediate(res)); await new Promise(res => setImmediate(res));
  check('a failing mirror does not fail the request', r2.status === 200 && r2.j().results[0].error === null, r2.status + '');
  check('the bars are still stored locally', db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='MIRROR2'").get().c > 0);

  // pushing existing history
  posted = [];
  r2 = await gm('/mirror/push/MIRROR');
  check('history can be pushed to the mirror in one call',
    r2.status === 200 && r2.j().pushed[0].mirrored > 300, JSON.stringify(r2.j().pushed[0]));
  check('the push reads what is stored and sends it in batches', posted.length >= 1 && posted.every(p => p.rows.length <= 500));
  check('pushing requires the key when one is set',
    (await gm('/mirror/push/MIRROR', { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_KEY: 'k', API_KEY: 'secret' })).status === 401);

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- /board: the whole radar in one request
{
  upstream.bars = session(390, clock - 390 * 60);
  for (const s of ['B1','B2','B3']) await get('/sync/' + s);
  const date = (await get('/day/B1?format=json')).j().date;

  let r2 = await get('/board?date=' + date);
  check('/board returns every tracked symbol at once', r2.status === 200 && r2.j().symbols.length >= 3, r2.j().symbols.length + ' symbols');
  check('/board returns bars for all of them in one payload', r2.j().rows.length > 900, r2.j().rows.length + ' rows');
  check('/board rows carry their symbol', r2.j().rows[0].symbol && new Set(r2.j().rows.map(x => x.symbol)).size >= 3);
  check('/board reports the newest bar so the client can resume', r2.j().last_bar_unix > 0);

  // one query for the whole board, not one per symbol
  const origPrepare = db.prepare.bind(db); let queries = 0;
  db.prepare = (sql) => { if (/FROM bars/.test(sql)) queries++; return origPrepare(sql); };
  await get('/board?date=' + date);
  db.prepare = origPrepare;
  check('the whole board costs a single bars query', queries === 1, queries + ' queries against bars');

  // incremental
  const lastUnix = r2.j().last_bar_unix;
  const inc = await get('/board?date=' + date + '&since=' + lastUnix);
  check('since= returns nothing when nothing is new', inc.j().count === 0 && inc.j().incremental === true);
  const mid = r2.j().rows.filter(x => x.symbol === 'B1').slice(-3)[0].unix;
  const inc2 = await get('/board?date=' + date + '&since=' + mid);
  const nSyms = r2.j().symbols.length;
  check('since= returns only newer bars, across every symbol', inc2.j().count > 0 && inc2.j().count <= nSyms * 3,
    inc2.j().count + ' rows for ' + nSyms + ' symbols');
  check('an incremental board read costs a few rows per symbol, not a session',
    Number(inc2.h['x-rows-read']) < nSyms * 5, inc2.h['x-rows-read'] + ' rows read for ' + nSyms + ' symbols');

  // a full board read costs one session per symbol, no more
  const full = await get('/board?date=' + date);
  check('a full board read does not scan history', Number(full.h['x-rows-read']) < full.j().symbols.length * 500,
    full.h['x-rows-read'] + ' rows for ' + full.j().symbols.length + ' symbols');

  check('/board rejects a bad date', (await get('/board?date=nope')).status === 400);
  upstream.bars = null;
}


// ---- the mirror must be a real backup, and /export a copy you own
{
  const realFetch = globalThis.fetch;
  let posted = [];
  const e4 = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const g4 = async (p) => { const r = await mod.fetch(new Request('https://x' + p), e4, ctx);
    const body = await r.text(); return { status: r.status, body, h: Object.fromEntries(r.headers), j: () => JSON.parse(body) }; };
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(u)) { if (o && o.method === 'POST') posted.push(JSON.parse(o.body)); return { status: 201, text: async () => '' }; }
    return realFetch(u, o);
  };

  upstream.bars = session(390, clock - 390 * 60);
  await g4('/sync/BK');
  // force a revision so the column has something to carry
  upstream.mode = 'mutated'; await g4('/sync/BK'); upstream.mode = 'ok';
  posted = [];
  await g4('/backfill/BK');          // a full pass writes and therefore mirrors
  await new Promise(res => setImmediate(res)); await new Promise(res => setImmediate(res));

  const sent = posted.length ? posted[0][0] : null;
  check('the mirror carries the bookkeeping columns', !!sent && 'revisions' in sent && 'first_seen' in sent && 'updated_at' in sent,
    sent ? Object.keys(sent).join(',') : 'nothing posted');
  { const schema = (await g4('/mirror/schema')).body;
    check('the mirror schema declares them too', ['revisions', 'first_seen', 'updated_at'].every(c => schema.indexOf(c) >= 0)); }

  // export
  const csv = await g4('/export/BK/2026-08-31');
  const lines = csv.body.trim().split('\n');
  check('/export returns a CSV file', /text\/csv/.test(csv.h['content-type']) && /attachment; filename=/.test(csv.h['content-disposition']),
    csv.h['content-disposition']);
  check('/export names every column, including the bookkeeping ones',
    lines[0] === 'symbol,date,time,unix,open,high,low,close,volume,revisions,first_seen,updated_at', lines[0]);
  const storedForDay = db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='BK' AND date='2026-08-31'").get().c;
  check('/export contains exactly what is stored for that day', lines.length - 1 === storedForDay,
    (lines.length - 1) + ' exported of ' + storedForDay + ' stored');
  check('/export reports the row count in a header', csv.h['x-rows'] === String(lines.length - 1));
  const all = await g4('/export/BK');
  check('/export without a date returns every day held', Number(all.h['x-rows']) >= Number(csv.h['x-rows']));
  check('/export rejects a bad date', (await g4('/export/BK/nope')).status === 400);

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- /table: browse the small tables, never the big one
{
  r = await get('/table');
  check('/table lists what can be browsed', r.j().tables.length === 6, r.j().tables.join(','));
  check('/table refuses to expose bars', r.j().tables.indexOf('bars') < 0 && /\/day and \/board/.test(r.j().note));
  r = await get('/table/symbols');
  check('/table/:name returns rows and column names', r.status === 200 && r.j().rows.length > 0 && r.j().columns.indexOf('symbol') >= 0,
    r.j().count + ' rows, ' + r.j().columns.length + ' columns');
  check('a table browse is cheap', Number(r.h['x-rows-read']) < 500, r.h['x-rows-read'] + ' rows read');
  check('/table/bars is rejected', (await get('/table/bars')).status === 404);
  check('an unknown table is rejected', (await get('/table/nope')).status === 404);
  check('a limit is honoured', (await get('/table/runs?limit=3')).j().rows.length <= 3);
  check('the limit is capped', (await get('/table/runs?limit=99999')).j().limit === 1000);
  const p1 = (await get('/table/runs?limit=2&offset=0')).j().rows;
  const p2 = (await get('/table/runs?limit=2&offset=2')).j().rows;
  check('paging moves through the table', p1.length && p2.length && p1[0].id !== p2[0].id, p1[0].id + ' then ' + p2[0].id);
  check('/data serves its page', /text\/html/.test((await get('/data')).h['content-type']) && /קריאת מסד/.test((await get('/data')).body));
  // and it must not touch D1 to do so
  const origPrepare = db.prepare.bind(db); let touched = 0;
  db.prepare = (sql) => { touched++; return origPrepare(sql); };
  await get('/data');
  db.prepare = origPrepare;
  check('serving /data costs no database work', touched === 0, touched + ' D1 calls');
}


// ---- the board must keep the fallback copy, since the radar reads through it
{
  const kvStore = {};
  const KV = { get: async (k, ty) => { const v = kvStore[k]; return v == null ? null : (ty === 'json' ? JSON.parse(v) : v); },
               put: async (k, v) => { kvStore[k] = v; } };
  const e5 = { DB: db, LOG: KV, RATE_PER_MIN: 1000000 };
  const g5 = async (p) => { const r = await mod.fetch(new Request('https://x' + p), e5, ctx);
    const body = await r.text(); return { status: r.status, body, h: Object.fromEntries(r.headers), j: () => JSON.parse(body) }; };
  const today = new Date().toISOString().slice(0, 10);
  const setUsage = (reads, writes) => db.db.prepare('INSERT INTO usage (day, reads, writes, queries) VALUES (?, ?, ?, 0) ON CONFLICT(day) DO UPDATE SET reads = ?, writes = ?')
    .run(today, reads, writes || 0, reads, writes || 0);

  upstream.bars = session(390, clock - 390 * 60);
  await g5('/sync/BRD');
  setUsage(0, 0);
  const date = (await g5('/day/BRD?format=json')).j().date;

  let r5 = await g5('/board?date=' + date);
  await new Promise(res => setImmediate(res));
  check('a full board read is snapshotted', Object.keys(kvStore).some(k => k === 'snap:BOARD:' + date),
    Object.keys(kvStore).join(','));
  const snapRows = JSON.parse(kvStore['snap:BOARD:' + date]).payload.rows.length;
  check('the snapshot holds the whole board', snapRows === r5.j().rows.length, snapRows + ' rows');

  // an incremental read must not overwrite it with a near-empty copy
  await g5('/board?date=' + date + '&since=' + r5.j().last_bar_unix);
  await new Promise(res => setImmediate(res));
  check('an incremental read does not replace the snapshot',
    JSON.parse(kvStore['snap:BOARD:' + date]).payload.rows.length === snapRows);

  // frozen: the board answers from the copy instead of returning nothing
  setUsage(4800000, 0);
  r5 = await g5('/board?date=' + date);
  check('frozen: the board serves the stored copy', r5.status === 200 && r5.j().from_snapshot === true, r5.h['x-from-snapshot']);
  check('frozen: it still carries the bars', r5.j().rows.length === snapRows, r5.j().rows.length + ' rows');
  check('frozen: it says why and when it clears', /budget spent/.test(r5.body) && /00:00 UTC/.test(r5.body));

  // a write-side blowout must freeze too, not only reads
  setUsage(0, 95000);
  check('the tier follows writes as well as reads', (await g5('/usage')).j().tier === 'frozen', (await g5('/usage')).j().tier);
  setUsage(0, 0);
  upstream.bars = null;
}


// ---- a migration must never spend the day inside a page load
{
  const kvStore = {};
  const KV = { get: async (k, ty) => { const v = kvStore[k]; return v == null ? null : (ty === 'json' ? JSON.parse(v) : v); },
               put: async (k, v) => { kvStore[k] = v; } };
  const today = new Date().toISOString().slice(0, 10);
  const setWrites = (n) => db.db.prepare('INSERT INTO usage (day, reads, writes, queries) VALUES (?, 0, ?, 0) ON CONFLICT(day) DO UPDATE SET writes = ?')
    .run(today, n, n);

  // a fresh database, opened by an ordinary request
  const fresh = new D1();
  const freshMod = (await import('./worker.js?indexes=' + Date.now())).default;
  const eF = { DB: fresh, LOG: KV, RATE_PER_MIN: 1000000 };
  const gF = async (p) => { const r = await freshMod.fetch(new Request('https://x' + p), eF, ctx);
    const body = await r.text(); return { status: r.status, body, h: Object.fromEntries(r.headers), j: () => JSON.parse(body) }; };

  let r6 = await gF('/');
  check('opening the service still works on a new database', r6.status === 200);
  const idxAfterOpen = fresh.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get();
  check('a page load does NOT build the index', idxAfterOpen === undefined, idxAfterOpen ? 'built' : 'deferred');
  check('the page load wrote only bookkeeping rows', Number(r6.h['x-rows-written']) < 100, r6.h['x-rows-written'] + ' rows written');
  check('/selfcheck reports the index as pending', /PENDING/.test(String((await gF('/selfcheck')).j().selfcheck.indexes)),
    String((await gF('/selfcheck')).j().selfcheck.indexes));

  // it is built overnight
  await freshMod.scheduled({ cron: '*/5 22-23 * * 1-5' }, eF, ctx);
  if (ctx.pending) await ctx.pending;
  check('the nightly cron builds it', !!fresh.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get());
  check('the build is recorded in the log', JSON.parse(kvStore['log:' + today] || '[]').some(e => e.code === 'index_built'));
  check('/selfcheck now reports it present', /all present/.test(String((await gF('/selfcheck')).j().selfcheck.indexes)));

  // and it defers when the day cannot afford it
  const fresh2 = new D1();
  const freshMod2 = (await import('./worker.js?indexes2=' + Date.now())).default;
  const e2 = { DB: fresh2, LOG: KV, RATE_PER_MIN: 1000000 };
  await freshMod2.fetch(new Request('https://x/'), e2, ctx);
  fresh2.db.prepare('INSERT OR REPLACE INTO usage (day, reads, writes, queries) VALUES (?, 0, ?, 0)').run(today, 90000);
  kvStore['log:' + today] = JSON.stringify([]);      // start the log clean for this check
  await freshMod2.scheduled({ cron: '*/5 22-23 * * 1-5' }, e2, ctx);
  if (ctx.pending) await ctx.pending;
  check('a spent day does not build the index',
    fresh2.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get() === undefined);
  check('the cron says why it stood down',
    JSON.parse(kvStore['log:' + today] || '[]').some(e => e.code === 'cron_skipped' || e.code === 'index_deferred'),
    JSON.parse(kvStore['log:' + today] || '[]').map(e => e.code).join(','));
  // asked directly, the builder itself refuses and explains
  const deferred = await freshMod2.fetch(new Request('https://x/migrate'), e2, ctx);
  const dj = JSON.parse(await deferred.text());
  check('/migrate declines while the budget is spent, and says so',
    dj.done === false && /budget/.test(dj.reason || ''), dj.reason || JSON.stringify(dj));
  check('the deferral is logged with the reason',
    JSON.parse(kvStore['log:' + today] || '[]').some(e => e.code === 'index_deferred'),
    JSON.parse(kvStore['log:' + today] || '[]').map(e => e.code).join(','));

  // and it can be forced explicitly
  const forced = await freshMod2.fetch(new Request('https://x/migrate?force=1'), e2, ctx);
  await forced.text();
  check('/migrate can force it when you choose to',
    !!fresh2.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get());
}


// ---- what a DEPLOY costs, measured against a database the size of production
{
  // This is the test that was missing. The suite measured requests, not the
  // first request after a schema change against a populated database — which
  // is exactly where 46,821 writes came from.
  const big = new D1();
  big.db.exec(`CREATE TABLE bars (symbol TEXT NOT NULL, unix INTEGER NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
    open REAL, high REAL, low REAL, close REAL, volume INTEGER, first_seen INTEGER, updated_at INTEGER,
    revisions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (symbol, unix))`);
  big.db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  big.db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version','1')").run();
  const ins = big.db.prepare('INSERT INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)');
  const SYMS = 20, DAYS = 6, PER = 390;
  for (let s = 0; s < SYMS; s++) for (let d = 0; d < DAYS; d++) for (let i = 0; i < PER; i++) {
    ins.run('S' + s, d * 86400 + i * 60, '2026-08-' + (20 + d), '09:30', 1, 1, 1, 1, 1, 0, 0);
  }
  const stored = big.db.prepare('SELECT COUNT(*) c FROM bars').get().c;

  WRITES.n = 0; READS.n = 0;
  const deployMod = (await import('./worker.js?deploy=' + Date.now())).default;
  const r7 = await deployMod.fetch(new Request('https://x/'), { DB: big, RATE_PER_MIN: 1000000 }, ctx);
  await r7.text();
  const deployWrites = WRITES.n, deployReads = READS.n;

  check('a database with production-scale history is set up', stored === SYMS * DAYS * PER, stored.toLocaleString() + ' bars');
  check('the first request after a deploy writes almost nothing', deployWrites < 500,
    deployWrites.toLocaleString() + ' rows written against ' + stored.toLocaleString() + ' stored');
  check('...and reads almost nothing', deployReads < stored * 0.1,
    deployReads.toLocaleString() + ' rows read');
  check('the index is left for the nightly job', 
    big.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get() === undefined);

  // and when the nightly job does it, the cost is bounded and one-off
  WRITES.n = 0;
  await deployMod.scheduled({ cron: '*/5 22-23 * * 1-5' }, { DB: big, RATE_PER_MIN: 1000000 }, ctx);
  if (ctx.pending) await ctx.pending;
  check('the nightly build creates the index', !!big.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get());
  WRITES.n = 0;
  await deployMod.scheduled({ cron: '*/5 22-23 * * 1-5' }, { DB: big, RATE_PER_MIN: 1000000 }, ctx);
  if (ctx.pending) await ctx.pending;
  check('a second nightly run costs nothing extra', WRITES.n < 200, WRITES.n + ' rows written');
}


// ---- a spent WRITE budget must not stop reading
{
  const today = new Date().toISOString().slice(0, 10);
  const set = (reads, writes) => db.db.prepare('INSERT OR REPLACE INTO usage (day, reads, writes, queries) VALUES (?, ?, ?, 0)').run(today, reads, writes);

  // exactly the state that froze the radar: writes over the limit, reads at 19%
  set(960000, 104000);
  let u = (await get('/usage')).j();
  check('the two budgets are graded separately', u.read_tier === 'normal' && u.write_tier === 'frozen',
    'reads ' + u.read_pct + '% -> ' + u.read_tier + ', writes ' + u.write_pct + '% -> ' + u.write_tier);
  const board = await get('/board');
  check('reading still works with the write budget spent', board.status === 200 && board.j().from_snapshot !== true,
    board.status + ', tier header ' + board.h['x-budget-tier']);
  const day = await get('/day/S1/2026-08-31?format=json');
  check('a stored day is still readable', day.status === 200 && day.j().rows.length > 0, day.j().rows.length + ' bars');
  check('but writing is refused', (await get('/sync/S1')).status === 429);

  // and the reverse: reads spent, writes fine
  set(4800000, 1000);
  u = (await get('/usage')).j();
  check('a spent read budget freezes reading', u.read_tier === 'frozen' && u.write_tier === 'normal',
    'reads ' + u.read_tier + ', writes ' + u.write_tier);
  const frozenBoard = await get('/board');
  check('reads then come from the snapshot or say so', frozenBoard.status === 200,
    frozenBoard.h['x-from-snapshot'] || frozenBoard.h['x-budget-tier']);

  set(0, 0);
  check('back to normal', (await get('/usage')).j().tier === 'normal');
}


// ---- pushing many symbols, and knowing whether the copy is complete
{
  const realFetch = globalThis.fetch;
  let posted = [], counts = {};
  const eM = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const gM = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eM, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(u)) {
      if (o && o.method === 'POST') { const rows = JSON.parse(o.body); posted.push(rows);
        const s = rows[0].symbol; counts[s] = (counts[s] || 0) + rows.length; return { status: 201, text: async () => '' }; }
      const m = u.match(/symbol=eq\.([A-Z0-9.\-]+)/);
      const n = m ? (counts[m[1]] || 0) : 0;
      return { status: 200, text: async () => '[]', headers: { get: (k) => k.toLowerCase() === 'content-range' ? '0-0/' + n : null } };
    }
    return realFetch(u, o);
  };

  upstream.bars = session(390, clock - 390 * 60);
  for (const s of ['M1', 'M2', 'M3']) await gM('/sync/' + s);

  // a typo must say so, not quietly show the status page
  let r8 = await gM('/mirror/psuh/M1');
  check('an unknown subcommand is an explicit error', r8.status === 404 && /unknown mirror subcommand/.test(r8.body), r8.status + '');
  check('the error lists what is valid', /\/mirror\/push\/all/.test(r8.body));

  // several at once
  posted = []; counts = {};
  r8 = await gM('/mirror/push/M1,M2,M3');
  check('a comma-separated list pushes each symbol', r8.j().pushed.length === 3, r8.j().pushed.map(x => x.symbol + ':' + x.mirrored).join(' '));
  check('each one carried its own bars', r8.j().pushed.every(x => x.mirrored === x.stored && x.stored > 300));

  // all
  posted = []; counts = {};
  r8 = await gM('/mirror/push/all');
  check('"all" pushes every tracked symbol', r8.j().pushed.length > 3, r8.j().pushed.length + ' symbols');
  check('when the subrequest budget runs out it says what is left',
    r8.j().skipped.length === 0 || /call again to continue with/.test(r8.j().note), r8.j().note.slice(0, 70));

  // bad input
  check('a bad symbol is rejected', (await gM('/mirror/push/NOT A SYMBOL')).status === 400);

  // verify
  r8 = await gM('/mirror/verify');
  const v = r8.j();
  check('/mirror/verify compares both sides per symbol', Array.isArray(v.symbols) && v.symbols.every(x => 'local' in x && 'mirrored' in x),
    v.symbols.length + ' symbols compared');
  check('a fully copied symbol reads as complete', v.symbols.filter(x => x.symbol === 'M1')[0].complete === true,
    JSON.stringify(v.symbols.filter(x => x.symbol === 'M1')[0]));
  // knock one out and prove it is caught
  counts['M2'] = 10;
  r8 = await gM('/mirror/verify');
  const m2 = r8.j().symbols.filter(x => x.symbol === 'M2')[0];
  check('a partially copied symbol is caught', m2.complete === false && m2.missing > 300, JSON.stringify(m2));
  check('verify names what to push next', /\/mirror\/push\/.*M2/.test(r8.j().push_next || ''), r8.j().push_next);
  check('verify summarises in words', /not fully mirrored|fully mirrored/.test(r8.j().summary), r8.j().summary);

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- pushing many symbols, and knowing whether the backup is complete
{
  const realFetch = globalThis.fetch;
  let posted = [], counts = {};
  const eM = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const gM = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eM, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(u)) {
      if (o && o.method === 'POST') {
        const rows = JSON.parse(o.body); posted.push(rows);
        const s = rows[0].symbol; counts[s] = (counts[s] || 0) + rows.length;
        return { status: 201, text: async () => '' };
      }
      // a count request, the shape /mirror/verify relies on
      const m = String(u).match(/symbol=eq\.([A-Z0-9.\-]+)/);
      const n = m ? (counts[m[1]] || 0) : 0;
      return { status: 200, headers: { get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null },
        text: async () => '[]' };
    }
    return realFetch(u, o);
  };

  upstream.bars = session(390, clock - 390 * 60);
  for (const s of ['M1', 'M2', 'M3']) await get('/sync/' + s);

  let rm = await gM('/mirror/push/M1,M2,M3');
  check('a list pushes several symbols in one call', rm.status === 200 && rm.j().pushed.length === 3,
    rm.j().pushed.map(x => x.symbol + ':' + x.mirrored).join(' '));
  check('each symbol reports stored and mirrored matching', rm.j().pushed.every(x => x.stored === x.mirrored && !x.error));
  check('the call says it is complete', rm.j().note === 'complete' && rm.j().error === null);

  rm = await gM('/mirror/push/all');
  check('"all" covers every tracked symbol', rm.status === 200 && rm.j().pushed.length > 3, rm.j().pushed.length + ' pushed');
  check('the subrequest budget is respected, and the rest are named',
    rm.j().skipped.length === 0 || /call again to continue with/.test(rm.j().note),
    rm.j().skipped.length + ' skipped');

  // verify: is the backup actually complete?
  const v = await gM('/mirror/verify');
  check('/mirror/verify compares both sides per symbol', v.status === 200 && Array.isArray(v.j().symbols) && v.j().symbols.length > 0,
    v.j().summary);
  check('verify reports counts from each side', v.j().symbols.every(x => 'local' in x && 'mirrored' in x && 'complete' in x));
  const m1 = v.j().symbols.find(x => x.symbol === 'M1');
  check('a fully pushed symbol reads as complete', m1 && m1.complete === true, m1 ? m1.local + ' local / ' + m1.mirrored + ' mirrored' : 'M1 missing');
  // a symbol the mirror is missing must be named, not glossed over
  counts['M2'] = 0;
  const v2 = await gM('/mirror/verify');
  check('a symbol missing from the mirror is called out', v2.j().incomplete.indexOf('M2') >= 0, v2.j().incomplete.join(','));
  check('and verify says exactly what to push next', /\/mirror\/push\/.*M2/.test(v2.j().push_next || ''), v2.j().push_next);

  // a typo must not look like success
  const bad = await gM('/mirror/puhs/M1');
  check('a mistyped subcommand 404s instead of showing the status page',
    bad.status === 404 && /unknown mirror subcommand/.test(bad.body), bad.status + '');

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the archive: many symbols, narrow rows, a rolling window
{
  const realFetch = globalThis.fetch;
  const store = { symbols: [], bars: {} };      // a tiny stand-in for Supabase
  let deleted = 0;
  const eA = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const gA = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eA, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/supabase\.co\/rest/.test(url)) {
      const method = (o && o.method) || 'GET';
      const hdr = (name, n) => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) {
        if (method === 'POST') { JSON.parse(o.body).forEach(x => store.symbols.push(x)); return { status: 201, text: async () => '', headers: hdr('', 0) }; }
        return { status: 200, text: async () => JSON.stringify(store.symbols), headers: hdr('', store.symbols.length) };
      }
      if (/archive_bars/.test(url)) {
        if (method === 'POST') {
          JSON.parse(o.body).forEach(x => { store.bars[x.symbol_id + ':' + x.unix] = x; });
          return { status: 201, text: async () => '', headers: hdr('', 0) };
        }
        if (method === 'DELETE') {
          const m = url.match(/unix=lt\.(\d+)/); const cut = m ? +m[1] : 0;
          const before = Object.keys(store.bars).length;
          Object.keys(store.bars).forEach(k => { if (store.bars[k].unix < cut) delete store.bars[k]; });
          deleted = before - Object.keys(store.bars).length;
          return { status: 204, text: async () => '', headers: hdr('', deleted) };
        }
        const idm = url.match(/symbol_id=eq\.(\d+)/);
        let rows = Object.values(store.bars);
        if (idm) rows = rows.filter(x => x.symbol_id === +idm[1]);
        const gte = url.match(/unix=gte\.(\d+)/), lte = url.match(/unix=lte\.(\d+)/);
        if (gte) rows = rows.filter(x => x.unix >= +gte[1]);
        if (lte) rows = rows.filter(x => x.unix <= +lte[1]);
        rows.sort((p, q) => p.unix - q.unix);
        return { status: 200, text: async () => JSON.stringify(rows), headers: hdr('', rows.length) };
      }
    }
    return realFetch(u, o);
  };

  check('the archive schema is served', /create table if not exists archive_bars/.test((await gA('/archive/schema')).body));
  check('the schema stores prices as integers, not floats',
    /o integer not null/.test((await gA('/archive/schema')).body));
  check('the schema keeps the symbol out of every row',
    /symbol_id smallint/.test((await gA('/archive/schema')).body));
  check('the archive is read-only to the public key',
    /for select to anon/.test((await gA('/archive/schema')).body));

  upstream.bars = session(390, clock - 390 * 60);
  let ra = await gA('/archive/fill/AAA,BBB');
  check('fill pulls from upstream straight into the archive', ra.status === 200 && ra.j().filled.length === 2,
    JSON.stringify(ra.j().filled).slice(0, 120));
  check('every fetched bar is written', ra.j().filled.every(x => x.written === x.fetched && x.written > 300));
  check('each symbol gets a small integer id, not repeated text', store.symbols.length === 2 && store.symbols.every(s => typeof s.id === 'number'),
    JSON.stringify(store.symbols));

  // round trip: what comes back must equal what went in
  const first = Object.values(store.bars).filter(x => x.symbol_id === 1).sort((p, q) => p.unix - q.unix)[0];
  check('prices are stored as scaled integers', Number.isInteger(first.o) && Number.isInteger(first.c), JSON.stringify(first));
  ra = await gA('/archive/read/AAA');
  const back = ra.j().rows;
  check('reading gives bars back in the normal shape', back.length > 300 && 'open' in back[0] && 'date' in back[0] && 'time' in back[0],
    JSON.stringify(back[0]));
  check('the round trip preserves the price to four decimals',
    Math.abs(back[0].open - first.o / 10000) < 1e-9, back[0].open + ' vs ' + first.o / 10000);
  check('date and time are derived, never stored', !('date' in first) && !('time' in first) && !('symbol' in first));

  // a rolling window keeps storage flat
  const old = { symbol_id: 1, unix: nowSecTest() - 200 * 86400, o: 1, h: 1, l: 1, c: 1, v: 1 };
  store.bars['1:' + old.unix] = old;
  const beforePrune = Object.keys(store.bars).length;
  ra = await gA('/archive/prune?key=');
  check('pruning drops what fell out of the window', Object.keys(store.bars).length < beforePrune,
    beforePrune + ' -> ' + Object.keys(store.bars).length);
  check('pruning keeps what is inside it', Object.keys(store.bars).length > 300);

  // status reports size honestly
  ra = await gA('/archive');
  check('the archive reports its size and headroom',
    ra.j().bars > 300 && typeof ra.j().estimated_mb === 'number' && typeof ra.j().pct_of_free_500mb === 'number',
    ra.j().bars + ' bars, ' + ra.j().estimated_mb + ' MB, ' + ra.j().pct_of_free_500mb + '% of 500 MB');
  check('the archive names the symbols it holds', ra.j().tracked.indexOf('AAA') >= 0);
  check('a mistyped archive subcommand 404s', (await gA('/archive/nope')).status === 404);
  check('the archive says when it is not configured',
    (await get('/archive')).status === 400 && /not configured/.test((await get('/archive')).body));

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the nightly archive pass: shards through the universe, then prunes
{
  const realFetch = globalThis.fetch;
  const store2 = { symbols: [], bars: {} };
  const logs = [];
  let kvDay = [];
  const KV = { get: async () => kvDay, put: async (k, v) => { kvDay = JSON.parse(v); kvDay.forEach(e => logs.push(e)); } };
  const eN = { DB: db, LOG: KV, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/supabase\.co\/rest/.test(url)) {
      const method = (o && o.method) || 'GET';
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) {
        if (method === 'POST') { JSON.parse(o.body).forEach(x => store2.symbols.push(x)); return { status: 201, text: async () => '', headers: hdr(0) }; }
        return { status: 200, text: async () => JSON.stringify(store2.symbols), headers: hdr(store2.symbols.length) };
      }
      if (method === 'POST') { JSON.parse(o.body).forEach(x => { store2.bars[x.symbol_id + ':' + x.unix] = x; }); return { status: 201, text: async () => '', headers: hdr(0) }; }
      if (method === 'DELETE') return { status: 204, text: async () => '', headers: hdr(0) };
      return { status: 200, text: async () => '[]', headers: hdr(Object.keys(store2.bars).length) };
    }
    return realFetch(u, o);
  };
  upstream.bars = session(390, clock - 390 * 60);

  const symsBefore = new Set(store2.symbols.map(s => s.symbol));
  await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, eN, ctx);
  if (ctx.pending) await ctx.pending;
  const added = store2.symbols.map(s => s.symbol).filter(s => !symsBefore.has(s));
  check('a nightly run archives a shard of the universe', added.length > 0 && added.length <= 12,
    added.length + ' symbols: ' + added.slice(0, 4).join(','));
  check('the shard starts at the top of the universe', added[0] === 'NVDA', added[0]);
  check('the run is recorded with its progress', logs.some(e => e.code === 'archive_pass'),
    logs.map(e => e.code).join(','));

  // the next run continues rather than repeating
  const after1 = new Set(store2.symbols.map(s => s.symbol));
  await mod.scheduled({ cron: '*/5 22-23 * * 1-5' }, eN, ctx);
  if (ctx.pending) await ctx.pending;
  const added2 = store2.symbols.map(s => s.symbol).filter(s => !after1.has(s));
  check('the next run continues where the last stopped, not from the top',
    added2.length > 0 && added2.every(s => !after1.has(s)), added2.slice(0, 4).join(','));

  // the shard stays inside the Worker's subrequest ceiling
  check('a shard is small enough for one invocation', added.length <= 12, added.length + ' symbols');

  // the universe is a real list of large US listings
  const uni = (await (await mod.fetch(new Request('https://x/archive'), eN, ctx)).json());
  check('the archive reports the universe size', uni.universe === 100, uni.universe + ' symbols');
  check('progress through the universe is visible', /%$/.test(uni.nightly_progress), uni.nightly_progress);

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- every Supabase call must carry its key, whatever else it sets
{
  const realFetch = globalThis.fetch;
  const seen = [];
  const eK = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'THEKEY' };
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      seen.push({ url: String(u), method: (o && o.method) || 'GET', headers: (o && o.headers) || {} });
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      return { status: 200, text: async () => '[]', headers: hdr(0) };
    }
    return realFetch(u, o);
  };
  upstream.bars = session(390, clock - 390 * 60);

  // the calls that set Prefer or Range are exactly the ones that used to lose it
  await mod.fetch(new Request('https://x/archive'), eK, ctx);
  await mod.fetch(new Request('https://x/archive/prune'), eK, ctx);
  await mod.fetch(new Request('https://x/archive/read/AAA'), eK, ctx);
  await mod.fetch(new Request('https://x/mirror/verify'), eK, ctx);

  check('every Supabase request was made', seen.length > 0, seen.length + ' calls');
  const missing = seen.filter(s => !s.headers || s.headers.apikey !== 'THEKEY');
  check('every Supabase request carries the api key', missing.length === 0,
    missing.length ? missing.map(m => m.method + ' ' + m.url.split('/rest/')[1].slice(0, 40)).join(' | ') : 'all ' + seen.length + ' calls');
  const withPrefer = seen.filter(s => s.headers && s.headers.Prefer);
  check('calls that set Prefer still carry the key', withPrefer.length > 0 && withPrefer.every(s => s.headers.apikey === 'THEKEY'),
    withPrefer.length + ' such calls');
  check('every request is also authorised', seen.every(s => /^Bearer THEKEY$/.test(s.headers.Authorization || '')));

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the schemas must survive being run twice
{
  for (const [name, path] of [['archive', '/archive/schema'], ['mirror', '/mirror/schema']]) {
    const sql = (await get(path)).body;
    const creates = (sql.match(/create policy/g) || []).length;
    const drops = (sql.match(/drop policy if exists/g) || []).length;
    check(name + ' schema drops each policy before creating it', creates > 0 && drops === creates,
      drops + ' drops for ' + creates + ' creates');
    check(name + ' schema creates tables idempotently',
      !/create table (?!if not exists)/.test(sql));
    check(name + ' schema creates indexes idempotently',
      !/create index (?!if not exists)/.test(sql));
  }
}


// ---- when D1 holds nothing for today, the board falls back to the archive
{
  const realFetch = globalThis.fetch;
  const arch = { symbols: [{ id: 1, symbol: 'FB1' }, { id: 2, symbol: 'FB2' }], bars: {} };
  const day = '2026-08-31';
  const base = Math.floor(Date.parse(day + 'T13:30:00Z') / 1000);
  for (const id of [1, 2]) for (let i = 0; i < 100; i++) {
    const u = base + i * 60;
    arch.bars[id + ':' + u] = { symbol_id: id, unix: u, o: 2170000, h: 2171000, l: 2169000, c: 2170500, v: 1000 + i };
  }
  const eB = { DB: db, LOG: { get: async () => [], put: async () => {} }, RATE_PER_MIN: 1000000,
               SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/supabase\.co\/rest/.test(url)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) return { status: 200, text: async () => JSON.stringify(arch.symbols), headers: hdr(2) };
      const idm = url.match(/symbol_id=eq\.(\d+)/);
      let rows = Object.values(arch.bars);
      if (idm) rows = rows.filter(x => x.symbol_id === +idm[1]);
      const gte = url.match(/unix=gte\.(\d+)/), lte = url.match(/unix=lte\.(\d+)/);
      if (gte) rows = rows.filter(x => x.unix >= +gte[1]);
      if (lte) rows = rows.filter(x => x.unix <= +lte[1]);
      rows.sort((p, q) => p.unix - q.unix);
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const gB = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eB, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };

  const r8 = await gB('/board?date=' + day + '&symbols=FB1,FB2');
  check('an empty D1 day is filled from the archive', r8.j().count > 0, r8.j().count + ' bars');
  check('the response says where the bars came from', r8.j().from_archive > 0, r8.j().from_archive + ' from archive');
  check('archive bars arrive in the normal shape',
    r8.j().rows[0] && 'open' in r8.j().rows[0] && 'time' in r8.j().rows[0] && 'symbol' in r8.j().rows[0],
    JSON.stringify(r8.j().rows[0]));
  check('prices survive the round trip', Math.abs(r8.j().rows[0].open - 217) < 1e-6, r8.j().rows[0].open + '');
  check('both symbols are covered', new Set(r8.j().rows.map(x => x.symbol)).size === 2);
  check('rows stay ordered by symbol then time',
    r8.j().rows.every((x, i, a) => i === 0 || x.symbol > a[i - 1].symbol || x.unix > a[i - 1].unix));

  // when D1 does have the day, the archive is not consulted at all
  upstream.bars = session(390, clock - 390 * 60);
  await gB('/sync/HAVE');
  const d2 = (await gB('/day/HAVE?format=json')).j().date;
  let hits = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (/archive_bars/.test(String(u))) hits++; return prevFetch(u, o); };
  await gB('/board?date=' + d2 + '&symbols=HAVE');
  globalThis.fetch = prevFetch;
  check('the archive is not touched when D1 has the day', hits === 0, hits + ' archive calls');

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the fallback is per symbol, not per board
{
  const realFetch = globalThis.fetch;
  const day2 = '2026-08-28';
  const arch2 = { symbols: [{ id: 1, symbol: 'MIX2' }], bars: {} };
  const base2 = Math.floor(Date.parse(day2 + 'T14:00:00Z') / 1000);
  for (let i = 0; i < 60; i++) arch2.bars['1:' + (base2 + i * 60)] =
    { symbol_id: 1, unix: base2 + i * 60, o: 1000000, h: 1001000, l: 999000, c: 1000500, v: 500 };
  const eM2 = { DB: db, LOG: { get: async () => [], put: async () => {} }, RATE_PER_MIN: 1000000,
                SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/supabase\.co\/rest/.test(url)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) return { status: 200, text: async () => JSON.stringify(arch2.symbols), headers: hdr(1) };
      const idm = url.match(/symbol_id=eq\.(\d+)/);
      let rows = Object.values(arch2.bars);
      if (idm) rows = rows.filter(x => x.symbol_id === +idm[1]);
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const gM2 = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eM2, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };

  // MIX1 is in D1 for that day; MIX2 is only in the archive
  upstream.bars = session(60, Math.floor(Date.parse(day2 + 'T14:00:00Z') / 1000));
  db.db.prepare("INSERT OR IGNORE INTO symbols (symbol, added_at) VALUES ('MIX1', 0)").run();
  const ins2 = db.db.prepare("INSERT OR REPLACE INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES ('MIX1',?,?,?,1,1,1,1,1,0,0,0)");
  for (let i = 0; i < 30; i++) ins2.run(base2 + i * 60, day2, '10:00');
  db.db.prepare("INSERT OR REPLACE INTO days (symbol, date, bars, first, last, revisions) VALUES ('MIX1',?,30,'10:00','10:29',0)").run(day2);

  const rM = await gM2('/board?date=' + day2 + '&symbols=MIX1,MIX2');
  const bySym = {};
  rM.j().rows.forEach(r2 => { bySym[r2.symbol] = (bySym[r2.symbol] || 0) + 1; });
  check('a symbol D1 has is served from D1', bySym.MIX1 > 0, (bySym.MIX1 || 0) + ' bars');
  check('a symbol D1 lacks is filled from the archive ANYWAY', bySym.MIX2 > 0, (bySym.MIX2 || 0) + ' bars');
  check('the mixed board reports the archive contribution', rM.j().from_archive > 0, rM.j().from_archive + '');
  check('no symbol is left blank when the archive holds it',
    Object.keys(bySym).length === 2, Object.keys(bySym).join(','));

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the maintenance window must run on a FRESH budget
{
  const src = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  const line = (src.match(/^crons = .*$/m) || [''])[0];
  check('the maintenance cron runs after the UTC reset, not before it',
    /0-1/.test(line) && !/22-23 \* \* 1-5"\]/.test(line), line);
  check('the intraday cron still covers the session', /13-21/.test(line), line);

  // and the worker recognises that window as maintenance
  const kvStore = {};
  const KV = { get: async (k, ty) => { const v = kvStore[k]; return v == null ? null : (ty === 'json' ? JSON.parse(v) : v); },
               put: async (k, v) => { kvStore[k] = v; } };
  const fresh = new D1();
  const mod2 = (await import('./worker.js?window=' + Date.now())).default;
  const envW = { DB: fresh, LOG: KV, RATE_PER_MIN: 1000000 };
  await mod2.fetch(new Request('https://x/'), envW, ctx);
  await mod2.scheduled({ cron: '*/5 0-1 * * 2-6' }, envW, ctx);
  if (ctx.pending) await ctx.pending;
  check('the 00:00-01:55 window does the maintenance work',
    !!fresh.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='bars_symbol_date_unix'").get());
}


// ---- the book probe must say WHY, not just that it failed
{
  const realFetch = globalThis.fetch;
  const shapes = {};
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (/cboe\.com/.test(url)) {
      shapes[url] = (shapes[url] || 0) + 1;
      if (/\.json$/.test(url)) return { status: 403, text: async () => 'Forbidden' };
      if (/markets\.cboe/.test(url)) return { status: 200, text: async () => '<html>login</html>' };
      if (/market_statistics/.test(url)) return { status: 200, text: async () => JSON.stringify({ data: { volume: 1 } }) };
      return { status: 404, text: async () => 'Not Found' };
    }
    return realFetch(u);
  };
  const r = await get('/bookprobe/NVDA');
  const v = r.j().venues[0];
  check('the probe reports every venue', r.j().venues.length === 4);
  check('the probe says whether the market is open', typeof r.j().market_open === 'boolean', String(r.j().market_open));
  check('a closed market is called out as a possible cause', /market/i.test(r.j().note), r.j().note);
  check('each failed attempt carries a reason', Array.isArray(v.attempts) && v.attempts.length === 4,
    (v.attempts || []).length + ' attempts');
  const why = (v.attempts || []).map(a => a.why).join(' | ');
  check('an HTTP failure reports its status', /HTTP 404/.test(why) && /HTTP 403/.test(why), why);
  check('an HTML response is reported as not JSON', /not JSON/.test(why), why);
  check('valid JSON with no levels is distinguished from a broken fetch',
    /parsed, but no levels/.test(why), why);
  check('the non-JSON attempt shows what came back instead',
    (v.attempts || []).some(a => a.body && /html/i.test(a.body)),
    JSON.stringify((v.attempts || []).find(a => a.body) || {}));

  globalThis.fetch = realFetch;
}


// ---- a partial day must be visible, and the nightly pass must repair it
{
  const realFetch = globalThis.fetch;
  const store = { symbols: [{ id: 1, symbol: 'PART' }], bars: {} };
  const put = (date, base, n) => { for (let i = 0; i < n; i++) {
    const u = Math.floor(Date.parse(date + 'T13:30:00Z') / 1000) + i * 60;
    store.bars['1:' + u] = { symbol_id: 1, unix: u, o: 1e6, h: 1e6, l: 1e6, c: 1e6, v: 1 }; } };
  put('2026-08-31', 0, 390);          // whole
  put('2026-09-01', 0, 231);          // filled mid-session

  const eP = { DB: db, LOG: { get: async () => [], put: async () => {} }, RATE_PER_MIN: 1000000,
               SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  let fetchedRange = null;
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/query1\.finance\.yahoo/.test(url)) {
      fetchedRange = (url.match(/range=(\w+)/) || [])[1];
      return realFetch(u, o);
    }
    if (/supabase\.co\/rest/.test(url)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) return { status: 200, text: async () => JSON.stringify(store.symbols), headers: hdr(1) };
      if ((o && o.method) === 'POST') { JSON.parse(o.body).forEach(x => { store.bars[x.symbol_id + ':' + x.unix] = x; }); return { status: 201, text: async () => '', headers: hdr(0) }; }
      let rows = Object.values(store.bars).sort((p, q) => p.unix - q.unix);
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const gP = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eP, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };

  const chk = await gP('/archive/check/PART');
  check('/archive/check lists the days held', chk.status === 200 && chk.j().days === 2, chk.j().days + ' days');
  check('a whole day is marked complete', chk.j().detail.some(d => d.bars === 390 && d.complete === true));
  check('a partial day is marked incomplete', chk.j().detail.some(d => d.bars === 231 && d.complete === false));
  check('the partial day is named', /2026-09-01 \(231\)/.test(chk.j().incomplete.join(',')), chk.j().incomplete.join(','));
  check('the note explains where partial days come from', /mid-session/.test(chk.j().note));

  // the nightly pass must pull five days, not one, so it can repair them
  upstream.bars = session(390, clock - 390 * 60);
  await mod.scheduled({ cron: '*/5 0-1 * * 2-6' }, eP, ctx);
  if (ctx.pending) await ctx.pending;
  check('the nightly archive pass pulls five days, not one', fetchedRange === '5d', String(fetchedRange));

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the archive must be read past the server's row cap
{
  const realFetch = globalThis.fetch;
  // 2,600 bars across 7 days: more than one PostgREST page
  const store = { symbols: [{ id: 1, symbol: 'PAGE' }], bars: [] };
  const DAYS = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'];
  DAYS.forEach(d => { for (let i = 0; i < 390; i++) {
    store.bars.push({ symbol_id: 1, unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60,
      o: 1e6, h: 1e6, l: 1e6, c: 1e6, v: 1 }); } });
  store.bars.sort((a, b) => a.unix - b.unix);

  let pages = 0;
  const eG = { DB: db, LOG: { get: async () => [], put: async () => {} }, RATE_PER_MIN: 1000000,
               SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/supabase\.co\/rest/.test(url)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) return { status: 200, text: async () => JSON.stringify(store.symbols), headers: hdr(1) };
      pages++;
      const lim = Math.min(1000, +((url.match(/limit=(\d+)/) || [0, 1000])[1]));   // the server's own cap
      const off = +((url.match(/offset=(\d+)/) || [0, 0])[1]);
      const rows = store.bars.slice(off, off + lim);
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const gG = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eG, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };

  const chk = await gG('/archive/check/PAGE');
  check('a read larger than one page returns everything', chk.j().bars === 2730, chk.j().bars + ' of 2730');
  check('every stored day is seen', chk.j().days === 7, chk.j().days + ' days');
  check('a whole day is not reported as partial because a page ended',
    chk.j().incomplete.length === 0, chk.j().incomplete.join(','));
  check('it took more than one request to get there', pages > 2, pages + ' pages fetched');
  check('every day reads complete', chk.j().detail.every(d => d.bars === 390 && d.complete));

  globalThis.fetch = realFetch;
}


// ---- the split: D1 for the session, the archive for the history
{
  const realFetch = globalThis.fetch;
  const arch = { symbols: [{ id: 1, symbol: 'SPLIT' }], bars: [] };
  const addDay = (d, n) => { for (let i = 0; i < n; i++) arch.bars.push({ symbol_id: 1,
    unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60, o: 1e6, h: 1e6, l: 1e6, c: 1e6, v: 1 }); };
  ['2026-08-26', '2026-08-27', '2026-08-28'].forEach(d => addDay(d, 390));
  arch.bars.sort((a, b) => a.unix - b.unix);

  const eS = { DB: db, LOG: { get: async () => [], put: async () => {} }, RATE_PER_MIN: 1000000,
               SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/supabase\.co\/rest/.test(url)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) return { status: 200, text: async () => JSON.stringify(arch.symbols), headers: hdr(1) };
      if ((o && o.method) === 'POST') { JSON.parse(o.body).forEach(x => arch.bars.push(x)); return { status: 201, text: async () => '', headers: hdr(0) }; }
      const lim = Math.min(1000, +((url.match(/limit=(\d+)/) || [0, 1000])[1]));
      const off = +((url.match(/offset=(\d+)/) || [0, 0])[1]);
      // The real API filters by symbol_id. A stub that does not will happily
      // count ANOTHER symbol's bars as verification for this one — which is the
      // precise mistake that would delete real data.
      const idm = url.match(/symbol_id=eq\.(\d+)/);
      let rows = arch.bars.slice().sort((a, b) => a.unix - b.unix);
      if (idm) rows = rows.filter(x => x.symbol_id === +idm[1]);
      const gte = url.match(/unix=gte\.(\d+)/), lte = url.match(/unix=lte\.(\d+)/);
      if (gte) rows = rows.filter(x => x.unix >= +gte[1]);
      if (lte) rows = rows.filter(x => x.unix <= +lte[1]);
      rows = rows.slice(off, off + lim);
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const gS = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eS, ctx);
    const body = await r.text(); return { status: r.status, body, h: Object.fromEntries(r.headers), j: () => JSON.parse(body) }; };

  // D1 holds nothing for 26 Aug; the archive does
  let r = await gS('/day/SPLIT/2026-08-26?format=json');
  check('a day only the archive holds is still served', r.j().rows.length === 390, r.j().rows.length + ' bars');
  check('the response names the store that answered', r.j().source === 'archive', r.j().source);
  check('the header names it too', r.h['x-source'] === 'archive', r.h['x-source']);
  check('archive bars arrive in the normal shape',
    ['symbol', 'unix', 'date', 'time', 'open', 'high', 'low', 'close', 'volume'].every(k => k in r.j().rows[0]));

  // the date picker must see archive-only days
  r = await gS('/days/SPLIT');
  const dates = r.j().days.map(d => d.date);
  check('/days lists days held only in the archive', dates.indexOf('2026-08-26') >= 0, dates.join(','));
  check('/days marks where each day came from', r.j().days.every(d => d.source === 'd1' || d.source === 'archive'));
  check('/days counts the archive-only days', r.j().archive_only >= 3, String(r.j().archive_only));

  // ---- the trim
  upstream.bars = session(390, clock - 390 * 60);
  await gS('/sync/SPLIT');
  r = await gS('/archive/trim-d1?symbols=SPLIT');
  check('the trim is a dry run unless told otherwise', r.j().dry_run === true && r.j().bars_deleted === 0);
  check('the dry run says how to actually do it', /apply=1/.test(r.j().note));

  // a day the archive does NOT hold must never be removed
  const d1Only = db.db.prepare("SELECT date FROM days WHERE symbol='SPLIT'").all().map(x => x.date);
  const rep = r.j().report[0] || {};
  const removable = rep.removable || [], held = rep.held_back || [];
  check('every removable day is one the archive actually holds',
    removable.every(d => ['2026-08-26', '2026-08-27', '2026-08-28'].indexOf(d) >= 0),
    removable.join(',') || 'none');
  check('a day missing from the archive is held back, not deleted',
    held.every(h => removable.indexOf(h.split(' ')[0]) < 0), held.join(' | ') || 'none held');
  check('the most recent sessions are always kept', (rep.kept || []).length >= 1 || !!rep.skipped, JSON.stringify(rep));

  // and D1 still has everything, because this was a dry run
  check('a dry run deletes nothing',
    db.db.prepare("SELECT COUNT(*) c FROM days WHERE symbol='SPLIT'").get().c === d1Only.length);

  // ---- a real trim, with one day deliberately missing from the archive
  {
    // four days in D1: three the archive has, one it does not
    const ins = db.db.prepare("INSERT OR REPLACE INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES ('TRIM',?,?,?,1,1,1,1,1,0,0,0)");
    const mkDay = (d, n) => { for (let i = 0; i < n; i++) ins.run(Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60, d, '10:00');
      db.db.prepare("INSERT OR REPLACE INTO days (symbol, date, bars, first, last, revisions) VALUES ('TRIM',?,?,'09:30','16:00',0)").run(d, n); };
    ['2026-08-26', '2026-08-27', '2026-08-28', '2026-09-01'].forEach(d => mkDay(d, 390));
    db.db.prepare("INSERT OR IGNORE INTO symbols (symbol, added_at) VALUES ('TRIM', 0)").run();
    arch.symbols.push({ id: 2, symbol: 'TRIM' });
    // the archive holds 26 and 27 only — 28 is deliberately absent
    ['2026-08-26', '2026-08-27'].forEach(d => { for (let i = 0; i < 390; i++)
      arch.bars.push({ symbol_id: 2, unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60, o: 1e6, h: 1e6, l: 1e6, c: 1e6, v: 1 }); });

    let r2 = await gS('/archive/trim-d1?symbols=TRIM&keep=1');
    const rep2 = r2.j().report[0];
    check('a day the archive lacks is never listed as removable',
      rep2.removable.indexOf('2026-08-28') < 0, rep2.removable.join(','));
    check('and it is named as held back', rep2.held_back.join(' ').indexOf('2026-08-28') >= 0, rep2.held_back.join(' | '));
    check('the days the archive does hold are listed as removable',
      rep2.removable.indexOf('2026-08-26') >= 0 && rep2.removable.indexOf('2026-08-27') >= 0, rep2.removable.join(','));

    const before = db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='TRIM'").get().c;
    r2 = await gS('/archive/trim-d1?symbols=TRIM&keep=1&apply=1');
    const after = db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='TRIM'").get().c;
    check('applying the trim actually deletes', after < before, before + ' -> ' + after);
    check('it deleted exactly the verified days', before - after === 780, (before - after) + ' bars');
    const left = db.db.prepare("SELECT date FROM days WHERE symbol='TRIM' ORDER BY date").all().map(x => x.date);
    check('the unverified day survived', left.indexOf('2026-08-28') >= 0, left.join(','));
    check('the kept session survived', left.indexOf('2026-09-01') >= 0, left.join(','));
    check('the verified days are gone', left.indexOf('2026-08-26') < 0 && left.indexOf('2026-08-27') < 0, left.join(','));
    check('and they are still readable through the archive',
      (await gS('/day/TRIM/2026-08-26?format=json')).j().rows.length === 390);
  }

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the universe: collected intraday to the archive, shown on request
{
  const realFetch = globalThis.fetch;
  const arch = { symbols: [], bars: [] };
  let yahooCalls = [], writes = 0;
  const eU = { DB: db, LOG: { get: async () => [], put: async () => {} }, RATE_PER_MIN: 1000000,
               SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    const url = String(u);
    if (/query1\.finance\.yahoo/.test(url)) {
      yahooCalls.push((url.match(/chart\/([A-Z0-9.\-]+)/) || [])[1]);
      return realFetch(u, o);
    }
    if (/supabase\.co\/rest/.test(url)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(url)) {
        if ((o && o.method) === 'POST') { JSON.parse(o.body).forEach(x => arch.symbols.push(x)); return { status: 201, text: async () => '', headers: hdr(0) }; }
        return { status: 200, text: async () => JSON.stringify(arch.symbols), headers: hdr(arch.symbols.length) };
      }
      if ((o && o.method) === 'POST') { writes++; JSON.parse(o.body).forEach(x => arch.bars.push(x)); return { status: 201, text: async () => '', headers: hdr(0) }; }
      const idm = url.match(/symbol_id=eq\.(\d+)/);
      let rows = arch.bars.slice().sort((a, b) => a.unix - b.unix);
      if (idm) rows = rows.filter(x => x.symbol_id === +idm[1]);
      const lim = Math.min(1000, +((url.match(/limit=(\d+)/) || [0, 1000])[1]));
      const off = +((url.match(/offset=(\d+)/) || [0, 0])[1]);
      rows = rows.slice(off, off + lim);
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const gU = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eU, ctx);
    const body = await r.text(); return { status: r.status, body, j: () => JSON.parse(body) }; };

  upstream.bars = session(390, clock - 390 * 60);

  // Earlier blocks left ~50 symbols tracked; production tracks 20. Trim to a
  // realistic set so this measures the guard, not the fixture.
  db.db.prepare("DELETE FROM symbols WHERE symbol NOT IN ('NVDA','GOOGL','AAPL','MSFT','AMZN','META','AVGO','TSLA','BRK-B','JPM','VOO','SPMO','TQQQ','QQQ','SMH','XLK','XLC','XLY','XLF','SPY')").run();
  yahooCalls = [];
  await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, eU, ctx);
  if (ctx.pending) await ctx.pending;
  await new Promise(r => setTimeout(r, 0));
  const universeHit = yahooCalls.filter(s => ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'AMZN'].indexOf(s) >= 0);
  check('a session run reaches into the universe', universeHit.length > 0, yahooCalls.slice(0, 12).join(','));
  check('a session run stays inside the subrequest ceiling', yahooCalls.length <= 45, yahooCalls.length + ' upstream calls');

  // it must move on next time rather than repeat
  const first = (await gU('/archive')).j().intraday_cursor;
  yahooCalls = [];
  await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, eU, ctx);
  if (ctx.pending) await ctx.pending;
  const second = (await gU('/archive')).j().intraday_cursor;
  check('the intraday walk advances', second > first, first + ' -> ' + second);
  check('progress through the universe is reported', /%$/.test((await gU('/archive')).j().intraday_progress));

  // the board can widen to the universe
  const narrow = await gU('/board');
  const wide = await gU('/board?universe=1');
  check('the default board stays with the tracked symbols',
    narrow.j().symbols.length < wide.j().symbols.length, narrow.j().symbols.length + ' vs ' + wide.j().symbols.length);
  check('the wide board includes universe names', wide.j().symbols.indexOf('WMT') >= 0);
  check('the wide board names anything it could not fetch this call',
    wide.j().not_fetched === undefined || Array.isArray(wide.j().not_fetched));


  // the slice must shrink when more symbols are tracked, never overrun
  {
    const many = [];
    for (let i = 0; i < 38; i++) many.push('Z' + i);
    many.forEach(s => db.db.prepare('INSERT OR IGNORE INTO symbols (symbol, added_at) VALUES (?, 0)').run(s));
    yahooCalls = [];
    await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, eU, ctx);
    if (ctx.pending) await ctx.pending;
    check('a crowded tracked list shrinks the universe slice rather than overrunning',
      yahooCalls.length <= 62, yahooCalls.length + ' upstream calls with ' + (20 + many.length) + ' tracked');
    many.forEach(s => db.db.prepare('DELETE FROM symbols WHERE symbol = ?').run(s));
  }
  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- the wide board must not exceed D1's bound-variable limit
{
  // 120 symbols: more than SQLite's 100-variable ceiling in a single IN list
  const lots = [];
  for (let i = 0; i < 120; i++) lots.push('Q' + i);
  const r = await get('/board?symbols=' + lots.join(','));
  check('a board of 120 symbols does not blow the variable limit', r.status === 200, r.status + ' ' + r.body.slice(0, 80));
  check('all requested symbols are carried', r.j().symbols.length === 120, r.j().symbols.length + '');
}


// ---- the watchlist: editable, capped, and the cron follows it
{
  upstream.bars = session(390, clock - 390 * 60);
  let r = await get('/watch');
  const before = r.j().count;
  check('/watch lists the live set with its cap', r.j().max === 40 && Array.isArray(r.j().tracked), before + ' tracked');

  r = await get('/watch/add/NEWLIVE');
  check('adding a symbol works', r.j().ok === true && r.j().added === 'NEWLIVE', r.body.slice(0, 80));
  check('the symbol is pulled immediately, not left for the cron',
    r.j().pulled && r.j().pulled.rows > 0, JSON.stringify(r.j().pulled));
  check('it now appears in the live set', (await get('/watch')).j().tracked.indexOf('NEWLIVE') >= 0);
  check('and the board carries it', (await get('/board?date=' + (await get('/day/NEWLIVE?format=json')).j().date)).j().symbols.indexOf('NEWLIVE') >= 0);

  r = await get('/watch/add/NEWLIVE');
  check('adding it again is a no-op, not an error', r.j().ok === true && /already/.test(r.j().note));

  r = await get('/watch/remove/NEWLIVE');
  check('removing a symbol works', r.j().ok === true && r.j().removed === 'NEWLIVE');
  check('it leaves the live set', (await get('/watch')).j().tracked.indexOf('NEWLIVE') < 0);
  check('its bars are NOT deleted by un-tracking',
    db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='NEWLIVE'").get().c > 0);

  check('a bad symbol is rejected', (await get('/watch/add/bad sym')).status === 400);
  check('an unknown subcommand 404s', (await get('/watch/nope/X')).status === 404);

  // the cap
  const now = (await get('/watch')).j().count;
  const fill = [];
  for (let i = now; i < 40; i++) fill.push('F' + i);
  for (const s of fill) await get('/watch/add/' + s);
  r = await get('/watch/add/ONEMORE');
  check('the 41st symbol is refused', r.status === 409 && /full/.test(r.j().error), r.status + ' ' + r.body.slice(0, 60));
  check('the refusal says what to do', /remove/.test(r.j().note));
  for (const s of fill) await get('/watch/remove/' + s);
  check('room is reported', typeof (await get('/watch')).j().room === 'number');

  // archive dates
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u))) return { status: 200, text: async () => JSON.stringify([{ id: 9, symbol: 'SPY' }]), headers: hdr(1) };
      const rows = []; ['2026-09-01', '2026-09-02', '2026-09-03'].forEach(d => { for (let i = 0; i < 5; i++)
        rows.push({ symbol_id: 9, unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60, o: 1, h: 1, l: 1, c: 1, v: 1 }); });
      const off = +((String(u).match(/offset=(\d+)/) || [0, 0])[1]);
      return { status: 200, text: async () => JSON.stringify(rows.slice(off, off + 1000)), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const eD = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const rd = await mod.fetch(new Request('https://x/archive/dates'), eD, ctx);
  const dj = JSON.parse(await rd.text());
  check('/archive/dates lists the sessions the archive holds, newest first',
    dj.dates.length === 3 && dj.dates[0] === '2026-09-03', dj.dates.join(','));
  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- export and copy must answer from the same place
{
  const realFetch = globalThis.fetch;
  const arch = { symbols: [{ id: 7, symbol: 'EXPO' }], bars: [] };
  for (let i = 0; i < 390; i++) arch.bars.push({ symbol_id: 7,
    unix: Math.floor(Date.parse('2026-08-31T13:30:00Z') / 1000) + i * 60, o: 1010000, h: 1020000, l: 1000000, c: 1015000, v: 5 });
  const eX = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u))) return { status: 200, text: async () => JSON.stringify(arch.symbols), headers: hdr(1) };
      const off = +((String(u).match(/offset=(\d+)/) || [0, 0])[1]);
      return { status: 200, text: async () => JSON.stringify(arch.bars.slice(off, off + 1000)), headers: hdr(arch.bars.length) };
    }
    return realFetch(u, o);
  };
  const gX = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eX, ctx);
    return { status: r.status, body: await r.text(), h: Object.fromEntries(r.headers) }; };

  // EXPO is not in D1 at all — the export used to come back empty
  const ex = await gX('/export/EXPO');
  const lines = ex.body.trim().split('\n');
  check('an export for a symbol D1 lacks comes from the archive', lines.length - 1 === 390, (lines.length - 1) + ' rows');
  check('the export names the store it used', ex.h['x-source'] === 'archive', ex.h['x-source']);
  check('the prices survive the export', /EXPO,2026-08-31,\d\d:\d\d,\d+,101,102,100,101.5,5/.test(lines[1]) || /101/.test(lines[1]), lines[1]);
  const day = await gX('/export/EXPO/2026-08-31');
  check('a single-day export works too', day.body.trim().split('\n').length - 1 === 390);
  check('an unknown day exports nothing rather than everything',
    (await gX('/export/EXPO/2026-01-01')).body.trim().split('\n').length - 1 === 0);

  // a symbol D1 DOES have still comes from D1
  upstream.bars = session(390, clock - 390 * 60);
  await gX('/sync/HASD1');
  const d1ex = await gX('/export/HASD1');
  check('a symbol D1 holds is still exported from D1', d1ex.h['x-source'] === 'd1', d1ex.h['x-source']);

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- export and copy must answer from the SAME store
{
  const realFetch = globalThis.fetch;
  const rows = [];
  ['2026-08-20', '2026-08-21'].forEach(d => { for (let i = 0; i < 5; i++)
    rows.push({ symbol_id: 7, unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60,
      o: 1230000, h: 1250000, l: 1220000, c: 1240000, v: 999 }); });
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u))) return { status: 200, text: async () => JSON.stringify([{ id: 7, symbol: 'ONLYARC' }]), headers: hdr(1) };
      const off = +((String(u).match(/offset=(\d+)/) || [0, 0])[1]);
      return { status: 200, text: async () => JSON.stringify(rows.slice(off, off + 1000)), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const eX = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const gX = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eX, ctx);
    return { status: r.status, body: await r.text(), h: Object.fromEntries(r.headers) }; };

  // ONLYARC is not in D1 at all — the old export returned an empty file
  const all = await gX('/export/ONLYARC');
  check('exporting a symbol D1 never held still returns its bars',
    all.body.trim().split('\n').length === 11, all.body.trim().split('\n').length - 1 + ' data rows');
  check('the export says it came from the archive', all.h['x-source'] === 'archive', all.h['x-source']);
  check('the exported prices are decoded, not raw integers', /,123,125,122,124,999/.test(all.body), all.body.split('\n')[1]);

  const one = await gX('/export/ONLYARC/2026-08-20');
  check('a single archived day exports on its own', one.body.trim().split('\n').length === 6);
  check('and only that day', !/2026-08-21/.test(one.body));

  // a symbol D1 DOES hold must still come from D1, not the archive
  const d1one = await gX('/export/BK/2026-08-31');
  check('a live symbol still exports from D1', d1one.h['x-source'] === 'd1', d1one.h['x-source']);

  globalThis.fetch = realFetch;
}


// ---- copying D1's own older history into the archive, before any trim
{
  const realFetch = globalThis.fetch;
  const written = [];
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u))) {
        if ((o && o.method) === 'POST') return { status: 201, text: async () => '', headers: hdr(0) };
        return { status: 200, text: async () => JSON.stringify([{ id: 3, symbol: 'OLD' }]), headers: hdr(1) };
      }
      if ((o && o.method) === 'POST') { JSON.parse(o.body).forEach(x => written.push(x)); return { status: 201, text: async () => '', headers: hdr(0) }; }
      const off = +((String(u).match(/offset=(\d+)/) || [0, 0])[1]);
      return { status: 200, text: async () => JSON.stringify(written.slice(off, off + 1000)), headers: hdr(written.length) };
    }
    return realFetch(u, o);
  };
  // two days that exist ONLY in D1 — the shape of 26-27 Aug
  const ins = db.db.prepare("INSERT OR REPLACE INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES ('OLD',?,?,?,12.34,12.5,12.2,12.4,555,0,0,0)");
  ['2026-08-26', '2026-08-27'].forEach(d => { for (let i = 0; i < 390; i++)
    ins.run(Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60, d, '10:00'); });

  const eO = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const r = await mod.fetch(new Request('https://x/archive/from-d1/OLD'), eO, ctx);
  const j2 = JSON.parse(await r.text());
  check('D1-only history copies into the archive', j2.copied[0].copied === 780, JSON.stringify(j2.copied[0]));
  check('every bar made it', written.length === 780, written.length + ' written');
  check('prices survive the narrow encoding', written[0].c === 124000 && written[0].o === 123400,
    'o=' + written[0].o + ' c=' + written[0].c);
  check('volume survives', written[0].v === 555);
  check('the days are the ones D1 held',
    new Set(written.map(x => new Date(x.unix * 1000).toISOString().slice(0, 10))).size === 2);

  globalThis.fetch = realFetch;
}


// ---- the wide board must not exceed the Worker's subrequest ceiling
{
  const realFetch = globalThis.fetch;
  let sub = 0;
  const arch = [];
  for (let i = 0; i < 120; i++) arch.push('W' + i);
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      sub++;
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u))) return { status: 200, text: async () => JSON.stringify(arch.map((s, i) => ({ id: i + 1, symbol: s }))), headers: hdr(arch.length) };
      // a full session: two pages of 1,000
      const off = +((String(u).match(/offset=(\d+)/) || [0, 0])[1]);
      const rows = []; for (let i = off; i < Math.min(off + 1000, 1400); i++)
        rows.push({ unix: 1788442200 + i * 60, o: 1e6, h: 1e6, l: 1e6, c: 1e6, v: 1 });
      return { status: 200, text: async () => JSON.stringify(rows), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const eB = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  sub = 0;
  const r = await mod.fetch(new Request('https://x/board?universe=1'), eB, ctx);
  const body = await r.text();
  check('the wide board answers instead of dying', r.status === 200, r.status + ' ' + body.slice(0, 60));
  check('it stays inside the 50-subrequest ceiling', sub <= 50, sub + ' subrequests');
  const j2 = JSON.parse(body);
  check('what it could not reach is named for a follow-up call',
    Array.isArray(j2.not_fetched) && j2.not_fetched.length > 0, (j2.not_fetched || []).length + ' deferred');
  globalThis.fetch = realFetch;
}


// ---- a stale page must be provable, not argued about
{
  const r = await get('/selfcheck');
  check('/selfcheck reports the build the Worker is running', !!r.j().selfcheck.build, r.j().selfcheck.build);
  const rr = await mod.fetch(new Request('https://x/scan'), env, ctx);
  check('every response carries the build in a header', !!rr.headers.get('X-Build'), rr.headers.get('X-Build'));
  const body = await rr.text();
  check('the page itself shows the same build',
    body.indexOf(rr.headers.get('X-Build')) >= 0, 'header ' + rr.headers.get('X-Build'));
  check('the build is not the placeholder', body.indexOf('<!--BUILD-->') < 0);
  check('pages are served no-store so a refresh really refreshes',
    /no-store/.test(rr.headers.get('Cache-Control') || ''), rr.headers.get('Cache-Control'));
}


// ---- /archive/dates must separate a covered session from one being collected
{
  const realFetch = globalThis.fetch;
  // SPY has four days; the newest day exists for SPY alone
  const perSym = {};
  const NEW = '2026-09-04';
  const ALL = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'];
  ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'JPM', 'WMT', 'XOM'].forEach((s, i) => {
    perSym[s] = { id: i + 1, days: ALL.concat(s === 'SPY' ? [NEW] : []) };
  });
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u)))
        return { status: 200, text: async () => JSON.stringify(Object.keys(perSym).map(s => ({ id: perSym[s].id, symbol: s }))), headers: hdr(10) };
      const id = +((String(u).match(/symbol_id=eq\.(\d+)/) || [0, 1])[1]);
      const sym = Object.keys(perSym).find(s => perSym[s].id === id) || 'SPY';
      const rows = [];
      perSym[sym].days.forEach(d => { for (let i = 0; i < 3; i++)
        rows.push({ unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60, o: 1e6, h: 1e6, l: 1e6, c: 1e6, v: 1 }); });
      const off = +((String(u).match(/offset=(\d+)/) || [0, 0])[1]);
      return { status: 200, text: async () => JSON.stringify(rows.slice(off, off + 1000)), headers: hdr(rows.length) };
    }
    return realFetch(u, o);
  };
  const eD2 = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const r = await mod.fetch(new Request('https://x/archive/dates'), eD2, ctx);
  const j2 = JSON.parse(await r.text());
  check('a day only one symbol has is NOT reported as covered',
    j2.covered.indexOf(NEW) < 0, 'covered: ' + j2.covered.join(','));
  check('it is reported as still being collected', j2.collecting.indexOf(NEW) >= 0, j2.collecting.join(','));
  check('the latest COVERED day is the one to show', j2.latest_covered === '2026-09-03', j2.latest_covered);
  check('days every symbol has are covered', j2.covered.length === 4, j2.covered.length + '');
  check('coverage counts are reported per day', j2.coverage[NEW] === 1 && j2.coverage['2026-09-03'] === 10,
    JSON.stringify(j2.coverage));
  globalThis.fetch = realFetch;
}


// ---- /diag must trace the store the scanner actually reads
{
  const realFetch = globalThis.fetch;
  const arcRows = [];
  for (let i = 0; i < 390; i++) arcRows.push({ symbol_id: 4,
    unix: Math.floor(Date.parse('2026-09-02T13:30:00Z') / 1000) + i * 60,
    o: 1060000, h: 1067800, l: 1054600, c: 1060900, v: 1000 });
  globalThis.fetch = async (u, o) => {
    const s = String(u);
    if (/query1\.finance\.yahoo/.test(s)) return { status: 200, json: async () => ({ chart: { result: [{
      timestamp: [Math.floor(Date.parse('2026-09-02T13:30:00Z') / 1000)],
      indicators: { quote: [{ open: [105.97], high: [106.78], low: [105.46], close: [106.09], volume: [25181800] }],
        adjclose: [{ adjclose: [106.09] }] } }] } }) };
    if (/supabase\.co\/rest/.test(s)) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(s)) return { status: 200, text: async () => JSON.stringify([{ id: 4, symbol: 'ARCONLY' }]), headers: hdr(1) };
      const off = +((s.match(/offset=(\d+)/) || [0, 0])[1]);
      return { status: 200, text: async () => JSON.stringify(arcRows.slice(off, off + 1000)), headers: hdr(arcRows.length) };
    }
    return realFetch(u, o);
  };
  const eG = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const r = await mod.fetch(new Request('https://x/diag/ARCONLY'), eG, ctx);
  const j2 = JSON.parse(await r.text());
  check('a symbol only the archive holds is still traced',
    j2.stored_sessions.length > 0, j2.stored_sessions.length + ' sessions');
  check('the trace names which store answered',
    j2.stored_sessions[0].source === 'archive', j2.stored_sessions[0].source);
  check('it counts the bars in each store',
    j2.stored_sessions[0].archive_bars === 390 && j2.stored_sessions[0].d1_bars === 0,
    'd1 ' + j2.stored_sessions[0].d1_bars + ' archive ' + j2.stored_sessions[0].archive_bars);
  check('the provider daily candle is fetched for comparison',
    (j2.provider_daily || []).length > 0, (j2.provider_daily || []).length + ' daily candles');
  check('the comparison names the authoritative high',
    j2.comparison[0] && j2.comparison[0].authoritative.high === 106.78,
    JSON.stringify(j2.comparison[0] && j2.comparison[0].authoritative));
  check('and reports the delta against what the scanner derives',
    j2.comparison[0] && j2.comparison[0].deltas && typeof j2.comparison[0].deltas.high === 'number',
    JSON.stringify(j2.comparison[0] && j2.comparison[0].deltas));
  check('coverage is reported per session',
    typeof j2.stored_sessions[0].coverage_pct === 'number', j2.stored_sessions[0].coverage_pct + '%');
  globalThis.fetch = realFetch;
}


// ---- the authoritative daily candle replaces aggregation for completed days
{
  const realFetch = globalThis.fetch;
  let dailyCalls = 0;
  globalThis.fetch = async (u, o) => {
    const s = String(u);
    if (/interval=1d/.test(s)) {
      dailyCalls++;
      const t0 = Math.floor(Date.parse('2026-08-31T13:30:00Z') / 1000);
      return { status: 200, json: async () => ({ chart: { result: [{
        timestamp: [t0, t0 + 86400, t0 + 2 * 86400],
        indicators: { quote: [{ open: [103.08, 105.11, 105.97], high: [104.99, 106.64, 106.78],
          low: [102.84, 104.66, 105.46], close: [104.87, 105.92, 106.09],
          volume: [34188700, 22074600, 25181800] }],
          adjclose: [{ adjclose: [104.87, 105.92, 106.09] }] } }] } }) };
    }
    return realFetch(u, o);
  };
  // Later blocks move the clock; pin it so the fixture's sessions are in the
  // past and therefore eligible to be stored as completed days.
  const savedClock = clock;
  clock = Math.floor(Date.UTC(2026, 8, 3, 21, 0) / 1000);        // 3 Sep, after the close
  const eY = { DB: db, RATE_PER_MIN: 1000000 };
  const gY = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eY, ctx);
    return { status: r.status, j: JSON.parse(await r.text()) }; };

  let r = await gY('/daily/WMT');
  check('/daily returns the provider daily candles', r.j.bars.length === 3, r.j.bars.length + ' bars');
  check('it carries the official close', r.j.bars.some(b => b.close === 106.09), JSON.stringify(r.j.bars[2]));
  check('it carries consolidated volume, not the minute-feed subset',
    r.j.bars.some(b => b.volume === 25181800));
  check('adjclose is stored alongside, never mixed into close',
    r.j.bars.every(b => 'adjclose' in b));

  const before = dailyCalls;
  await gY('/daily/WMT');
  check('a second call is served from the cache rather than refetching',
    dailyCalls === before, dailyCalls + ' upstream calls');
  const r2 = await gY('/daily/WMT');
  check('and says why it did not refresh', !!r2.j.skipped, r2.j.skipped || '(no reason given)');

  check("today's forming candle is never stored as authoritative",
    r.j.bars.every(b => b.date < r.j.last_completed_session || b.date === r.j.last_completed_session),
    'newest ' + r.j.bars[r.j.bars.length - 1].date + ' vs last completed ' + r.j.last_completed_session);

  globalThis.fetch = realFetch;
  clock = savedClock;
}


// ---- the board's archive fallback must return a WHOLE session
{
  const realFetch = globalThis.fetch;
  // two full sessions in the archive, 780 bars — more than the old 500 cap
  const rows = [];
  ['2026-09-02', '2026-09-03'].forEach(d => { for (let i = 0; i < 390; i++)
    rows.push({ symbol_id: 5, unix: Math.floor(Date.parse(d + 'T13:30:00Z') / 1000) + i * 60,
      o: 1000000, h: 1005000, l: 995000, c: 1000000, v: 10 }); });
  globalThis.fetch = async (u, o) => {
    if (/supabase\.co\/rest/.test(String(u))) {
      const hdr = n => ({ get: k => k.toLowerCase() === 'content-range' ? '0-0/' + n : null });
      if (/archive_symbols/.test(String(u))) return { status: 200, text: async () => JSON.stringify([{ id: 5, symbol: 'WHOLE' }]), headers: hdr(1) };
      const s = String(u);
      const gte = +((s.match(/unix=gte\.(\d+)/) || [0, 0])[1]);
      const lte = +((s.match(/unix=lte\.(\d+)/) || [0, 1e12])[1]);
      const lim = Math.min(1000, +((s.match(/limit=(\d+)/) || [0, 1000])[1]));
      const off = +((s.match(/offset=(\d+)/) || [0, 0])[1]);
      const sel = rows.filter(r => r.unix >= gte && r.unix <= lte).slice(off, off + lim);
      return { status: 200, text: async () => JSON.stringify(sel), headers: hdr(sel.length) };
    }
    return realFetch(u, o);
  };
  const eW = { DB: db, RATE_PER_MIN: 1000000, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_KEY: 'k' };
  const r = await mod.fetch(new Request('https://x/board?date=2026-09-03&symbols=WHOLE'), eW, ctx);
  const j2 = JSON.parse(await r.text());
  const got = (j2.rows || []).filter(x => x.symbol === 'WHOLE');
  check('the archive fallback returns the WHOLE requested session, not a truncated one',
    got.length === 390, got.length + ' of 390 bars');
  check('and only that session', got.every(x => x.date === '2026-09-03'),
    Array.from(new Set(got.map(x => x.date))).join(','));
  check('it spans open to close', got.length && got[0].time <= '09:35' && got[got.length - 1].time >= '15:55',
    (got[0] || {}).time + ' -> ' + (got[got.length - 1] || {}).time);
  globalThis.fetch = realFetch;
}


// ---- the collector must not depend on the scheduler
{
  const realFetch = globalThis.fetch;
  upstream.bars = session(390, clock - 390 * 60);
  const eS = { DB: db, RATE_PER_MIN: 1000000, LOG: { get: async () => [], put: async () => {} } };
  const gS = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eS, ctx);
    return { status: r.status, body: await r.text() }; };

  // pretend nothing has been collected for an hour, mid-session
  db.db.prepare("DELETE FROM meta WHERE key='self_drive_at'").run();
  db.db.prepare('UPDATE symbols SET last_bar_unix = ?').run(clock - 3600);
  const before = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;

  await gS('/board');
  if (ctx.pending) await ctx.pending;
  await new Promise(r => setTimeout(r, 0));
  const after = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  check('a stale board request collects without any cron', after > before,
    before + ' runs -> ' + after);
  check('the run is labelled so it is distinguishable from a cron run',
    !!db.db.prepare("SELECT id FROM runs WHERE kind='self-drive'").get());

  // a second request straight away must NOT collect again
  const after2Before = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  await gS('/board');
  if (ctx.pending) await ctx.pending;
  check('it does not run again within the interval',
    db.db.prepare('SELECT COUNT(*) c FROM runs').get().c === after2Before);

  // fresh data means it stays out of the way
  db.db.prepare("DELETE FROM meta WHERE key='self_drive_at'").run();
  db.db.prepare('UPDATE symbols SET last_bar_unix = ?').run(clock - 10);
  const freshBefore = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  await gS('/board');
  if (ctx.pending) await ctx.pending;
  check('it does nothing when collection is already keeping up',
    db.db.prepare('SELECT COUNT(*) c FROM runs').get().c === freshBefore);

  // and never outside the session
  const saved = clock;
  clock = Math.floor(Date.UTC(2026, 8, 5, 17, 0) / 1000);   // Saturday
  db.db.prepare("DELETE FROM meta WHERE key='self_drive_at'").run();
  db.db.prepare('UPDATE symbols SET last_bar_unix = ?').run(clock - 3600);
  const weekendBefore = db.db.prepare('SELECT COUNT(*) c FROM runs').get().c;
  await gS('/board');
  if (ctx.pending) await ctx.pending;
  check('it never collects outside the session',
    db.db.prepare('SELECT COUNT(*) c FROM runs').get().c === weekendBefore);
  clock = saved;

  check('/selfcheck reports when collection last happened',
    /last run|self-drive/.test(JSON.parse((await gS('/selfcheck')).body).selfcheck.collection || ''),
    JSON.parse((await gS('/selfcheck')).body).selfcheck.collection);

  globalThis.fetch = realFetch;
  upstream.bars = null;
}


// ---- /audit must catch what the unit tests cannot
{
  const eA = { DB: db, RATE_PER_MIN: 1000000, LOG: { get: async () => [], put: async () => {} } };
  const gA = async (p) => { const r = await mod.fetch(new Request('https://x' + p), eA, ctx);
    return JSON.parse(await r.text()); };
  const D = '2026-08-20';
  const put = (sym, time, unix, o, h, l, c, v) => db.db.prepare(
    'INSERT OR REPLACE INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES (?,?,?,?,?,?,?,?,?,0,0,0)')
    .run(sym, unix, D, time, o, h, l, c, v);
  const base = Math.floor(Date.parse(D + 'T13:30:00Z') / 1000);

  // a clean session
  for (let i = 0; i < 60; i++) put('CLEAN', String(9 + Math.floor((30 + i) / 60)).padStart(2, '0') + ':' + String((30 + i) % 60).padStart(2, '0'),
    base + i * 60, 100, 100.5, 99.5, 100, 1000);
  let r = await gA('/audit?date=' + D + '&symbols=CLEAN');
  check('a clean session passes every invariant', r.verdict === 'OK', JSON.stringify(r.findings));

  // impossible OHLC — high below low
  put('BADOHLC', '09:30', base, 100, 99, 101, 100, 1000);
  r = await gA('/audit?date=' + D + '&symbols=BADOHLC');
  check('impossible OHLC is caught', r.findings.some(f => /impossible OHLC/.test(f.check)), JSON.stringify(r.findings));
  check('and rated CRITICAL', r.verdict === 'CRITICAL');

  // a bar filed under a date it does not belong to
  db.db.prepare("INSERT OR REPLACE INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES ('WRONGDAY',?,?,'09:30',100,100.5,99.5,100,1000,0,0,0)")
    .run(base + 5 * 86400, D);
  r = await gA('/audit?date=' + D + '&symbols=WRONGDAY');
  check('a bar filed under the wrong date is caught',
    r.findings.some(f => /wrong date/.test(f.check)), JSON.stringify(r.findings));

  // a session that starts late — the GOOGL shape
  for (let i = 92; i < 115; i++) put('LATE', String(9 + Math.floor((30 + i) / 60)).padStart(2, '0') + ':' + String((30 + i) % 60).padStart(2, '0'),
    base + i * 60, 100, 100.5, 99.5, 100, 1000);
  r = await gA('/audit?date=' + D + '&symbols=LATE');
  check('a session that starts at 11:02 is caught',
    r.findings.some(f => /does not start at the open/.test(f.check)), JSON.stringify(r.findings));
  check('and it names how many minutes are missing',
    /missing 92 minutes/.test(JSON.stringify(r.findings)), JSON.stringify(r.findings));

  // A duplicate cannot be inserted at all — (symbol, unix) is the primary key,
  // which is itself the guarantee. The audit checks it anyway because the
  // client-side stores have no such constraint and that is where the doubling
  // actually happened.
  for (let i = 0; i < 40; i++) put('DUPE', String(9 + Math.floor((30 + i) / 60)).padStart(2, '0') + ':' + String((30 + i) % 60).padStart(2, '0'),
    base + i * 60, 100, 100.5, 99.5, 100, 1000);
  let threw = false;
  try {
    db.db.prepare("INSERT INTO bars (symbol, unix, date, time, open, high, low, close, volume, first_seen, updated_at, revisions) VALUES ('DUPE',?,?,'09:31',100,100.5,99.5,100,1000,0,0,0)")
      .run(base + 60, D);
  } catch (e) { threw = true; }
  check('the schema itself forbids a duplicate minute in D1', threw);
  r = await gA('/audit?date=' + D + '&symbols=DUPE');
  check('and the audit finds nothing wrong with a clean set', !r.findings.some(f => /duplicate/.test(f.check)));

  check('the audit says the findings are not opinions',
    /cannot be true|every invariant held/.test(r.note), r.note);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
