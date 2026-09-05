// ============================================================================
// SCANNER REPLAY — feed the EXISTING scanner historical candles, one minute at
// a time, and measure what happened next.
//
// The one property everything rests on: at minute i the scanner receives
// rows.slice(0, i + 1) and nothing else. It cannot see a candle that had not
// printed yet. analyze() looks one bar forward for its two-bar confirmations,
// so when the slice ends at i that lookahead simply finds nothing and reports
// `confirmed: null` — which is exactly what a live scanner would have had.
//
// Forward performance is measured from the FULL day. That is not a leak: it is
// the evaluation, not the decision. The two are kept apart by construction —
// replayStates() never sees the future, scoreAlert() never feeds the scanner.
// ============================================================================

// A state change worth recording, not one row per candle.
var TRACKED_STATES = ['QUIET', 'WATCH', 'CLOSE', 'READY', 'ACTIVE', 'AVOID', 'NO DATA'];

// Which transitions count as an alert — the moment the scanner said "this is
// worth attention". Everything else is recorded but not scored.
var ALERT_STATES = ['WATCH', 'CLOSE', 'READY', 'ACTIVE'];

var CONFIG = {
  // Below this, an alert produced no move worth having. Kept here so it can be
  // changed without touching the logic.
  falseAlertMaxUpPct: 0.30,
  falseAlertWindowMin: 30,
  windows: [5, 15, 30, 60],
  // The scanner needs some history before it can say anything; below this many
  // candles its state is not meaningful and is not recorded as a transition.
  warmupBars: 20
};

// ---------------------------------------------------------------- the replay
//
// rows: one day of 1-minute candles, chronological.
// deps: { analyze, radarRow, momentum, tactical } — the REAL engine, passed in
// rather than imported, so this file cannot quietly diverge from it.
function replayStates(rows, deps, opts) {
  var o = opts || {};
  var out = [], prev = null, prevA = null;
  var K = o.engine || { K: 3 };
  var market = o.market || { label: 'Neutral', parts: [] };
  var warm = o.warmupBars == null ? CONFIG.warmupBars : o.warmupBars;

  for (var i = 0; i < rows.length; i++) {
    // THE rule. Only what had printed by this minute.
    var seen = rows.slice(0, i + 1);
    if (seen.length < warm) continue;

    var A = deps.analyze(seen, K);
    if (!A || !A.state) continue;
    var row = deps.radarRow(o.symbol || '?', A, market, 'LIVE');
    var b = A.state.bar;

    var rec = {
      i: i, time: rows[i].time, price: rows[i].close,
      status: row.status, score: row.score, why: row.why,
      structure: row.structure, momentum: row.momentum,
      vwap: b.vwap, ema9: b.ema9, ema20: b.ema20,
      volume: rows[i].volume, volx: b.volx,
      aboveVwap: b.aboveVwap,
      planState: row.plan ? row.plan.state : null,
      // the engine's own events for this candle, as they were known then
      events: (A.state.events || []).map(function (e) {
        return e.type + (e.level != null ? '@' + e.level.toFixed(2) : '')
          + (e.confirmed === true ? '[confirmed]' : e.confirmed === false ? '[unconfirmed]' : '');
      })
    };
    out.push(rec);

    if (prev !== rec.status) {
      rec.transition = { from: prev, to: rec.status,
        reason: rec.why || (rec.events.length ? rec.events.join(' · ') : 'שינוי מצב') };
      prev = rec.status;
    }
    prevA = A;
  }
  return out;
}

