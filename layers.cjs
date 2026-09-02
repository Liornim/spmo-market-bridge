// Multi-day layer, time-of-day volume, path probability and the plain-language
// "what now" block. Kept in its own file so engine.cjs stays the intraday core.
var E = require('./engine.cjs');

// ---------------------------------------------------------------- volume by time of day
// The closing auction is not comparable to a normal minute, so relative volume
// is measured against the SAME minute on previous days. With no history the
// baseline is null and callers fall back to the session average.
function volumeBaseline(daysRows) {
  var sum = {}, cnt = {}, days = 0;
  (daysRows || []).forEach(function (rows) {
    if (!rows || !rows.length) return;
    days++;
    rows.forEach(function (r) { sum[r.time] = (sum[r.time] || 0) + r.volume; cnt[r.time] = (cnt[r.time] || 0) + 1; });
  });
  if (days < 2) return null;
  var by = {};
  Object.keys(sum).forEach(function (t) { by[t] = sum[t] / cnt[t]; });
  return { byTime: by, days: days };
}
function volxTod(bar, baseline) {
  if (!baseline || !baseline.byTime[bar.time]) return null;
  var b = baseline.byTime[bar.time];
  return b > 0 ? Math.round(bar.volume / b * 100) / 100 : null;
}

// ---------------------------------------------------------------- daily layer
// daysRows: array of one day's 1-minute rows, oldest first, today last.
function dailyContext(daysRows) {
  var days = (daysRows || []).filter(function (r) { return r && r.length; });
  if (!days.length) return null;
  var bars = days.map(function (rows) {
    var o = rows[0].open, c = rows[rows.length - 1].close;
    var h = -Infinity, l = Infinity, v = 0;
    rows.forEach(function (r) { h = Math.max(h, r.high); l = Math.min(l, r.low); v += r.volume; });
    return { date: rows[0].date, open: o, high: h, low: l, close: c, volume: v, range: h - l,
      closeStrength: h > l ? (c - l) / (h - l) : 0.5 };
  });
  var prior = bars.slice(0, -1), today = bars[bars.length - 1];
  var atrDaily = prior.length ? prior.reduce(function (s, b) { return s + b.range; }, 0) / prior.length : today.range;
  // Daily trend over the prior sessions: higher closes and higher lows.
  var trend = 'RANGE', why = 'אין רצף יומי';
  if (prior.length >= 3) {
    var last3 = prior.slice(-3);
    var upCloses = last3.filter(function (b, i) { return i === 0 || b.close > last3[i - 1].close; }).length;
    var upLows = last3.filter(function (b, i) { return i === 0 || b.low > last3[i - 1].low; }).length;
    if (upCloses >= 3 && upLows >= 2) { trend = 'UP'; why = 'סגירות ושפלים עולים'; }
    else if (upCloses <= 1 && upLows <= 1) { trend = 'DOWN'; why = 'סגירות ושפלים יורדים'; }
    else why = 'מעורב';
  }
  var prev = prior.length ? prior[prior.length - 1] : null;
  // Multi-day levels: prior highs/lows that price reacted to more than once.
  var levels = [];
  prior.forEach(function (b) { levels.push({ price: b.high, why: 'גבוה ' + b.date }, { price: b.low, why: 'נמוך ' + b.date }); });
  var gap = prev ? today.open - prev.close : 0;
  return { days: bars.length, priorDays: prior.length, trend: trend, trendWhy: why,
    prevHigh: prev ? prev.high : null, prevLow: prev ? prev.low : null, prevClose: prev ? prev.close : null,
    atrDaily: atrDaily, levels: levels, gap: gap, today: today,
    closeStrength: prev ? prev.closeStrength : null };
}

// ---------------------------------------------------------------- features
// A compact description of "situations like this one", used both to bucket
// history and to score the model fallback.
function features(A, ctx, upper, lower) {
  var S = A.state, b = S.bar, atr = b.atr20 || b.avgRange || 1;
  var vx = (ctx && ctx.baseline) ? volxTod(b, ctx.baseline) : null;
  if (vx == null) vx = b.volx;
  var mom = E.momentum(A);
  return {
    structure: S.announced || S.trend,
    vwap: b.aboveVwap ? 'above' : 'below',
    ema: b.align,
    momentum: mom.label,
    vol: vx >= 1.5 ? 'high' : vx >= 0.8 ? 'normal' : 'low',
    daily: ctx && ctx.daily ? ctx.daily.trend : 'NA',
    dUp: Math.round(((upper - b.close) / atr) * 2) / 2,
    dDown: Math.round(((b.close - lower) / atr) * 2) / 2,
    tod: b.time < '10:30' ? 'open' : b.time < '14:30' ? 'mid' : 'late'
  };
}
function bucketKey(f, coarse) {
  return coarse
    ? [f.structure, f.vwap, f.daily].join('|')
    : [f.structure, f.vwap, f.ema, f.momentum, f.vol, f.daily, f.dUp, f.dDown].join('|');
}

