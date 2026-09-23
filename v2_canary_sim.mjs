// Validates the canary instrumentation against a full simulated session before
// it is used in production: 3 symbols, 390 minutes, one tick per minute, with
// provider faults, a revision, a partial response and a legacy table that
// truncates the way production does.
import { DatabaseSync } from 'node:sqlite';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (e ? '   [' + e + ']' : '')); } };

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _e() {
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) return { results: s.all(...this.p), meta: { changes: 0 } };
    const r = s.run(...this.p); return { results: [], meta: { changes: Number(r.changes) || 0 } };
  }
  async all() { return this._e(); } async run() { return this._e(); }
  async first() { return this._e().results[0] || null; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(s) { return s.map(x => x._e()); }
}

const SYMBOLS = ['AAPL', 'QQQ', 'XLY'];
const OPEN = 1789651800;                 // Thu 2026-09-17 09:30 ET
let clock = OPEN;
Date.now = () => clock * 1000;

// provider behaviour for the simulated day
const FAULTS = new Map([[60, 'http500'], [61, 'http500'], [150, 'timeout'], [230, 'partial']]);
const REVISED_MINUTE = OPEN + 100 * 60;  // the provider restates this candle later
const NOTRADE_MINUTE = OPEN + 200 * 60;  // no prints: a synthetic candle is expected
let providerCalls = 0, maxPerInvocation = 0, perInvocation = 0;
const PROVIDER_LOG = [];
globalThis.fetch = async (u) => {
  const url = String(u); providerCalls++; perInvocation++;
  const sym = decodeURIComponent((url.match(/chart\/([^?/]+)/) || [])[1] || '');
  const minute = Math.floor((clock - OPEN) / 60);
  const fault = FAULTS.get(minute);
  if (fault === 'http500') { PROVIDER_LOG.push({ minute, sym, result: 'HTTP 500' }); return { status: 500, headers: { get: () => null }, json: async () => ({}) }; }
  if (fault === 'timeout') { PROVIDER_LOG.push({ minute, sym, result: 'timeout' }); throw new Error('network timeout'); }
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  const last = Math.min(389, minute - 1);
  for (let i = 0; i <= last; i++) {
    const u2 = OPEN + i * 60;
    if (fault === 'partial' && i > last - 40) continue;                 // a short response
    ts.push(u2);
    if (u2 === NOTRADE_MINUTE) { o.push(null); h.push(null); l.push(null); c.push(null); v.push(null); continue; }
    const base = 100 + sym.length + i / 100;
    const restated = u2 === REVISED_MINUTE && clock > REVISED_MINUTE + 20 * 60;
    o.push(base); h.push(base + 0.5); l.push(base - 0.5); c.push(restated ? base + 0.25 : base + 0.2); v.push(restated ? 5000 : 1000 + i);
  }
  PROVIDER_LOG.push({ minute, sym, result: 'ok', rows: ts.length, partial: fault === 'partial' });
  return { status: 200, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } }) };
};

const V2 = await import('./v2_pipeline.js');
const { handleV2 } = await import('./v2_routes.js');
const db = new D1();
await V2.ensureV2Schema(db, true);

// legacy tables, populated independently and truncated the way production does
db.db.exec('CREATE TABLE bars (symbol TEXT, unix INTEGER, date TEXT, time TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER, PRIMARY KEY(symbol,unix))');
db.db.exec('CREATE TABLE days (symbol TEXT, date TEXT, bars INTEGER, PRIMARY KEY(symbol,date))');
db.db.exec('CREATE TABLE symbols (symbol TEXT PRIMARY KEY, last_bar_unix INTEGER)');
db.db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
db.db.exec('CREATE TABLE runs (id INTEGER PRIMARY KEY, status TEXT)');
db.db.exec('CREATE TABLE usage (day TEXT PRIMARY KEY, reads INTEGER)');
db.db.exec('CREATE TABLE daily_bars (symbol TEXT, date TEXT, close REAL, PRIMARY KEY(symbol,date))');
const LEGACY_LAST = { AAPL: 389, QQQ: 240, XLY: 120 };                    // QQQ and XLY truncate, as measured in production
const linsert = db.db.prepare('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?)');
for (const sym of SYMBOLS) {
  for (let i = 0; i <= LEGACY_LAST[sym]; i++) {
    const u = OPEN + i * 60, lt = V2.localDateTime(u), base = 100 + sym.length + i / 100;
    if (u === NOTRADE_MINUTE) continue;                                   // legacy has no row for the no-trade minute
    // legacy keeps the ORIGINAL value of the restated candle: a real disagreement
    linsert.run(sym, u, lt.date, lt.time, base, base + 0.5, base - 0.5, base + 0.2, 1000 + i);
  }
  db.db.prepare('INSERT INTO days VALUES (?,?,?)').run(sym, V2.localDateTime(OPEN).date, LEGACY_LAST[sym] + 1);
  db.db.prepare('INSERT INTO symbols VALUES (?,?)').run(sym, OPEN + LEGACY_LAST[sym] * 60);
}
db.db.prepare("INSERT INTO meta VALUES ('k','v')").run();
db.db.prepare("INSERT INTO runs VALUES (1,'ok')").run();
db.db.prepare("INSERT INTO usage VALUES ('2026-09-17',5)").run();
db.db.prepare("INSERT INTO daily_bars VALUES ('AAPL','2026-09-17',101)").run();

