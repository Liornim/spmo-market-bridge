// bars-vault test harness. Real SQLite behind a D1-compatible shim, mocked
// Yahoo, and a subrequest counter so the Free-plan cap (50/invocation) is
// asserted, not assumed.
import { DatabaseSync } from 'node:sqlite';
import * as E2 from './engine.cjs';
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
// ============================================================================
// CONSISTENCY TEST — one symbol, one full session, read through every path.
// The provider payload reproduces patterns MEASURED in the published archive
// (data branch, 2026-09-08..17): an extra non-minute-aligned timestamp with
// null prices inside a minute (becomes a flat volume-0 bar), and a 16:00
// closing stamp. Invariants: one row per (symbol, date, minute); only
// 09:30..15:59; every read path returns identical OHLCV for every minute.
// ============================================================================
const STRICT = process.env.CONSISTENCY_STRICT !== '0';
const SYM = 'SPMO', DATE = '2026-08-31', OPEN = 1788183000;            // 09:30 ET
clock = OPEN + 420 * 60;                                                 // 16:30 ET, session over
const px = i => +(100 + i * 0.01).toFixed(4);
const pay = [];
for (let i = 0; i < 390; i++) pay.push([OPEN + i * 60, px(i), px(i) + 0.1, px(i) - 0.1, px(i) + 0.05, 1000 + i]);
const i1451 = (14 * 60 + 51) - 570;
pay.splice(i1451 + 1, 0, [OPEN + i1451 * 60 + 37, null, null, null, null, null]);   // 14:51:37, no prices
pay.push([OPEN + 390 * 60, px(389) + 0.05, px(389) + 0.05, px(389) + 0.05, px(389) + 0.05, 0]); // 16:00 stamp
upstream.bars = pay;
await get('/backfill/' + SYM);
upstream.bars = null;

const csv = t => { const [h, ...ls] = t.trim().split('\n'); const k = h.split(','); return ls.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
const norm = r => ({ time: r.time, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume });
const paths = {};
paths['D1 bars'] = db.db.prepare('SELECT * FROM bars WHERE symbol=? AND date=? ORDER BY unix').all(SYM, DATE).map(norm);
paths['/day json'] = (await get(`/day/${SYM}/${DATE}?format=json`)).j().rows.map(norm);
paths['/day csv'] = csv((await get(`/day/${SYM}/${DATE}`)).body).map(norm);
paths['/board'] = (await get(`/board?symbols=${SYM}&date=${DATE}`)).j().rows.map(norm);
paths['/bars/export'] = csv((await get(`/bars/export/${SYM}?from=${DATE}&to=${DATE}`)).body).map(norm);
paths['/export'] = csv((await get(`/export/${SYM}?date=${DATE}`)).body).map(norm);
const lastR = (await get(`/bars/last?symbols=${SYM}&n=400`)).j();
paths['/bars/last'] = (lastR.rows || []).filter(r => r.date === DATE).map(norm);

const { validateDay } = await import('./docs/audit/completeness.mjs');
const report = [];
const ref = paths['D1 bars'];
for (const [name, rows] of Object.entries(paths)) {
  const byT = {}; rows.forEach(r => (byT[r.time] ||= []).push(r));
  const dups = Object.values(byT).filter(a => a.length > 1).length;
  const off = rows.filter(r => r.time < '09:30' || r.time > '15:59').length;
  const v = validateDay(DATE, rows.map(r => ({ date: DATE, time: r.time, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v })));
  report.push({ path: name, rows: rows.length, minutes: Object.keys(byT).length, dup_minutes: dups, outside_session: off, verdict: v.verdict });
}
console.log('\npath            rows  minutes  dup_min  outside  verdict');
report.forEach(r => console.log(r.path.padEnd(15), String(r.rows).padStart(4), String(r.minutes).padStart(8), String(r.dup_minutes).padStart(8), String(r.outside_session).padStart(8), ' ', r.verdict));

// field-level mismatch report: every path against the canonical minute
const canon = {};
ref.forEach(r => { if (r.time >= '09:30' && r.time <= '15:59' && !(r.time in canon)) canon[r.time] = r; });
const mism = [];
for (const [name, rows] of Object.entries(paths)) {
  const seen = {};
  rows.forEach(r => {
    if (!(r.time in canon)) return;
    if (seen[r.time]) { mism.push([name, r.time, 'duplicate row', JSON.stringify(canon[r.time]), JSON.stringify(r)]); return; }
    seen[r.time] = 1;
    for (const f of ['o', 'h', 'l', 'c', 'v']) if (r[f] !== canon[r.time][f]) mism.push([name, r.time, f, canon[r.time][f], r[f]]);
  });
}
console.log('\nmismatches vs first stored row of each minute:', mism.length);
mism.slice(0, 12).forEach(m => console.log('  ' + m.join(' | ')));

check('storage: one row per (symbol, date, minute)', report[0].dup_minutes === 0, report[0].dup_minutes + ' duplicated minutes');
check('storage: no row outside 09:30..15:59', report[0].outside_session === 0, report[0].outside_session + ' rows outside');
check('storage: every unix is a minute start', db.db.prepare('SELECT COUNT(*) c FROM bars WHERE symbol=? AND unix % 60 != 0').get(SYM).c === 0);
for (const r of report) check(`${r.path}: same 390 minutes as storage, day COMPLETE`, r.rows === 390 && r.minutes === 390 && r.verdict === 'COMPLETE', `${r.rows} rows, ${r.verdict}`);
check('every read path agrees field-by-field', mism.length === 0, mism.length + ' mismatches');
// /bars/daily must still return the provider's daily candle next to the minute aggregate
db.db.exec("CREATE TABLE IF NOT EXISTS daily_bars (symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, volume INTEGER, adjclose REAL, fetched_at INTEGER, PRIMARY KEY (symbol, date))");
db.db.prepare("INSERT OR REPLACE INTO daily_bars VALUES (?, '2026-08-28', 1, 2, 0.5, 1.5, 999, 1.5, 0)").run(SYM);
const dly = (await get(`/bars/daily?symbols=${SYM}`)).j();
check('/bars/daily: provider daily rows survive the canonical filter', dly.rows.some(r => r.source === 'provider' && r.date === '2026-08-28'));
check('/bars/daily: the minute aggregate counts 390 canonical bars', (dly.rows.find(r => r.date === DATE) || {}).bars === 390);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail && STRICT ? 1 : 0);
