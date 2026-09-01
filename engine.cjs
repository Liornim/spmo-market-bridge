// bars-vault structure engine — pure function over one day's 1-minute bars.
// Inlined into view.html by build-view.mjs; unit-tested directly in node.
//
// analyze(rows, { K: 3 }) -> { bars, swings, state, events }
//   rows: [{ time, open, high, low, close, volume }] in chronological order.
//
// Swing confirmation is K bars on each side (default 3, per the owner's
// "K=3, no exceptions" rule; the spec that inspired this used 2). A swing is
// only usable from the bar that confirms it, so nothing here looks ahead:
// the state at bar i is computed from bars 0..i.
function analyze(rows, opts) {
  var K = (opts && opts.K) || 3, LOOK = 20, n = rows.length;
  if (!n) return null;

  // ---- per-bar derived values (causal: volume average is of bars 0..i)
  var bars = [], volSum = 0, rangeSum = 0, dayHigh = -Infinity, dayLow = Infinity;
  var pvSum = 0, ema9 = null, ema20 = null, k9 = 2 / 10, k20 = 2 / 21, belowVwapRun = 0;
  for (var i = 0; i < n; i++) {
    var r = rows[i], range = r.high - r.low, body = Math.abs(r.close - r.open);
    volSum += r.volume; rangeSum += range;
    dayHigh = Math.max(dayHigh, r.high); dayLow = Math.min(dayLow, r.low);
    // VWAP from the open, EMA9/EMA20 on closes, 20-bar average range.
    pvSum += (r.high + r.low + r.close) / 3 * r.volume;
    var vwap = volSum > 0 ? pvSum / volSum : r.close;
    ema9 = ema9 == null ? r.close : r.close * k9 + ema9 * (1 - k9);
    ema20 = ema20 == null ? r.close : r.close * k20 + ema20 * (1 - k20);
    var w20 = rows.slice(Math.max(0, i - 19), i + 1), atr20 = w20.reduce(function (s, x) { return s + (x.high - x.low); }, 0) / w20.length;
    var aboveVwap = r.close > vwap, vwapReclaim = aboveVwap && belowVwapRun >= 3, vwapLoss = !aboveVwap && belowVwapRun === 0 && i > 0 && bars[i - 1].aboveVwap;
    belowVwapRun = aboveVwap ? 0 : belowVwapRun + 1;
    var align = r.close > ema9 && ema9 > ema20 ? 'bull' : r.close < ema9 && ema9 < ema20 ? 'bear' : 'mixed';
    var pct = function (x) { return range > 0 ? Math.round(x / range * 1000) / 10 : 0; };
    bars.push({
      i: i, time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
      range: range, body: pct(body), uw: pct(r.high - Math.max(r.open, r.close)), lw: pct(Math.min(r.open, r.close) - r.low),
      dir: r.close > r.open ? 'up' : r.close < r.open ? 'down' : 'flat',
      volx: volSum > 0 ? Math.round(r.volume / (volSum / (i + 1)) * 100) / 100 : 0,
      avgRange: rangeSum / (i + 1),
      closePos: range > 0 ? (r.close - r.low) / range : 0.5,      // 1 = closed at high
      vwap: vwap, ema9: ema9, ema20: ema20, atr20: atr20, aboveVwap: aboveVwap, vwapReclaim: vwapReclaim, vwapLoss: vwapLoss, align: align,
      newDayHigh: r.high >= dayHigh && (i === 0 || r.high > Math.max.apply(null, rows.slice(0, i).map(function (x) { return x.high; }))),
      dayHigh: dayHigh, dayLow: dayLow
    });
  }

  // ---- swings, confirmed K bars later
  var swings = [];
  for (var s = K; s < n - K; s++) {
    var hiL = true, loL = true, hiR = true, loR = true;
    for (var k = 1; k <= K; k++) {
      if (!(rows[s].high > rows[s - k].high)) hiL = false;
      if (!(rows[s].high >= rows[s + k].high)) hiR = false;
      if (!(rows[s].low < rows[s - k].low)) loL = false;
      if (!(rows[s].low <= rows[s + k].low)) loR = false;
    }
    if (hiL && hiR) swings.push({ i: s, time: rows[s].time, kind: 'H', price: rows[s].high, confirmedAt: s + K });
    if (loL && loR) swings.push({ i: s, time: rows[s].time, kind: 'L', price: rows[s].low, confirmedAt: s + K });
  }
  swings.sort(function (a, b) { return a.i - b.i; });
  // A swing only earns HH/LH/HL/LL if it moved at least MIN_MOVE x the average
  // bar range past the previous swing of its kind; smaller wiggles are EQ and
  // count as levels but never as structure.
  var MIN_MOVE = (opts && opts.minMove) || 1.5, prevH = null, prevL = null;
  swings.forEach(function (w) {
    var tol = MIN_MOVE * bars[w.i].avgRange;
    if (w.kind === 'H') { w.label = !prevH ? 'H' : w.price > prevH.price + tol ? 'HH' : w.price < prevH.price - tol ? 'LH' : 'EQ'; if (w.label !== 'EQ') prevH = w; }
    else { w.label = !prevL ? 'L' : w.price > prevL.price + tol ? 'HL' : w.price < prevL.price - tol ? 'LL' : 'EQ'; if (w.label !== 'EQ') prevL = w; }
  });

  // ---- sequential walk: levels, trend, events
  //
  // Levels for breakout/support events are WINDOW extremes, not the nearest
  // micro-swing: the highest high / lowest low of the last 60 bars, excluding
  // the most recent 5 (a high made a minute ago is not resistance yet).
  // Swings still drive trend, HL/LL structure, and the "structure break" event.
  var WIN = 60, AGE = 5, COOLDOWN = 30, MARGIN = (opts && opts.margin) || 0.15, RUNS = (opts && opts.runs) || 3;
  var events = [], prevState = null, lastBreakout = null, states = [], fired = {}, trendRun = 0, runTrend = null, announced = null;
  var cooled = function (type, b) { return fired[type] == null || b - fired[type] > COOLDOWN; };
  var mark = function (type, b) { fired[type] = b; };

  for (var b = 0; b < n; b++) {
    var bar = bars[b], next = bars[b + 1] || null, margin = MARGIN * bar.avgRange;
    var conf = swings.filter(function (w) { return w.confirmedAt <= b; });
    var SH = conf.filter(function (w) { return w.kind === 'H' && w.label !== 'EQ'; }), SL = conf.filter(function (w) { return w.kind === 'L' && w.label !== 'EQ'; });
    var lastSH = SH[SH.length - 1] || null, lastSL = SL[SL.length - 1] || null;

    var wEnd = b - AGE, wStart = Math.max(0, b - WIN), res = null, sup = null;
    if (wEnd >= wStart && wEnd >= 0) {
      var w = rows.slice(wStart, wEnd + 1), hiIdx = 0, loIdx = 0;
      for (var q = 1; q < w.length; q++) { if (w[q].high > w[hiIdx].high) hiIdx = q; if (w[q].low < w[loIdx].low) loIdx = q; }
      if (w[hiIdx].high > bar.close) res = { price: w[hiIdx].high, time: w[hiIdx].time, kind: 'window' };
      if (w[loIdx].low < bar.close) sup = { price: w[loIdx].low, time: w[loIdx].time, kind: 'window' };
    }

    var trend = 'RANGE', reason = 'אין רצף';
    if (lastSH && lastSL && lastSH.label !== 'H' && lastSL.label !== 'L') {
      if (lastSH.label === 'HH' && lastSL.label === 'HL') { trend = 'UP'; reason = 'HH + HL'; }
      else if (lastSH.label === 'LH' && lastSL.label === 'LL') { trend = 'DOWN'; reason = 'LH + LL'; }
      else reason = lastSH.label + ' + ' + lastSL.label;
    } else if (!lastSH || !lastSL) reason = 'עדיין אין מספיק swings';

    // ---- events, judged against the PREVIOUS bar's levels (no look-ahead on levels;
    // the only forward look is the 2-bar confirmation, which is reported as such).
    var pres = prevState ? prevState.res : null, psup = prevState ? prevState.sup : null;
    var pTrend = prevState ? prevState.trend : null, pSL = prevState ? prevState.lastSL : null, pSH = prevState ? prevState.lastSH : null;
    var ev = [], score = 0;

    if (pres && bar.high > pres.price && bar.close > pres.price + margin && cooled('breakout', b)) {
      var confirmed = next ? next.close > pres.price : null;
      var strong = bar.body > 65 && bar.volx > 1.2;
      score += confirmed ? 5 : 2;
      ev.push({ type: strong && confirmed ? 'strong_breakout' : 'breakout', level: pres.price, confirmed: confirmed, strong: strong });
      lastBreakout = { i: b, level: pres.price, confirmed: confirmed, dayHigh: pres.price >= prevState.bar.dayHigh - 1e-9 };
      if (confirmed) mark('breakout', b);
    } else if (pres && bar.high > pres.price && bar.close < pres.price && bar.uw >= 50 && cooled('rejected', b)) {
      ev.push({ type: 'rejected', level: pres.price, wick: bar.uw }); mark('rejected', b);
    } else if (pres && !ev.length && bar.close >= pres.price * (1 - 0.0015) && bar.close <= pres.price) {
      ev.push({ type: 'testing', level: pres.price });
    }
    if (lastBreakout && b > lastBreakout.i && b - lastBreakout.i <= 10) {
      if (bar.close < lastBreakout.level) { score -= 3; ev.push({ type: 'failed', level: lastBreakout.level, confirmed: lastBreakout.confirmed, dayHigh: lastBreakout.dayHigh }); lastBreakout = null; }
      else if (bar.low <= lastBreakout.level + margin && bar.close >= lastBreakout.level && cooled('retest_hold', b)) { ev.push({ type: 'retest_hold', level: lastBreakout.level }); mark('retest_hold', b); }
    }
    if (psup && bar.low < psup.price && bar.close < psup.price - margin && cooled('support_break', b)) {
      var confS = next ? next.close < psup.price : null;
      score -= 2; ev.push({ type: 'support_break', level: psup.price, confirmed: confS });
      if (confS) mark('support_break', b);
    }
    // Structure break: the level the trend rests on gives way.
    // Only an announced trend (two agreeing swings) can be "broken".
    var pAnnounced = prevState ? prevState.announced : null;
    if (pAnnounced === 'UP' && pSL && bar.close < pSL.price - margin && cooled('structure_break', b)) {
      score -= 2; ev.push({ type: 'structure_break', level: pSL.price, side: 'bear', confirmed: next ? next.close < pSL.price : null }); mark('structure_break', b);
    } else if (pAnnounced === 'DOWN' && pSH && bar.close > pSH.price + margin && cooled('structure_break', b)) {
      score += 2; ev.push({ type: 'structure_break', level: pSH.price, side: 'bull', confirmed: next ? next.close > pSH.price : null }); mark('structure_break', b);
    }
    conf.forEach(function (w) {
      if (w.confirmedAt !== b || w.label === 'EQ') return;
      ev.push({ type: (w.label.toLowerCase()) + '_confirmed', level: w.price, at: w.time });
    });
    if (bar.volx >= 1.5) { score += 2; ev.push({ type: 'volume_spike', volx: bar.volx }); }
    var momentum = bar.body >= 75 && bar.range > 1.5 * bar.avgRange;
    if (momentum) ev.push({ type: 'momentum', body: bar.body, range: bar.range });
    if (bar.vwapReclaim) ev.push({ type: 'vwap_reclaim', level: bar.vwap });
    if (bar.vwapLoss) ev.push({ type: 'vwap_loss', level: bar.vwap });
    if (bar.body >= 70) score += 1;
    if (bar.closePos >= 0.8) score += 1;
    if (bar.newDayHigh) score += 1;
    if (bar.uw > 55) score -= 2;
    // Trend change is announced on the SECOND structural swing that agrees
    // (HH+HL is the trend; the next HH or HL is the confirmation).
    var structConfirmedNow = conf.some(function (w) { return w.confirmedAt === b && w.label !== 'EQ'; });
    if (structConfirmedNow) {
      if (trend === runTrend) trendRun++; else { runTrend = trend; trendRun = 1; }
      if (trendRun === RUNS && (trend === 'UP' || trend === 'DOWN') && cooled('trend_change', b)) {
        ev.push({ type: 'trend_change', from: pTrend === trend ? 'RANGE' : pTrend, to: trend }); mark('trend_change', b); announced = trend;
      }
    }
    if (announced && trend !== announced) announced = null;

    var attempt = (pres && bar.close >= pres.price * (1 - 0.0015) && bar.close <= pres.price * (1 + 0.0015)) || (lastBreakout && b - lastBreakout.i <= 1);
    var state = attempt ? 'ATTEMPT' : trend;
    var tier = score >= 7 ? 'CHECK' : score >= 5 ? 'IMPORTANT' : score >= 3 ? 'WATCH' : 'NONE';
    // Ask = worth a fresh look: only day-extreme levels, only confirmed.
    var pDayHigh = prevState ? prevState.bar.dayHigh : Infinity, pDayLow = prevState ? prevState.bar.dayLow : -Infinity;
    var ask = ev.some(function (e) {
      if (e.type === 'strong_breakout' || e.type === 'breakout') return e.confirmed === true && e.level >= pDayHigh - 1e-9;
      if (e.type === 'rejected') return e.level >= pDayHigh - 1e-9;
      if (e.type === 'failed') return e.confirmed === true && e.dayHigh === true;
      if (e.type === 'support_break') return e.confirmed === true && e.level <= pDayLow + 1e-9;
      if (e.type === 'structure_break') return e.confirmed === true;
      if (e.type === 'trend_change') return true;
      return false;
    }) || (bar.volx >= 1.5 && momentum);
    var loggable = ask || tier !== 'NONE' || ev.some(function (e) {
      return e.type === 'failed' || e.type === 'rejected' || e.type === 'support_break' || e.type === 'structure_break' || e.type === 'trend_change' || e.type === 'retest_hold' || /breakout/.test(e.type);
    });

    var st = { i: b, time: bar.time, close: bar.close, trend: trend, reason: reason, state: state, res: res, sup: sup,
      lastSH: lastSH, lastSL: lastSL, announced: announced, score: score, tier: tier, ask: ask, events: ev, bar: bar };
    states.push(st);
    if (loggable) events.push(st);
    prevState = st;
  }

  return { bars: bars, swings: swings, states: states, state: states[n - 1], events: events };
}

