// The replay is only worth anything if the scanner cannot see the future.
// These test that property directly, then the arithmetic of the metrics.
const R = require('./replay.cjs');
const E = require('./engine.cjs');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const near = (a, b, t = 1e-6) => a != null && b != null && Math.abs(a - b) <= t;

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function day(n, shape) {
  const rows = []; let p = 230;
  for (let i = 0; i < n; i++) {
    const drift = shape === 'up' ? 0.012 : shape === 'down' ? -0.012 : 0;
    const o = p, c = o + drift + Math.sin(i / 11) * 0.05;
    rows.push({ date: '2026-09-03', time: tm(i), unix: i * 60, open: +o.toFixed(2),
      high: +(Math.max(o, c) + 0.06).toFixed(2), low: +(Math.min(o, c) - 0.06).toFixed(2),
      close: +c.toFixed(2), volume: 5000 + (i % 17) * 400 });
    p = c;
  }
  return rows;
}
const deps = { analyze: E.analyze, radarRow: E.radarRow };

// ---- THE property: the future cannot change the past --------------------
{
  const base = day(200, 'up');
  // Same first 200 candles, then two completely different futures.
  const upFuture = base.concat(day(100, 'up').map((r, i) => Object.assign({}, r, { time: tm(200 + i), unix: (200 + i) * 60 })));
  const dnFuture = base.concat(day(100, 'down').map((r, i) => Object.assign({}, r, { time: tm(200 + i), unix: (200 + i) * 60 })));

  const a = R.replayStates(upFuture, deps, { symbol: 'T' }).filter(s => s.i < 200);
  const b = R.replayStates(dnFuture, deps, { symbol: 'T' }).filter(s => s.i < 200);
  ck('the same history is replayed the same number of times', a.length === b.length, a.length + ' vs ' + b.length);
  const diffs = a.filter((s, i) => s.status !== b[i].status || s.score !== b[i].score
    || !near(s.vwap, b[i].vwap, 1e-9) || !near(s.ema9, b[i].ema9, 1e-9));
  ck('NO state before minute 200 changes when the future changes', diffs.length === 0,
    diffs.length ? 'first at ' + diffs[0].time + ': ' + diffs[0].status + ' vs ' + b[a.indexOf(diffs[0])].status : 'identical');

  // and truncating the day must give the same answer as the prefix of the full day
  const truncated = R.replayStates(base, deps, { symbol: 'T' });
  const prefix = a;
  ck('replaying a truncated day equals the prefix of the full day',
    truncated.length === prefix.length
    && truncated.every((s, i) => s.status === prefix[i].status && s.time === prefix[i].time),
    truncated.length + ' vs ' + prefix.length);
}

// ---- the last candle can never be "confirmed" ---------------------------
{
  const rows = day(120, 'up');
  const states = R.replayStates(rows, deps, { symbol: 'T' });
  const confirmedOnLast = states.filter(s => s.i === rows.length - 1 && s.events.some(e => /\[confirmed\]/.test(e)));
  ck('the newest candle carries no two-bar confirmation', confirmedOnLast.length === 0,
    confirmedOnLast.length ? confirmedOnLast[0].events.join(',') : 'none');
}

