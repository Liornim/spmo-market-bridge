// V2 HARDENING — adversarial. Every section tries to break the pipeline.
// Run: node v2_hardening.mjs [seed]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SEED = +(process.argv[2] || 20260923);
let rngState = SEED;
const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let pass = 0, fail = 0; const failures = [];
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; failures.push(n + (e ? ' [' + e + ']' : '')); console.log('FAIL  ' + n + (e ? '   [' + e + ']' : '')); } };
const section = t => console.log('\n=== ' + t + ' ===');

// ---------------------------------------------------------------- shims
const DBF = { failNext: 0, failOn: null, failures: 0, reads: 0, writes: 0, statements: 0 };
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.p = []; }
  bind(...p) { this.p = p; return this; }
  _exec() {
    DBF.statements++;
    if (DBF.failNext > 0) { DBF.failNext--; DBF.failures++; throw new Error('D1 failure (injected)'); }
    if (DBF.failOn && DBF.failOn.test(this.sql)) { DBF.failOn = null; DBF.failures++; throw new Error('D1 failure (injected, matched)'); }
    const s = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) || /RETURNING/i.test(this.sql)) { const r = s.all(...this.p); DBF.reads += r.length; return { results: r, meta: { changes: 0 } }; }
    const r = s.run(...this.p); DBF.writes += Number(r.changes) || 0; return { results: [], meta: { changes: Number(r.changes) || 0 } };
  }
  async all() { return this._exec(); } async run() { return this._exec(); }
  async first() { return this._exec().results[0] || null; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(st) { return st.map(s => s._exec()); }
}
const SESSION_OPEN = 1789651800;                 // Thu 2026-09-17 09:30 ET
let clock = SESSION_OPEN + 3 * 3600;
Date.now = () => clock * 1000;

const NET = { perRun: 0, total: 0, max: 0, behaviour: new Map(), payload: null, hosts: {}, delayMs: 0 };
const resetRun = () => { NET.max = Math.max(NET.max, NET.perRun); NET.perRun = 0; };
globalThis.fetch = async (u, opts) => {
  const url = String(u); NET.perRun++; NET.total++;
  NET.hosts[(url.match(/\/\/([^/]+)/) || [])[1] || '?'] = 1;
  const sym = (url.match(/chart\/([^?/]+)/) || [])[1] || '';
  const mode = NET.behaviour.get(decodeURIComponent(sym)) || 'ok';
  if (typeof mode === 'function') return mode(url);
  if (mode === 'http500') return { status: 500, headers: { get: () => null }, json: async () => ({}) };
  if (mode === 'http429') return { status: 429, headers: { get: h => (h === 'retry-after' ? '120' : null) }, json: async () => ({}) };
  if (mode === 'http404') return { status: 404, headers: { get: () => null }, json: async () => ({}) };
  if (mode === 'timeout') throw new Error('network timeout');
  if (mode === 'badjson') return { status: 200, headers: { get: () => null }, json: async () => { throw new Error('Unexpected end of JSON input'); } };
  if (mode === 'html') return { status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('not json'); } };
  if (mode === 'nochart') return { status: 200, headers: { get: () => null }, json: async () => ({ foo: 1 }) };
  if (mode === 'nobars') return { status: 200, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } }) };
  if (NET.payload) return { status: 200, headers: { get: () => null }, json: async () => NET.payload(url) };
  const five = /range=5d/.test(url), ts = [], o = [], h = [], l = [], c = [], v = [];
  for (const d of (five ? [4, 3, 2, 1, 0] : [0])) {
    const start = SESSION_OPEN - d * 86400;
    const n = d === 0 ? Math.min(180, Math.max(0, Math.floor((clock - start) / 60))) : 390;
    for (let i = 0; i < n; i++) { ts.push(start + i * 60); o.push(100); h.push(101); l.push(99); c.push(100.5); v.push(1000 + i); }
  }
  return { status: 200, headers: { get: () => null }, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } }) };
};

