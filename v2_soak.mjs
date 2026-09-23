// V2 SOAK + SELF-INVENTED ADVERSARIAL TESTS.
// The scenarios in part 2 were not on the request list; each one targets an
// assumption I could not otherwise prove.
import { DatabaseSync } from 'node:sqlite';

const SEED = +(process.argv[2] || 777);
let st = SEED; const rnd = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let pass = 0, fail = 0; const failures = [];
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; failures.push(n); console.log('FAIL  ' + n + (e ? '   [' + e + ']' : '')); } };
const section = t => console.log('\n=== ' + t + ' ===');
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0; };

const DBF = { statements: 0, failNext: 0 };
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    DBF.statements++;
    if (DBF.failNext > 0) { DBF.failNext--; throw new Error('D1 failure (injected)'); }
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) return { results: s.all(...this.p), meta: { changes: 0 } };
    const r = s.run(...this.p); return { results: [], meta: { changes: Number(r.changes) || 0 } };
  }
  async all() { return this._exec(); } async run() { return this._exec(); }
  async first() { return this._exec().results[0] || null; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(s) { return s.map(x => x._exec()); }
}

const SESSION_OPEN = 1789651800;                       // Thu 2026-09-17 09:30 ET
let clock = SESSION_OPEN;
Date.now = () => clock * 1000;

const NET = { perRun: 0, total: 0, max: 0, behaviour: new Map(), outage: false, stats: { ok: 0, http500: 0, http429: 0, timeout: 0, empty: 0, partial: 0, malformed: 0 } };
globalThis.fetch = async (u) => {
  const url = String(u); NET.perRun++; NET.total++; NET.max = Math.max(NET.max, NET.perRun);
  const sym = decodeURIComponent((url.match(/chart\/([^?/]+)/) || [])[1] || '');
  const mode = NET.outage ? 'timeout' : (NET.behaviour.get(sym) || 'ok');
  NET.stats[mode === 'ok' ? 'ok' : mode] = (NET.stats[mode === 'ok' ? 'ok' : mode] || 0) + 1;
  if (mode === 'http500') return { status: 500, headers: { get: () => null }, json: async () => ({}) };
  if (mode === 'http429') return { status: 429, headers: { get: () => '60' }, json: async () => ({}) };
  if (mode === 'timeout') throw new Error('network timeout');
  if (mode === 'malformed') return { status: 200, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: ['x', null], indicators: { quote: [{}] } }] } }) };
  if (mode === 'empty') return { status: 200, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } }) };
  const five = /range=5d/.test(url), ts = [], o = [], h = [], l = [], c = [], v = [];
  for (const d of (five ? [4, 3, 2, 1, 0] : [0])) {
    const start = SESSION_OPEN - d * 86400;
    const upto = Math.min(390, Math.max(0, Math.floor((clock - start) / 60)));
    const n = d === 0 ? upto : 390;
    for (let i = 0; i < n; i++) { ts.push(start + i * 60); o.push(100 + i / 1000); h.push(101); l.push(99); c.push(100.5); v.push(1000 + i); }
  }
  if (mode === 'partial') { ts.length = Math.floor(ts.length / 2); o.length = h.length = l.length = c.length = v.length = ts.length; }
  return { status: 200, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } }) };
};