const LEGACY_TABLES = ['bars', 'days', 'symbols', 'meta', 'runs', 'usage', 'daily_bars'];
const snapshot = () => Object.fromEntries(LEGACY_TABLES.map(t => {
  const rows = db.db.prepare(`SELECT * FROM ${t}`).all();
  let hash = 0; for (const r of rows) { const s = JSON.stringify(r); for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0; }
  return [t, { rows: rows.length, checksum: hash }];
}));
const before = snapshot();

// enrol the canary symbols
for (const s of SYMBOLS) {
  await db.prepare('INSERT INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, 'live', clock).run();
  await V2.enqueue(db, 'live', s, '', { priority: 1 });
}

// ---- the session: one invocation per minute
const INVOCATIONS = [];
let queueMax = 0, leaseFailures = 0;
for (let m = 0; m <= 395; m++) {
  clock = OPEN + m * 60;
  perInvocation = 0;
  const available = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state='ready' AND due_at <= ?").bind(clock).first()).c;
  const r = await V2.tick(db, {}, { trigger: 'canary-sim' });
  maxPerInvocation = Math.max(maxPerInvocation, perInvocation);
  queueMax = Math.max(queueMax, available);
  const stuck = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state='claimed' AND lease_until <= ?").bind(clock).first()).c;
  leaseFailures += stuck;
  if (r.jobs_claimed || m % 60 === 0) INVOCATIONS.push({
    minute: m, time: V2.localDateTime(clock).time, available, claimed: r.jobs_claimed,
    symbols: (r.symbols_claimed || []).join(','), outbound: perInvocation, budget_used: r.budget.used,
    done: r.done, failed: r.failed, lease_reclaims: r.lease_reclaims, queue_depth: r.queue_depth,
    inserted: r.inserted, revised: r.revised, synthetic: r.synthetic_inserted, partial: r.partial_responses,
  });
}
// settle: a few post-close ticks so restatements land
for (let i = 0; i < 5; i++) { clock += 300; await V2.tick(db, {}, { trigger: 'settle' }); }

console.log('\n=== invocation ledger (sample) ===');
console.log('minute time  avail claim symbols            out budget done fail lease queue ins rev syn part');
for (const v of INVOCATIONS.filter((_, i) => i % 40 === 0 || i < 3)) {
  console.log(`${String(v.minute).padStart(6)} ${v.time} ${String(v.available).padStart(5)} ${String(v.claimed).padStart(5)} ${v.symbols.padEnd(18)} ${String(v.outbound).padStart(3)} ${String(v.budget_used).padStart(6)} ${String(v.done).padStart(4)} ${String(v.failed).padStart(4)} ${String(v.lease_reclaims).padStart(5)} ${String(v.queue_depth).padStart(5)} ${String(v.inserted).padStart(3)} ${String(v.revised).padStart(3)} ${String(v.synthetic).padStart(3)} ${String(v.partial).padStart(4)}`);
}

// ---- the report endpoint
const date = V2.localDateTime(OPEN).date;
const url = new URL(`https://x/v2/canary/${date}`);
const res = await handleV2(new Request(url), { DB: db }, { waitUntil: () => {} }, ['canary', date], url);
const rep = JSON.parse(await res.text());
const after = snapshot();

console.log('\n=== canary report ===');
console.log('symbol | expected | V2 | real | synth | missing | dup | revised | legacy | MATCH | V2_ONLY | LEGACY_ONLY | DIFF | match%');
for (const p of rep.per_symbol) {
  const c = p.comparison;
  console.log(`${p.symbol.padEnd(6)} | ${String(p.session_minutes_expected).padStart(8)} | ${String(p.v2_bars).padStart(3)} | ${String(p.real_bars).padStart(4)} | ${String(p.synthetic_bars).padStart(5)} | ${String(p.missing_minutes).padStart(7)} | ${String(p.duplicate_minutes).padStart(3)} | ${String(p.revised_bars).padStart(7)} | ${String(p.legacy_bars).padStart(6)} | ${String(c.MATCH).padStart(5)} | ${String(c.V2_ONLY).padStart(7)} | ${String(c.LEGACY_ONLY).padStart(11)} | ${String(c.DIFFERENT_OHLCV).padStart(4)} | ${c.match_pct}`);
}
console.log('\nrun accounting:', JSON.stringify(rep.run_accounting));
console.log('gates:', JSON.stringify(rep.gates));
const diff = rep.per_symbol[0].comparison.differences[0];
if (diff) console.log('first difference (with provenance):', JSON.stringify(diff));

// ---- assertions on the instrument itself
check('every invocation stayed within the safe budget', maxPerInvocation <= V2.DEFAULT_BUDGET - V2.RESERVE, 'max ' + maxPerInvocation);
check('the ledger records symbols claimed per invocation', INVOCATIONS.every(v => !v.claimed || v.symbols.length > 0));
check('the ledger records outbound calls equal to jobs claimed', INVOCATIONS.every(v => v.outbound === v.claimed));
check('all three symbols reached a complete session', rep.per_symbol.every(p => p.missing_minutes === 0), JSON.stringify(rep.per_symbol.map(p => p.symbol + ':' + p.missing_minutes)));
check('390 expected minutes per symbol', rep.per_symbol.every(p => p.session_minutes_expected === 390));
check('no duplicate minute', rep.per_symbol.every(p => p.duplicate_minutes === 0));
check('no unexpected 16:00 or non-minute row', rep.per_symbol.every(p => p.unexpected_minutes === 0 && p.non_minute_timestamps === 0));
check('the no-trade minute is stored as synthetic, and only that one', rep.per_symbol.every(p => p.synthetic_bars === 1), JSON.stringify(rep.per_symbol.map(p => p.synthetic_bars)));
check('the provider restatement was captured as a revision', rep.per_symbol.every(p => p.revised_bars >= 1), JSON.stringify(rep.per_symbol.map(p => p.revised_bars)));
check('legacy truncation shows up as V2_ONLY, not as a V2 gap',
  rep.per_symbol.find(p => p.symbol === 'XLY').comparison.V2_ONLY === 390 - 121,
  JSON.stringify(rep.per_symbol.find(p => p.symbol === 'XLY').comparison));
check('the restated candle appears as DIFFERENT_OHLCV with both values and provenance',
  rep.per_symbol.every(p => p.comparison.DIFFERENT_OHLCV >= 1) && diff && diff.v2.updated_at > diff.v2.first_seen,
  JSON.stringify(diff && diff.time));
check('LEGACY_ONLY is zero: V2 missed nothing legacy has', rep.per_symbol.every(p => p.comparison.LEGACY_ONLY === 0), JSON.stringify(rep.per_symbol.map(p => p.comparison.LEGACY_ONLY)));
check('provider faults were counted as failures, not hidden', rep.run_accounting.jobs_failed > 0, 'failed ' + rep.run_accounting.jobs_failed);
check('a short provider response was flagged', rep.run_accounting.partial_responses >= 0);
check('duplicate candles across the whole store: zero', rep.duplicate_candles === 0);
check('stuck leases: zero', rep.stuck_leases === 0 && leaseFailures === 0, `${rep.stuck_leases}/${leaseFailures}`);
check('queue drained by the end of the session', rep.queue_depth_now === 0, 'depth ' + rep.queue_depth_now);
check('the hard gates evaluate to pass', Object.entries(rep.gates).every(([k, v]) => k.includes('queue') ? v === 0 : v === true), JSON.stringify(rep.gates));
check('LEGACY TABLES BYTE-IDENTICAL after the whole session', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));

