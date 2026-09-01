// Test harness for bars-vault. Runs the real worker module against a real
// SQLite database (via a D1-compatible shim) with a mocked Yahoo upstream.
import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------- D1 shim
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.p) }; }
  async first() { const r = this.db.prepare(this.sql).get(...this.p); return r === undefined ? null : r; }
  async run() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)/i.test(this.sql)) return { results: s.all(...this.p), meta: {} };
    const r = s.run(...this.p); return { meta: { changes: r.changes } };
  }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
}

// ---------------------------------------------------------------- Yahoo mock
// Real SPMO bars from the original service, so derived columns can be
// compared with known-good output.
const REAL = [
  [151.76, 152.2, 151.58, 152.17, 147577],
  [152.51, 152.565, 152.25, 152.25, 3124],
  [150.59, 150.65, 150.5838, 150.59, 5938],
  [150.7662, 150.7662, 150.7662, 150.7662, 164],
];
let clock = 1788205200; // 2026-08-31 15:40 ET (19:40 UTC)
Date.now = () => clock * 1000;

let upstream = { mode: 'ok', calls: [] };
const barsAt = (base, mutate) => REAL.map((b, i) => [base + i * 60, ...b]).concat([[clock - 30, 999, 999, 999, 999, 999]]); // last = unclosed

globalThis.fetch = async (u) => {
  upstream.calls.push(u);
  if (upstream.mode === 'throw') throw new Error('network down');
  if (upstream.mode === 'http500') return { status: 500, json: async () => ({}) };
  if (upstream.mode === 'notfound') return { status: 200, json: async () => ({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } }) };
  const base = clock - 600;
  const rows = barsAt(base).map(r => upstream.mode === 'mutated' && r[0] === base ? [r[0], r[1], r[2], r[3] - 0.5, r[4], r[5]] : r);
  return { status: 200, json: async () => ({ chart: { result: [{
    timestamp: rows.map(r => r[0]),
    indicators: { quote: [{ open: rows.map(r => r[1]), high: rows.map(r => r[2]), low: rows.map(r => r[3]), close: rows.map(r => r[4]), volume: rows.map(r => r[5]) }] }
  }] } }) };
};