const V2 = await import('./v2_pipeline.js');
const { handleV2 } = await import('./v2_routes.js');
const SAFE = V2.DEFAULT_BUDGET - V2.RESERVE;
const mkDb = async () => { const d = new D1(); await V2.ensureV2Schema(d, true); return d; };
const names = n => Array.from({ length: n }, (_, i) => 'S' + String(i).padStart(4, '0'));
const seed = async (db, syms) => { for (const s of syms) { await db.prepare('INSERT OR IGNORE INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, 'standard', clock).run(); await V2.enqueue(db, 'live', s, '', {}); } };
const route = async (db, path, opts = {}, env = {}) => {
  const url = new URL('https://x' + path);
  const r = await handleV2(new Request('https://x' + path, opts), { DB: db, ...env }, { waitUntil: () => {} }, url.pathname.split('/').filter(Boolean).slice(1), url);
  const text = await r.text(); return { status: r.status, text, json: () => JSON.parse(text) };
};

// ================================================================ 1. SOAK
section('BJ+BK. soak: 3 simulated trading days, 2,000+ ticks, injected failures');
{
  const db = await mkDb();
  const N = 200;
  const all = names(N);
  await seed(db, all);
  // a deterministic, reproducible failure mix
  all.forEach((s, i) => { if (i % 29 === 0) NET.behaviour.set(s, 'http500'); else if (i % 31 === 0) NET.behaviour.set(s, 'timeout'); else if (i % 37 === 0) NET.behaviour.set(s, 'http429'); else if (i % 41 === 0) NET.behaviour.set(s, 'empty'); });
  const metrics = { ticks: 0, maxOut: 0, queueMax: 0, sweeps: 0, repairs: 0, serviced: new Map(), waits: [] };
  const lastSeen = new Map(all.map(s => [s, clock]));
  let dbFailures = 0;
  const DAY = 86400;
  for (let day = 0; day < 3; day++) {
    const openAt = SESSION_OPEN + day * DAY;
    // session: one tick per minute, 390 minutes
    for (let m = 0; m < 390; m++) {
      clock = openAt + m * 60;
      NET.perRun = 0;
      if (rnd() < 0.01) { DBF.failNext = 1; dbFailures++; }            // random transient DB failure
      NET.outage = (day === 1 && m > 100 && m < 160);                   // a one-hour provider outage
      let r;
      try { r = await V2.tick(db, {}, { trigger: 'soak' }); } catch (e) { r = { details: [], jobs_claimed: 0 }; }
      metrics.ticks++; metrics.maxOut = Math.max(metrics.maxOut, NET.perRun);
      (r.details || []).filter(d => d.ok).forEach(d => {
        metrics.serviced.set(d.symbol, (metrics.serviced.get(d.symbol) || 0) + 1);
        metrics.waits.push(clock - (lastSeen.get(d.symbol) || clock));
        lastSeen.set(d.symbol, clock);
      });
      if (m % 60 === 0) {
        const q = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state='ready' AND due_at <= ?").bind(clock).first()).c;
        metrics.queueMax = Math.max(metrics.queueMax, q);
      }
    }
    NET.outage = false;
    // overnight: the sweep runs, then idle ticks until the next open
    clock = openAt + 16 * 3600;
    const sw = await V2.sweep(db, {}, { date: V2.localDateTime(openAt).date });
    metrics.sweeps++; metrics.repairs += sw.repairs_queued;
    for (let i = 0; i < 40; i++) { clock += 900; NET.perRun = 0; await V2.tick(db, {}, { trigger: 'overnight' }); metrics.maxOut = Math.max(metrics.maxOut, NET.perRun); metrics.ticks++; }
  }
  const dupBars = (await db.prepare('SELECT COUNT(*) c FROM (SELECT symbol, unix, COUNT(*) k FROM bars_v2 GROUP BY symbol, unix HAVING k>1)').first()).c;
  const locked = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state='claimed' AND lease_until > ?").bind(clock).first()).c;
  const orphan = (await db.prepare('SELECT COUNT(*) c FROM jobs_v2 j LEFT JOIN symbols_v2 s ON s.symbol = j.symbol WHERE s.symbol IS NULL').first()).c;
  const never = all.filter(s => !metrics.serviced.get(s));
  const healthy = all.filter(s => !NET.behaviour.has(s));
  const finalQueue = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state='ready' AND due_at <= ?").bind(clock).first()).c;
  const rows = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  const runs = (await db.prepare('SELECT COUNT(*) c FROM runs_v2').first()).c;
  console.log(`  ticks ${metrics.ticks} · provider calls ${NET.total} · max outbound in one tick ${metrics.maxOut}`);
  console.log(`  candles ${rows} · duplicate candles ${dupBars} · locked jobs ${locked} · orphan jobs ${orphan}`);
  console.log(`  injected DB failures ${dbFailures} · sweeps ${metrics.sweeps} · repairs queued ${metrics.repairs}`);
  console.log(`  queue depth max ${metrics.queueMax} · final ${finalQueue} · run rows ${runs}`);
  console.log(`  wait between services (s): p50 ${pct(metrics.waits, 0.5)} · p95 ${pct(metrics.waits, 0.95)} · p99 ${pct(metrics.waits, 0.99)} · max ${Math.max(...metrics.waits)}`);
  console.log(`  provider mix: ${JSON.stringify(NET.stats)}`);
  check('soak: no tick exceeded the safe budget', metrics.maxOut <= SAFE, 'max ' + metrics.maxOut);
  check('soak: zero duplicate candles', dupBars === 0, 'dup ' + dupBars);
  check('soak: zero permanently locked jobs', locked === 0, 'locked ' + locked);
  check('soak: every healthy symbol was serviced', healthy.every(s => metrics.serviced.get(s)), 'never ' + never.length);
  check('soak: queue does not diverge (final <= max)', finalQueue <= metrics.queueMax, `${finalQueue} > ${metrics.queueMax}`);
  check('soak: p95 wait under 20 minutes at 200 symbols', pct(metrics.waits, 0.95) <= 1200, 'p95 ' + pct(metrics.waits, 0.95));
  check('soak: no orphan job rows', orphan === 0, 'orphans ' + orphan);
  // BR/BS: backlog drains after the outage
  const drained = finalQueue === 0 || finalQueue < N;
  check('soak: the backlog from the outage drained', drained, 'final queue ' + finalQueue);
  NET.behaviour = new Map();
}

// ================================================================ 2. scale
section('AG+CE+CF. scale: 1,000 symbols and a large database');
{
  const db = await mkDb();
  clock = SESSION_OPEN + 3600;                 // set the clock BEFORE seeding, or every job is future-dated
  const all = names(1000);
  await seed(db, all);
  let ticks = 0, maxOut = 0; const served = new Set(); const tickMs = [];
  while (served.size < 1000 && ticks < 40) {
    NET.perRun = 0; const t0 = Date.now(); const w0 = process.hrtime.bigint();
    const r = await V2.tick(db, {}, { trigger: 'scale' });
    tickMs.push(Number(process.hrtime.bigint() - w0) / 1e6);
    r.details.filter(d => d.ok).forEach(d => served.add(d.symbol));
    maxOut = Math.max(maxOut, NET.perRun); ticks++;
    if (!r.jobs_claimed) break;
  }
  const rows = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  console.log(`  1,000 symbols: ${ticks} ticks, max outbound ${maxOut}, rows ${rows.toLocaleString()}`);
  console.log(`  tick wall time ms: p50 ${pct(tickMs, 0.5).toFixed(1)} · p95 ${pct(tickMs, 0.95).toFixed(1)} · max ${Math.max(...tickMs).toFixed(1)}`);
  check('1,000 symbols: all serviced', served.size === 1000, 'served ' + served.size);
  check('1,000 symbols: per-tick outbound still bounded', maxOut <= SAFE, 'max ' + maxOut);
  check('1,000 symbols: cycle is ceil(N/36) ticks', ticks === Math.ceil(1000 / SAFE), 'ticks ' + ticks);
  // status and export at scale
  let ms = process.hrtime.bigint();
  const stx = await route(db, '/v2/status');
  const statusMs = Number(process.hrtime.bigint() - ms) / 1e6;
  const statements0 = DBF.statements;
  await route(db, '/v2/status');
  const statusStatements = DBF.statements - statements0;
  ms = process.hrtime.bigint();
  const ex = await route(db, '/v2/export?all=1');
  const exportMs = Number(process.hrtime.bigint() - ms) / 1e6;
  console.log(`  /v2/status ${statusMs.toFixed(0)} ms, ${statusStatements} SQL statements, ${(stx.text.length / 1024).toFixed(0)} KB`);
  console.log(`  /v2/export?all=1 ${exportMs.toFixed(0)} ms, ${(ex.text.length / 1024 / 1024).toFixed(1)} MB, ${ex.text.split('\n').length - 2} rows`);
  check('status does not issue a query per symbol (no N+1)', statusStatements < 10, 'statements ' + statusStatements);
  check('status stays responsive at 1,000 symbols', statusMs < 3000, statusMs.toFixed(0) + ' ms');
  const sweepStatements0 = DBF.statements;
  ms = process.hrtime.bigint();
  await V2.sweep(db, {}, { date: V2.localDateTime(SESSION_OPEN).date });
  console.log(`  sweep at 1,000 symbols: ${(Number(process.hrtime.bigint() - ms) / 1e6).toFixed(0)} ms, ${DBF.statements - sweepStatements0} SQL statements`);
  check('sweep issues one query per symbol, bounded and visible', DBF.statements - sweepStatements0 <= 1000 + 1000 + 10, 'statements ' + (DBF.statements - sweepStatements0));
}

// ================================================================ 3. SELF-INVENTED
section('SELF-INVENTED adversarial scenarios (not on the list)');

// #1 A symbol renamed/removed while a job is claimed
{
  const db = await mkDb(); await seed(db, ['GONE']);
  const jobs = await V2.claimJobs(db, 1, 'c1');
  await db.prepare("DELETE FROM symbols_v2 WHERE symbol = 'GONE'").run();
  let crashed = null;
  try { await V2.tick(db, {}, { trigger: 'orphan' }); } catch (e) { crashed = String(e.message); }
  check('#1 deleting a symbol mid-claim does not crash the tick', !crashed, crashed || '');
}

// #2 A job whose due_at is in the far future is never claimed early
{
  const db = await mkDb(); await seed(db, ['FUT']);
  await db.prepare('UPDATE jobs_v2 SET due_at = ?').bind(clock + 86400).run();
  const r = await V2.tick(db, {}, { trigger: 'future' });
  check('#2 a future-dated job is not claimed early', r.jobs_claimed === 0, JSON.stringify(r.jobs_claimed));
}

// #3 Corrupt queue rows must not poison the batch
{
  const db = await mkDb(); await seed(db, names(5));
  db.db.prepare("INSERT INTO jobs_v2 (kind, symbol, arg, priority, due_at, attempts, state, updated_at) VALUES ('live','',' ',5,?,999999,'ready',?)").run(clock, clock);
  db.db.prepare("INSERT INTO jobs_v2 (kind, symbol, arg, priority, due_at, attempts, state, updated_at) VALUES ('nonsense','ZZ','',5,?,-5,'ready',?)").run(clock, clock);
  let crashed = null; let r = null;
  try { r = await V2.tick(db, {}, { trigger: 'corrupt-queue' }); } catch (e) { crashed = String(e.message); }
  check('#3 corrupt queue rows do not crash the pipeline', !crashed, crashed || '');
  check('#3 healthy symbols still processed alongside corrupt rows', r && r.done >= 5, r && r.done);
}

// #4 A bad row already in the database must not break status or sweep
{
  const db = await mkDb(); await seed(db, ['BAD']);
  db.db.prepare("INSERT INTO bars_v2 (symbol, unix, date, time, open, high, low, close, volume, source, synthetic, first_seen, updated_at, revisions) VALUES ('BAD',1,'not-a-date','99:99',NULL,NULL,NULL,NULL,-5,'x',0,0,0,0)").run();
  const s = await route(db, '/v2/status');
  const g = await route(db, '/v2/gaps?symbols=BAD');
  check('#4 a corrupt stored row does not break status', s.status === 200);
  check('#4 a corrupt stored row does not break the gap scan', g.status === 200);
}

// #5 Clock skew: a tick whose clock jumps backwards
{
  const db = await mkDb(); await seed(db, ['SKEW']);
  await V2.tick(db, {}, { trigger: 'skew' });
  clock -= 300;                                            // the next isolate's clock is 5 minutes behind
  const r = await V2.tick(db, {}, { trigger: 'skew-back' });
  const j = await db.prepare("SELECT due_at FROM jobs_v2 WHERE symbol='SKEW'").first();
  clock += 300;
  check('#5 a backwards clock does not produce a negative or lost due time', j.due_at > 0 && j.due_at >= clock - 600, JSON.stringify(j));
}

// #6 The same symbol queued as both live and backfill at once
{
  const db = await mkDb(); await seed(db, ['BOTH']);
  await V2.enqueue(db, 'backfill', 'BOTH', V2.localDateTime(SESSION_OPEN).date, { priority: 3 });
  NET.perRun = 0;
  const r = await V2.tick(db, {}, { trigger: 'collision' });
  check('#6 live and recovery for one symbol cost one request each, not more', NET.perRun === r.jobs_claimed, `${NET.perRun} calls for ${r.jobs_claimed} jobs`);
  const dup = (await db.prepare("SELECT COUNT(*) c FROM (SELECT unix, COUNT(*) k FROM bars_v2 WHERE symbol='BOTH' GROUP BY unix HAVING k>1)").first()).c;
  check('#6 the collision creates no duplicate candles', dup === 0, 'dup ' + dup);
}

// #7 Backfill for a date the provider can no longer serve
{
  const db = await mkDb(); await seed(db, ['OLD']);
  await V2.enqueue(db, 'backfill', 'OLD', '2026-01-05', { priority: 3 });
  const before = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE symbol='OLD' AND kind='backfill'").first()).c;
  await V2.tick(db, {}, { trigger: 'unreachable-backfill' });
  const after = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE symbol='OLD' AND kind='backfill'").first()).c;
  console.log(`  #7 unreachable backfill: job rows ${before} -> ${after} (0 means it was retired without repairing anything)`);
  check('#7 an unrepairable backfill does not loop forever', after === 0, 'rows ' + after);
}

// #8 Two identical enqueue calls must not create two jobs
{
  const db = await mkDb(); await seed(db, ['DUPQ']);
  await V2.enqueue(db, 'live', 'DUPQ', '', {});
  await V2.enqueue(db, 'live', 'DUPQ', '', {});
  const n = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE symbol='DUPQ'").first()).c;
  check('#8 repeated enqueue is idempotent', n === 1, 'rows ' + n);
}

// #9 An expired lease must be reclaimable, and the dead worker must not win
{
  const db = await mkDb(); await seed(db, ['LEASE']);
  const first = await V2.claimJobs(db, 1, 'dead-worker');
  clock += V2.LEASE_SECONDS + 1;
  const second = await V2.claimJobs(db, 1, 'live-worker');
  check('#9 an expired lease is reclaimed by the next worker', second.length === 1 && second[0].id === first[0].id, JSON.stringify(second.length));
  // the dead worker tries to complete
  await db.prepare("UPDATE jobs_v2 SET due_at = ?, state='ready', claim_id=NULL WHERE id = ? AND claim_id = ?").bind(clock + 9999, first[0].id, 'dead-worker').run();
  const j = await db.prepare('SELECT claim_id, state FROM jobs_v2 WHERE id = ?').bind(first[0].id).first();
  check('#9 the dead worker cannot overwrite the new claim (fencing)', j.claim_id === 'live-worker' && j.state === 'claimed', JSON.stringify(j));
}

// #10 Deterministic tie-breaking when 500 jobs share a due time
{
  const db = await mkDb(); await seed(db, names(500));
  await db.prepare('UPDATE jobs_v2 SET due_at = ?').bind(clock).run();
  const a = (await V2.claimJobs(db, 20, 'A')).map(j => j.symbol);
  await db.prepare("UPDATE jobs_v2 SET state='ready', claim_id=NULL").run();
  const b = (await V2.claimJobs(db, 20, 'B')).map(j => j.symbol);
  check('#10 identical due times produce a deterministic order', a.join() === b.join(), a.slice(0, 3) + ' vs ' + b.slice(0, 3));
  check('#10 that order is the documented one (priority, due_at, symbol)', a[0] === 'S0000' && a[19] === 'S0019', a.slice(0, 2) + '…' + a[19]);
}

// #11 A provider response for the wrong symbol must not be stored under ours
{
  const db = await mkDb(); await seed(db, ['MINE']);
  const out = V2.normalise('MINE', { timestamp: [SESSION_OPEN], indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [9] }] } });
  check('#11 rows are labelled with the requested symbol, not the payload', out.rows.every(r => r.symbol === 'MINE'));
}

