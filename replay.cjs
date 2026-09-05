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
  // ZERO, and deliberately so.
  //
  // I had this at 20 and it was my invention, not the scanner's: nothing in
  // engine.cjs, layers.cjs or the radar withholds a verdict until N candles
  // have printed. radarRow answers from the first bar. So a warm-up here hid
  // real scanner behaviour — and on a day whose move happens before 09:50 it
  // hid the part that matters most.
  //
  // Nor is prior-session data preloaded, for the same reason: the live scanner
  // does NOT have it. sessionRows() filters the store to one date, VWAP
  // accumulates from the day's first bar, and EMA9/EMA20 are seeded at the
  // first close. Feeding yesterday's candles in would make the replay measure
  // something the live scanner never sees, which is the opposite of the point.
  // The first candles are genuinely thin — that is a fact about the scanner,
  // and it should be visible rather than hidden.
  warmupBars: 0
};

// ---------------------------------------------------------------- the replay
//
// rows: one day of 1-minute candles, chronological.
// deps: { analyze, radarRow, momentum, tactical } — the REAL engine, passed in
// rather than imported, so this file cannot quietly diverge from it.
// Which inputs a run actually had, so the page can never imply more than it had.
// Four states, exactly as specified: REAL HISTORICAL, RECONSTRUCTED, SIMULATED,
// MISSING. Filled by the caller from what it could supply.
function inputLedger(o) {
  var has = function (v) { return v != null && !(Array.isArray(v) && !v.length); };
  return [
    { key: 'symbol candles', state: 'REAL HISTORICAL', note: 'the stored 1-minute bars for the day' },
    { key: 'current candle / time', state: 'REAL HISTORICAL', note: 'the bar being replayed' },
    { key: 'VWAP', state: 'REAL HISTORICAL', note: 'computed inside analyze() from those bars' },
    { key: 'EMA9', state: 'REAL HISTORICAL', note: 'computed inside analyze()' },
    { key: 'EMA20', state: 'REAL HISTORICAL', note: 'computed inside analyze()' },
    { key: 'volume', state: 'REAL HISTORICAL', note: 'from the stored bars' },
    { key: 'relative volume', state: 'REAL HISTORICAL', note: 'computed inside analyze()' },
    { key: 'time-of-day volume baseline', state: has(o.baseline) ? 'RECONSTRUCTED' : 'MISSING',
      note: has(o.baseline) ? 'volumeBaseline() over prior stored sessions' : 'no prior sessions supplied' },
    { key: 'multi-day context', state: has(o.daily) ? 'RECONSTRUCTED' : 'MISSING',
      note: has(o.daily) ? 'dailyContext() over prior stored sessions' : 'no prior sessions supplied' },
    { key: 'historical calibration', state: has(o.calibration) ? 'RECONSTRUCTED' : 'MISSING',
      note: has(o.calibration) ? 'calibrate() over prior sessions' : 'not supplied' },
    { key: 'SPY candles', state: has(o.benchRows && o.benchRows.SPY) ? 'REAL HISTORICAL' : 'MISSING',
      note: has(o.benchRows && o.benchRows.SPY) ? 'same day, sliced to the same minute' : 'not supplied' },
    { key: 'QQQ candles', state: has(o.benchRows && o.benchRows.QQQ) ? 'REAL HISTORICAL' : 'MISSING',
      note: has(o.benchRows && o.benchRows.QQQ) ? 'same day, sliced to the same minute' : 'not supplied' },
    { key: 'market context', state: has(o.benchRows) ? 'RECONSTRUCTED' : 'SIMULATED',
      note: has(o.benchRows) ? 'marketContext() over benchmarks as of this minute' : 'fixed Neutral' },
    { key: 'cross-symbol context', state: has(o.benchRows && o.benchRows[o.sectorEtf]) ? 'REAL HISTORICAL'
        : (o.sectorEtf ? 'MISSING' : 'REAL HISTORICAL'),
      note: o.sectorEtf ? ('sector ETF ' + o.sectorEtf) : 'this symbol has no sector ETF mapping' },
    { key: 'freshness / stale state', state: o.freshnessMode === 'derived' ? 'RECONSTRUCTED' : 'SIMULATED',
      note: o.freshnessMode === 'derived' ? 'derived from the bar being replayed: it had just closed' : 'fixed LIVE' },
    { key: 'session state', state: 'RECONSTRUCTED', note: 'from the bar time within the session' },
    { key: 'end-of-session state', state: 'RECONSTRUCTED', note: 'true only on the last bar of the day' },
    { key: 'configuration / thresholds', state: 'REAL HISTORICAL', note: 'engine defaults, unchanged' },
    { key: 'cached / previous scanner state', state: 'REAL HISTORICAL',
      note: 'buildTickerState is stateless per call; live keeps none either' },
    // Verified against the function body: buildTickerState reads exactly eleven
    // ctx keys — baseline, calibration, daily, date, freshness, market,
    // marketCtx, now, nowUnix, sessionEnded, staleSeconds. The order book and
    // position are read by analysisPack, which is a different surface. Marking
    // them as gaps here would block COMPLETE over inputs the scanner never
    // consults, which is its own kind of dishonesty.
    { key: 'order book / Level 2', state: 'NOT CONSUMED',
      note: 'buildTickerState does not read c.book; it belongs to the analysis pack' },
    { key: 'position', state: 'NOT CONSUMED',
      note: 'buildTickerState does not read c.position; the system tracks no positions at all' }
  ];
}

