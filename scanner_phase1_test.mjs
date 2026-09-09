// PHASE 1 REGRESSION TESTS. These document reproduced defects; they are
// expected to FAIL until Phase 2 fixes them. They read production only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./engine.cjs'), L = require('./layers.cjs');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const load = s => readFileSync(`fixtures/scanner/2026-09-08/${s}.csv`, 'utf8').split('\n').filter(Boolean).slice(1)
  .map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; })
  .filter(r => r.time <= '15:59');
const at = (sym, t) => { const rows = load(sym); const i = rows.findIndex(r => r.time === t);
  const A = E.analyze(rows.slice(0, i + 1), { symbol: sym });
  return { A, plan: E.executionPlan(A, null), ts: L.buildTickerState(sym, A, {}) }; };

// READY-SCORE-DISPLAY-PARITY-001
// The score shown beside a decision must be the score that decision was made
// from. Today status comes from plan.state and score comes from
// bottomLine.confidence — two unrelated computations — so READY can be shown
// beside a 0 that had no part in producing it.
{
  let mismatches = 0, sample = '';
  ['NVDA', 'AAPL', 'GOOGL'].forEach(sym => {
    const rows = load(sym);
    for (let i = 15; i < rows.length; i++) {
      const A = E.analyze(rows.slice(0, i + 1), { symbol: sym });
      const ts = L.buildTickerState(sym, A, {});
      if (ts.status === 'READY' && !ts.score) { mismatches++; if (!sample) sample = sym + ' ' + rows[i].time; }
    }
  });
  ck('READY-SCORE-DISPLAY-PARITY-001: a READY decision is never displayed with a score of 0',
    mismatches === 0, mismatches + ' occurrences, e.g. ' + sample);
}
// FAILED-PRESENTATION-001
// A local setup ending must not be presented as a symbol-level AVOID unless
// the symbol independently warrants it.
{
  let bad = 0, sample = '';
  ['NVDA', 'AAPL', 'GOOGL'].forEach(sym => {
    const rows = load(sym);
    for (let i = 15; i < rows.length; i++) {
      const A = E.analyze(rows.slice(0, i + 1), { symbol: sym });
      const plan = E.executionPlan(A, null), ts = L.buildTickerState(sym, A, {});
      const S = A.states[A.states.length - 1];
      // symbol-level warrant: a declared downtrend. Absent that, a failed
      // setup is a setup event, not a verdict on the symbol.
      if (ts.status === 'AVOID' && plan && plan.state === 'FAILED' && S.announced !== 'DOWN') {
        bad++; if (!sample) sample = sym + ' ' + rows[i].time;
      }
    }
  });
  ck('FAILED-PRESENTATION-001: a failed setup alone never renders the symbol as AVOID',
    bad === 0, bad + ' occurrences, e.g. ' + sample);
}
console.log(`\n${pass} passed, ${fail} failed  (failures are the reproduced Phase 1 defects)`);