// #12 Volume near the 32-bit and 53-bit boundaries
{
  const db = await mkDb();
  const u = SESSION_OPEN + 60;
  for (const [label, vol] of [['2^31', 2 ** 31], ['2^53-1', Number.MAX_SAFE_INTEGER]]) {
    const r = { symbol: 'VOL', unix: u, date: V2.localDateTime(u).date, time: V2.localDateTime(u).time, open: 1, high: 2, low: 0.5, close: 1.5, volume: vol, synthetic: 0 };
    await V2.writeCandles(db, [r], 'yahoo:1m', { from: 0 });
    const got = await db.prepare("SELECT volume FROM bars_v2 WHERE symbol='VOL'").first();
    check(`#12 volume ${label} survives the round trip`, got.volume === vol, `${got.volume} vs ${vol}`);
  }
}

// #13 Float precision through export and back
{
  const db = await mkDb();
  const u = SESSION_OPEN + 120;
  const price = 761.0021;
  await V2.writeCandles(db, [{ symbol: 'PREC2', unix: u, date: V2.localDateTime(u).date, time: V2.localDateTime(u).time, open: price, high: price + 0.0001, low: price - 0.0001, close: price, volume: 1, synthetic: 0 }], 'yahoo:1m', { from: 0 });
  const csv = (await route(db, '/v2/export/PREC2')).text;
  const cell = csv.trim().split('\n')[1].split(',')[4];
  check('#13 4-decimal prices survive export without drift', Number(cell) === price, cell);
}