function replayStates(rows, deps, opts) {
  var o = opts || {};
  var out = [], prev = null, prevA = null;
  var K = o.engine || { K: 3 };
  var warm = o.warmupBars == null ? CONFIG.warmupBars : o.warmupBars;
  var sym = o.symbol || '?';
  var lastTime = rows.length ? rows[rows.length - 1].time : null;

  for (var i = 0; i < rows.length; i++) {
    // THE rule. Only what had printed by this minute.
    var seen = rows.slice(0, i + 1);
    if (seen.length < warm) continue;

    var A = deps.analyze(seen, K);
    if (!A || !A.state) continue;

    // --- context, reconstructed AS OF THIS MINUTE and never later.
    // Benchmarks are sliced to the same minute, so a market regime computed
    // here cannot contain a candle the live radar would not have had.
    var mkCtx = { label: 'Neutral', parts: [] };
    if (o.benchRows && deps.marketContext) {
      var list = [];
      Object.keys(o.benchRows).forEach(function (bs) {
        var br = o.benchRows[bs];
        if (!br || !br.length) return;
        // same rule as the symbol: only bars up to this minute
        var upto = br.filter(function (x) { return x.time <= rows[i].time; });
        if (!upto.length) return;
        var bA = deps.analyze(upto, K);
        if (bA) { bA.symbol = bs; list.push(bA); }
      });
      if (list.length) mkCtx = deps.marketContext(list);
    }

    var ctx = {
      market: mkCtx.label, marketCtx: mkCtx,
      // The bar being replayed had just closed, so at that instant the feed was
      // as fresh as it ever gets. Anything else would be inventing a delay.
      freshness: o.freshness || 'LIVE',
      staleSeconds: o.staleSeconds == null ? 30 : o.staleSeconds,
      sessionEnded: !!o.sessionEnded || rows[i].time === lastTime && !!o.markLastBarClosed,
      daily: o.daily || null, baseline: o.baseline || null, calibration: o.calibration || null,
      now: (rows[i].unix || 0) * 1000, date: rows[i].date
    };

    // THE live path. Same function the radar calls, not a copy of its rules.
    var snap = deps.buildTickerState(sym, A, ctx);
    var row = snap.row || {};
    var b = A.state.bar;

    var rec = {
      i: i, time: rows[i].time, price: rows[i].close,
      // Everything below comes from the SNAPSHOT — the object the radar renders
      // — so the replay cannot show a status the radar would have overridden.
      status: snap.status, score: snap.score, why: row.why,
      action: snap.action, actionText: snap.actionText,
      noEdge: !!snap.noEdge, stale: !!snap.stale,
      sessionIncomplete: !!snap.sessionIncomplete,
      valid: snap.valid !== false,
      violations: (snap.violations || []).map(function (v) { return v.code; }),
      levels: snap.levels ? { watch: snap.levels.watch, entry: snap.levels.entry,
        target1: snap.levels.target1, target2: snap.levels.target2,
        tacticalInvalidation: snap.levels.tacticalInvalidation, hardStop: snap.levels.hardStop } : null,
      marketLabel: mkCtx.label,
      structure: snap.structure, momentum: snap.momentum,
      vwap: b.vwap, ema9: b.ema9, ema20: b.ema20,
      volume: rows[i].volume, volx: b.volx,
      aboveVwap: b.aboveVwap,
      planState: snap.plan ? snap.plan.state : null,
      // the engine's own events for this candle, as they were known then
      events: (A.state.events || []).map(function (e) {
        return e.type + (e.level != null ? '@' + e.level.toFixed(2) : '')
          + (e.confirmed === true ? '[confirmed]' : e.confirmed === false ? '[unconfirmed]' : '');
      })
    };
    out.push(rec);

    if (prev !== rec.status) {
      rec.transition = { from: prev, to: rec.status,
        first: prev === null,
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

  var ledger = inputLedger(o);
  // NOT CONSUMED is not a gap: an input the scanner never reads cannot make the
  // replay differ from the radar.
  var incomplete = ledger.filter(function (x) { return x.state === 'MISSING' || x.state === 'SIMULATED'; });
  return {
    // A run says what it had. "HISTORICAL PARITY INCOMPLETE" is not a warning
    // to be dismissed: any essential input missing means the numbers describe a
    // scanner running on less than the radar had.
    ledger: ledger, inputsComplete: incomplete.length === 0,
    inputsIncomplete: incomplete.map(function (x) { return x.key + ' (' + x.state + ')'; }),
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
  replayStates: replayStates, scoreAlert: scoreAlert, runReplay: runReplay, inputLedger: inputLedger,
  CONFIG: CONFIG, ALERT_STATES: ALERT_STATES, TRACKED_STATES: TRACKED_STATES
};