// ---------------------------------------------------------------- calibration
// Replays the loaded historical days and records, for each situation, whether
// price rose by the required distance before falling by the other one, within
// the horizon. These are real observed outcomes from the symbol's own history —
// when there are too few of them the caller must not show a percentage.
function calibrate(daysRows, opts) {
  var o = opts || {}, horizon = o.horizon || 60, step = o.step || 2;
  var table = {}, coarse = {}, total = 0;
  (daysRows || []).forEach(function (rows) {
    if (!rows || rows.length < 120) return;
    var A = E.analyze(rows, o.engine || { K: 3 });
    if (!A) return;
    var bars = A.bars, n = bars.length;
    for (var i = 60; i < n - horizon; i += step) {
      var b = bars[i], atr = b.atr20 || b.avgRange || 1;
      // sample a spread of target distances so the table can answer different asks
      [0.5, 1, 1.5, 2].forEach(function (du) {
        [0.5, 1, 1.5, 2].forEach(function (dd) {
          var up = b.close + du * atr, dn = b.close - dd * atr, hit = null;
          for (var k = i + 1; k <= i + horizon && k < n; k++) {
            if (bars[k].high >= up) { hit = 'up'; break; }
            if (bars[k].low <= dn) { hit = 'down'; break; }
          }
          if (!hit) return;
          var sub = { state: A.states[i], bar: b };
          var f = features({ state: A.states[i], bars: bars.slice(0, i + 1), swings: A.swings, states: A.states.slice(0, i + 1) },
            { daily: o.daily, baseline: o.baseline }, up, dn);
          [bucketKey(f, false), 'C:' + bucketKey(f, true) + '|' + f.dUp + '|' + f.dDown].forEach(function (key, idx) {
            var t = idx === 0 ? table : coarse;
            t[key] = t[key] || { n: 0, up: 0 };
            t[key].n++; if (hit === 'up') t[key].up++;
          });
          total++;
        });
      });
    }
  });
  return { table: table, coarse: coarse, total: total };
}