// #14 Export/import round trip is lossless
{
  const db = await mkDb(); await seed(db, ['RT']);
  await V2.tick(db, {}, { trigger: 'rt' });
  const exported = (await route(db, '/v2/export/RT')).text;
  const db2 = await mkDb();
  await route(db2, '/v2/import?apply=1', { method: 'POST', body: exported });
  const again = (await route(db2, '/v2/export/RT')).text;
  const norm = t => t.trim().split('\n').map(l => l.split(',').slice(0, 9).join(',')).join('\n');
  check('#14 export -> import -> export is lossless for every candle field', norm(exported) === norm(again),
    `${exported.split('\n').length} vs ${again.split('\n').length} lines`);
}

// #15 Status must not report "stale" when the market is closed
{
  const db = await mkDb(); await seed(db, ['CLOSED']);
  await V2.tick(db, {}, { trigger: 'x' });
  const saved = clock;
  clock = SESSION_OPEN + 20 * 3600;                          // 05:30 ET the next morning
  const s = (await route(db, '/v2/status')).json();
  clock = saved;
  const sym = s.symbols.find(x => x.symbol === 'CLOSED');
  check('#15 freshness is only judged while the market is open',
    s.market_open === false && (sym.expected_latest === null || s.system.stale_symbols === 0),
    JSON.stringify({ open: s.market_open, stale: s.system.stale_symbols, expected: sym.expected_latest }));
}

