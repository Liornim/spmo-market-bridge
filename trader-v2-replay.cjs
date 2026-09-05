// ============================================================================
// TRADER V2 REPLAY — drives the V2 engine over stored candles and measures what
// its decisions were actually worth.
//
// Two layers, kept strictly apart:
//
//   DECISION   at minute T the engine sees bars[0..T] and nothing else.
//   EVALUATION runs afterwards over the whole day and may look forward freely.
//
// They never touch. runV2() produces decisions; simulate() and missedMoves()
// consume the finished day. A forward number can therefore never reach a
// decision, which is the one property that makes any of this meaningful.
// ============================================================================

var RCFG = {
  missedMovePct: 0.5,      // a move worth having, in percent
  missedWindowMin: 30,     // within this many minutes
  missedMaxAdversePct: 0.4,// having first risked no more than this
  entrySlipATR: 0.05,      // fill above the trigger
  maxHoldBars: 90          // an open trade is closed out at this age
};

// ---------------------------------------------------------------- the replay
function runV2(rows, engine, opts) {
  var o = opts || {};
  var cfg = o.config || {};
  var bench = o.benchBars || null;
  var states = [], prior = null;

  // Precomputing the indicator series once is safe ONLY because each decision
  // is handed a prefix of it. Anything the engine reads is bars[0..i].
  var allBars = engine.computeBars(rows);

  for (var i = 0; i < rows.length; i++) {
    var ctxBars = allBars.slice(0, i + 1);
    var ctx = { bars: ctxBars };
    if (bench && bench.length) {
      // the benchmark is cut to the same minute, never further
      ctx.benchBars = bench.filter(function (x) { return x.time <= rows[i].time; });
    }
    var d = engine.decide(rows.slice(0, i + 1), ctx, prior, cfg);
    d.i = i;
    states.push(d);
    prior = d;
  }
  return states;
}

// ---------------------------------------------------------------- setups
// A setup is a lifecycle, not a state change. Counting every transition as an
// "alert" is what made the old measurements unreadable.
function collectSetups(states) {
  var byId = {}, order = [];
  states.forEach(function (s) {
    if (!s.setupId) return;
    if (!byId[s.setupId]) {
      byId[s.setupId] = { setupId: s.setupId, type: s.setup && s.setup.type,
        detectedAt: s.i, detectedTime: s.time, detectedPrice: s.price,
        armedAt: null, readyAt: null, failedAt: null, plan: null,
        bestScore: 0, quality: s.quality && s.quality.label, states: [] };
      order.push(s.setupId);
    }
    var S = byId[s.setupId];
    S.states.push({ i: s.i, time: s.time, state: s.state, score: s.score });
    if (s.score > S.bestScore) S.bestScore = s.score;
    if (s.plan && !S.plan) S.plan = s.plan;
    if (s.state === 'ARMED' && S.armedAt == null) { S.armedAt = s.i; S.armedTime = s.time; }
    if (s.state === 'READY' && S.readyAt == null) {
      S.readyAt = s.i; S.readyTime = s.time; S.readyPrice = s.price; S.readyScore = s.score;
      S.plan = s.plan;
    }
    if (s.state === 'FAILED' && S.failedAt == null) { S.failedAt = s.i; S.failedTime = s.time; }
  });
  return order.map(function (k) { return byId[k]; });
}

// ---------------------------------------------------------------- trades
// One trade per setup that reached READY. Filled on the next bar, then walked
// forward bar by bar: whichever of stop or target the bar touched first, with
// the ambiguous case resolved against us rather than for us.
function simulate(rows, setups, cfg) {
  var c = Object.assign({}, RCFG, cfg || {});
  var trades = [];
  setups.forEach(function (S) {
    if (S.readyAt == null || !S.plan) return;
    var entryIdx = S.readyAt + 1;
    if (entryIdx >= rows.length) {
      trades.push({ setupId: S.setupId, type: S.type, outcome: 'no_fill',
        reason: 'READY on the last candle', readyTime: S.readyTime });
      return;
    }
    var p = S.plan;
    var fill = Math.max(rows[entryIdx].open, p.entry);
    var risk = fill - p.stop;
    if (risk <= 0) {
      trades.push({ setupId: S.setupId, type: S.type, outcome: 'no_fill',
        reason: 'fill at or below the stop', readyTime: S.readyTime });
      return;
    }
    var mfe = 0, mae = 0, exit = null;
    for (var i = entryIdx; i < rows.length && i - entryIdx < c.maxHoldBars; i++) {
      var r = rows[i];
      mfe = Math.max(mfe, r.high - fill);
      mae = Math.min(mae, r.low - fill);
      var hitStop = r.low <= p.stop, hitT1 = r.high >= p.t1;
      // A bar that touched both is scored as the loss. Assuming the good fill
      // first is how a backtest flatters itself.
      if (hitStop) { exit = { i: i, price: p.stop, reason: 'stop' }; break; }
      if (hitT1) { exit = { i: i, price: p.t1, reason: 'target1' }; break; }
    }
    if (!exit) {
      var last = Math.min(rows.length - 1, entryIdx + c.maxHoldBars - 1);
      exit = { i: last, price: rows[last].close, reason: last === rows.length - 1 ? 'close' : 'time' };
    }
    var R = (exit.price - fill) / risk;
    trades.push({
      setupId: S.setupId, type: S.type, quality: S.quality,
      detectedTime: S.detectedTime, readyTime: S.readyTime, readyScore: S.readyScore,
      entryTime: rows[entryIdx].time, entryPrice: +fill.toFixed(2),
      stop: p.stop, t1: p.t1, t2: p.t2, risk: +risk.toFixed(2),
      exitTime: rows[exit.i].time, exitPrice: +exit.price.toFixed(2), exitReason: exit.reason,
      mfe: +mfe.toFixed(2), mae: +mae.toFixed(2),
      mfeR: +(mfe / risk).toFixed(2), maeR: +(mae / risk).toFixed(2),
      R: +R.toFixed(2), minutesHeld: exit.i - entryIdx,
      outcome: R > 0 ? 'win' : 'loss'
    });
  });
  return trades;
}

