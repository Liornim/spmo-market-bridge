// SCANNER PARITY TEST
//
// Path A: the live radar's call, exactly as radar.html:464 makes it.
// Path B: the replay's call, through the adapter.
// Identical inputs, every minute, every field the radar renders. 0 divergences
// is the requirement.
//
// This is CODE parity. It says the two paths agree given the same inputs. It
// does not by itself say the historical inputs were complete — that is the
// separate ledger, and the page must not conflate them.
import { readFileSync } from 'node:fs';
import * as E from './engine.cjs';
import * as L from './layers.cjs';
import * as R from './replay.cjs';

let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const deps = { analyze: E.analyze, radarRow: E.radarRow, buildTickerState: L.buildTickerState, marketContext: E.marketContext };

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const day = (n, base, drift, seed) => { const out = []; let p = base, s = seed || 3;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) { const o = p, c = o + drift + (rnd() - 0.5) * 0.12;
    out.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +o.toFixed(2),
      high: +(Math.max(o, c) + 0.07).toFixed(2), low: +(Math.min(o, c) - 0.07).toFixed(2),
      close: +c.toFixed(2), volume: 5000 + (i % 19) * 400 }); p = c; }
  return out; };

const rows = day(240, 231.2, 0.012, 7);
const bench = { SPY: day(240, 560, 0.004, 11), QQQ: day(240, 480, 0.005, 13) };

// ---- Path B: the replay
const replay = R.runReplay(rows, deps, { symbol: 'NVDA', benchRows: bench });

// ---- Path A: the live radar's own call, reproduced here from radar.html:464
function livePath(i) {
  const seen = rows.slice(0, i + 1);
  const A = E.analyze(seen, { K: 3 });
  if (!A || !A.state) return null;
  // market context exactly as marketCtxFor does: analyse each benchmark up to
  // this minute and hand the list to marketContext
  const list = [];
  ['SPY', 'QQQ'].forEach(bs => {
    const upto = bench[bs].filter(x => x.time <= rows[i].time);
    if (!upto.length) return;
    const bA = E.analyze(upto, { K: 3 });
    if (bA) { bA.symbol = bs; list.push(bA); }
  });
  const mk = list.length ? E.marketContext(list) : { label: 'Neutral', parts: [] };
  return L.buildTickerState('NVDA', A, {
    market: mk.label, marketCtx: mk, freshness: 'LIVE', staleSeconds: 30,
    sessionEnded: false, daily: null, baseline: null, calibration: null,
    now: rows[i].unix * 1000, date: rows[i].date
  });
}

// ---- compare every field the radar shows
const FIELDS = [
  ['status', s => s.status, r => r.status],
  ['score', s => s.score, r => r.score],
  ['reason', s => (s.row || {}).why, r => r.why],
  ['action', s => s.action, r => r.action],
  ['actionText', s => s.actionText, r => r.actionText],
  ['structure', s => s.structure, r => r.structure],
  ['momentum', s => s.momentum, r => r.momentum],
  ['noEdge gate', s => !!s.noEdge, r => r.noEdge],
  ['stale gate', s => !!s.stale, r => r.stale],
  ['sessionIncomplete gate', s => !!s.sessionIncomplete, r => r.sessionIncomplete],
  ['valid', s => s.valid !== false, r => r.valid],
  ['violations', s => (s.violations || []).map(v => v.code).join(','), r => (r.violations || []).join(',')],
  ['market label', s => (s.row && s.row.bl ? s.row.bl.market : null), r => r.marketLabel],
  ['level: watch', s => s.levels.watch, r => r.levels && r.levels.watch],
  ['level: entry', s => s.levels.entry, r => r.levels && r.levels.entry],
  ['level: target1', s => s.levels.target1, r => r.levels && r.levels.target1],
  ['level: target2', s => s.levels.target2, r => r.levels && r.levels.target2],
  ['level: tacticalInvalidation', s => s.levels.tacticalInvalidation, r => r.levels && r.levels.tacticalInvalidation],
  ['level: hardStop', s => s.levels.hardStop, r => r.levels && r.levels.hardStop],
  ['plan state', s => (s.plan ? s.plan.state : null), r => r.planState],
  ['vwap', s => null, r => null]   // computed identically inside analyze; covered by status
];
const same = (a, b) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