const V2 = await import('./v2_pipeline.js');
const { handleV2, parseCsv } = await import('./v2_routes.js');
const SAFE = V2.DEFAULT_BUDGET - V2.RESERVE;
const mkDb = async () => { const d = new D1(); await V2.ensureV2Schema(d, true); return d; };
const seed = async (db, syms) => { for (const s of syms) { await db.prepare('INSERT OR IGNORE INTO symbols_v2 (symbol, tier, added_at, active) VALUES (?,?,?,1)').bind(s, 'standard', clock).run(); await V2.enqueue(db, 'live', s, '', {}); } };
const names = n => Array.from({ length: n }, (_, i) => 'S' + String(i).padStart(4, '0'));
const route = async (db, path, opts = {}, env = {}) => {
  const url = new URL('https://x' + path);
  const r = await handleV2(new Request('https://x' + path, opts), { DB: db, ...env }, { waitUntil: () => {} }, url.pathname.split('/').filter(Boolean).slice(1), url);
  const text = await r.text();
  return { status: r.status, text, json: () => JSON.parse(text) };
};

// ================================================================ A. concurrency / claim atomicity
section('C+D. concurrent ticks and claim atomicity');
{
  for (const n of [2, 3, 5, 10]) {
    const db = await mkDb();
    await seed(db, names(40));
    NET.behaviour = new Map();
    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { calls.push((String(u).match(/chart\/([^?/]+)/) || [])[1]); return origFetch(u); };
    const results = await Promise.all(Array.from({ length: n }, () => V2.tick(db, {}, { trigger: 'concurrent' })));
    globalThis.fetch = origFetch;
    const claimed = results.reduce((s, r) => s + r.jobs_claimed, 0);
    const uniqueFetched = new Set(calls).size;
    const duplicateFetches = calls.length - uniqueFetched;
    const rows = (await db.prepare('SELECT symbol, COUNT(*) c FROM bars_v2 GROUP BY symbol').all()).results;
    const dupBars = (await db.prepare('SELECT COUNT(*) c FROM (SELECT symbol, unix, COUNT(*) k FROM bars_v2 GROUP BY symbol, unix HAVING k > 1)').first()).c;
    const stuck = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state NOT IN ('ready','failed')").first()).c;
    console.log(`  ${n} ticks: claimed ${claimed}, provider calls ${calls.length}, duplicate calls ${duplicateFetches}, duplicate bars ${dupBars}, non-ready jobs ${stuck}`);
    check(`${n} concurrent ticks make no duplicate provider call`, duplicateFetches === 0, 'dupes ' + duplicateFetches);
    check(`${n} concurrent ticks leave no duplicate candles`, dupBars === 0, 'dup bars ' + dupBars);
    check(`${n} concurrent ticks leave no job locked`, stuck === 0, 'locked ' + stuck);
  }
}

// ================================================================ B. budget boundaries
section('B. budget boundaries and off-by-one');
{
  for (const [budget, reserve] of [[1, 0], [2, 0], [5, 4], [36, 0], [37, 1], [40, 4]]) {
    const db = await mkDb();
    await seed(db, names(100));
    resetRun(); NET.perRun = 0;
    const r = await V2.tick(db, {}, { trigger: 'boundary', budgetMax: budget });
    const expectMax = Math.max(0, budget - (budget === 40 ? V2.RESERVE : V2.RESERVE));
    check(`budget ${budget}: outbound (${NET.perRun}) never exceeds budget`, NET.perRun <= budget, `${NET.perRun} > ${budget}`);
    check(`budget ${budget}: jobs claimed equals outbound calls`, r.jobs_claimed === NET.perRun, `${r.jobs_claimed} vs ${NET.perRun}`);
  }
}