// ---------------------------------------------------------------- metrics
function metrics(trades) {
  var t = trades.filter(function (x) { return x.outcome !== 'no_fill'; });
  if (!t.length) return { trades: 0 };
  var wins = t.filter(function (x) { return x.R > 0; });
  var losses = t.filter(function (x) { return x.R <= 0; });
  var sum = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); };
  var avg = function (a, f) { return a.length ? sum(a, f) / a.length : null; };
  var Rs = t.map(function (x) { return x.R; }).sort(function (a, b) { return a - b; });
  var grossWin = sum(wins, function (x) { return x.R; });
  var grossLoss = Math.abs(sum(losses, function (x) { return x.R; }));
  return {
    trades: t.length, wins: wins.length, losses: losses.length,
    winRate: +(wins.length / t.length * 100).toFixed(1),
    avgR: +(avg(t, function (x) { return x.R; })).toFixed(2),
    medianR: +Rs[Math.floor(Rs.length / 2)].toFixed(2),
    avgWinR: wins.length ? +(avg(wins, function (x) { return x.R; })).toFixed(2) : null,
    avgLossR: losses.length ? +(avg(losses, function (x) { return x.R; })).toFixed(2) : null,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? Infinity : 0),
    expectancyR: +(avg(t, function (x) { return x.R; })).toFixed(2),
    avgMfeR: +(avg(t, function (x) { return x.mfeR; })).toFixed(2),
    avgMaeR: +(avg(t, function (x) { return x.maeR; })).toFixed(2),
    avgHold: Math.round(avg(t, function (x) { return x.minutesHeld; }))
  };
}

function breakdown(trades, key) {
  var g = {};
  trades.filter(function (t) { return t.outcome !== 'no_fill'; }).forEach(function (t) {
    var k = key(t) || 'unknown';
    (g[k] = g[k] || []).push(t);
  });
  var out = {};
  Object.keys(g).forEach(function (k) { out[k] = metrics(g[k]); });
  return out;
}

// ---------------------------------------------------------------- missed
// Post-analysis. Uses the future ON PURPOSE, and is never fed back.
function missedMoves(rows, states, trades, cfg) {
  var c = Object.assign({}, RCFG, cfg || {});
  var entered = {};
  trades.forEach(function (t) { if (t.entryTime) entered[t.entryTime] = true; });
  var out = [];
  for (var i = 0; i < rows.length - 2; i++) {
    var end = Math.min(rows.length - 1, i + c.missedWindowMin);
    var win = rows.slice(i + 1, end + 1);
    if (!win.length) continue;
    var base = rows[i].close;
    var hi = Math.max.apply(null, win.map(function (r) { return r.high; }));
    var lo = Math.min.apply(null, win.map(function (r) { return r.low; }));
    var up = (hi - base) / base * 100, down = (base - lo) / base * 100;
    if (up < c.missedMovePct || down > c.missedMaxAdversePct) continue;
    // was a trade already open across this minute?
    var covered = trades.some(function (t) {
      return t.entryTime && t.entryTime <= rows[i].time && t.exitTime >= rows[i].time;
    });
    if (covered) continue;
    var s = states[i];
    out.push({
      time: rows[i].time, price: base, upPct: +up.toFixed(2), maxAdversePct: +down.toFixed(2),
      state: s ? s.state : null, score: s ? s.score : null,
      trend: s ? s.trend : null, quality: s && s.quality ? s.quality.label : null,
      why: s ? (s.reason || '') : '', next: s ? (s.next || '') : ''
    });
    i = end;   // one entry per move, not one per minute inside it
  }
  return out;
}

// ---------------------------------------------------------------- one day
function analyseDay(rows, engine, opts) {
  var o = opts || {};
  var states = runV2(rows, engine, o);
  var setups = collectSetups(states);
  var trades = simulate(rows, setups, o);
  return {
    symbol: o.symbol || null, date: rows.length ? rows[0].date : null, bars: rows.length,
    states: states, setups: setups, trades: trades,
    metrics: metrics(trades),
    byType: breakdown(trades, function (t) { return t.type; }),
    byQuality: breakdown(trades, function (t) { return t.quality; }),
    missed: missedMoves(rows, states, trades, o),
    quality: states.length ? states[states.length - 1].quality : null,
    counts: {
      setups: setups.length,
      armed: setups.filter(function (s) { return s.armedAt != null; }).length,
      ready: setups.filter(function (s) { return s.readyAt != null; }).length,
      entered: trades.filter(function (t) { return t.outcome !== 'no_fill'; }).length,
      failedBeforeEntry: setups.filter(function (s) { return s.failedAt != null && s.readyAt == null; }).length
    }
  };
}

if (typeof module !== 'undefined') module.exports = {
  RCFG: RCFG, runV2: runV2, collectSetups: collectSetups, simulate: simulate,
  metrics: metrics, breakdown: breakdown, missedMoves: missedMoves, analyseDay: analyseDay
};
