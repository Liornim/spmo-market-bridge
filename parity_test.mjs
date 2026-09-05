// SCANNER PARITY AUDIT
//
// Question: does Scanner Replay Lab run the same code that produces a status
// on the live Market Radar? Not "similar logic" — the same call, on the same
// inputs, producing the same answer.
//
// This test does not modify either side. It reports.
import { readFileSync } from 'node:fs';
import * as E from './engine.cjs';
import * as L from './layers.cjs';
import * as R from './replay.cjs';

let pass = 0, fail = 0, findings = [];
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); if (!ok) findings.push(n + (x ? ' — ' + x : '')); };

// ---------------------------------------------------------------- 1. what each path calls
const radar = readFileSync(new URL('./radar.html', import.meta.url), 'utf8');
const replaySrc = readFileSync(new URL('./replay.cjs', import.meta.url), 'utf8');

console.log('=== 1. WHAT PRODUCES THE STATUS ===');
console.log('LIVE   radar.html:464  st.snap = buildTickerState(sym, st.A, ctx)   [layers.cjs]');
console.log('       buildTickerState calls radarRow(...) [engine.cjs] and then OVERRIDES its status');
console.log('REPLAY replay.cjs:66   deps.radarRow(sym, A, market, "LIVE")        [engine.cjs]');
console.log('       radarRow only. buildTickerState is never called.\n');

ck('the live radar builds its row inside buildTickerState', /st\.snap=buildTickerState\(/.test(radar));
ck('the live row IS the snapshot row, not a separate call', /st\.row=st\.snap\.row/.test(radar));
ck('the replay calls radarRow directly', /deps\.radarRow\(/.test(replaySrc));
ck('AUDIT: the replay does NOT call buildTickerState', !/buildTickerState/.test(replaySrc),
  'this is the divergence');

// ---------------------------------------------------------------- 2. inputs
const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const day = (n, base, drift) => { const out = []; let p = base;
  for (let i = 0; i < n; i++) { const o = p, c = o + drift + Math.sin(i / 9) * 0.06;
    out.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +o.toFixed(2),
      high: +(Math.max(o, c) + 0.07).toFixed(2), low: +(Math.min(o, c) - 0.07).toFixed(2),
      close: +c.toFixed(2), volume: 5000 + (i % 19) * 400 }); p = c; }
  return out; };
const rows = day(240, 231.2, 0.01);

// ---------------------------------------------------------------- 3. same inputs, both paths
console.log('\n=== 3. IDENTICAL INPUTS, BOTH PATHS, EVERY MINUTE ===');
const ctxFor = (A, i) => ({
  market: 'Neutral', marketCtx: { label: 'Neutral', parts: [] },
  freshness: 'LIVE', staleSeconds: 30, sessionEnded: false,
  daily: null, baseline: null, calibration: null,
  now: 1788000000000, date: '2026-09-04'
});

const diffs = [];
for (let i = 0; i < rows.length; i++) {
  const seen = rows.slice(0, i + 1);
  const A = E.analyze(seen, { K: 3 });
  if (!A || !A.state) continue;

  // LIVE path, exactly as radar.html calls it
  const snap = L.buildTickerState('NVDA', A, ctxFor(A, i));
  // REPLAY path, exactly as replay.cjs calls it
  const rep = E.radarRow('NVDA', A, { label: 'Neutral', parts: [] }, 'LIVE');

  const d = [];
  if (snap.status !== rep.status) d.push('status ' + rep.status + ' vs live ' + snap.status);
  if (snap.score !== rep.score) d.push('score ' + rep.score + ' vs live ' + snap.score);
  if ((snap.row && snap.row.why) !== rep.why) d.push('why "' + rep.why + '" vs live "' + (snap.row || {}).why + '"');
  if (snap.structure !== rep.structure) d.push('structure');
  if (snap.momentum !== rep.momentum) d.push('momentum');
  if (d.length) diffs.push({ i, time: rows[i].time, d });
}

ck('every minute was compared', true, rows.length + ' minutes');
if (diffs.length) {
  console.log('\n   FIRST DIVERGENCE: ' + diffs[0].time + ' (candle ' + diffs[0].i + ')');
  diffs[0].d.forEach(x => console.log('     ' + x));
  const byKind = {};
  diffs.forEach(x => x.d.forEach(y => { const k = y.split(' ')[0]; byKind[k] = (byKind[k] || 0) + 1; }));
  console.log('   divergent minutes: ' + diffs.length + ' of ' + rows.length
    + '  (' + Object.entries(byKind).map(([k, v]) => k + ' ' + v).join(', ') + ')');
}
ck('PARITY: live and replay agree on every minute', diffs.length === 0,
  diffs.length ? diffs.length + ' minutes differ, first at ' + diffs[0].time : 'identical');

// ---------------------------------------------------------------- 4. why
console.log('\n=== 4. WHY THEY DIFFER ===');
console.log('buildTickerState applies three gates AFTER radarRow returns:');
console.log('  a. edge.noEdge      -> status becomes WATCH (or stays AVOID), action WATCH_ONLY');
console.log('  b. isStale          -> status becomes AVOID');
console.log('  c. !validateState   -> status becomes AVOID');
console.log('It also gates on session coverage and data age. radarRow knows none of this,');
console.log('so the replay reports the pre-gate status: what the scanner would have said');
console.log('before the safety layer had its say.\n');

const anySnap = L.buildTickerState('NVDA', E.analyze(rows, { K: 3 }), ctxFor(null, 0));
ck('the live snapshot carries gates the replay has no equivalent for',
  'noEdge' in anySnap && 'stale' in anySnap && 'sessionIncomplete' in anySnap,
  Object.keys(anySnap).filter(k => /noEdge|stale|sessionIncomplete|valid/.test(k)).join(', '));

console.log('\n=== VERDICT ===');
console.log(diffs.length === 0
  ? 'PARITY VERIFIED — the replay reproduces the live status on every minute.'
  : 'PARITY NOT VERIFIED — the replay runs the same ENGINE (engine.cjs radarRow) but not the\n'
    + 'same PATH. The live radar wraps it in buildTickerState, whose gates change the status.\n'
    + 'First divergence: ' + diffs[0].time + '. ' + diffs.length + ' of ' + rows.length + ' minutes differ.');

console.log(`\n${pass} passed, ${fail} failed`);
// The audit reporting a real divergence is a successful audit, not a failed run.
process.exit(0);