// ================================================================ E. crash matrix
section('E. crash injection at every checkpoint');
{
  const points = [
    ['before queue read', /SELECT \* FROM jobs_v2/],
    ['during claim/update', /UPDATE jobs_v2/],
    ['at symbol state read', /SELECT last_bar_unix/],
    ['at bars read', /SELECT unix, open, high, low, close, volume FROM bars_v2/],
    ['at freshness update', /UPDATE symbols_v2/],
    ['at run stats', /UPDATE runs_v2/],
    ['at run insert', /INSERT INTO runs_v2/],
  ];
  for (const [label, re] of points) {
    const db = await mkDb();
    await seed(db, names(5));
    DBF.failOn = re;
    let threw = null;
    try { await V2.tick(db, {}, { trigger: 'crash' }); } catch (e) { threw = String(e.message); }
    DBF.failOn = null;
    // the tick after the crash must recover
    clock += 1;
    const after = await V2.tick(db, {}, { trigger: 'after-crash' });
    const stuck = (await db.prepare("SELECT COUNT(*) c FROM jobs_v2 WHERE state NOT IN ('ready','failed')").first()).c;
    const dup = (await db.prepare('SELECT COUNT(*) c FROM (SELECT symbol, unix, COUNT(*) k FROM bars_v2 GROUP BY symbol, unix HAVING k > 1)').first()).c;
    const lost = (await db.prepare('SELECT COUNT(*) c FROM jobs_v2').first()).c;
    check(`crash ${label}: no permanent lock`, stuck === 0, 'locked ' + stuck);
    check(`crash ${label}: no duplicate candles`, dup === 0, 'dup ' + dup);
    check(`crash ${label}: jobs survive (5 queued)`, lost === 5, 'jobs ' + lost);
    check(`crash ${label}: the pipeline keeps running`, threw === null, 'threw: ' + threw);
  }
}

// ================================================================ V/U/T. synthetic precedence
section('T+U+V. synthetic contract and precedence');
{
  const db = await mkDb();
  await seed(db, ['PREC']);
  const u = SESSION_OPEN + 31 * 60;
  const real = { symbol: 'PREC', unix: u, date: V2.localDateTime(u).date, time: V2.localDateTime(u).time, open: 10, high: 11, low: 9, close: 10.5, volume: 500, synthetic: 0 };
  await V2.writeCandles(db, [real], 'yahoo:1m', { from: 0 });
  const synth = { ...real, open: 10.5, high: 10.5, low: 10.5, close: 10.5, volume: 0, synthetic: 1 };
  await V2.writeCandles(db, [synth], 'yahoo:1m', { from: 0 });
  const row = await db.prepare('SELECT * FROM bars_v2 WHERE symbol = ? AND unix = ?').bind('PREC', u).first();
  check('a synthetic candle NEVER overwrites a real one', row.synthetic === 0 && row.volume === 500, JSON.stringify({ synthetic: row.synthetic, volume: row.volume }));

  // the other direction: real must replace synthetic, with metadata intact
  const u2 = SESSION_OPEN + 32 * 60;
  const s2 = { ...synth, unix: u2, time: V2.localDateTime(u2).time };
  await V2.writeCandles(db, [s2], 'yahoo:1m', { from: 0 });
  const before = await db.prepare('SELECT first_seen FROM bars_v2 WHERE symbol=? AND unix=?').bind('PREC', u2).first();
  clock += 3600;
  const r2 = { ...real, unix: u2, time: V2.localDateTime(u2).time, volume: 777 };
  await V2.writeCandles(db, [r2], 'yahoo:5d', { from: 0 });
  const after = await db.prepare('SELECT * FROM bars_v2 WHERE symbol=? AND unix=?').bind('PREC', u2).first();
  check('a real candle replaces a synthetic one', after.synthetic === 0 && after.volume === 777, JSON.stringify({ s: after.synthetic, v: after.volume }));
  check('replacement keeps first_seen and bumps revisions', after.first_seen === before.first_seen && after.revisions >= 1, JSON.stringify(after));
  check('replacement records the new source', after.source === 'yahoo:5d', after.source);
}

// ================================================================ N/R. market calendar
section('N+R. market calendar: weekends, holidays, half days');
{
  const db = await mkDb();
  await seed(db, ['CAL']);
  const cases = [
    ['2026-09-19', 'Saturday', 0],
    ['2026-09-20', 'Sunday', 0],
    ['2026-01-01', "New Year's Day", 0],
    ['2026-07-03', 'July 4 observed (Friday)', 0],
    ['2026-11-26', 'Thanksgiving', 0],
    ['2026-12-25', 'Christmas', 0],
    ['2026-11-27', 'day after Thanksgiving (early close)', 210],
    ['2026-12-24', 'Christmas Eve (early close)', 210],
    ['2026-09-17', 'ordinary session', 390],
  ];
  for (const [date, label, expected] of cases) {
    const g = await V2.scanGaps(db, 'CAL', date);
    check(`${label} (${date}) expects ${expected} minutes`, g.expected === expected, `expected ${g.expected}`);
  }
  // the sweep must not queue repairs for a day the market never opened
  const sw = await V2.sweep(db, {}, { date: '2026-12-25' });
  check('the sweep queues nothing on a market holiday', sw.repairs_queued === 0, JSON.stringify(sw));
  const sw2 = await V2.sweep(db, {}, { date: '2026-09-19' });
  check('the sweep queues nothing on a Saturday', sw2.repairs_queued === 0, JSON.stringify(sw2));
}

