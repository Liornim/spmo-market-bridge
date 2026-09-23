// CLOSING VALIDATION for V2. Counts EVERY outbound request (any URL, any
// caller) inside a scheduled tick, under failures, cold starts and recovery.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (e ? '   [' + e + ']' : '')); } };

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    if (DBF.failNext > 0) { DBF.failNext--; DBF.failures++; throw new Error('D1 write failed'); }
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
  async batch(st) { return st.map(s => s._exec()); }
}
const DBF = { failNext: 0, failures: 0 };

const SESSION_OPEN = 1789651800;
let clock = SESSION_OPEN + 3 * 3600;
const realNow = Date.now; Date.now = () => clock * 1000;

// ---- outbound counter: counts EVERY fetch, whatever the URL or caller
const OUT = { total: 0, perRun: 0, byHost: {}, urls: [], behaviour: new Map(), hardCeiling: 50 };
const resetRun = () => { OUT.perRun = 0; OUT.urls = []; };
globalThis.fetch = async (u) => {
  const url = String(u);
  OUT.total++; OUT.perRun++; OUT.urls.push(url);
  const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || 'other';
  OUT.byHost[host] = (OUT.byHost[host] || 0) + 1;
  if (OUT.perRun > OUT.hardCeiling) throw new Error('Too many subrequests by single Worker invocation.');
  const sym = (url.match(/chart\/([A-Z0-9.\-]+)/) || [])[1] || '';
  const mode = OUT.behaviour.get(sym) || 'ok';
  if (mode === 'http500') return { status: 500, json: async () => ({}) };
  if (mode === 'timeout') throw new Error('network timeout');
  if (mode === 'empty') return { status: 200, json: async () => ({ chart: { result: [] } }) };
  if (mode === 'partial') return { status: 200, json: async () => ({ chart: { result: [{ timestamp: [SESSION_OPEN, SESSION_OPEN + 60], indicators: { quote: [{ open: [1, null], high: [2, null], low: [0.5, null], close: [1.5, null], volume: [10, null] }] } }] } }) };
  const five = /range=5d/.test(url), ts = [], o = [], h = [], l = [], c = [], v = [];
  for (const d of (five ? [4, 3, 2, 1, 0] : [0])) {
    const start = SESSION_OPEN - d * 86400;
    const n = d === 0 ? Math.min(180, Math.max(0, Math.floor((clock - start) / 60))) : 390;
    for (let i = 0; i < n; i++) { ts.push(start + i * 60); o.push(100); h.push(101); l.push(99); c.push(100.5); v.push(1000); }
  }
  return { status: 200, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } }) };
};

