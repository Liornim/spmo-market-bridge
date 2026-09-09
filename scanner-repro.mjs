// PHASE 1 REPRODUCTION — run production v190 over each fixture minute by
// minute, exactly as the Scanner Replay does, and record every state.
// READS production. CHANGES NOTHING.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./engine.cjs'), L = require('./layers.cjs');
const SYMS = process.argv.slice(2).length ? process.argv.slice(2) : ['NVDA', 'AAPL', 'GOOGL'];
const out = {};
for (const sym of SYMS) {
  const rows = readFileSync(`fixtures/scanner/2026-09-08/${sym}.csv`, 'utf8').split('\n').filter(Boolean).slice(1)
    .map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; })
    .filter(r => r.time <= '15:59');
  const tl = [];
  for (let i = 15; i < rows.length; i++) {
    const prefix = rows.slice(0, i + 1);
    const A = E.analyze(prefix, { symbol: sym });
    const plan = E.executionPlan(A, null);
    const ts = L.buildTickerState(sym, A, {});
    // the real field names: status is the state word, plan carries its own
    tl.push({ i, time: rows[i].time, close: rows[i].close,
      ts_state: ts && ts.status, ts_score: ts && ts.score, ts_action: ts && ts.action,
      ts_actionText: ts && ts.actionText,
      plan_state: plan && plan.state, plan_score: plan && plan.score, plan_setup: plan && plan.setup,
      ts_plan_state: ts && ts.plan && ts.plan.state, ts_plan_score: ts && ts.plan && ts.plan.score,
      whatNow: (ts && ts.whatNow) || '', noEdge: ts && ts.noEdge,
      setupId: (ts && ts.plan && ts.plan.id) || null });
  }
  out[sym] = tl;
  const ready = tl.filter(x => /READY|ENTRY/.test(String(x.ts_state)+' '+String(x.ts_action)));
  const readyZero = ready.filter(x => !x.ts_score);
  const avoid = tl.filter(x => /AVOID/.test(String(x.ts_state)+' '+String(x.ts_action)));
  const avoidFail = avoid.filter(x => /fail|נכשל|בוטל|CANCELLED/i.test(String(x.ts_actionText)+' '+String(x.whatNow)+' '+String(x.ts_plan_state)));
  let f2r1 = 0, f2r2 = 0;
  for (let k = 1; k < tl.length; k++) { if (/FAIL|AVOID/.test(String(tl[k - 1].ts_state)) && /READY/.test(String(tl[k].ts_state))) f2r1++;
    if (k > 1 && /FAIL|AVOID/.test(String(tl[k - 2].ts_state)) && /READY/.test(String(tl[k].ts_state))) f2r2++; }
  const trans = tl.filter((x, k) => k === 0 || x.ts_state !== tl[k - 1].ts_state).length;
  console.log(`${sym.padEnd(6)} bars ${tl.length}  transitions ${trans}  READY ${ready.length}  READY-score-0 ${readyZero.length}  AVOID ${avoid.length}  AVOID-"failed" ${avoidFail.length}  FAILED→READY 1bar ${f2r1} 2bar ${f2r2}  setupId ${tl.some(x => x.setupId) ? 'present' : 'ABSENT'}`);
  if (readyZero.length) console.log('        READY score 0 at: ' + readyZero.slice(0, 10).map(x => x.time).join(' '));
  if (avoidFail.length) console.log('        AVOID "failed" at: ' + avoidFail.slice(0, 10).map(x => x.time).join(' '));
}
writeFileSync('scanner-repro-timeline.json', JSON.stringify(out));
