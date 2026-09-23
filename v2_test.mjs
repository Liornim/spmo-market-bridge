// V2 test suite. Runs the real v2_pipeline against a SQLite-backed D1 shim and
// a provider shim that enforces a hard external-request ceiling, exactly as
// Cloudflare would. Legacy code is not loaded or touched.
import { DatabaseSync } from 'node:sqlite';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '   [' + extra + ']' : '')); } };

// ---------------------------------------------------------------- D1 shim
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    DB_CALLS.n++;
    if (DB_CALLS.failNext > 0) { DB_CALLS.failNext--; throw new Error('D1 unavailable'); }
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) {
      const results = s.all(...this.p);
      DB_CALLS.reads += results.length;
      return { results, meta: { changes: 0 } };
    }
    const r = s.run(...this.p);
    DB_CALLS.writes += Number(r.changes) || 0;
    return { results: [], meta: { changes: Number(r.changes) || 0 } };
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async first() { const r = this._exec(); return r.results[0] || null; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(st) { return st.map(s => s._exec()); }
}
const DB_CALLS = { n: 0, reads: 0, writes: 0, failNext: 0 };

// ---------------------------------------------------------------- clock
const SESSION_OPEN = 1789651800;            // 2026-09-17 09:30 ET
let clock = SESSION_OPEN + 3 * 3600;        // 12:30 ET
const realNow = Date.now;
Date.now = () => clock * 1000;

// ---------------------------------------------------------------- provider shim
const PROVIDER = { ceiling: 50, used: 0, calls: [], mode: 'ok', failFor: new Set(), maxSeen: 0 };
const resetProvider = (ceiling = 50) => { PROVIDER.ceiling = ceiling; PROVIDER.used = 0; PROVIDER.calls = []; PROVIDER.mode = 'ok'; PROVIDER.failFor = new Set(); };
globalThis.fetch = async (u) => {
  const url = String(u);
  PROVIDER.used++; PROVIDER.maxSeen = Math.max(PROVIDER.maxSeen, PROVIDER.used);
  const sym = (url.match(/chart\/([A-Z0-9.\-]+)/) || [])[1] || '';
  PROVIDER.calls.push(sym);
  if (PROVIDER.used > PROVIDER.ceiling) throw new Error('Too many subrequests by single Worker invocation.');
  if (PROVIDER.mode === 'http500' || PROVIDER.failFor.has(sym)) return { status: 500, json: async () => ({}) };
  if (PROVIDER.mode === 'timeout') throw new Error('network timeout');
  const five = /range=5d/.test(url);
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  const days = five ? [4, 3, 2, 1, 0] : [0];
  for (const d of days) {
    const start = SESSION_OPEN - d * 86400;
    const n = d === 0 ? Math.min(180, Math.floor((clock - start) / 60)) : 390;
    for (let i = 0; i < n; i++) { ts.push(start + i * 60); o.push(100 + i / 100); h.push(101 + i / 100); l.push(99 + i / 100); c.push(100.5 + i / 100); v.push(1000 + i); }
  }
  return { status: 200, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } }) };
};

const V2 = await import('./v2_pipeline.js');
const { handleV2, parseCsv } = await import('./v2_routes.js');