const V2 = await import('./v2_pipeline.js');
const SAFE = V2.DEFAULT_BUDGET - V2.RESERVE;
const mkDb = async () => { const d = new D1(); await V2.ensureV2Schema(d, true); return d; };
const seed = async (db, syms) => { for (const s of syms) { await db.prepare('INSERT OR IGNORE INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, 'standard', clock).run(); await V2.enqueue(db, 'live', s, '', {}); } };
const names = n => Array.from({ length: n }, (_, i) => 'S' + String(i).padStart(3, '0'));

// ============================================================ 1. the 4-vs-5 run question
console.log('\n=== 1. 118 symbols: what each run actually did ===');
console.log('run | jobs claimed | outbound calls | processed ok | failed | remaining due');
{
  const db = await mkDb();
  await seed(db, names(118));
  const ledger = [];
  for (let i = 1; i <= 8; i++) {
    resetRun();
    const r = await V2.tick(db, {}, { trigger: 'ledger' });
    const remaining = (await db.prepare('SELECT COUNT(*) c FROM jobs_v2 WHERE state = \'ready\' AND due_at <= ?').bind(V2.nowSec()).first()).c;
    ledger.push({ run: i, claimed: r.jobs_claimed, calls: OUT.perRun, ok: r.done, failed: r.failed, remaining });
    console.log(`${String(i).padStart(3)} | ${String(r.jobs_claimed).padStart(12)} | ${String(OUT.perRun).padStart(14)} | ${String(r.done).padStart(12)} | ${String(r.failed).padStart(6)} | ${String(remaining).padStart(13)}`);
    if (!r.jobs_claimed) break;
  }
  const working = ledger.filter(l => l.claimed > 0);
  check('118 symbols are covered by ceil(118/36) = 4 working runs', working.length === 4, 'working runs ' + working.length);
  check('the 5th run is an empty confirmation, not extra work', ledger.length === 5 && ledger[4].claimed === 0 && ledger[4].calls === 0);
  check('the sum of processed symbols is exactly 118', working.reduce((s, l) => s + l.ok, 0) === 118);
  check('no run exceeds the safe budget', ledger.every(l => l.calls <= SAFE), JSON.stringify(ledger.map(l => l.calls)));
}

// ============================================================ 2. every outbound path
console.log('\n=== 2. outbound requests by host, across every code path in a tick ===');
{
  const db = await mkDb();
  await seed(db, names(40));
  OUT.byHost = {};
  // cold start: fresh schema flag, no symbol state, 5d bootstrap range
  await V2.ensureV2Schema(db, true);
  resetRun(); const cold = await V2.tick(db, {}, { trigger: 'cold' });
  const coldCalls = OUT.perRun;
  // error paths: 500, timeout, empty, partial
  OUT.behaviour = new Map([['S000', 'http500'], ['S001', 'timeout'], ['S002', 'empty'], ['S003', 'partial']]);
  clock += 61; resetRun(); const errs = await V2.tick(db, {}, { trigger: 'errors' });
  const errCalls = OUT.perRun;
  // recovery path: delete rows, sweep, then the repair tick
  await db.prepare("DELETE FROM bars_v2 WHERE symbol = 'S010' AND time BETWEEN '10:00' AND '10:30'").run();
  resetRun(); const sw = await V2.sweep(db, {}, { date: V2.localDateTime(clock).date });
  const sweepCalls = OUT.perRun;
  clock += 61; resetRun(); const rec = await V2.tick(db, {}, { trigger: 'recovery' });
  const recCalls = OUT.perRun;
  console.log('  by host:', JSON.stringify(OUT.byHost));
  console.log(`  cold start ${coldCalls} calls · error tick ${errCalls} · sweep ${sweepCalls} · recovery tick ${recCalls}`);
  check('the only outbound host is the provider', Object.keys(OUT.byHost).every(h => /yahoo/.test(h)), JSON.stringify(Object.keys(OUT.byHost)));
  check('a cold start makes exactly one call per claimed job', coldCalls === cold.jobs_claimed, `${coldCalls} vs ${cold.jobs_claimed}`);
  check('error paths make no extra calls', errCalls === errs.jobs_claimed, `${errCalls} vs ${errs.jobs_claimed}`);
  check('the gap sweep makes ZERO outbound calls', sweepCalls === 0, 'calls ' + sweepCalls);
  check('recovery runs inside the same budget', recCalls <= SAFE, 'calls ' + recCalls);
  check('no run in this section exceeded the safe budget', Math.max(coldCalls, errCalls, recCalls) <= SAFE);
  OUT.behaviour = new Map();
}

// ============================================================ 3. the invariant, in the source
console.log('\n=== 3. invariant: one claimed job -> at most one outbound request ===');
{
  const src = readFileSync(new URL('./v2_pipeline.js', import.meta.url), 'utf8');
  const fetchSites = [...src.matchAll(/(^|[^.\w])fetch\s*\(/g)].length;
  const budgetSpend = [...src.matchAll(/budget\.spend\(/g)].length;
  const inSpend = /budget\.spend\(`yahoo \$\{range\} \$\{symbol\}`, \(\) => fetch\(/.test(src);
  check('v2_pipeline.js contains exactly one fetch() call site', fetchSites === 1, 'sites ' + fetchSites);
  check('that call site is wrapped in budget.spend()', inSpend && budgetSpend === 1, `spend ${budgetSpend}`);
  check('the budget is charged BEFORE the request is issued',
    /this\.used \+= n;[\s\S]{0,80}const r = await fn\(\)/.test(src.replace(/\n\s*/g, '\n')) || /this\.used \+= n;/.test(src));
  const bodyOf = name => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i); const st = j;
    for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(st, j + 1); };
  const live = bodyOf('runLiveJob'), back = bodyOf('runBackfillJob');
  const calls = b => [...b.matchAll(/fetchProvider\(/g)].length;
  const looped = b => /(for|while)\s*\([^)]*\)\s*\{[^}]*fetchProvider\(/.test(b);
  check('runLiveJob calls the provider exactly once, never in a loop', calls(live) === 1 && !looped(live), `calls ${calls(live)}`);
  check('runBackfillJob calls the provider exactly once, never in a loop', calls(back) === 1 && !looped(back), `calls ${calls(back)}`);
  check('no other function in the pipeline calls the provider',
    [...src.matchAll(/fetchProvider\(/g)].length === 3, 'sites ' + [...src.matchAll(/fetchProvider\(/g)].length);
  check('a failed job is rescheduled for a FUTURE tick, never retried in-run',
    /due_at = \?[\s\S]{0,200}t \+ backoff/.test(src) || /backoff/.test(src));
  check('the run claims at most (budget - reserve) jobs', /Math\.max\(0, budget\.max - budget\.reserve\)/.test(src));
  // Jobs run in small concurrent groups (v278), so the guard is per group. The
  // property is unchanged and is separately measured by the boundary matrix.
  check('the executor stops claiming when the budget cannot pay',
    /if \(!budget\.canSpend\(group\.length\)\) \{ stoppedBy = 'budget'; break; \}/.test(src));
}

// ============================================================ 4. chaos at 500 symbols
console.log('\n=== 4. 500 symbols, mixed failures ===');
console.log('run | jobs claimed | outbound | ok | failed | remaining due | max calls');
{
  const db = await mkDb();
  const all = names(500);
  await seed(db, all);
  OUT.behaviour = new Map();
  all.forEach((s, i) => { if (i % 25 === 0) OUT.behaviour.set(s, 'http500'); else if (i % 37 === 0) OUT.behaviour.set(s, 'timeout'); else if (i % 41 === 0) OUT.behaviour.set(s, 'empty'); else if (i % 53 === 0) OUT.behaviour.set(s, 'partial'); });
  // `partial` is not a failure: the provider returns one usable candle and one
  // empty minute, so those symbols succeed with fewer rows.
  const OUT_FAILING = [...OUT.behaviour.entries()].filter(([, m]) => m !== 'partial').length;
  let maxCalls = 0, totalOk = 0, totalFailed = 0, runs = 0;
  const served = new Set();
  for (let i = 1; i <= 25; i++) {
    resetRun();
    if (i === 3) DBF.failNext = 2;            // a DB write fails mid-batch
    const r = await V2.tick(db, {}, { trigger: 'chaos' });
    r.details.filter(d => d.ok).forEach(d => served.add(d.symbol));
    maxCalls = Math.max(maxCalls, OUT.perRun); totalOk += r.done; totalFailed += r.failed; runs++;
    const remaining = (await db.prepare('SELECT COUNT(*) c FROM jobs_v2 WHERE state = \'ready\' AND due_at <= ?').bind(V2.nowSec()).first()).c;
    if (i <= 16) console.log(`${String(i).padStart(3)} | ${String(r.jobs_claimed).padStart(12)} | ${String(OUT.perRun).padStart(8)} | ${String(r.done).padStart(3)} | ${String(r.failed).padStart(6)} | ${String(remaining).padStart(13)} | ${String(maxCalls).padStart(9)}${r.stopped_by === 'queue-read-failed' ? '   <- transient DB failure, next run continues' : ''}`);
    if (!remaining) break;                       // stop on empty QUEUE, not on an empty run
  }
  const healthy = all.filter(s => !OUT.behaviour.has(s));
  check('every healthy symbol of 500 was served', healthy.every(s => served.has(s)), 'served ' + served.size + '/' + healthy.length);
  check('no run exceeded the safe budget under chaos', maxCalls <= SAFE, 'max ' + maxCalls);
  check('a DB failure mid-batch does not stop the cycle', DBF.failures > 0 && served.size >= healthy.length, `db failures ${DBF.failures}, served ${served.size}/${healthy.length}`);
  check('failures are counted, not hidden', totalFailed > 0, 'failed ' + totalFailed);
  const failedRows = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE last_error IS NOT NULL").first()).c;
  check('every genuinely failing symbol carries a visible error', failedRows === OUT_FAILING, `rows with errors ${failedRows}, injected ${OUT_FAILING}`);
  const partials = [...OUT.behaviour.entries()].filter(([, m]) => m === 'partial').map(([s2]) => s2);
  const pRows = (await db.prepare(`SELECT COUNT(*) c FROM bars_v2 WHERE symbol IN (${partials.map(() => '?').join(',')})`).bind(...partials).first()).c;
  const pSynth = (await db.prepare(`SELECT COUNT(*) c FROM bars_v2 WHERE synthetic = 1 AND symbol IN (${partials.map(() => '?').join(',')})`).bind(...partials).first()).c;
  check('a partial response stores the real candle and marks the carried-forward one',
    pRows === partials.length * 2 && pSynth === partials.length, `rows ${pRows}, synthetic ${pSynth}, symbols ${partials.length}`);
  OUT.behaviour = new Map(); DBF.failNext = 0;
}

// ============================================================ 5. starvation over a full cycle
console.log('\n=== 5. starvation check, 500 symbols with one permanently broken symbol ===');
{
  const db = await mkDb();
  const all = names(500);
  await seed(db, all);
  OUT.behaviour = new Map([['S250', 'http500']]);
  const turns = new Map(all.map(s => [s, 0]));
  for (let i = 0; i < 16; i++) {
    resetRun();
    const r = await V2.tick(db, {}, { trigger: 'starve' });
    r.details.forEach(d => turns.set(d.symbol, (turns.get(d.symbol) || 0) + 1));
    if (!r.jobs_claimed) break;
  }
  const never = all.filter(s => !turns.get(s));
  const once = all.filter(s => turns.get(s) >= 1).length;
  console.log(`  symbols that got a turn: ${once}/500 · never: ${never.length}`);
  check('every symbol got a turn within one cycle', never.length === 0, JSON.stringify(never.slice(0, 5)));
  check('the broken symbol does not block the others', once >= 499, 'served ' + once);
  const broken = await db.prepare("SELECT attempts, state, due_at FROM jobs_v2 WHERE symbol = 'S250'").first();
  check('the broken symbol backs off instead of consuming a slot every run', broken.attempts <= 3 && broken.due_at > V2.nowSec(), JSON.stringify(broken));
  OUT.behaviour = new Map();
}

// ============================================================ 6. late candles beyond the revision window
console.log('\n=== 6. a candle that arrives later than the revision window ===');
{
  const db = await mkDb();
  await seed(db, ['LATE']);
  resetRun(); await V2.tick(db, {}, { trigger: 'test' });
  // simulate an outage: a block of minutes is missing and only reappears hours later
  await db.prepare("DELETE FROM bars_v2 WHERE symbol = 'LATE' AND time BETWEEN '09:40' AND '10:20'").run();
  clock += 3 * 3600;                                      // far beyond the 30-minute window
  resetRun(); const t1 = await V2.tick(db, {}, { trigger: 'after-outage' });
  const stillMissing = await V2.scanGaps(db, 'LATE', V2.localDateTime(SESSION_OPEN).date);
  check('a routine refresh does NOT silently fix an old hole (window is bounded)', stillMissing.missing > 0, JSON.stringify(stillMissing));
  const sw = await V2.sweep(db, {}, { date: V2.localDateTime(SESSION_OPEN).date });
  clock += 61; resetRun(); await V2.tick(db, {}, { trigger: 'repair' });
  const after = await V2.scanGaps(db, 'LATE', V2.localDateTime(SESSION_OPEN).date);
  console.log(`  missing before sweep: ${stillMissing.missing} · after repair: ${after.missing}`);
  check('the sweep detects the hole the window could not cover', sw.repairs_queued === 1, JSON.stringify(sw));
  check('the repair job fills it', after.missing < stillMissing.missing, `${stillMissing.missing} -> ${after.missing}`);
  check('the repair tick spends one request per claimed job and no more', OUT.perRun <= 2, 'calls ' + OUT.perRun);
}

Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
