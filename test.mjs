// bars-vault test harness. Real SQLite behind a D1-compatible shim, mocked
// Yahoo, and a subrequest counter so the Free-plan cap (50/invocation) is
// asserted, not assumed.
import { DatabaseSync } from 'node:sqlite';

let subreq = 0;                                   // fetch + every D1 call
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) return { results: s.all(...this.p), meta: { changes: 0 } };
    const r = s.run(...this.p); return { results: [], meta: { changes: Number(r.changes) } };
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

const mod = (await import('./worker.js')).default;
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
check('/status is 2 D1 calls regardless of table size', subreq === 2, subreq + ' calls');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