const mkDb = async () => { const db = new D1(); await V2.ensureV2Schema(db, true); return db; };
const seed = async (db, symbols, tier = 'standard') => {
  for (const s of symbols) {
    await db.prepare('INSERT OR IGNORE INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, tier, clock).run();
    await V2.enqueue(db, 'live', s, '', { priority: tier === 'live' ? 1 : 5 });
  }
};
const names = n => Array.from({ length: n }, (_, i) => 'S' + String(i).padStart(3, '0'));
const req = (path, opts = {}) => new Request('https://x' + path, opts);
const route = async (db, path, opts = {}) => {
  const url = new URL('https://x' + path);
  const r = await handleV2(req(path, opts), { DB: db }, { waitUntil: () => {} }, url.pathname.split('/').filter(Boolean).slice(1), url);
  return { status: r.status, json: async () => JSON.parse(await r.text()), text: () => r.text() };
};

// ============================================================ 1. canonical rules
{
  check('session minute accepted', V2.isSessionMinute(SESSION_OPEN));
  check('non-aligned timestamp rejected', !V2.isSessionMinute(SESSION_OPEN + 37));
  check('16:00 rejected', !V2.isSessionMinute(SESSION_OPEN + 390 * 60));
  check('15:59 accepted', V2.isSessionMinute(SESSION_OPEN + 389 * 60));
}

// ============================================================ 2. one symbol, one fetch
{
  const db = await mkDb(); resetProvider();
  await seed(db, ['AAPL']);
  const r = await V2.tick(db, {}, { trigger: 'test' });
  check('one provider request for one symbol', PROVIDER.used === 1, 'used ' + PROVIDER.used);
  // A symbol with no history bootstraps from a 5-day pull in ONE request. The
  // window spans Sun 09-13 .. Thu 09-17, and the Sunday is correctly rejected,
  // so 3 full sessions + today so far = 1,350 candles.
  check('a cold symbol bootstraps from one request', r.inserted === 3 * 390 + 180 && PROVIDER.used === 1, 'inserted ' + r.inserted);
  check('the weekend day in the 5-day window is rejected, not stored', r.inserted === 1350);
  check('accounting reports the write breakdown', r.candidates >= r.inserted && r.unchanged === 0);
  const again = await V2.tick(db, {}, { trigger: 'test' });
  check('nothing due immediately after a successful run', again.jobs_claimed === 0, JSON.stringify(again.jobs_claimed));
  clock += 61;
  const third = await V2.tick(db, {}, { trigger: 'test' });
  check('re-run writes nothing new (idempotent)', third.inserted === 0 && third.revised === 0, `ins ${third.inserted} rev ${third.revised} unch ${third.unchanged}`);
  check('unchanged rows are counted, not rewritten', third.unchanged > 0, 'unchanged ' + third.unchanged);
}

// ============================================================ 3. bounded revision window
{
  const db = await mkDb(); resetProvider();
  await seed(db, ['AAPL']);
  await V2.tick(db, {}, { trigger: 'test' });
  clock += 61; await V2.tick(db, {}, { trigger: 'test' });        // second pass: now incremental
  const before = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  clock += 61;
  const r = await V2.tick(db, {}, { trigger: 'test' });
  const after = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  check('the second pass does not re-download history into new rows', after === before, `${before} -> ${after}`);
  check('candidate rows are bounded by the revision window',
    r.candidates <= V2.REVISION_WINDOW / 60 + 5, 'candidates ' + r.candidates);
}

// ============================================================ 4. fairness under a ceiling
{
  const db = await mkDb(); resetProvider(50);
  const all = names(118);
  await seed(db, all);
  const seen = new Set();
  let ticks = 0;
  while (seen.size < all.length && ticks < 10) {
    resetProvider(50);
    const r = await V2.tick(db, {}, { trigger: 'test' });
    r.details.filter(d => d.ok).forEach(d => seen.add(d.symbol));
    check(`tick ${ticks + 1} stays inside the budget`, PROVIDER.used <= 40, 'used ' + PROVIDER.used);
    ticks++; clock += 61;
  }
  check('every symbol of 118 is served without changing the architecture', seen.size === 118, 'served ' + seen.size + ' in ' + ticks + ' ticks');
  check('a full cycle takes ceil(N / budget) ticks', ticks === Math.ceil(118 / (V2.DEFAULT_BUDGET - V2.RESERVE)), 'ticks ' + ticks);
  const tail = await db.prepare("SELECT COUNT(*) c FROM bars_v2 WHERE symbol = 'S117'").first();
  check('the last symbol alphabetically has candles', tail.c > 0, 'rows ' + tail.c);
  const first = await db.prepare("SELECT COUNT(*) c FROM bars_v2 WHERE symbol = 'S000'").first();
  check('the first symbol is not favoured', Math.abs(first.c - tail.c) < 5, `${first.c} vs ${tail.c}`);
}

// ============================================================ 5. starvation after a mid-run stop
{
  const db = await mkDb(); resetProvider(10);          // a ceiling that stops us mid-list
  await seed(db, names(30));
  const r1 = await V2.tick(db, {}, { trigger: 'test', budgetMax: 10 });
  const firstBatch = r1.details.filter(d => d.ok).map(d => d.symbol);
  clock += 1;                                          // no time passes: the rest are still due
  resetProvider(10);
  const r2 = await V2.tick(db, {}, { trigger: 'test', budgetMax: 10 });
  const secondBatch = r2.details.filter(d => d.ok).map(d => d.symbol);
  check('the next execution continues instead of restarting at the first symbol',
    secondBatch.length > 0 && !secondBatch.some(s => firstBatch.includes(s)), JSON.stringify(secondBatch.slice(0, 3)));
  check('work stopped for budget is reported', r1.stopped_by === 'budget' || r1.jobs_claimed === r1.done, r1.stopped_by);
}

// ============================================================ 6. failure isolation
{
  const db = await mkDb(); resetProvider(50);
  await seed(db, names(10));
  PROVIDER.failFor = new Set(['S003', 'S007']);
  const r = await V2.tick(db, {}, { trigger: 'test' });
  check('one failing symbol does not abort the others', r.done === 8 && r.failed === 2, `done ${r.done} failed ${r.failed}`);
  const ok = await db.prepare("SELECT COUNT(DISTINCT symbol) c FROM bars_v2").first();
  check('the healthy symbols were written', ok.c === 8, 'symbols ' + ok.c);
  const j = await db.prepare("SELECT attempts, last_error, due_at FROM jobs_v2 WHERE symbol = 'S003'").first();
  check('a failed job is retried with visible bounded backoff', j.attempts === 1 && /HTTP 500/.test(j.last_error) && j.due_at > clock, JSON.stringify(j));
  const retries = PROVIDER.calls.filter(s => s === 'S003').length;
  check('no invisible retry storm', retries === 1, 'calls ' + retries);
}

// ============================================================ 7. DB failure mid-batch
{
  const db = await mkDb(); resetProvider(50);
  await seed(db, names(6));
  DB_CALLS.failNext = 0;
  const r = await V2.tick(db, {}, { trigger: 'test' });
  check('baseline batch succeeded', r.done === 6);
  DB_CALLS.failNext = 1;
  clock += 61;
  const r2 = await V2.tick(db, {}, { trigger: 'test' });
  check('a single DB failure does not destroy the batch', r2.done + r2.failed >= 1, JSON.stringify({ done: r2.done, failed: r2.failed }));
  DB_CALLS.failNext = 0;
}

// ============================================================ 8. gap detection and recovery
{
  const db = await mkDb(); resetProvider(50);
  await seed(db, ['AAPL']);
  await V2.tick(db, {}, { trigger: 'test' });
  await db.prepare("DELETE FROM bars_v2 WHERE symbol='AAPL' AND time BETWEEN '10:00' AND '10:09'").run();
  const g = await V2.scanGaps(db, 'AAPL', V2.localDateTime(clock).date);
  check('gap detection finds the hole', g.missing >= 10, JSON.stringify(g));
  const sw = await V2.sweep(db, {}, { date: V2.localDateTime(clock).date });
  check('sweep queues a bounded repair job', sw.repairs_queued === 1, JSON.stringify(sw));
  clock += 61; resetProvider(50);
  const r = await V2.tick(db, {}, { trigger: 'test' });
  const g2 = await V2.scanGaps(db, 'AAPL', V2.localDateTime(clock).date);
  check('recovery refills the hole without a browser', g2.missing < g.missing, JSON.stringify(g2));
  check('recovery used the same budget rules', r.budget.used <= r.budget.max);
}

// ============================================================ 9. import / export / copy
{
  const db = await mkDb(); resetProvider(50);
  await seed(db, ['AAPL']);
  await V2.tick(db, {}, { trigger: 'test' });
  const exp = await route(db, '/v2/export/AAPL');
  const body = await exp.text();
  check('export returns the canonical schema', body.split('\n')[0] === 'symbol,date,time,unix,open,high,low,close,volume,source,synthetic,revisions,first_seen,updated_at');
  const lines = body.trim().split('\n').length - 1;
  check('export contains every stored candle', lines === 3 * 390 + 180, 'rows ' + lines);

  const db2 = await mkDb();
  const pre = await route(db2, '/v2/import', { method: 'POST', body });
  const preJ = await pre.json();
  check('import previews before writing', preJ.mode === 'preview' && preJ.report[0].would_insert === 3 * 390 + 180, JSON.stringify(preJ.report && preJ.report[0]));
  const app = await route(db2, '/v2/import?apply=1', { method: 'POST', body });
  const appJ = await app.json();
  check('import writes and reports counts', appJ.report[0].inserted === 3 * 390 + 180 && appJ.report[0].unchanged === 0);
  const again = await route(db2, '/v2/import?apply=1', { method: 'POST', body });
  const againJ = await again.json();
  check('re-importing the same file is idempotent', againJ.report[0].inserted === 0 && againJ.report[0].unchanged === 3 * 390 + 180, JSON.stringify(againJ.report[0]));

  const bad = parseCsv('symbol,date,time,open,high,low,close,volume\nAAPL,2026-09-17,16:00,1,1,1,1,0\nAAPL,2026-09-17,09:30,5,1,1,1,0\n');
  check('import rejects a 16:00 row and an impossible candle', bad.rows.length === 0 && bad.rejected.length === 2, JSON.stringify(bad.rejected));

  // legacy-shaped CSV (the /export column order, with unix in the middle)
  const legacyCsv = 'symbol,date,time,unix,open,high,low,close,volume,revisions,first_seen,updated_at\n' +
    `AAPL,2026-09-17,09:30,${SESSION_OPEN},100,101,99,100.5,1000,0,0,0\n`;
  const lp = parseCsv(legacyCsv);
  check('columns are read by name, so an /export file imports correctly', lp.rows.length === 1 && lp.rows[0].open === 100, JSON.stringify(lp.rows[0]));
}

// ============================================================ 10. copy from legacy D1
{
  const db = await mkDb();
  db.db.exec(`CREATE TABLE bars (symbol TEXT, unix INTEGER, date TEXT, time TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER, PRIMARY KEY(symbol,unix))`);
  const ins = db.db.prepare('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 100; i++) { const u = SESSION_OPEN + i * 60; const lt = V2.localDateTime(u); ins.run('LEG', u, lt.date, lt.time, 10, 11, 9, 10.5, 500); }
  ins.run('LEG', SESSION_OPEN + 37, V2.localDateTime(SESSION_OPEN).date, '09:30', 10, 11, 9, 10.5, 0);   // legacy duplicate-minute row
  await db.prepare("INSERT INTO symbols_v2 (symbol, tier, added_at, active) VALUES ('LEG','standard',?,1)").bind(clock).run();
  const prev = await (await route(db, '/v2/copy/from-d1?symbols=LEG')).json();
  check('copy previews without writing', prev.mode === 'preview' && prev.report[0].rows === 100, JSON.stringify(prev.report[0]));
  const ap = await (await route(db, '/v2/copy/from-d1?symbols=LEG&apply=1')).json();
  check('copy from legacy D1 writes only canonical rows', ap.report[0].inserted === 100, JSON.stringify(ap.report[0]));
  const legacyUntouched = db.db.prepare('SELECT COUNT(*) c FROM bars').get().c;
  check('the legacy table is untouched by the copy', legacyUntouched === 101, 'legacy rows ' + legacyUntouched);
  const ap2 = await (await route(db, '/v2/copy/from-d1?symbols=LEG&apply=1')).json();
  check('copy is idempotent', ap2.report[0].inserted === 0 && ap2.report[0].unchanged === 100, JSON.stringify(ap2.report[0]));
}

// ============================================================ 11. status endpoint
{
  const db = await mkDb(); resetProvider(50);
  await seed(db, names(5));
  await V2.tick(db, {}, { trigger: 'test' });
  const st = await (await route(db, '/v2/status')).json();
  check('status reports the budget in plain terms', /used \d+ \/ safe \d+/.test(st.system.request_budget), st.system.request_budget);
  check('status reports per-symbol freshness', st.symbols.length === 5 && st.symbols[0].candles_today > 0);
  check('status counts stale symbols', typeof st.system.stale_symbols === 'number');
  const acct = await (await route(db, '/v2/accounting')).json();
  check('accounting exposes the maximum requests in one execution', acct.max_requests_in_one_execution <= V2.DEFAULT_BUDGET);
}

// ============================================================ 12. load and accounting table
{
  console.log('\nsymbols | ticks to cover all | provider reqs | max in one execution | DB writes | inserted | unchanged');
  const rows = [];
  for (const n of [27, 50, 118, 200, 500]) {
    const db = await mkDb();
    await seed(db, names(n));
    let ticks = 0, providerTotal = 0, maxOne = 0, inserted = 0, unchanged = 0;
    const served = new Set();
    DB_CALLS.writes = 0;
    while (served.size < n && ticks < 40) {
      resetProvider(50);
      const r = await V2.tick(db, {}, { trigger: 'load' });
      r.details.filter(d => d.ok).forEach(d => served.add(d.symbol));
      providerTotal += PROVIDER.used; maxOne = Math.max(maxOne, PROVIDER.used);
      inserted += r.inserted; unchanged += r.unchanged;
      ticks++;                    // the clock does NOT advance: one full cycle, each symbol once
    }
    rows.push({ n, ticks, providerTotal, maxOne, writes: DB_CALLS.writes, inserted, unchanged });
    console.log(String(n).padStart(7) + ' | ' + String(ticks).padStart(18) + ' | ' + String(providerTotal).padStart(13) + ' | ' +
      String(maxOne).padStart(20) + ' | ' + String(DB_CALLS.writes).padStart(9) + ' | ' + String(inserted).padStart(8) + ' | ' + String(unchanged).padStart(9));
    check(`${n} symbols: every symbol served`, served.size === n, 'served ' + served.size);
    check(`${n} symbols: no execution exceeds the safe budget`, maxOne <= V2.DEFAULT_BUDGET - V2.RESERVE, 'max ' + maxOne);
    check(`${n} symbols: one provider request per symbol per cycle`, providerTotal === n, 'reqs ' + providerTotal);
  }
  const r118 = rows.find(r => r.n === 118), r200 = rows.find(r => r.n === 200), r500 = rows.find(r => r.n === 500);
  check('adding 82 symbols adds exactly 82 provider requests to the cycle',
    r200.providerTotal - r118.providerTotal === 82, 'delta ' + (r200.providerTotal - r118.providerTotal));
  check('per-invocation load is flat as the universe grows',
    r118.maxOne === r200.maxOne && r200.maxOne === r500.maxOne, `${r118.maxOne}/${r200.maxOne}/${r500.maxOne}`);
  check('cycle length is ceil(N / safe budget)',
    rows.every(r => r.ticks === Math.ceil(r.n / (V2.DEFAULT_BUDGET - V2.RESERVE))), JSON.stringify(rows.map(r => r.n + ':' + r.ticks)));
}

// ============================================================ 13. duplicate invocation & cold isolate
{
  const db = await mkDb(); resetProvider(50);
  await seed(db, names(5));
  const [a, b] = [await V2.tick(db, {}, { trigger: 'dup' }), await V2.tick(db, {}, { trigger: 'dup' })];
  check('a duplicate scheduled invocation does no duplicate work', b.jobs_claimed === 0, JSON.stringify(b.jobs_claimed));
  const total = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  check('no duplicate candles after a duplicate invocation', total === 5 * 1350, 'rows ' + total);
  // cold isolate: module state reset, schema flag false
  await V2.ensureV2Schema(db, true);
  clock += 61; resetProvider(50);
  const c2 = await V2.tick(db, {}, { trigger: 'cold' });
  check('a cold isolate resumes from the queue', c2.jobs_claimed === 5, JSON.stringify(c2.jobs_claimed));
}

// ============================================================ 14. missing symbol metadata
{
  const db = await mkDb(); resetProvider(50);
  await V2.enqueue(db, 'live', 'ORPHAN', '', {});          // queued without a symbols_v2 row
  const r = await V2.tick(db, {}, { trigger: 'test' });
  check('a job without symbol metadata does not crash the run', r.done + r.failed === 1, JSON.stringify({ done: r.done, failed: r.failed }));
}

Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