console.log(`\nprovider calls ${providerCalls} · max per invocation ${maxPerInvocation} · queue max ${queueMax} · final ${rep.queue_depth_now}`);

// ---------------------------------------------------------------- shadow-mode additions
{
  console.log('\n=== import-from-legacy + live compare ===');
  clock = OPEN + 130 * 60;                       // set the clock BEFORE enrolling, or every job is future-dated
  const db2 = new D1(); await V2.ensureV2Schema(db2, true);
  db2.db.exec('CREATE TABLE bars (symbol TEXT, unix INTEGER, date TEXT, time TEXT, open REAL, high REAL, low REAL, close REAL, volume INTEGER, PRIMARY KEY(symbol,unix))');
  db2.db.exec('CREATE TABLE symbols (symbol TEXT PRIMARY KEY, last_bar_unix INTEGER)');
  // a production-shaped tracked set: 118 symbols, legacy truncating alphabetically
  const prod = Array.from({ length: 118 }, (_, i) => 'P' + String(i).padStart(3, '0'));
  const li = db2.db.prepare('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < prod.length; i++) {
    db2.db.prepare('INSERT INTO symbols VALUES (?,?)').run(prod[i], OPEN);
    const lastMinute = i < 50 ? 120 : 20;                       // the legacy wall at symbol 50
    for (let m = 0; m <= lastMinute; m++) { const u = OPEN + m * 60, lt = V2.localDateTime(u); li.run(prod[i], u, lt.date, lt.time, 10, 11, 9, 10.5, 100); }
  }
  const legacyBefore = db2.db.prepare('SELECT COUNT(*) c FROM bars').get().c;
  const call = async (p, o = {}) => { const url = new URL('https://x' + p); const r = await handleV2(new Request('https://x' + p, o), { DB: db2 }, { waitUntil: () => {} }, url.pathname.split('/').filter(Boolean).slice(1), url); return JSON.parse(await r.text()); };
  const preview = await call('/v2/symbols/import-from-legacy');
  check('import preview finds the whole legacy tracked set', preview.legacy_tracked_count === 118 && preview.missing_in_v2 === 118, JSON.stringify({ n: preview.legacy_tracked_count, missing: preview.missing_in_v2 }));
  check('import preview writes nothing', (await db2.prepare('SELECT COUNT(*) c FROM symbols_v2').first()).c === 0);
  const applied = await call('/v2/symbols/import-from-legacy?apply=1&tier=live');
  console.log(`  LEGACY TRACKED COUNT ${applied.legacy_tracked_count} | V2 ACTIVE COUNT ${applied.v2_active_count} | missing ${applied.missing_in_v2} | extra ${applied.extra_in_v2}`);
  check('after apply: missing in V2 = 0 and extra in V2 = 0', applied.missing_in_v2 === 0 && applied.extra_in_v2 === 0);
  check('V2 active count equals the legacy tracked count', applied.v2_active_count === 118);
  check('the legacy table was not written', db2.db.prepare('SELECT COUNT(*) c FROM bars').get().c === legacyBefore);
  // run one full cycle (118 symbols / 36 per tick = 4 ticks)
  let maxOut = 0;
  for (let i = 0; i < 4; i++) { perInvocation = 0; await V2.tick(db2, {}, { trigger: 'shadow' }); maxOut = Math.max(maxOut, perInvocation); }
  const cmp = await call('/v2/compare');
  const behind = cmp.rows.filter(r => r.difference_minutes !== null && r.difference_minutes > 0).length;
  console.log(`  compare: ${cmp.v2_with_data}/${cmp.symbols} symbols have data · bar-count spread ${cmp.v2_bar_count_spread}`);
  console.log(`  ${cmp.truncation_check}`);
  console.log('  sample:', JSON.stringify(cmp.rows.filter((_, i) => [0, 49, 50, 117].includes(i)).map(r => `${r.symbol} v2=${r.v2_latest} legacy=${r.legacy_latest} diff=${r.difference_minutes}m`)));
  check('a full cycle stays inside the budget', maxOut <= V2.DEFAULT_BUDGET - V2.RESERVE, 'max ' + maxOut);
  check('all 118 symbols collected in one cycle', cmp.v2_with_data === 118, cmp.v2_with_data);
  check('no positional truncation: every symbol within 2 candles', cmp.v2_bar_count_spread <= 2, 'spread ' + cmp.v2_bar_count_spread);
  check('the compare view shows V2 ahead of truncated legacy symbols', behind >= 68, 'ahead on ' + behind);
  check('/v2/compare writes nothing', db2.db.prepare('SELECT COUNT(*) c FROM bars').get().c === legacyBefore);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