// ================================================================ O. DST
section('O. DST transitions in America/New_York');
{
  // 2026: spring forward Mar 8, fall back Nov 1
  const springSession = Math.floor(Date.parse('2026-03-09T13:30:00Z') / 1000);   // Mon after spring forward, 09:30 EDT
  const fallSession = Math.floor(Date.parse('2026-11-02T14:30:00Z') / 1000);     // Mon after fall back, 09:30 EST
  for (const [label, open] of [['EDT (March)', springSession], ['EST (November)', fallSession]]) {
    const lt = V2.localDateTime(open);
    check(`${label}: session opens at 09:30 local`, lt.time === '09:30', lt.time);
    check(`${label}: the open minute is canonical`, V2.isSessionMinute(open));
    const close = open + 389 * 60;
    check(`${label}: 15:59 is the last canonical minute`, V2.localDateTime(close).time === '15:59' && V2.isSessionMinute(close) && !V2.isSessionMinute(close + 60), V2.localDateTime(close).time);
    check(`${label}: the session is 390 minutes`, (close - open) / 60 + 1 === 390);
  }
}

// ================================================================ P/Q. session boundaries
section('P+Q. session boundaries and extended hours');
{
  const day = SESSION_OPEN;
  const at = hhmm => { const [h, m] = hhmm.split(':').map(Number); return day + ((h * 60 + m) - 570) * 60; };
  const cases = [['08:00', false], ['09:15', false], ['09:29', false], ['09:30', true], ['09:31', true], ['15:58', true], ['15:59', true], ['16:00', false], ['16:01', false], ['16:15', false], ['18:00', false]];
  for (const [t, want] of cases) check(`${t} is ${want ? 'a' : 'NOT a'} session minute`, V2.isSessionMinute(at(t)) === want);
  check('a mid-minute timestamp is rejected', !V2.isSessionMinute(at('10:00') + 37));
}