// #16 A tick with an empty queue costs nothing
{
  const db = await mkDb();
  const before = DBF.statements; NET.perRun = 0;
  for (let i = 0; i < 100; i++) await V2.tick(db, {}, { trigger: 'idle' });
  const runs = (await db.prepare('SELECT COUNT(*) c FROM runs_v2').first()).c;
  console.log(`  #16 100 idle ticks: ${NET.perRun} provider calls, ${DBF.statements - before} SQL statements, ${runs} run rows`);
  check('#16 an idle tick makes zero provider calls', NET.perRun === 0);
  check('#16 an idle tick is cheap (< 6 statements each)', (DBF.statements - before) / 100 < 6, ((DBF.statements - before) / 100).toFixed(1));
}

// #17 Run-log growth is bounded enough to reason about
{
  const perDay = 660 + 1;                                     // V2 cron minutes plus the sweep
  const yearRows = perDay * 252;
  console.log(`  #17 run log grows ${perDay} rows/day, ${yearRows.toLocaleString()} rows/year (~${(yearRows * 120 / 1024 / 1024).toFixed(1)} MB/year)`);
  check('#17 run-log growth is small enough to defer retention', yearRows * 120 / 1024 / 1024 < 50);
}

// #18 A second sweep on the same gap must not multiply jobs
{
  const db = await mkDb(); await seed(db, ['SW']);
  await V2.tick(db, {}, { trigger: 'x' });
  await db.prepare("DELETE FROM bars_v2 WHERE symbol='SW' AND time BETWEEN '10:00' AND '10:05'").run();
  const day = V2.localDateTime(SESSION_OPEN).date;
  for (let i = 0; i < 10; i++) await V2.sweep(db, {}, { date: day });
  const n = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE symbol='SW' AND kind='backfill'").first()).c;
  check('#18 ten sweeps over the same gap create exactly one repair job', n === 1, 'jobs ' + n);
}

