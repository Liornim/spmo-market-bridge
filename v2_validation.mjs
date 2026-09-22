// Side-by-side validation: the legacy worker and the V2 pipeline are given the
// SAME provider payloads and the SAME external-request ceiling, then compared
// candle by candle. Neither implementation is modified.
import { DatabaseSync } from 'node:sqlite';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (e ? '   [' + e + ']' : '')); } };

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) return { results: s.all(...this.p), meta: { changes: 0 } };
    const r = s.run(...this.p); return { results: [], meta: { changes: Number(r.changes) || 0 } };
  }
  async all() { return this._exec(); } async run() { return this._exec(); }
  async first() { return this._exec().results[0] || null; }
  async raw() { return this._exec().results.map(o => Object.values(o)); }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(st) { return st.map(s => s._exec()); }
  async exec(sql) { this.db.exec(sql); return { count: 0 }; }
}

const SESSION_OPEN = 1789651800;                 // 2026-09-17 09:30 ET
let clock = SESSION_OPEN + 6 * 3600 + 30 * 60;   // 16:00 ET — the session is over
const realNow = Date.now; Date.now = () => clock * 1000;

const CEILING = { max: 50, used: 0 };
const SYMBOLS = ['AAPL', 'NVDA', 'HD', 'QCOM', 'SPY', 'QQQ', 'SMH', 'ZZZZ'];   // ZZZZ = last alphabetically
globalThis.fetch = async (u) => {
  const url = String(u);
  CEILING.used++;
  if (CEILING.used > CEILING.max) throw new Error('Too many subrequests by single Worker invocation.');
  if (!/finance\.yahoo/.test(url)) return { status: 200, ok: true, headers: { get: () => '0-0/0' }, text: async () => '[]', json: async () => [] };
  const sym = (url.match(/chart\/([A-Z0-9.\-]+)/) || [])[1];
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  for (let i = 0; i < 390; i++) {                 // a complete session for every symbol
    ts.push(SESSION_OPEN + i * 60);
    const base = 100 + (sym.charCodeAt(0) % 7);
    o.push(base + i / 100); h.push(base + 0.5 + i / 100); l.push(base - 0.5 + i / 100); c.push(base + 0.25 + i / 100); v.push(1000 + i);
  }
  ts.push(SESSION_OPEN + 390 * 60);               // the 16:00 closing stamp the audit found
  o.push(100); h.push(100); l.push(100); c.push(100); v.push(0);
  ts.push(SESSION_OPEN + 137 * 60 + 37);          // a non-minute-aligned stamp with null prices
  o.push(null); h.push(null); l.push(null); c.push(null); v.push(null);
  return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } }) };
};

const V2 = await import('./v2_pipeline.js');
const legacy = (await import('./worker.js')).default;

// ---- legacy run: one scheduled invocation, same ceiling
const legacyDb = new D1();
const legacyEnv = { DB: legacyDb, RATE_PER_MIN: 1e9, SYMBOLS: SYMBOLS.join(',') };
const pending = [];
CEILING.used = 0;
await legacy.scheduled({ cron: '* 13-21 * * *' }, legacyEnv, { waitUntil: p => pending.push(p) });
await Promise.allSettled(pending);
const legacyUsed = CEILING.used;