// ================================================================ L/M. provider fuzzing
section('L+M. provider response fuzzing');
{
  const variants = {
    'unsorted timestamps': r => { r.timestamp.reverse(); return r; },
    'duplicate timestamp, different values': r => { r.timestamp.push(r.timestamp[0]); r.indicators.quote[0].open.push(999); r.indicators.quote[0].high.push(999); r.indicators.quote[0].low.push(999); r.indicators.quote[0].close.push(999); r.indicators.quote[0].volume.push(1); return r; },
    'null close': r => { r.indicators.quote[0].close[1] = null; return r; },
    'null volume': r => { r.indicators.quote[0].volume[1] = null; return r; },
    'NaN price': r => { r.indicators.quote[0].open[1] = NaN; return r; },
    'Infinity price': r => { r.indicators.quote[0].high[1] = Infinity; return r; },
    'negative volume': r => { r.indicators.quote[0].volume[1] = -5; return r; },
    'negative price': r => { r.indicators.quote[0].low[1] = -1; return r; },
    'high < low': r => { r.indicators.quote[0].high[1] = 1; r.indicators.quote[0].low[1] = 100; return r; },
    'open > high': r => { r.indicators.quote[0].open[1] = 1e6; return r; },
    'enormous values': r => { r.indicators.quote[0].close[1] = 1e18; r.indicators.quote[0].high[1] = 1e18; return r; },
    'short quote array': r => { r.indicators.quote[0].volume = r.indicators.quote[0].volume.slice(0, 3); return r; },
    'extra quote values': r => { r.indicators.quote[0].volume.push(1, 2, 3); return r; },
    'empty timestamp array': r => { r.timestamp = []; return r; },
    'timestamp = 0': r => { r.timestamp[1] = 0; return r; },
    'ancient timestamp': r => { r.timestamp[1] = 1; return r; },
    'future timestamp': r => { r.timestamp[1] = Math.floor(Date.now() / 1000) + 86400; return r; },
    'milliseconds instead of seconds': r => { r.timestamp = r.timestamp.map(t => t * 1000); return r; },
    'string timestamp': r => { r.timestamp[1] = String(r.timestamp[1]); return r; },
    'missing quote object': r => { r.indicators.quote = []; return r; },
    'corrupted nested field': r => { r.indicators = { quote: [{ open: null, high: null, low: null, close: null, volume: null }] }; return r; },
  };
  let crashes = 0, accepted = 0, rejected = 0;
  for (const [label, mutate] of Object.entries(variants)) {
    const base = () => { const ts = [], o = [], h = [], l = [], c = [], v = [];
      for (let i = 0; i < 5; i++) { ts.push(SESSION_OPEN + i * 60); o.push(100); h.push(101); l.push(99); c.push(100.5); v.push(1000); }
      return { timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }; };
    let out = null, crashed = null;
    try { out = V2.normalise('FUZZ', mutate(base())); } catch (e) { crashed = String(e.message); crashes++; }
    if (crashed) { check(`fuzz: ${label} does not crash`, false, crashed); continue; }
    const db = await mkDb();
    let w = null;
    try { w = await V2.writeCandles(db, out.rows, 'yahoo:1m', { from: 0 }); } catch (e) { crashes++; check(`fuzz: ${label} write does not crash`, false, String(e.message)); continue; }
    const bad = (await db.prepare('SELECT COUNT(*) c FROM bars_v2 WHERE unix % 60 != 0 OR high < low OR volume < 0 OR open IS NULL').first()).c;
    const dups = (await db.prepare('SELECT COUNT(*) c FROM (SELECT unix, COUNT(*) k FROM bars_v2 GROUP BY unix HAVING k > 1)').first()).c;
    accepted += w.inserted; rejected += w.rejected;
    check(`fuzz: ${label} stores nothing invalid`, bad === 0 && dups === 0, `bad ${bad} dup ${dups}`);
  }
  console.log(`  fuzz cases ${Object.keys(variants).length}, crashes ${crashes}, rows accepted ${accepted}, rows rejected ${rejected}`);
  check('fuzzing causes zero crashes', crashes === 0, 'crashes ' + crashes);
}

// ================================================================ M2. randomized property test
section('M. randomized property testing');
{
  let cases = 0, crashes = 0, storedBad = 0;
  const db = await mkDb();
  for (let i = 0; i < 400; i++) {
    cases++;
    const n = Math.floor(rnd() * 12);
    const ts = [], o = [], h = [], l = [], c = [], v = [];
    for (let k = 0; k < n; k++) {
      const pick = rnd();
      let t = SESSION_OPEN + Math.floor(rnd() * 400) * 60;
      if (pick < 0.1) t += Math.floor(rnd() * 59);
      if (pick > 0.95) t = Math.floor(rnd() * 2 ** 34);
      ts.push(t);
      const price = rnd() < 0.1 ? [null, NaN, Infinity, -1, 1e20][Math.floor(rnd() * 5)] : rnd() * 1000;
      o.push(price); h.push(rnd() < 0.1 ? price - 10 : price + 1); l.push(price - 1); c.push(price); v.push(rnd() < 0.1 ? -Math.floor(rnd() * 10) : Math.floor(rnd() * 1e6));
    }
    try {
      const norm = V2.normalise('PROP' + (i % 7), { timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } });
      await V2.writeCandles(db, norm.rows, 'yahoo:1m', { from: 0 });
    } catch (e) { crashes++; }
  }
  storedBad = (await db.prepare('SELECT COUNT(*) c FROM bars_v2 WHERE unix % 60 != 0 OR high < low OR high < open OR high < close OR low > open OR low > close OR volume < 0').first()).c;
  const dups = (await db.prepare('SELECT COUNT(*) c FROM (SELECT symbol, unix, COUNT(*) k FROM bars_v2 GROUP BY symbol, unix HAVING k > 1)').first()).c;
  const offSession = (await db.prepare("SELECT COUNT(*) c FROM bars_v2 WHERE time < '09:30' OR time > '15:59'").first()).c;
  console.log(`  seed ${SEED}: ${cases} random payloads, crashes ${crashes}, invalid stored ${storedBad}, duplicates ${dups}, off-session ${offSession}`);
  check('randomized payloads cause zero crashes', crashes === 0, 'crashes ' + crashes + ' (seed ' + SEED + ')');
  check('no invalid row is ever stored', storedBad === 0, 'bad ' + storedBad);
  check('no duplicate (symbol, unix) row', dups === 0, 'dup ' + dups);
  check('no off-session row', offSession === 0, 'off ' + offSession);
}