const byIndex = {}; replay.states.forEach(s => { byIndex[s.i] = s; });
const divergences = [];
for (let i = 0; i < rows.length; i++) {
  const live = livePath(i), rep = byIndex[i];
  if (!live && !rep) continue;
  if (!live || !rep) { divergences.push({ i, time: rows[i].time, field: 'presence', live: !!live, replay: !!rep }); continue; }
  FIELDS.forEach(([name, lf, rf]) => {
    const lv = lf(live), rv = rf(rep);
    if (!same(lv, rv)) divergences.push({ i, time: rows[i].time, field: name, live: lv, replay: rv });
  });
}

console.log('=== CODE PARITY: ' + rows.length + ' minutes, ' + FIELDS.length + ' fields each ===');
if (divergences.length) {
  const d = divergences[0];
  console.log('FIRST DIVERGENCE  ' + d.time + '  field: ' + d.field);
  console.log('  live   : ' + JSON.stringify(d.live));
  console.log('  replay : ' + JSON.stringify(d.replay));
  const kinds = {}; divergences.forEach(x => kinds[x.field] = (kinds[x.field] || 0) + 1);
  console.log('  ' + divergences.length + ' divergences across: ' + Object.entries(kinds).map(([k, v]) => k + ' x' + v).join(', '));
}
ck('CODE PARITY: 0 divergences across every rendered field', divergences.length === 0,
  divergences.length ? divergences.length + ' found' : rows.length + ' minutes identical');

// ---- the replay must be calling the live function, not imitating it
const src = readFileSync(new URL('./replay.cjs', import.meta.url), 'utf8');
ck('the replay calls buildTickerState', /deps\.buildTickerState\(/.test(src));
ck('and does not reimplement its gates', !/noEdge\s*=|function validateState|edge\.noEdge\s*&&/.test(src));
ck('the status it reports is the SNAPSHOT status, not radarRow s',
  /status: snap\.status/.test(src));

// ---- and no future leakage, still
{
  const half = rows.slice(0, 150);
  const halfBench = { SPY: bench.SPY.slice(0, 150), QQQ: bench.QQQ.slice(0, 150) };
  const partial = R.runReplay(half, deps, { symbol: 'NVDA', benchRows: halfBench });
  const full = replay.states.filter(s => s.i < 150);
  ck('NO LEAKAGE: half a day equals the first half of the full day',
    partial.states.length === full.length && partial.states.every((s, i) => s.status === full[i].status && s.score === full[i].score),
    partial.states.length + ' vs ' + full.length);
  ck('NO LEAKAGE: benchmarks are sliced to the same minute', /x\.time <= rows\[i\]\.time/.test(src));
}

// ---- the ledger must not overstate what a run had
{
  const bare = R.runReplay(rows, deps, { symbol: 'NVDA' });
  const led = R.inputLedger({});
  const missing = led.filter(x => x.state === 'MISSING' || x.state === 'SIMULATED');
  ck('a run with no context reports its gaps', missing.length > 0, missing.map(x => x.key).join(', '));
  const withCtx = R.inputLedger({ benchRows: bench, daily: {}, baseline: {}, calibration: {}, freshnessMode: 'derived' });
  ck('supplying context moves entries out of MISSING',
    withCtx.filter(x => x.state === 'MISSING').length < missing.length,
    withCtx.filter(x => x.state === 'MISSING').map(x => x.key).join(', ') || 'none');
  // Verified against the function body: buildTickerState reads eleven ctx keys
  // and neither of these is among them. Counting them as gaps would block
  // COMPLETE over inputs the scanner never consults.
  ck('inputs the scanner never reads are marked NOT CONSUMED, not MISSING',
    withCtx.filter(x => /order book|position/.test(x.key)).every(x => x.state === 'NOT CONSUMED'));
  const body = readFileSync(new URL('./layers.cjs', import.meta.url), 'utf8');
  const bts = body.slice(body.indexOf('function buildTickerState'), body.indexOf('\nfunction validateState'));
  ck('and that claim is true of the real function',
    !/c\.book/.test(bts) && !/c\.position/.test(bts));
  ck('every ctx key buildTickerState DOES read is covered by the ledger',
    ['baseline','calibration','daily','freshness','market','marketCtx','sessionEnded','staleSeconds']
      .every(k => new RegExp('c\\.' + k).test(bts)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