// ---- V2 run: as many ticks as its own budget needs
const v2Db = new D1();
await V2.ensureV2Schema(v2Db, true);
for (const s of SYMBOLS) {
  await v2Db.prepare('INSERT OR IGNORE INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, 'standard', clock).run();
  await V2.enqueue(v2Db, 'live', s, '', {});
}
let v2Used = 0, ticks = 0;
for (let i = 0; i < 6; i++) {
  CEILING.used = 0;
  const r = await V2.tick(v2Db, {}, { trigger: 'validation' });
  v2Used += CEILING.used; ticks++;
  if (CEILING.used > 36) throw new Error('v2 exceeded its safe budget');
  if (!r.jobs_claimed) break;
}

// ---- compare
const date = V2.localDateTime(SESSION_OPEN).date;
console.log('\nsymbol | legacy bars | V2 bars | legacy last | V2 last | OHLCV match | legacy 16:00 | V2 16:00 | dup minutes legacy/V2');
const rows = [];
for (const s of SYMBOLS) {
  const L = (await legacyDb.prepare('SELECT * FROM bars WHERE symbol = ? AND date = ? ORDER BY unix').bind(s, date).all()).results;
  const V = (await v2Db.prepare('SELECT * FROM bars_v2 WHERE symbol = ? AND date = ? ORDER BY unix').bind(s, date).all()).results;
  const dup = a => a.length - new Set(a.map(r => r.time)).size;
  const l1600 = L.filter(r => r.time >= '16:00').length, v1600 = V.filter(r => r.time >= '16:00').length;
  const byTime = new Map(L.map(r => [r.time, r]));
  let mism = 0, compared = 0;
  for (const r of V) {
    const e = byTime.get(r.time);
    if (!e) continue;
    compared++;
    if (e.open !== r.open || e.high !== r.high || e.low !== r.low || e.close !== r.close || e.volume !== r.volume) mism++;
  }
  rows.push({ s, L: L.length, V: V.length, lLast: L.length ? L[L.length - 1].time : '—', vLast: V.length ? V[V.length - 1].time : '—', mism, compared, l1600, v1600, ldup: dup(L), vdup: dup(V) });
  console.log(`${s.padEnd(6)} | ${String(L.length).padStart(11)} | ${String(V.length).padStart(7)} | ${(L.length ? L[L.length - 1].time : '—').padStart(11)} | ${(V.length ? V[V.length - 1].time : '—').padStart(7)} | ${String(compared - mism) + '/' + compared} | ${String(l1600).padStart(12)} | ${String(v1600).padStart(8)} | ${dup(L)}/${dup(V)}`);
}
console.log(`\nexternal requests: legacy ${legacyUsed} in one invocation, V2 ${v2Used} across ${ticks} bounded executions`);

check('V2 collects every symbol, including the last alphabetically', rows.every(r => r.V === 390), JSON.stringify(rows.map(r => r.s + ':' + r.V)));
check('V2 stores exactly the 390 session minutes', rows.every(r => r.V === 390));
check('V2 stores no 16:00 row', rows.every(r => r.v1600 === 0));
check('V2 stores no duplicate minutes', rows.every(r => r.vdup === 0));
check('where both stores hold a minute, OHLCV is identical', rows.every(r => r.mism === 0), JSON.stringify(rows.map(r => r.s + ':' + r.mism)));
check('both stores reject the 16:00 stamp and the mid-minute row (legacy since v250)',
  rows.every(r => r.l1600 === 0 && r.ldup === 0 && r.v1600 === 0 && r.vdup === 0));
check('no V2 execution exceeded its safe budget', true);

// ---------------------------------------------------------------- scenario B
// The case that broke production: more symbols than one invocation can pay for.
{
  const N = 118;
  const many = Array.from({ length: N }, (_, i) => 'S' + String(i).padStart(3, '0'));
  const lDb = new D1();
  // legacy's ensureSchema is module state and already ran for the first
  // database, so the tables are copied rather than re-created.
  for (const r of legacyDb.db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all()) lDb.db.exec(r.sql);
  CEILING.used = 0;
  const p2 = [];
  await legacy.scheduled({ cron: '* 13-21 * * *' }, { DB: lDb, RATE_PER_MIN: 1e9, SYMBOLS: many.join(',') }, { waitUntil: x => p2.push(x) });
  await Promise.allSettled(p2);
  const lCovered = (await lDb.prepare('SELECT COUNT(DISTINCT symbol) c FROM bars').first()).c;
  const lLast = (await lDb.prepare('SELECT symbol FROM bars ORDER BY symbol DESC LIMIT 1').first());

  const vDb = new D1();
  await V2.ensureV2Schema(vDb, true);
  for (const s of many) {
    await vDb.prepare('INSERT OR IGNORE INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, 'standard', clock).run();
    await V2.enqueue(vDb, 'live', s, '', {});
  }
  let vTicks = 0, vMax = 0;
  for (let i = 0; i < 10; i++) {
    CEILING.used = 0;
    const r = await V2.tick(vDb, {}, { trigger: 'validation-b' });
    vMax = Math.max(vMax, CEILING.used); vTicks++;
    if (!r.jobs_claimed) break;
  }
  const vCovered = (await vDb.prepare('SELECT COUNT(DISTINCT symbol) c FROM bars_v2').first()).c;
  console.log(`\nscenario B — ${N} symbols, ceiling ${CEILING.max}:`);
  console.log(`  legacy: ${lCovered}/${N} symbols collected in one invocation (last stored: ${lLast ? lLast.symbol : '—'})`);
  console.log(`  V2    : ${vCovered}/${N} symbols collected across ${vTicks} executions, max ${vMax} requests in any one`);
  check('legacy truncates the universe at the ceiling', lCovered < N, `covered ${lCovered}`);
  check('V2 collects every symbol regardless of position', vCovered === N, `covered ${vCovered}`);
  check('V2 never exceeds the safe budget even at 118 symbols', vMax <= V2.DEFAULT_BUDGET - V2.RESERVE, 'max ' + vMax);
}
check('V2 needs no more provider requests in total than legacy would', v2Used <= SYMBOLS.length + 2, `v2 ${v2Used} for ${SYMBOLS.length} symbols`);

Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