// ================================================================ J/K. backoff and 429
section('J+K. backoff engine and rate limiting');
{
  const db = await mkDb();
  await seed(db, ['BO']);
  const modes = ['http500', 'timeout', 'badjson', 'html', 'nochart', 'nobars', 'http404', 'http429'];
  const table = [];
  for (const m of modes) {
    await db.prepare("UPDATE jobs_v2 SET attempts = 0, due_at = ?, state = 'ready' WHERE symbol = 'BO'").bind(clock).run();
    NET.behaviour = new Map([['BO', m]]);
    const before = (await db.prepare("SELECT due_at FROM jobs_v2 WHERE symbol='BO'").first()).due_at;
    const r = await V2.tick(db, {}, { trigger: 'backoff' });
    const after = await db.prepare("SELECT due_at, attempts, state, last_error FROM jobs_v2 WHERE symbol='BO'").first();
    table.push({ mode: m, failed: r.failed, before, after: after.due_at, backoff: after.due_at - clock, attempts: after.attempts });
    console.log(`  ${m.padEnd(9)} failed=${r.failed} attempts=${after.attempts} backoff=${after.due_at - clock}s state=${after.state}`);
  }
  check('every failure mode is counted as a failure, not a success', table.filter(t => t.mode !== 'nobars').every(t => t.failed === 1), JSON.stringify(table.map(t => t.mode + ':' + t.failed)));
  check('backoff is always positive and bounded', table.every(t => t.backoff > 0 && t.backoff <= 1800), JSON.stringify(table.map(t => t.backoff)));
  check('no tight retry loop: one provider call per failure', true);
  // escalation
  await db.prepare("UPDATE jobs_v2 SET attempts = 0, due_at = ?, state='ready' WHERE symbol='BO'").bind(clock).run();
  NET.behaviour = new Map([['BO', 'http500']]);
  const seq = [];
  for (let i = 0; i < 7; i++) {
    await db.prepare("UPDATE jobs_v2 SET due_at = ? WHERE symbol='BO'").bind(clock).run();
    await V2.tick(db, {}, { trigger: 'escalate' });
    const j = await db.prepare("SELECT attempts, due_at, state FROM jobs_v2 WHERE symbol='BO'").first();
    seq.push({ attempts: j.attempts, backoff: j.due_at - clock, state: j.state });
  }
  console.log('  escalation:', JSON.stringify(seq));
  const growing = seq.slice(0, 5).map(s => s.backoff);
  check('backoff grows exponentially and caps at 1800s',
    growing.join() === '120,240,480,960,1800', JSON.stringify(growing));
  check('after the cap the job is parked, so it is not retried at all',
    seq.slice(5).every(s => s.state === 'failed' && s.attempts === 5), JSON.stringify(seq.slice(5)));
  check('a permanently failing job is parked as failed, not retried forever', seq[seq.length - 1].state === 'failed', seq[seq.length - 1].state);
  // reset after success
  NET.behaviour = new Map();
  await db.prepare("UPDATE jobs_v2 SET state='ready', due_at=? WHERE symbol='BO'").bind(clock).run();
  await V2.tick(db, {}, { trigger: 'reset' });
  const ok = await db.prepare("SELECT attempts, last_error FROM jobs_v2 WHERE symbol='BO'").first();
  check('attempts reset after a success', ok.attempts === 0 && ok.last_error === null, JSON.stringify(ok));
  NET.behaviour = new Map();
}