// ---------------------------------------------------------------- runner
const mod = (await import('./worker.js')).default;
const db = new D1();
const env = { DB: db };
const ctx = { waitUntil: p => { ctx.pending = p; } };
const get = async (path) => {
  const r = await mod.fetch(new Request('https://x' + path), env, ctx);
  const body = await r.text();
  return { status: r.status, h: Object.fromEntries(r.headers), body, j: () => JSON.parse(body) };
};
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '   [' + extra + ']' : ''}`); };

// 1. schema + seeding
let r = await get('/');
check('health returns ok', r.status === 200 && r.j().ok === true);
check('schema auto-created, default symbols seeded', r.j().tracked.includes('NVDA') && r.j().tracked.includes('SPMO'), r.j().tracked.length + ' symbols');
check('D1 missing binding is reported clearly', (await mod.fetch(new Request('https://x/'), {}, ctx)).status === 500);

// 2. first sync
r = await get('/sync/SPMO');
check('sync writes closed bars only', r.j().results[0].rows === 4, 'rows=' + r.j().results[0].rows);
let cnt = db.db.prepare('SELECT COUNT(*) c FROM bars').get().c;
check('unclosed bar never reaches DB', cnt === 4 && !db.db.prepare("SELECT 1 FROM bars WHERE open = 999").get());

// 3. idempotent re-sync
await get('/sync/SPMO');
check('re-sync is idempotent (no duplicate rows)', db.db.prepare('SELECT COUNT(*) c FROM bars').get().c === 4);
check('unchanged bars keep revisions=0', db.db.prepare('SELECT SUM(revisions) s FROM bars').get().s === 0);

// 4. upstream mutates a closed bar (bug #3 scenario) — must be visible, not silent
upstream.mode = 'mutated';
await get('/sync/SPMO');
const mut = db.db.prepare('SELECT revisions, low FROM bars ORDER BY unix LIMIT 1').get();
check('mutated closed bar is overwritten AND counted in revisions', mut.revisions === 1 && Math.abs(mut.low - (151.58 - 0.5)) < 1e-9, 'revisions=' + mut.revisions);
upstream.mode = 'ok';
await get('/sync/SPMO'); // restore original values (revisions now 2)

// 5. CSV read matches original service output
r = await get('/day/SPMO/2026-08-31');
const lines = r.body.trim().split('\n');
const f = lines[1].split(',');
check('CSV header matches original 14 columns', lines[0].split(',').length === 14);
check('derived columns match original service (BULL 66.1 4.8 29 0.62)', f[8] === 'BULL' && f[9] === '66.1' && f[10] === '4.8' && f[11] === '29' && f[12] === '0.62', f.slice(8, 13).join(' '));
check('vol_x normalised over full day', f[13] === String(Math.round(147577 / ((147577 + 3124 + 5938 + 164) / 4) * 100) / 100));
check('time rendered in exchange local time', /^\d\d:\d\d$/.test(f[2]) && f[1] === '2026-08-31', f[1] + ' ' + f[2]);
check('freshness headers present', r.h['x-stale-seconds'] !== undefined && r.h['x-data-stale'] !== undefined, `stale=${r.h['x-stale-seconds']}s`);
check('read did not hit upstream', r.h['x-fetched-now'] === 'no');

// 6. on-demand: unknown symbol, no date
const before = upstream.calls.length;
r = await get('/day/AMD');
check('unknown symbol fetched on demand and returned', r.status === 200 && r.body.split('\n')[1].startsWith('AMD,'), 'fetched=' + r.h['x-fetched-now']);
check('on-demand symbol auto-added to tracking', !!db.db.prepare("SELECT 1 FROM symbols WHERE symbol='AMD'").get());
r = await get('/day/AMD');
check('second read of same day served from DB, no upstream call', r.h['x-fetched-now'] === 'no' && upstream.calls.length === before + 1);

// 7. persistence across time: advance clock a month, data still there
clock += 30 * 86400;
r = await get('/day/SPMO/2026-08-31');
check('data readable 30 days later without upstream', r.status === 200 && r.body.trim().split('\n').length === 5 && r.h['x-fetched-now'] === 'no');
check('stale flag correct on old data', r.h['x-data-stale'] === 'true');
r = await get('/days/SPMO');
check('/days lists stored dates with counts', r.j().days[0].date === '2026-08-31' && r.j().days[0].bars === 4);
clock -= 30 * 86400;

// 8. failure paths never lose data or crash
for (const mode of ['throw', 'http500', 'notfound']) {
  upstream.mode = mode;
  r = await get('/sync/SPMO');
  const err = r.j().results[0].error;
  check(`upstream ${mode}: error recorded, no crash`, r.status === 200 && !!err, err);
  check(`upstream ${mode}: existing rows untouched`, db.db.prepare("SELECT COUNT(*) c FROM bars WHERE symbol='SPMO'").get().c === 4);
}
r = await get('/status');
check('/status surfaces last_error per symbol', r.j().symbols.find(s => s.symbol === 'SPMO').last_error !== null);
check('/status logs runs with errors', r.j().recent_runs[0].errors !== null);
upstream.mode = 'ok';
await get('/sync/SPMO');
r = await get('/status');
check('successful sync clears last_error', r.j().symbols.find(s => s.symbol === 'SPMO').last_error === null);


// 8b. review fixes
r = await get('/status');
const spmoRow = r.j().symbols.find(s => s.symbol === 'SPMO');
check('symbols.last_bar_unix populated after sync (was NULL bug)', spmoRow.last_bar_unix !== null && spmoRow.stale_seconds !== null, 'stale=' + spmoRow.stale_seconds);
upstream.mode = 'notfound';
await get('/sync/TYPO');
check('failed first-contact symbol is NOT auto-tracked', !db.db.prepare("SELECT 1 FROM symbols WHERE symbol='TYPO'").get());
upstream.mode = 'ok';
// incremental: pretend DB already has everything; a manual sync should write only the overlap window
const beforeCnt = db.db.prepare('SELECT COUNT(*) c FROM bars WHERE symbol=\'SPMO\'').get().c;
r = await get('/sync/SPMO');
check('incremental sync writes only new+overlap bars', r.j().results[0].rows <= 4 && db.db.prepare('SELECT COUNT(*) c FROM bars WHERE symbol=\'SPMO\'').get().c === beforeCnt, 'rows=' + r.j().results[0].rows);
r = await get('/backfill/SPMO');
check('backfill rewrites full range', r.j().results[0].rows === 4 && r.j().kind === 'backfill-one');
// fetch guard: /day without date twice within a minute → second is served from DB
clock += 86400 * 3; // move to a later day so "date < today" is true
upstream.calls = [];
await get('/day/SPMO'); await get('/day/SPMO');
check('/day (no date) hits upstream at most once per minute', upstream.calls.length === 1, upstream.calls.length + ' upstream calls');
clock -= 86400 * 3;

// 9. cron paths
upstream.calls = [];
await mod.scheduled({ cron: '*/5 13-21 * * 1-5' }, env, ctx); await ctx.pending;
check('cron syncs every tracked symbol sequentially', upstream.calls.length === (await get('/')).j().tracked.length, upstream.calls.length + ' calls');
check('cron uses range=1d', upstream.calls.every(u => u.includes('range=1d')));
upstream.calls = [];
await mod.scheduled({ cron: '30 22 * * 1-5' }, env, ctx); await ctx.pending;
check('nightly cron uses range=5d backfill', upstream.calls.every(u => u.includes('range=5d')));
check('runs table records cron kinds', (await get('/status')).j().recent_runs.some(x => x.kind === 'cron-backfill'));

// 10. input validation
check('bad date rejected', (await get('/day/NVDA/tomorrow')).status === 400);
check('bad symbol rejected', (await get('/sync/../etc')).status === 400 || (await get('/sync/BAD SYM')).status === 400);
check('unknown route 404', (await get('/nope')).status === 404);
check('missing day returns 404 with header-only CSV', (await get('/day/SPMO/2020-01-01')).status === 404);

// 11. JSON mode
r = await get('/day/SPMO/2026-08-31?format=json');
check('format=json returns rows with revisions', r.j().rows.length === 4 && 'revisions' in r.j().rows[0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