// ---- forward metrics, checked against hand arithmetic -------------------
{
  // a flat day with one known spike and one known dip after minute 50
  const rows = [];
  for (let i = 0; i < 120; i++) rows.push({ date: '2026-09-03', time: tm(i), unix: i * 60,
    open: 100, high: 100, low: 100, close: 100, volume: 1000 });
  rows[55].high = 101;          // +1.00 at minute 55
  rows[70].low = 98;            // -2.00 at minute 70
  rows[60].close = 100.5;       // the close 10 minutes on

  const s = R.scoreAlert(rows, 50, {});
  ck('the alert price is the candle it fired on', s.price === 100);
  // Minute 55 IS five minutes after minute 50, so the +5m window must include
  // it. The boundary is inclusive at both ends of the window.
  ck('+5m includes the candle exactly five minutes later', near(s.windows[5].maxUp, 1), String(s.windows[5].maxUp));
  ck('the +5m window is exactly five candles', s.windows[5].bars === 5, String(s.windows[5].bars));
  const before = R.scoreAlert(rows, 49, {});
  ck('one minute earlier, the same spike is outside the +5m window',
    near(before.windows[5].maxUp, 0), String(before.windows[5].maxUp));
  ck('and inside the +15m one', near(before.windows[15].maxUp, 1), String(before.windows[15].maxUp));
  ck('+15m catches the spike five minutes later', near(s.windows[15].maxUp, 1), String(s.windows[15].maxUp));
  ck('+15m max up in percent', near(s.windows[15].maxUpPct, 1), String(s.windows[15].maxUpPct));
  ck('+15m does not yet see the later dip', near(s.windows[15].maxDown, 0), String(s.windows[15].maxDown));
  ck('+30m sees the dip', near(s.windows[30].maxDown, -2), String(s.windows[30].maxDown));
  ck('+15m return uses the close at that minute', near(s.windows[15].price, rows[65].close));
  ck('+10 minutes later the close is the one that moved', near(rows[60].close, 100.5));

  ck('remaining move to the close is the highest high after the alert', near(s.remainingMove, 1), String(s.remainingMove));
  ck('and in percent', near(s.remainingMovePct, 1), String(s.remainingMovePct));

  // a window that runs past the end is reported short, not padded
  const late = R.scoreAlert(rows, 100, {});
  ck('a 60-minute window near the close is marked incomplete', late.windows[60].complete === false,
    late.windows[60].bars + ' bars of 60');
  ck('and its bar count is the truth', late.windows[60].bars === 19, String(late.windows[60].bars));
}

// ---- the weak/false rule ------------------------------------------------
{
  const flat = [];
  for (let i = 0; i < 120; i++) flat.push({ date: '2026-09-03', time: tm(i), unix: i * 60,
    open: 100, high: 100.05, low: 99.95, close: 100, volume: 1000 });
  const s = R.scoreAlert(flat, 10, {});
  ck('a 0.05% move is weak at the default threshold', s.weak === true, s.windows[30].maxUpPct.toFixed(3) + '%');
  ck('the rule is stated in the result', /below 0\.3%/.test(s.weakRule), s.weakRule);
  const loose = R.scoreAlert(flat, 10, { falseAlertMaxUpPct: 0.01 });
  ck('the threshold is configurable', loose.weak === false, loose.weakRule);
}

// ---- a full run ---------------------------------------------------------
{
  const rows = day(390, 'up');
  const r = R.runReplay(rows, deps, { symbol: 'NVDA' });
  ck('every alert is a transition INTO an attention state',
    r.alerts.every(a => R.ALERT_STATES.indexOf(a.status) >= 0), r.alerts.map(a => a.status).join(','));
  ck('no alert repeats a state it was already in',
    r.alerts.every(a => R.ALERT_STATES.indexOf(a.from) < 0), r.alerts.map(a => a.from).join(','));
  ck('alerts are in time order', r.alerts.every((a, i, arr) => i === 0 || a.index > arr[i - 1].index));
  ck('the summary counts what the list contains', r.summary.alerts === r.alerts.length);
  ck('weak count matches the flags', r.summary.weak === r.alerts.filter(a => a.weak).length);
  if (r.alerts.length) {
    const best = r.alerts.reduce((m, a) => (a.toClose.maxUpPct > m.toClose.maxUpPct ? a : m));
    ck('best alert is the one with the largest move after it', r.summary.best.time === best.time,
      r.summary.best.time + ' vs ' + best.time);
    ck('earliest useful is not later than best',
      !r.summary.earliestUseful || r.summary.earliestUseful.time <= r.summary.best.time,
      (r.summary.earliestUseful || {}).time + ' vs ' + r.summary.best.time);
  }
  ck('the config used is reported with the run', r.config.falseAlertMaxUpPct === 0.3 && r.config.warmupBars === 20);
  ck('the states are kept for the chart', r.states.length > 300, r.states.length + ' states');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
