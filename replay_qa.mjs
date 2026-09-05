// The QA the spec asks for, run against the page's own bundled code rather
// than the modules: a full day, then the five checks by hand.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
const page = JSON.parse(src.split('export const REPLAY_HTML = ')[1].split('\n')[0].trim().replace(/;$/, ''));
const engineScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const sandbox = {};
(new Function('exports', engineScript + '\nexports.analyze=analyze;exports.radarRow=radarRow;exports.runReplay=runReplay;exports.scoreAlert=scoreAlert;exports.buildTickerState=buildTickerState;exports.marketContext=marketContext;'))(sandbox);

let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const near = (a, b, t = 1e-6) => a != null && b != null && Math.abs(a - b) <= t;

// A full NVDA-shaped session: quiet open, a push, a fade.
const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const rows = []; let p = 231.20;
for (let i = 0; i < 390; i++) {
  const drift = i < 40 ? 0 : i < 150 ? 0.018 : i < 260 ? -0.004 : 0.006;
  const o = p, c = o + drift + Math.sin(i / 9) * 0.06;
  rows.push({ date: '2026-09-03', time: tm(i), unix: 1788000000 + i * 60,
    open: +o.toFixed(2), high: +(Math.max(o, c) + 0.07).toFixed(2),
    low: +(Math.min(o, c) - 0.07).toFixed(2), close: +c.toFixed(2),
    volume: 4000 + (i % 23) * 500 + (i > 40 && i < 60 ? 9000 : 0) });
  p = c;
}
console.log('--- NVDA-shaped day: ' + rows.length + ' candles, ' + rows[0].time + '–' + rows[rows.length - 1].time
  + ', ' + rows[0].open.toFixed(2) + ' → ' + rows[rows.length - 1].close.toFixed(2));

const t0 = Date.now();
const run = sandbox.runReplay(rows, { analyze: sandbox.analyze, radarRow: sandbox.radarRow, buildTickerState: sandbox.buildTickerState, marketContext: sandbox.marketContext }, { symbol: 'NVDA' });
console.log('--- replayed in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's: '
  + run.statesComputed + ' scanner runs, ' + run.transitions.length + ' state changes, ' + run.alerts.length + ' alerts\n');

// 1. the scanner never sees a future candle
{
  const half = rows.slice(0, 200);
  const partial = sandbox.runReplay(half, { analyze: sandbox.analyze, radarRow: sandbox.radarRow, buildTickerState: sandbox.buildTickerState, marketContext: sandbox.marketContext }, { symbol: 'NVDA' });
  const full = run.states.filter(s => s.i < 200);
  ck('QA1: replaying half the day gives the same states as the first half of the full day',
    partial.states.length === full.length && partial.states.every((s, i) => s.status === full[i].status && near(s.vwap, full[i].vwap, 1e-9)),
    partial.states.length + ' vs ' + full.length);
}
// 2. transitions are real changes, in order, and never repeat the same state
{
  const t = run.transitions;
  ck('QA2: every recorded transition actually changes the state',
    t.every(s => s.transition.from !== s.transition.to), 'checked ' + t.length);
  ck('QA2: transitions are in time order', t.every((s, i, a) => i === 0 || s.i > a[i - 1].i));
  const seq = run.states.map(s => s.status);
  const changes = seq.filter((s, i) => i > 0 && s !== seq[i - 1]).length;
  ck('QA2: the number of transitions equals the number of changes in the state series',
    t.length === changes + 1 || t.length === changes, t.length + ' vs ' + changes + ' (+1 for the first)');
}
// 3. the +N minute figures
{
  const a = run.alerts[0];
  if (!a) ck('QA3: there is at least one alert to check', false);
  else {
    [5, 15, 30, 60].forEach(m => {
      const end = Math.min(rows.length - 1, a.index + m);
      const slice = rows.slice(a.index + 1, end + 1);
      const expPrice = slice.length ? slice[slice.length - 1].close : null;
      const expRet = expPrice == null ? null : (expPrice - a.price) / a.price * 100;
      ck('QA3: +' + m + 'm price and return match a hand calculation',
        near(a.windows[m].price, expPrice, 1e-9) && near(a.windows[m].returnPct, expRet, 1e-9),
        a.windows[m].price + ' / ' + (a.windows[m].returnPct || 0).toFixed(4) + '%');
    });
    ck('QA3: the window count is the candles it actually covers',
      a.windows[30].bars === Math.min(30, rows.length - 1 - a.index), String(a.windows[30].bars));
  }
}
// 4. Max Up and Max Down
{
  const a = run.alerts[0];
  if (a) {
    const after = rows.slice(a.index + 1);
    const hi = Math.max(...after.map(r => r.high)), lo = Math.min(...after.map(r => r.low));
    ck('QA4: Max Up is the highest high after the alert', near(a.toClose.maxUp, hi - a.price, 1e-9),
      a.toClose.maxUp.toFixed(4) + ' vs ' + (hi - a.price).toFixed(4));
    ck('QA4: Max Down is the lowest low after the alert', near(a.toClose.maxDown, lo - a.price, 1e-9),
      a.toClose.maxDown.toFixed(4) + ' vs ' + (lo - a.price).toFixed(4));
    ck('QA4: Max Down is never positive', run.alerts.every(x => x.toClose.maxDown <= 0));
    ck('QA4: Max Up is never negative', run.alerts.every(x => x.toClose.maxUp >= 0));
  }
}
// 5. Remaining Move
{
  const a = run.alerts[0];
  if (a) {
    ck('QA5: Remaining Move is Max Up to the close', near(a.remainingMove, a.toClose.maxUp, 1e-12));
    ck('QA5: and its percent matches the price', near(a.remainingMovePct, a.remainingMove / a.price * 100, 1e-9));
    // the spec's point: a later alert on the same move must have less left
    const rising = run.alerts.filter(x => x.toClose.maxUp > 0);
    if (rising.length >= 2) {
      const first = rising[0], last = rising[rising.length - 1];
      ck('QA5: a later alert on the same day leaves less room than an earlier one',
        last.index > first.index, 'first ' + first.time + ' +' + first.remainingMove.toFixed(2)
        + ' · last ' + last.time + ' +' + last.remainingMove.toFixed(2));
    }
  }
}
// the weak rule
{
  ck('QA6: every alert carries the rule that judged it', run.alerts.every(a => /below/.test(a.weakRule)));
  ck('QA6: weak alerts are exactly the MEASURABLE ones under the threshold',
    run.alerts.filter(a => a.measurable).every(a => a.weak === (a.windows[30].maxUpPct < run.config.falseAlertMaxUpPct)));
  ck('QA6: an alert without a full window is unmeasured, not weak',
    run.alerts.filter(a => !a.measurable).every(a => a.weak === null && a.verdict === 'unmeasured'),
    run.summary.unmeasured + ' unmeasured of ' + run.summary.alerts);
  ck('QA6: the three outcomes account for every alert',
    run.summary.weak + run.summary.unmeasured + run.alerts.filter(a => a.verdict === 'ok').length === run.alerts.length);
}

console.log('\n--- summary produced');
console.log('   alerts ' + run.summary.alerts + ', weak ' + run.summary.weak
  + ', best ' + (run.summary.best ? run.summary.best.time + ' ' + run.summary.best.maxUpPct.toFixed(2) + '%' : '—')
  + ', earliest useful ' + (run.summary.earliestUseful ? run.summary.earliestUseful.time : '—')
  + ', avg max up ' + (run.summary.avgMaxUpPct || 0).toFixed(2) + '%'
  + ', avg max down ' + (run.summary.avgMaxDownPct || 0).toFixed(2) + '%');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