// ---------------------------------------------------------------- probability
// Answers ONE defined question: does price reach `upper` before `lower`, within
// `horizonMin` minutes. Empirical when the symbol's own history has enough
// comparable cases; otherwise a transparent weighted model, reported as a bias
// with a confidence score rather than a fake percentage.
function pathProbability(A, ctx) {
  if (!A || !A.state) return null;
  var c = ctx || {}, S = A.state, b = S.bar, atr = b.atr20 || b.avgRange || 1;
  var T = c.tactical || E.tactical(A);
  var upper = c.upper != null ? c.upper : (T.resistance ? T.resistance.price : b.close + atr);
  var lower = c.lower != null ? c.lower : (T.support ? T.support.price : b.close - atr);
  var horizon = c.horizonMin || 60;
  var f = features(A, c, upper, lower);
  var out = { upper: upper, lower: lower, horizonMin: horizon, features: f, why: [] };

  // 1. empirical
  if (c.calibration) {
    var exact = c.calibration.table[bucketKey(f, false)];
    var coarse = c.calibration.coarse['C:' + bucketKey(f, true) + '|' + f.dUp + '|' + f.dDown];
    var hit = (exact && exact.n >= 30) ? exact : (coarse && coarse.n >= 30) ? coarse : null;
    if (hit) {
      out.source = 'empirical'; out.n = hit.n;
      out.up = Math.round(hit.up / hit.n * 100);
      out.confidence = Math.min(90, 40 + Math.round(Math.min(hit.n, 400) / 8));
      out.why.push(hit.n + ' מקרים דומים בהיסטוריה של הנייר');
      out.down = 100 - out.up;
      return out;
    }
    out.sampled = (exact ? exact.n : 0) + (coarse ? coarse.n : 0);
  }

  // 2. transparent model. Each layer moves the odds; none of it is invented,
  // and the result is labelled as a model bias, not an observed frequency.
  var score = 0, add = function (pts, txt) { if (!pts) return; score += pts; out.why.push((pts > 0 ? '+' : '') + pts + ' ' + txt); };
  add(f.structure === 'UP' ? 2 : f.structure === 'DOWN' ? -2 : 0, 'מבנה תוך-יומי ' + f.structure);
  add(f.daily === 'UP' ? 2 : f.daily === 'DOWN' ? -2 : 0, 'מגמה רב-יומית ' + f.daily);
  add(f.vwap === 'above' ? 1 : -1, 'מחיר ' + (f.vwap === 'above' ? 'מעל' : 'מתחת') + ' VWAP');
  add(f.ema === 'bull' ? 1 : f.ema === 'bear' ? -1 : 0, 'EMA ' + f.ema);
  add(f.momentum === 'PUSHING' || f.momentum === 'RECOVERY' ? 1 : f.momentum === 'SELLING' ? -1 : 0, 'מומנטום ' + f.momentum);
  add(c.market === 'Bullish' ? 1 : c.market === 'Bearish' ? -1 : 0, 'שוק ' + (c.market || 'לא ידוע'));
  // Distance asymmetry: the nearer level is simply likelier to be reached.
  var dU = (upper - b.close) / atr, dD = (b.close - lower) / atr;
  var geom = dU + dD > 0 ? (dD - dU) / (dU + dD) : 0;
  add(Math.round(geom * 3), 'הרמה ' + (geom > 0 ? 'העליונה' : 'התחתונה') + ' קרובה יותר');
  var pct = Math.round(100 / (1 + Math.exp(-score / 3.2)));
  out.source = 'model';
  out.up = Math.max(10, Math.min(90, pct)); out.down = 100 - out.up;
  out.confidence = Math.max(20, Math.min(55, 25 + Math.abs(score) * 3));
  out.bias = out.up >= 60 ? 'נטייה שורית' : out.up <= 40 ? 'נטייה דובית' : 'ללא נטייה ברורה';
  return out;
}

// ---------------------------------------------------------------- what now
// Plain language. No HH/HL/VWAP/R in the user-facing strings.
var ACTIONS = {
  DO_NOT_BUY: 'לא לקנות',
  START_WATCHING: 'להתחיל לעקוב',
  WAIT_FOR_CONFIRMATION: 'לחכות לאישור',
  ENTRY_AVAILABLE: 'אפשר להיכנס',
  HOLD: 'להחזיק',
  TAKE_PARTIAL: 'לממש חלק',
  MOVE_STOP: 'להעלות סטופ',
  EXIT: 'לצאת',
  SETUP_CANCELLED: 'ה-setup בוטל',
  SESSION_CLOSED: 'המסחר הסתיים'
};
var PLAN_TO_ACTION = {
  NO_SETUP: 'DO_NOT_BUY',
  WAITING_FOR_ZONE: 'START_WATCHING',
  IN_ZONE: 'WAIT_FOR_CONFIRMATION',
  READY_PARTIAL: 'ENTRY_AVAILABLE',
  WAITING_FOR_CONFIRMATION: 'WAIT_FOR_CONFIRMATION',
  READY_ADD: 'ENTRY_AVAILABLE',
  ACTIVE: 'HOLD',
  TAKE_PROFIT_AREA: 'TAKE_PARTIAL',
  DO_NOT_CHASE: 'DO_NOT_BUY',
  FAILED: 'SETUP_CANCELLED'
};
function n2(x) { return x == null ? null : (Math.round(x * 100) / 100).toFixed(2); }