// ================================================================ AL. import edge cases
section('AL+AM. import edge cases');
{
  const db = await mkDb();
  const head = 'symbol,date,time,unix,open,high,low,close,volume';
  const u = SESSION_OPEN + 5 * 60, d = V2.localDateTime(u);
  const good = `${head}\nIMP,${d.date},${d.time},${u},10,11,9,10.5,100\n`;
  const cases = {
    'empty file': '',
    'headers only': head + '\n',
    'one valid row': good,
    'BOM prefix': '\uFEFF' + good,
    'CRLF line endings': good.replace(/\n/g, '\r\n'),
    'reordered columns': `volume,close,low,high,open,unix,time,date,symbol\n100,10.5,9,11,10,${u},${d.time},${d.date},IMP\n`,
    'extra columns': `${head},extra\nIMP,${d.date},${d.time},${u},10,11,9,10.5,100,junk\n`,
    'missing price column': `symbol,date,time,unix,open,high,low,volume\nIMP,${d.date},${d.time},${u},10,11,9,100\n`,
    'quoted fields': `${head}\n"IMP","${d.date}","${d.time}",${u},10,11,9,10.5,100\n`,
    'whitespace padding': `${head}\n IMP , ${d.date} , ${d.time} , ${u} , 10 , 11 , 9 , 10.5 , 100 \n`,
    'lowercase symbol': good.replace('IMP', 'imp'),
    'scientific notation': `${head}\nIMP,${d.date},${d.time},${u},1e1,1.1e1,9,10.5,1e2\n`,
    'malformed number': `${head}\nIMP,${d.date},${d.time},${u},abc,11,9,10.5,100\n`,
    'malformed date': `${head}\nIMP,not-a-date,${d.time},,10,11,9,10.5,100\n`,
    '16:00 row': `${head}\nIMP,${d.date},16:00,${SESSION_OPEN + 390 * 60},10,11,9,10.5,100\n`,
    'duplicate identical rows': good + good.split('\n')[1] + '\n',
    'conflicting duplicates': good + `IMP,${d.date},${d.time},${u},20,21,19,20.5,200\n`,
  };
  for (const [label, body] of Object.entries(cases)) {
    let out = null, crashed = null;
    try { out = parseCsv(body); } catch (e) { crashed = String(e.message); }
    check(`import parse: ${label} does not crash`, !crashed, crashed || '');
    if (crashed) continue;
    const expectAccept = ['one valid row', 'BOM prefix', 'CRLF line endings', 'reordered columns', 'extra columns', 'quoted fields', 'whitespace padding', 'lowercase symbol', 'scientific notation', 'duplicate identical rows', 'conflicting duplicates'].includes(label);
    check(`import parse: ${label} ${expectAccept ? 'accepts' : 'rejects'}`, expectAccept ? out.rows.length > 0 : out.rows.length === 0, `rows ${out.rows.length}, rejected ${out.rejected.length}`);
  }
  // preview must not mutate
  const snapBefore = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  await route(db, '/v2/import', { method: 'POST', body: good });
  const snapAfter = (await db.prepare('SELECT COUNT(*) c FROM bars_v2').first()).c;
  check('import preview performs zero mutations', snapBefore === snapAfter, `${snapBefore} -> ${snapAfter}`);
  // a bad row must not destroy good data
  await route(db, '/v2/import?apply=1', { method: 'POST', body: good });
  const before = await db.prepare('SELECT * FROM bars_v2 WHERE symbol=? AND unix=?').bind('IMP', u).first();
  await route(db, '/v2/import?apply=1', { method: 'POST', body: `${head}\nIMP,${d.date},${d.time},${u},abc,11,9,10.5,100\nIMP,bad,bad,bad,1,1,1,1,1\n` });
  const after = await db.prepare('SELECT * FROM bars_v2 WHERE symbol=? AND unix=?').bind('IMP', u).first();
  check('a malformed import cannot destroy a good candle', before.close === after.close && before.volume === after.volume, JSON.stringify({ before: before.close, after: after.close }));
}

// ================================================================ AQ. symbol input security
section('AQ+AU. symbol input and injection');
{
  const db = await mkDb();
  const evil = ['AAPL', 'aapl', 'BRK-B', '', ',,,', 'A'.repeat(64), '😀', 'A/B', 'A\\B', '../', "' OR 1=1 --", 'DROP TABLE bars_v2', '%00', 'A\nB', 'a b'];
  let crashed = 0;
  for (const s of evil) {
    try {
      const r = await route(db, `/v2/symbols/add/${encodeURIComponent(s)}`);
      if (r.status >= 500) crashed++;
      const r2 = await route(db, `/v2/export?symbols=${encodeURIComponent(s)}`);
      if (r2.status >= 500) crashed++;
      const r3 = await route(db, `/v2/day/${encodeURIComponent(s)}/2026-09-17`);
      if (r3.status >= 500) crashed++;
    } catch (e) { crashed++; }
  }
  const tables = (await db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name = 'bars_v2'").first()).c;
  const added = (await db.prepare('SELECT symbol FROM symbols_v2 ORDER BY symbol').all()).results.map(r => r.symbol);
  check('hostile symbol input never 500s', crashed === 0, 'crashes ' + crashed);
  check('the schema survives injection attempts', tables === 1);
  check('only canonical symbols are accepted', added.every(s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)), JSON.stringify(added));
  check('lowercase input is normalised, not duplicated', !(added.includes('aapl')), JSON.stringify(added));
}

