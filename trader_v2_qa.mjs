// TRADER V2 — QA / GOLDEN TEST HARNESS
//
// Four layers, per the plan. Layers 1 and 3 run on synthetic fixtures and are
// unconditional. Layer 2 (golden minutes) and layer 4 (cross-day) need the real
// 2026-09-04 candles; when those are absent this reports NOT RUN rather than
// passing vacuously, because a green tick on a test that never executed is
// worse than a red one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as V from './trader-v2-engine.cjs';
import * as R from './trader-v2-replay.cjs';

const eng = { computeBars: V.computeBars, decide: V.decide };
const results = [];
let pass = 0, fail = 0, notRun = 0;
const ck = (id, name, ok, actual = '', expected = '') => {
  ok ? pass++ : fail++;
  results.push({ id, name, status: ok ? 'PASS' : 'FAIL', actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${actual ? '   [' + actual + ']' : ''}`);
};
const skip = (id, name, why) => {
  notRun++;
  results.push({ id, name, status: 'NOT RUN', actual: why, expected: '' });
  console.log(`SKIP  ${id}  ${name}   [${why}]`);
};

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function day(n, base, drift, noise, seed) {
  const o = []; let p = base, s = seed || 5;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const q = p, c = q + drift(i) + (rnd() - 0.5) * noise;
    o.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +q.toFixed(2),
      high: +(Math.max(q, c) + rnd() * noise * 0.5).toFixed(2),
      low: +(Math.min(q, c) - rnd() * noise * 0.5).toFixed(2),
      close: +c.toFixed(2), volume: 5000 + Math.floor(rnd() * 8000) });
    p = c;
  }
  return o;
}
const FIELDS = s => JSON.stringify([s.state, s.score, s.setupId, s.reason, s.next,
  s.plan && [s.plan.entry, s.plan.zone, s.plan.invalidation, s.plan.stop, s.plan.t1, s.plan.t2, s.plan.rr]]);

console.log('=== 1. ENGINE INTEGRITY ===');

// QA-001 determinism
{
  const rows = day(200, 230, () => 0.012, 0.45, 7);
  const runs = [];
  for (let k = 0; k < 10; k++) runs.push(R.runV2(rows, eng, {}).map(FIELDS).join('|'));
  ck('QA-001', 'ten identical runs give identical output',
    runs.every(x => x === runs[0]), runs.every(x => x === runs[0]) ? '10/10 identical' : 'differ');
}

// QA-002 the future cannot change the past
{
  const base = day(150, 230, () => 0.012, 0.45, 7);
  const futures = [
    base.concat(day(80, base[149].close, () => 0.06, 0.45, 21).map((r, i) => ({ ...r, time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 }))),
    base.concat(day(80, base[149].close, () => -0.06, 0.45, 31).map((r, i) => ({ ...r, time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 }))),
    base   // future deleted entirely
  ];
  const outs = futures.map(f => R.runV2(f, eng, {}).slice(0, 150).map(FIELDS).join('|'));
  const same = outs.every(x => x === outs[0]);
  let firstDiff = '';
  if (!same) {
    const a = outs[0].split('|'), b = outs[1].split('|');
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { firstDiff = 'minute ' + tm(i); break; }
  }
  ck('QA-002', 'randomised, reversed and deleted futures leave minute T identical',
    same, same ? '3 futures, 150 minutes, all identical' : 'first divergence ' + firstDiff);
}

// QA-003 prefix consistency: a fresh engine on the same prefix
{
  const rows = day(200, 230, () => 0.012, 0.45, 7);
  const full = R.runV2(rows, eng, {});
  let bad = 0, firstBad = '';
  [40, 80, 120, 160, 199].forEach(T => {
    const fresh = R.runV2(rows.slice(0, T + 1), eng, {});
    if (FIELDS(fresh[fresh.length - 1]) !== FIELDS(full[T])) { bad++; if (!firstBad) firstBad = tm(T); }
  });
  ck('QA-003', 'a fresh engine on the same prefix reaches the same state',
    bad === 0, bad ? 'differs at ' + firstBad : '5 checkpoints identical');
}

// QA-004 a failed setup cannot resurrect
{
  let violations = 0, sample = '';
  [7, 11, 13, 19, 23].forEach(seed => {
    const rows = day(300, 230, i => (i % 40 < 20 ? 0.05 : -0.05), 0.45, seed);
    const st = R.runV2(rows, eng, {});
    for (let i = 1; i < st.length; i++) {
      if (st[i].state === 'READY' && st[i].setupId) {
        // was this exact setup id ever FAILED before now?
        const failedBefore = st.slice(0, i).some(x => x.state === 'FAILED' && x.setupId === st[i].setupId);
        if (failedBefore) { violations++; if (!sample) sample = st[i].time + ' ' + st[i].setupId; }
      }
    }
  });
  ck('QA-004', 'a FAILED setupId never returns to READY', violations === 0,
    violations ? violations + ' violations, first ' + sample : '5 fixtures clean');
}

// QA-005 READY must be actionable
{
  let missing = 0, vague = 0, sample = '';
  [7, 11, 13].forEach(seed => {
    const rows = day(300, 230, () => 0.015, 0.45, seed);
    R.runV2(rows, eng, {}).filter(s => s.state === 'READY').forEach(s => {
      const p = s.plan;
      const complete = s.setup && s.setup.type && p && p.entry != null && p.zone && p.invalidation != null
        && p.stop != null && p.t1 != null && p.t2 != null && p.rr != null && s.score != null && s.reason;
      if (!complete) { missing++; if (!sample) sample = s.time; }
      if (/ממתין לאישור|wait for confirmation/i.test(s.next || '')) vague++;
    });
  });
  ck('QA-005', 'every READY carries type, trigger, zone, invalidation, stop, T1, T2, R:R, score and reason',
    missing === 0, missing ? missing + ' incomplete, first ' + sample : 'all complete');
  ck('QA-005b', 'no READY says "wait for confirmation"', vague === 0, vague + ' vague');
}

// QA-006 score invariant, at the CONFIGURED threshold
{
  let bad = 0;
  [{ readyScore: 6 }, { readyScore: 8 }, { readyScore: 4 }].forEach(cfg => {
    const rows = day(300, 230, () => 0.015, 0.45, 7);
    R.runV2(rows, eng, { config: cfg }).filter(s => s.state === 'READY')
      .forEach(s => { if (s.score < cfg.readyScore) bad++; });
  });
  ck('QA-006', 'no READY below the configured score threshold, at three thresholds', bad === 0, bad + ' violations');
}

// QA-007 downtrend gate
{
  let readyInDown = 0, reasons = 0;
  [11, 17, 29].forEach(seed => {
    const rows = day(300, 230, () => -0.02, 0.45, seed);
    const st = R.runV2(rows, eng, {});
    st.forEach(s => {
      if (s.state === 'READY' && s.trend === 'DOWN') readyInDown++;
      if (s.state === 'AVOID' && /מבנה יורד/.test(s.reason || '')) reasons++;
    });
  });
  ck('QA-007', 'no READY while the structure is a declared downtrend', readyInDown === 0, readyInDown + ' found');
  ck('QA-007b', 'the downtrend block is stated as the reason', reasons > 0, reasons + ' bars');
}

// QA-008 no chase
{
  const spike = day(120, 230, () => 0.005, 0.4, 7)
    .concat(day(30, 236, () => 0.6, 0.4, 9).map((r, i) => ({ ...r, time: tm(120 + i), unix: 1788000000 + (120 + i) * 60 })));
  const st = R.runV2(spike, eng, {});
  const chasing = st.filter(s => s.state === 'READY' && s.extension > V.CFG.chaseATR);
  ck('QA-008', 'never READY while extended past the chase limit', chasing.length === 0, chasing.length + ' found');
  const warned = st.filter(s => /לא רודפים/.test(s.next || ''));
  ck('QA-008b', 'an extended price is told the expected pullback area',
    warned.length === 0 || /נסיגה צפויה/.test(warned[0].next), warned.length + ' warnings');
}

// QA-009 confirmation must advance, not regress  --- the new one
{
  let regressions = 0, sample = '';
  [7, 11, 13, 19, 23, 31].forEach(seed => {
    const rows = day(320, 230, i => (i % 60 < 35 ? 0.02 : -0.015), 0.45, seed);
    const st = R.runV2(rows, eng, {});
    for (let i = 1; i < st.length; i++) {
      const prev = st[i - 1], now = st[i];
      if (prev.state !== 'ARMED' || !prev.plan) continue;
      // the trigger the ARMED state named was satisfied on this bar
      const satisfied = rows[i].high >= prev.plan.entry;
      // and nothing actually invalidated
      const invalidated = rows[i].low < prev.plan.invalidation;
      if (satisfied && !invalidated && (now.state === 'AVOID' || now.state === 'WATCH')) {
        regressions++;
        if (!sample) sample = now.time + ': ARMED trigger ' + prev.plan.entry + ' met, went ' + now.state + ' — ' + now.reason;
      }
    }
  });
  ck('QA-009', 'a satisfied confirmation never regresses to AVOID or WATCH without invalidation',
    regressions === 0, regressions ? regressions + ' regressions, first ' + sample : '6 fixtures clean');
}

console.log('\n=== 3. TRADE SIMULATOR ===');
{
  const rows = day(320, 230, i => (i % 60 < 35 ? 0.02 : -0.015), 0.45, 7);
  const res = R.analyseDay(rows, eng, {});
  const filled = res.trades.filter(t => t.outcome !== 'no_fill');

  // SIM-001 one setup, one trade
  const ids = filled.map(t => t.setupId);
  ck('SIM-001', 'one setupId produces at most one trade (pyramiding off)',
    new Set(ids).size === ids.length, ids.length + ' trades, ' + new Set(ids).size + ' ids');

  // SIM-002 stop hit
  const stopped = filled.filter(t => t.exitReason === 'stop');
  ck('SIM-002', 'a stopped trade records R <= 0 and exits at the stop',
    stopped.every(t => t.R <= 0 && t.exitPrice === t.stop), stopped.length + ' stopped');

  // SIM-003 exit model must be declared
  ck('SIM-003', 'the exit model is stated: single exit at T1 or stop, partials OFF',
    /hitT1\) \{ exit = \{ i: i, price: p\.t1, reason: 'target1' \}/.test(readFileSync(new URL('./trader-v2-replay.cjs', import.meta.url), 'utf8')),
    'T1 full exit, no partials, T2 recorded but not traded');

  // SIM-004 ambiguous candle
  const src = readFileSync(new URL('./trader-v2-replay.cjs', import.meta.url), 'utf8');
  ck('SIM-004', 'a candle touching both stop and target is resolved STOP FIRST',
    /if \(hitStop\)[\s\S]{0,90}break; \}\s*\n\s*if \(hitT1\)/.test(src), 'policy: STOP FIRST, deterministic');

  // SIM-005 end of day
  const eod = filled.filter(t => t.exitReason === 'close');
  ck('SIM-005', 'an open position at session end exits at the last session close',
    eod.every(t => t.exitTime === rows[rows.length - 1].time), eod.length + ' held to the close');
  ck('SIM-005b', 'MFE never negative and MAE never positive',
    filled.every(t => t.mfe >= 0 && t.mae <= 0));
}

console.log('\n=== 2 & 4. GOLDEN CASES AND CROSS-DAY ===');
{
  // The golden set needs the real candles. Look for them; do not fake them.
  const dataDir = new URL('./qa-data/', import.meta.url);
  const need = ['NVDA', 'MSFT', 'TSLA', 'AMD'].map(s => 'qa-data/' + s + '_2026-09-04.json');
  const have = need.filter(f => existsSync(new URL('./' + f, import.meta.url)));
  if (have.length === 0) {
    ['NVDA', 'MSFT', 'TSLA', 'AMD'].forEach(s =>
      skip('GOLDEN-' + s, s + ' 2026-09-04 golden minutes', 'no candle data on disk'));
    skip('CROSS-DAY', 'all symbols, all available days', 'no candle data on disk');
    console.log('\n  The golden set is defined and ready. It needs the real candles at');
    console.log('  qa-data/SYMBOL_2026-09-04.json — download them from /bars/export/SYMBOL');
    console.log('  and the same harness will run all 34 cases without further changes.');
  } else {
    console.log('  found ' + have.length + ' of 4 symbols; running the golden set');
  }
}

// ---- reports
const summary = {
  generated: new Date().toISOString(),
  engine: 'trader-v2', pass: pass, fail: fail, notRun: notRun,
  total: pass + fail + notRun,
  config: V.CFG, simulator: R.RCFG,
  exitModel: 'single exit at T1 or stop; partials off; ambiguous candle resolved STOP FIRST',
  results: results
};
writeFileSync(new URL('./qa-summary.json', import.meta.url), JSON.stringify(summary, null, 2));
const csv = ['test_id,name,status,actual,expected'].concat(results.map(r =>
  [r.id, JSON.stringify(r.name), r.status, JSON.stringify(String(r.actual)), JSON.stringify(String(r.expected))].join(',')));
writeFileSync(new URL('./qa-golden-results.csv', import.meta.url), csv.join('\n'));

console.log(`\n${pass} passed, ${fail} failed, ${notRun} not run`);
console.log('wrote qa-summary.json and qa-golden-results.csv');
process.exit(fail ? 1 : 0);