function whatNow(A, ctx) {
  if (!A || !A.state) return null;
  var c = ctx || {}, S = A.state, b = S.bar, atr = b.atr20 || b.avgRange || 1;
  var T = c.tactical || E.tactical(A);
  var P = c.plan || E.executionPlan(A, { label: c.market || 'Neutral' });
  var ended = c.sessionEnded;

  var watch = T.resistance ? T.resistance.price : (P && P.zone ? P.zone[1] : b.dayHigh);
  var hasZone = !!(P && P.zone && P.entry != null && P.addAbove != null);
  var lower = T.support ? T.support.price : (P && P.invalidation != null ? P.invalidation : b.dayLow);
  var prob = c.probability || pathProbability(A, { tactical: T, upper: watch, lower: lower,
    horizonMin: 60, daily: c.daily, baseline: c.baseline, calibration: c.calibration, market: c.market });

  var actionKey = ended ? 'SESSION_CLOSED' : (PLAN_TO_ACTION[P ? P.state : 'NO_SETUP'] || 'DO_NOT_BUY');
  var W = { action: actionKey, actionText: ACTIONS[actionKey], sessionEnded: !!ended,
    price: b.close, watch: watch, probability: prob, plan: P, up: [], down: [], why: [] };

  // The one line that matters
  if (ended) W.next = 'המסחר הסתיים — הרמות למטה הן לקראת המסחר הבא, לא להוראה עכשיו';
  else if (P && P.state === 'FAILED') W.next = 'אין כניסה. צריך מצב חדש לפני שמסתכלים שוב.';
  else if (P && (P.state === 'READY_PARTIAL' || P.state === 'READY_ADD')) W.next = 'המחיר במקום שתכננו — ' + P.headline;
  else W.next = 'לשים לב אם המחיר מגיע ל-' + n2(watch);

  // If it goes up
  var above = T.above.filter(function (l) { return l.price > b.close + 0.05 * atr; });
  var t1 = above[1] ? above[1].price : watch + 1.2 * atr;
  var t2 = above[2] ? above[2].price : t1 + 1.5 * atr;
  if (!ended) {
    if (P && P.state === 'READY_PARTIAL' && hasZone) {
      W.up.push('אם המחיר נשאר מעל ' + n2(P.zone[0]) + ' — אפשר להיכנס בחלק מהסכום סביב ' + n2(P.entry));
      W.up.push('אם אחרי זה עולה מעל ' + n2(P.addAbove) + ' ונשאר שם — אפשר להוסיף');
    } else if (P && P.kind === 'breakout' && P.entry != null) {
      W.up.push('אם עובר את ' + n2(watch) + ' ונשאר מעל — אפשר להיכנס סביב ' + n2(P.entry));
    } else {
      W.up.push('אם עולה מעל ' + n2(watch) + ' — להתחיל לעקוב מקרוב');
      W.up.push('אם נשאר מעל ' + n2(watch) + ' אחרי כמה דקות — אפשר להיכנס');
    }
    W.up.push('יעד ראשון ' + n2(t1) + ' — שם לממש חלק');
    W.up.push('יעד שני ' + n2(t2));
  } else {
    W.up.push('הרמה החשובה למעלה הייתה ' + n2(watch));
  }

  // If it goes down
  var below = T.below.filter(function (l) { return l.price < b.close - 0.05 * atr; });
  var s1 = T.support ? T.support.price : (below[0] ? below[0].price : b.close - atr);
  var s2 = below.find(function (l) { return l.price < s1 - 0.1 * atr; });
  var s3 = P && P.invalidation != null ? P.invalidation : (s2 ? s2.price - 0.5 * atr : s1 - atr);
  if (!ended) {
    W.down.push('אם יורד ל-' + n2(s1) + ' — לבדוק אם יש קונים שעוצרים את הירידה');
    if (s2) W.down.push('אם שובר את ' + n2(s2.price) + ' — התרחיש החיובי נחלש');
    W.down.push('אם יורד מתחת ' + n2(s3) + ' — לבטל, לא להיכנס');
  } else {
    W.down.push('התמיכה החשובה הייתה ' + n2(s1));
  }

  // Why, in plain words
  var d = c.daily;
  if (d) W.why.push('מגמה של כמה ימים: ' + (d.trend === 'UP' ? 'עולה' : d.trend === 'DOWN' ? 'יורדת' : 'ללא כיוון'));
  W.why.push('היום: ' + (S.trend === 'UP' ? 'עולה' : S.trend === 'DOWN' ? 'יורד' : 'ללא כיוון'));
  var mom = E.momentum(A);
  W.why.push('בדקות האחרונות: ' + ({ PUSHING: 'לוחץ למעלה', PULLBACK: 'נסוג', RECOVERY: 'מתאושש', SELLING: 'נמכר', FLAT: 'שקט' }[mom.label]));
  W.why.push(b.aboveVwap ? 'מעל ממוצע היום' : 'מתחת לממוצע היום');
  var vx = c.baseline ? volxTod(b, c.baseline) : null;
  if (vx != null) W.why.push('מחזור מול אותה דקה בימים קודמים: ' + vx.toFixed(1) + '×');
  return W;
}

module.exports = { volumeBaseline: volumeBaseline, volxTod: volxTod, dailyContext: dailyContext,
  calibrate: calibrate, pathProbability: pathProbability, whatNow: whatNow, ACTIONS: ACTIONS, features: features };