// Market context from the analyses of SPY / QQQ (and optionally a sector ETF).
// Bullish needs VWAP and EMA alignment to agree across the index ETFs.
function marketContext(list) {
  var have = list.filter(function (x) { return x && x.state; });
  if (!have.length) return { label: 'Unavailable', score: 0, parts: [] };
  var score = 0, parts = [];
  have.forEach(function (x) {
    var b = x.state.bar, s = 0;
    s += b.aboveVwap ? 1 : -1;
    s += b.align === 'bull' ? 1 : b.align === 'bear' ? -1 : 0;
    if (x.state.announced === 'UP') s += 1; else if (x.state.announced === 'DOWN') s -= 1;
    score += s; parts.push({ symbol: x.symbol, score: s, aboveVwap: b.aboveVwap, align: b.align, trend: x.state.trend, close: b.close, vwap: b.vwap });
  });
  var per = score / have.length;
  return { label: per >= 1.5 ? 'Bullish' : per <= -1.5 ? 'Bearish' : 'Neutral', score: score, parts: parts };
}

// Bottom line: structure first, indicators only move confidence.
// Never emits LONG without a confirmed structural event.
function bottomLine(A, market) {
  if (!A || !A.state) return null;
  var S = A.state, b = S.bar, n = A.states.length, atr = b.atr20 || b.avgRange || 1;
  var recent = function (type, within, pred) {
    for (var i = n - 1; i >= Math.max(0, n - 1 - within); i--) {
      var hit = A.states[i].events.find(function (e) { return e.type === type && (!pred || pred(e)); });
      if (hit) return { e: hit, ago: n - 1 - i };
    }
    return null;
  };
  var conf = function (e) { return e.confirmed === true; };
  var breakout = recent('breakout', 3, conf) || recent('strong_breakout', 3, conf);
  var bullBreak = recent('structure_break', 3, function (e) { return e.side === 'bull' && e.confirmed === true; });
  var retest = recent('retest_hold', 5);
  var rejected = recent('rejected', 5), failed = recent('failed', 5);
  var bearBreak = recent('structure_break', 10, function (e) { return e.side === 'bear' && e.confirmed === true; });
  var supBreak = recent('support_break', 10, conf);
  var vwapReclaim = recent('vwap_reclaim', 3);

  // Levels
  var above = [], below = [];
  if (S.res) above.push({ price: S.res.price, reason: 'גבוה 60 נרות' + (S.res.time ? ' (' + S.res.time + ')' : '') });
  if (S.lastSH && S.lastSH.price > b.close) above.push({ price: S.lastSH.price, reason: 'swing ' + S.lastSH.label + ' אחרון (' + S.lastSH.time + ')' });
  if (b.dayHigh > b.close) above.push({ price: b.dayHigh, reason: 'גבוה היום' });
  if (S.sup) below.push({ price: S.sup.price, reason: 'נמוך 60 נרות' + (S.sup.time ? ' (' + S.sup.time + ')' : '') });
  if (S.lastSL && S.lastSL.price < b.close) below.push({ price: S.lastSL.price, reason: 'swing ' + S.lastSL.label + ' אחרון (' + S.lastSL.time + ')' });
  if (b.dayLow < b.close) below.push({ price: b.dayLow, reason: 'נמוך היום' });
  var uniq = function (arr, asc) { var seen = {}; return arr.filter(function (x) { var k = x.price.toFixed(2); if (seen[k]) return false; seen[k] = 1; return true; }).sort(function (x, y) { return asc ? x.price - y.price : y.price - x.price; }); };
  above = uniq(above, true); below = uniq(below, false);
  var trigger = above[0] || null, strong = above.find(function (x) { return trigger && x.price > trigger.price + 0.25 * atr; }) || null, invalid = below[0] || null;
  var dist = function (lv) { return lv ? { pts: lv.price - b.close, atr: (lv.price - b.close) / atr } : null; };

  // Structural setup?
  var trendUp = S.trend === 'UP', announcedUp = S.announced === 'UP', announcedDown = S.announced === 'DOWN';
  var setup = trendUp || !!breakout || !!bullBreak || !!retest;

  // Confidence
  var c = 0, why = [];
  if (breakout || bullBreak) { c += 3; why.push('+3 פריצה/שבירה מבנית מאושרת'); }
  if (trendUp) { c += 2; why.push('+2 HH/HL'); }
  if (b.aboveVwap) { c += 1; why.push('+1 מעל VWAP'); } else { c -= 2; why.push('-2 מתחת VWAP'); }
  if (b.align === 'bull') { c += 1; why.push('+1 EMA שורי'); } else if (b.align === 'bear') { c -= 1; why.push('-1 EMA דובי'); }
  var volOk = b.volx >= 1.2 || (breakout && A.states[n - 1 - breakout.ago].bar.volx >= 1.2);
  if (volOk) { c += 1; why.push('+1 נפח'); }
  if (market && market.label === 'Bullish') { c += 1; why.push('+1 שוק'); } else if (market && market.label === 'Bearish') { c -= 2; why.push('-2 שוק נגד'); }
  if (retest) { c += 1; why.push('+1 בדיקה חוזרת'); }
  if (rejected) { c -= 2; why.push('-2 דחייה'); }
  if (bearBreak || supBreak || failed) { c -= 3; why.push('-3 ביטול/שבירה'); }
  c = Math.max(0, Math.min(10, c));

  // Action
  var action = 'WAIT', reason = 'אין setup מבני';
  if (announcedDown || bearBreak || supBreak) { action = 'AVOID'; reason = announcedDown ? 'מגמת ירידה מוכרזת' : 'תמיכה/מבנה נשברו'; }
  else if ((breakout || bullBreak) && c >= 6) { action = 'LONG'; reason = (breakout ? 'פריצה' : 'שבירת מבנה שורית') + ' מאושרת · ביטחון ' + c; }
  else if (breakout || bullBreak) { action = 'LONG WATCH'; reason = 'פריצה מאושרת אבל ביטחון ' + c + '/10'; }
  else if (setup && trigger && (trigger.price - b.close) <= 1.0 * atr) { action = 'LONG WATCH'; reason = 'מגמה עולה, ' + ((trigger.price - b.close) / atr).toFixed(1) + '× טווח מהטריגר'; }
  else if (setup && vwapReclaim) { action = 'LONG WATCH'; reason = 'VWAP נכבש מחדש בתוך מגמה עולה'; }
  else if (setup) { action = 'WAIT'; reason = 'מגמה עולה, רחוק מהטריגר'; }

  return {
    action: action, reason: reason, confidence: c, why: why,
    trigger: trigger ? { price: trigger.price, reason: trigger.reason, dist: dist(trigger) } : null,
    strong: strong ? { price: strong.price, reason: strong.reason, dist: dist(strong) } : null,
    invalidation: invalid ? { price: invalid.price, reason: invalid.reason, dist: dist(invalid) } : null,
    vwap: b.vwap, aboveVwap: b.aboveVwap, ema9: b.ema9, ema20: b.ema20, align: b.align, atr: atr,
    market: market ? market.label : 'Unavailable', setup: setup
  };
}
if (typeof module !== 'undefined') module.exports = { analyze: analyze, bottomLine: bottomLine, marketContext: marketContext };