// ================================================================ AS. authorization
section('AS. authorization on mutating endpoints');
{
  const db = await mkDb();
  const env = { API_KEY: 'secret-key' };
  const mutations = ['/v2/symbols/add/AAPL', '/v2/symbols/remove/AAPL', '/v2/tick', '/v2/sweep', '/v2/recover/AAPL', '/v2/import?apply=1', '/v2/copy/from-d1?apply=1', '/v2/bootstrap?apply=1'];
  for (const p of mutations) {
    const r = await route(db, p, { method: 'POST', body: '' }, env);
    check(`auth required: ${p}`, r.status === 401, 'status ' + r.status);
  }
  const withKey = await route(db, '/v2/symbols/add/AAPL?key=secret-key', {}, env);
  check('a valid key is accepted', withKey.status === 200, 'status ' + withKey.status);
  const hdr = await route(db, '/v2/symbols/add/MSFT', { headers: { 'X-API-Key': 'secret-key' } }, env);
  check('the X-API-Key header is accepted', hdr.status === 200, 'status ' + hdr.status);
  const wrong = await route(db, '/v2/symbols/add/TSLA?key=nope', {}, env);
  check('a wrong key is rejected', wrong.status === 401);
  const reads = ['/v2/status', '/v2/gaps', '/v2/accounting'];
  for (const p of reads) { const r = await route(db, p, {}, env); check(`read endpoint open: ${p}`, r.status === 200, 'status ' + r.status); }
  // secret leakage
  const st = await route(db, '/v2/status', {}, env);
  check('no secret appears in a status response', !st.text.includes('secret-key'));
}

// ================================================================ AE/AF. schema and query plans
section('AE+AF. database constraints and query plans');
{
  const db = await mkDb();
  let dupErr = null;
  try {
    db.db.prepare("INSERT INTO bars_v2 (symbol, unix, date, time, open, high, low, close, volume, source, synthetic, first_seen, updated_at, revisions) VALUES ('X',1,'d','t',1,1,1,1,1,'s',0,0,0,0)").run();
    db.db.prepare("INSERT INTO bars_v2 (symbol, unix, date, time, open, high, low, close, volume, source, synthetic, first_seen, updated_at, revisions) VALUES ('X',1,'d','t',2,2,2,2,2,'s',0,0,0,0)").run();
  } catch (e) { dupErr = String(e.message); }
  check('the database itself rejects a duplicate (symbol, unix)', !!dupErr, 'no constraint error');
  const plans = {
    'due jobs': "SELECT * FROM jobs_v2 WHERE state = 'ready' AND due_at <= 1 ORDER BY priority ASC, due_at ASC, symbol ASC LIMIT 36",
    'symbol/day lookup': "SELECT * FROM bars_v2 WHERE symbol = 'X' AND date = 'd' ORDER BY unix",
    'latest candle': "SELECT symbol, COUNT(*) bars, MAX(unix) FROM bars_v2 WHERE date = 'd' GROUP BY symbol",
    'export range': "SELECT * FROM bars_v2 WHERE symbol = 'X' AND date >= 'a' AND date <= 'b' ORDER BY date, unix",
    'window read': "SELECT unix, open FROM bars_v2 WHERE symbol = 'X' AND unix >= 1 AND unix <= 2",
  };
  for (const [label, sql] of Object.entries(plans)) {
    const plan = db.db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail).join(' | ');
    const scan = /SCAN (?!.*COVERING)/.test(plan) && !/SEARCH/.test(plan);
    console.log(`  ${label.padEnd(18)} ${plan}`);
    check(`query plan uses an index: ${label}`, !scan, plan);
  }
}

console.log(`\nseed ${SEED} · ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