// ---------------------------------------------------------------- forward look
//
// What the price did AFTER a given minute. Uses the whole day on purpose: this
// measures the alert, it does not inform it.
function scoreAlert(rows, atIndex, opts) {
  var o = opts || {};
  var windows = o.windows || CONFIG.windows;
  var entry = rows[atIndex];
  if (!entry) return null;
  var px = entry.close;
  var out = { index: atIndex, time: entry.time, price: px, windows: {}, };

  windows.forEach(function (m) {
    var end = Math.min(rows.length - 1, atIndex + m);
    var slice = rows.slice(atIndex + 1, end + 1);
    var last = slice.length ? slice[slice.length - 1] : null;
    var hi = slice.length ? Math.max.apply(null, slice.map(function (r) { return r.high; })) : null;
    var lo = slice.length ? Math.min.apply(null, slice.map(function (r) { return r.low; })) : null;
    out.windows[m] = {
      bars: slice.length,
      // A window that runs past the close is reported short rather than padded:
      // "+60m" on a 15:45 alert is 15 minutes, and saying otherwise would make
      // late alerts look better than they were.
      complete: slice.length === m,
      price: last ? last.close : null,
      returnPct: last ? (last.close - px) / px * 100 : null,
      maxUp: hi != null ? hi - px : null,
      maxUpPct: hi != null ? (hi - px) / px * 100 : null,
      maxDown: lo != null ? lo - px : null,
      maxDownPct: lo != null ? (lo - px) / px * 100 : null
    };
  });

  // Everything after the alert, to the close. "Remaining move" is the question
  // of whether the scanner woke up early enough to matter.
  var rest = rows.slice(atIndex + 1);
  var restHi = rest.length ? Math.max.apply(null, rest.map(function (r) { return r.high; })) : null;
  var restLo = rest.length ? Math.min.apply(null, rest.map(function (r) { return r.low; })) : null;
  out.toClose = {
    bars: rest.length,
    maxUp: restHi != null ? restHi - px : null,
    maxUpPct: restHi != null ? (restHi - px) / px * 100 : null,
    maxDown: restLo != null ? restLo - px : null,
    maxDownPct: restLo != null ? (restLo - px) / px * 100 : null,
    close: rest.length ? rest[rest.length - 1].close : null
  };
  out.remainingMove = out.toClose.maxUp;
  out.remainingMovePct = out.toClose.maxUpPct;

  // Weak by the configured rule, and the rule is named in the result so nobody
  // has to guess what "false" meant.
  var wm = o.falseAlertWindowMin || CONFIG.falseAlertWindowMin;
  var w = out.windows[wm];
  var thr = o.falseAlertMaxUpPct == null ? CONFIG.falseAlertMaxUpPct : o.falseAlertMaxUpPct;
  // Three outcomes, not two. An alert fired ten minutes before the close has no
  // thirty-minute window at all, and calling that "not weak" credits it with a
  // result it never had the time to produce. It is UNMEASURED, and says so.
  out.measurable = !!(w && w.complete);
  out.weak = out.measurable ? w.maxUpPct < thr : null;
  out.verdict = !out.measurable ? 'unmeasured' : (out.weak ? 'weak' : 'ok');
  out.weakRule = 'Max Up within ' + wm + ' minutes below ' + thr + '%'
    + '; an alert with fewer than ' + wm + ' minutes left is unmeasured, not weak';
  return out;
}

// ---------------------------------------------------------------- one run
function runReplay(rows, deps, opts) {
  var o = opts || {};
  var states = replayStates(rows, deps, o);
  var transitions = states.filter(function (s) { return s.transition; });
  var alertStates = o.alertStates || ALERT_STATES;

  // An alert is a transition INTO an attention state from something quieter.
  var alerts = transitions.filter(function (s) {
    return alertStates.indexOf(s.transition.to) >= 0
      && alertStates.indexOf(s.transition.from) < 0;
  }).map(function (s) {
    var sc = scoreAlert(rows, s.i, o);
    sc.status = s.status; sc.from = s.transition.from; sc.reason = s.transition.reason;
    sc.score = s.score; sc.structure = s.structure; sc.momentum = s.momentum;
    return sc;
  });

  var pct = function (list, f) {
    var v = list.map(f).filter(function (x) { return x != null; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  };
  var best = alerts.slice().sort(function (a, b) {
    return (b.toClose.maxUpPct || -Infinity) - (a.toClose.maxUpPct || -Infinity);
  })[0] || null;
  // The earliest alert that led to a real move — the one that would actually
  // have been useful, as opposed to the one that scored best after the fact.
  var thr = o.falseAlertMaxUpPct == null ? CONFIG.falseAlertMaxUpPct : o.falseAlertMaxUpPct;
  var earliestUseful = alerts.filter(function (a) {
    return a.toClose.maxUpPct != null && a.toClose.maxUpPct >= thr;
  })[0] || null;

  return {
    symbol: o.symbol || null, date: rows.length ? rows[0].date : null,
    bars: rows.length, statesComputed: states.length,
    states: states, transitions: transitions, alerts: alerts,
    summary: {
      alerts: alerts.length,
      weak: alerts.filter(function (a) { return a.weak === true; }).length,
      unmeasured: alerts.filter(function (a) { return !a.measurable; }).length,
      measured: alerts.filter(function (a) { return a.measurable; }).length,
      best: best ? { time: best.time, price: best.price, maxUpPct: best.toClose.maxUpPct } : null,
      earliestUseful: earliestUseful
        ? { time: earliestUseful.time, price: earliestUseful.price,
            remainingMovePct: earliestUseful.remainingMovePct } : null,
      avgMaxUpPct: pct(alerts, function (a) { return a.toClose.maxUpPct; }),
      avgMaxDownPct: pct(alerts, function (a) { return a.toClose.maxDownPct; }),
      avgRemainingPct: pct(alerts, function (a) { return a.remainingMovePct; }),
      weakRule: 'Max Up within ' + (o.falseAlertWindowMin || CONFIG.falseAlertWindowMin)
        + ' minutes below ' + thr + '%; alerts too close to the bell are unmeasured'
    },
    config: { falseAlertMaxUpPct: thr,
      falseAlertWindowMin: o.falseAlertWindowMin || CONFIG.falseAlertWindowMin,
      windows: o.windows || CONFIG.windows,
      warmupBars: o.warmupBars == null ? CONFIG.warmupBars : o.warmupBars,
      alertStates: alertStates }
  };
}

if (typeof module !== 'undefined') module.exports = {
  replayStates: replayStates, scoreAlert: scoreAlert, runReplay: runReplay,
  CONFIG: CONFIG, ALERT_STATES: ALERT_STATES, TRACKED_STATES: TRACKED_STATES
};