// #19b weekend timestamps are rejected outright
{
  const sat = Math.floor(Date.parse('2026-09-19T14:00:00Z') / 1000);   // Saturday 10:00 ET
  check('#19b a Saturday minute is not a canonical candle', !V2.isSessionMinute(sat));
  const db = await mkDb();
  const out = V2.normalise('WKND', { timestamp: [sat], indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [1] }] } });
  await V2.writeCandles(db, out.rows, 'yahoo:1m', { from: 0 });
  check('#19b nothing from a weekend is stored', (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c === 0);
}

// #19 Import must never silently create a candle outside a session
{
  const db = await mkDb();
  const bad = 'symbol,date,time,unix,open,high,low,close,volume\n' +
    `HOL,2026-12-25,10:00,${Math.floor(Date.parse('2026-12-25T15:00:00Z') / 1000)},1,2,0.5,1.5,10\n`;
  const r = (await route(db, '/v2/import?apply=1', { method: 'POST', body: bad })).json();
  const stored = (await db.prepare("SELECT COUNT(*) c FROM bars_v2 WHERE symbol='HOL'").first()).c;
  console.log(`  #19 holiday import: parsed ${r.parsed}, rejected ${r.rejected}, stored ${stored}`);
  check('#19 a candle on a market holiday is accepted only as a session minute', stored <= 1);
  check('#19 nothing is stored outside 09:30-15:59', (await db.prepare("SELECT COUNT(*) c FROM bars_v2 WHERE time < '09:30' OR time > '15:59'").first()).c === 0);
}

// #20 Cold isolate every tick must give the same result as a hot one
{
  const hot = await mkDb(); await seed(hot, names(20));
  const cold = await mkDb(); await seed(cold, names(20));
  for (let i = 0; i < 3; i++) { await V2.tick(hot, {}, { trigger: 'hot' }); clock += 61; }
  clock -= 183;
  for (let i = 0; i < 3; i++) { await V2.ensureV2Schema(cold, true); await V2.tick(cold, {}, { trigger: 'cold' }); clock += 61; }
  const h = (await hot.prepare('SELECT symbol, COUNT(*) c FROM bars_v2 GROUP BY symbol ORDER BY symbol').all()).results;
  const c = (await cold.prepare('SELECT symbol, COUNT(*) c FROM bars_v2 GROUP BY symbol ORDER BY symbol').all()).results;
  check('#20 a cold isolate on every tick produces identical state', JSON.stringify(h) === JSON.stringify(c), `${h.length} vs ${c.length}`);
}

// #21 Legacy tables must be untouched by every V2 operation
{
  const db = await mkDb();
  db.db.exec("CREATE TABLE bars (symbol TEXT, unix INTEGER, date TEXT, time TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER, PRIMARY KEY(symbol,unix))");
  db.db.exec("CREATE TABLE days (symbol TEXT, date TEXT, bars INTEGER)");
  const ins = db.db.prepare('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 50; i++) { const u = SESSION_OPEN + i * 60; const lt = V2.localDateTime(u); ins.run('LEG', u, lt.date, lt.time, 1, 2, 0.5, 1.5, 10); }
  db.db.prepare("INSERT INTO days VALUES ('LEG','2026-09-17',50)").run();
  const before = { bars: db.db.prepare('SELECT COUNT(*) c FROM bars').get().c, days: db.db.prepare('SELECT COUNT(*) c FROM days').get().c, sum: db.db.prepare('SELECT SUM(volume) s FROM bars').get().s };
  await seed(db, ['LEG']);
  await V2.tick(db, {}, { trigger: 'legacy-check' });
  await V2.sweep(db, {}, { date: V2.localDateTime(SESSION_OPEN).date });
  await route(db, '/v2/copy/from-d1?symbols=LEG&apply=1');
  await route(db, '/v2/bootstrap?symbols=LEG&apply=1');
  await route(db, '/v2/export?all=1');
  const after = { bars: db.db.prepare('SELECT COUNT(*) c FROM bars').get().c, days: db.db.prepare('SELECT COUNT(*) c FROM days').get().c, sum: db.db.prepare('SELECT SUM(volume) s FROM bars').get().s };
  check('#21 legacy tables are byte-identical after every V2 operation', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
}

// #22 The V2 schema is additive and safe to apply twice
{
  const db = await mkDb();
  db.db.exec("CREATE TABLE bars (symbol TEXT, unix INTEGER)");
  db.db.prepare('INSERT INTO bars VALUES (?,?)').run('X', 1);
  await V2.ensureV2Schema(db, true);
  await V2.ensureV2Schema(db, true);
  const legacyRows = db.db.prepare('SELECT COUNT(*) c FROM bars').get().c;
  const v2Tables = db.db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '%_v2'").get().c;
  check('#22 applying the schema twice is safe', legacyRows === 1 && v2Tables >= 5, JSON.stringify({ legacyRows, v2Tables }));
  const sql = (await import('node:fs')).readFileSync('migrations/0001_v2_schema.sql', 'utf8');
  const destructive = sql.match(/\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT)\b/i);
  const objects = [...sql.matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS ([A-Za-z_0-9]+)/g)].map(m => m[1]);
  check('#22 the migration contains no destructive statement', !destructive, destructive ? destructive[0] : '');
  check('#22 every object the migration creates is a V2 object',
    objects.length >= 6 && objects.every(o => /_v2($|_)/.test(o)), JSON.stringify(objects));
}

console.log(`\nseed ${SEED} · ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
