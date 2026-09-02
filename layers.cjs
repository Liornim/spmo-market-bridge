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



// ---------------------------------------------------------------- level state
// The current condition of a level, decided from where price is now and what it
// did on its way here. A support that was lost and then regained reads as
// reclaimed — never as "breaking", which is what it did ten candles ago.
var LEVEL_TEXT = {
  approaching: 'מתקרב', testing: 'נבחנת', broken: 'נשברה', reclaimed: 'נכבשה מחדש',
  held: 'נשמרת', rejected: 'נדחתה', lost: 'אבדה', far: 'רחוקה'
};
function levelState(A, level, isSupport, look) {
  if (!A || !A.state || level == null) return null;
  var bars = A.bars, n = bars.length, b = bars[n - 1], atr = b.atr20 || b.avgRange || 1;
  var w = bars.slice(Math.max(0, n - (look || 20)));
  var d = (b.close - level) / atr;                       // + = price above the level
  var near = w.filter(function (x) { return x.low <= level + 0.25 * atr && x.high >= level - 0.25 * atr; });
  var closedBelow = w.filter(function (x) { return x.close < level - 0.15 * atr; }).length;
  var closedAbove = w.filter(function (x) { return x.close > level + 0.15 * atr; }).length;
  var lastTwoBelow = n >= 2 && bars[n - 1].close < level - 0.1 * atr && bars[n - 2].close < level - 0.1 * atr;
  var lastTwoAbove = n >= 2 && bars[n - 1].close > level + 0.1 * atr && bars[n - 2].close > level + 0.1 * atr;
  var recoveries = w.filter(function (x) { return x.low < level && x.close > level; }).length;
  var rejections = w.filter(function (x) { return x.high > level && x.close < level; }).length;

  var state;
  if (isSupport) {
    if (lastTwoBelow) state = 'broken';
    else if (closedBelow >= 2 && lastTwoAbove) state = 'reclaimed';
    else if (recoveries >= 2 && d > 0) state = 'held';
    else if (Math.abs(d) <= 0.25) state = 'testing';
    else if (Math.abs(d) <= 1.0) state = 'approaching';
    else state = 'far';
  } else {
    if (lastTwoAbove) state = 'broken';                  // resistance broken = price accepted above
    else if (closedAbove >= 2 && lastTwoBelow) state = 'lost';
    else if (rejections >= 2 && d < 0) state = 'rejected';
    else if (Math.abs(d) <= 0.25) state = 'testing';
    else if (Math.abs(d) <= 1.0) state = 'approaching';
    else state = 'far';
  }
  return { price: level, state: state, text: LEVEL_TEXT[state], distanceR: d,
    touches: near.length, recoveries: recoveries, rejections: rejections, isSupport: !!isSupport };
}

// ---------------------------------------------------------------- buying / selling pressure
//
// IMPORTANT: this bar feed carries no order book and no trade-by-trade tape.
// There is no bid/ask, no Level 2, no per-trade aggressor flag. What follows is
// pressure INFERRED FROM CANDLES: where each minute closed inside its own range,
// weighted by that minute's volume. Every result is labelled `source: 'candles'`
// so the UI can say so and never imply it read the book.
//
//   buyVolume  = volume * (close - low)  / (high - low)
//   sellVolume = volume * (high - close) / (high - low)
//
// which is the standard close-location value applied to volume. A minute that
// closes on its high counts fully as buying, on its low fully as selling.
function pressure(A, ctx) {
  if (!A || !A.state) return null;
  var c = ctx || {}, bars = A.bars, n = bars.length;
  if (!n) return null;
  var WIN = c.window || 15, RECENT = c.recent || 5;
  var b = bars[n - 1], atr = b.atr20 || b.avgRange || 1;

  var split = function (list) {
    var buy = 0, sell = 0;
    list.forEach(function (x) {
      var rng = x.high - x.low;
      // A zero-range minute has no information about who won it.
      if (rng <= 0 || !x.volume) return;
      var clv = (x.close - x.low) / rng;
      buy += x.volume * clv; sell += x.volume * (1 - clv);
    });
    var tot = buy + sell;
    return { buy: buy, sell: sell, total: tot, buyPct: tot > 0 ? buy / tot * 100 : 50 };
  };

  // The closing auction is excluded: it is one print, not a minute of trading.
  var usable = bars.filter(function (x) { return !x.auction; });
  var win = usable.slice(-WIN), recent = usable.slice(-RECENT), prior = usable.slice(-(WIN), -RECENT);
  if (win.length < 3) return null;

  var W = split(win), R = split(recent), P = prior.length >= 3 ? split(prior) : null;
  var buyPct = Math.round(W.buyPct), sellPct = 100 - buyPct;

  // Strengthening / weakening is measured per side, on volume actually traded,
  // not on the percentage alone: a side can gain share while doing less.
  var perBar = function (s, list) { return list.length ? s / list.length : 0; };
  var dBuy = P ? perBar(R.buy, recent) - perBar(P.buy, prior) : 0;
  var dSell = P ? perBar(R.sell, recent) - perBar(P.sell, prior) : 0;
  var scale = P ? Math.max(perBar(P.buy, prior) + perBar(P.sell, prior), 1) : 1;
  // A side is only strengthening if it is doing MORE and taking MORE of the
  // flow. Without the share test a volume surge would read as both sides
  // strengthening at once, which tells the trader nothing.
  var dShare = P ? R.buyPct - P.buyPct : 0;
  var trendOf = function (d, shareDelta) {
    var rel = d / scale;
    if (rel >= 0.15 && shareDelta > -3) return 'מתחזקים';
    if (rel <= -0.15 || shareDelta < -8) return 'נחלשים';
    return 'ללא שינוי';
  };
  var buyersTrend = trendOf(dBuy, dShare), sellersTrend = trendOf(dSell, -dShare);

  // Is the nearby level being defended or absorbed?
  var T = c.tactical || E.tactical(A);
  // Level condition comes from levelState(), which is anchored to the current
  // price. Volume only adds the "absorbed" nuance on top of it.
  var levelVerdict = function (level, isSupport) {
    if (!level) return null;
    var ls = levelState(A, level.price, isSupport);
    if (!ls) return null;
    var near = usable.filter(function (x) {
      return x.low <= level.price + 0.3 * atr && x.high >= level.price - 0.3 * atr;
    }).slice(-12);
    var vol = near.length ? near.reduce(function (s, x) { return s + x.volume; }, 0) / near.length : 0;
    var avgVol = usable.reduce(function (s, x) { return s + x.volume; }, 0) / usable.length;
    var heavy = avgVol > 0 && vol / avgVol >= 1.2;
    var parked = near.filter(function (x) { return Math.abs(x.close - level.price) <= 0.2 * atr; }).length;
    var absorbed = heavy && parked >= 3 && (ls.state === 'testing' || ls.state === 'approaching');
    return { price: level.price, state: ls.state, verdict: absorbed ? 'נבלעת' : ls.text,
      distanceR: ls.distanceR, touches: near.length, heavy: heavy,
      held: ls.recoveries, through: isSupport ? (ls.state === 'broken' ? 2 : 0) : (ls.state === 'broken' ? 2 : 0) };
  };
  var sup = levelVerdict(T.support, true), res = levelVerdict(T.resistance, false);

  // Does the flow agree with the setup on the table?
  var plan = c.plan || null;
  var bullishSetup = plan && ['WAITING_FOR_ZONE', 'IN_ZONE', 'READY_PARTIAL', 'WAITING_FOR_CONFIRMATION', 'READY_ADD', 'ACTIVE', 'TAKE_PROFIT_AREA'].indexOf(plan.state) >= 0;
  var side = buyPct >= 58 ? 'buyers' : buyPct <= 42 ? 'sellers' : 'balanced';
  // Who is winning now and which way that is heading are two different facts.
  // "Buyers 64%" plus "buyers weakening" is not support for a long — it is a
  // lead that is being given back, and the wording has to say so.
  var direction = (buyersTrend === 'מתחזקים' || sellersTrend === 'נחלשים') ? 'improving'
    : (buyersTrend === 'נחלשים' || sellersTrend === 'מתחזקים') ? 'deteriorating' : 'steady';
  var conclusion;
  if (side === 'buyers') conclusion = direction === 'deteriorating' ? 'הקונים עדיין מובילים, אבל הלחץ שלהם נחלש'
    : direction === 'improving' ? 'הקונים מובילים והלחץ שלהם מתחזק' : 'הקונים מובילים, ללא שינוי בעוצמה';
  else if (side === 'sellers') conclusion = direction === 'improving' ? 'המוכרים מובילים אבל הלחץ שלהם נחלש'
    : direction === 'deteriorating' ? 'המוכרים מובילים והלחץ שלהם מתחזק' : 'המוכרים מובילים, ללא שינוי בעוצמה';
  else conclusion = direction === 'improving' ? 'הכוחות שקולים, הקונים משתפרים'
    : direction === 'deteriorating' ? 'הכוחות שקולים, המוכרים משתפרים' : 'הכוחות שקולים';
  var agreement = !bullishSetup ? 'לא רלוונטי'
    : (side === 'buyers' && direction !== 'deteriorating') ? 'תומך'
    : (side === 'buyers' && direction === 'deteriorating') ? 'תומך אך נחלש'
    : side === 'sellers' ? 'סותר'
    : direction === 'deteriorating' ? 'נוטה נגד' : 'ניטרלי';

  // Net contribution to the up-side, in the same units the probability model uses.
  var tilt = 0;
  if (side === 'buyers') tilt += 1; else if (side === 'sellers') tilt -= 1;
  if (buyersTrend === 'מתחזקים') tilt += 1;
  if (buyersTrend === 'נחלשים') tilt -= 1;
  if (sellersTrend === 'מתחזקים') tilt -= 1;
  if (sellersTrend === 'נחלשים') tilt += 1;
  if (sup && (sup.state === 'held' || sup.state === 'reclaimed')) tilt += 1;
  if (sup && (sup.state === 'broken' || sup.verdict === 'נבלעת')) tilt -= 1;
  if (res && res.state === 'broken') tilt += 1;
  if (res && (res.state === 'rejected' || res.verdict === 'נבלעת')) tilt -= 1;

  return {
    source: 'candles',                       // never 'orderbook' — we have none
    hasOrderBook: false, hasTape: false,
    buyPct: buyPct, sellPct: sellPct,
    side: side, buyersTrend: buyersTrend, sellersTrend: sellersTrend,
    support: sup, resistance: res, agreement: agreement, tilt: tilt,
    direction: direction, conclusion: conclusion,
    window: win.length, recentWindow: recent.length,
    summary: 'קונים ' + buyPct + '% · מוכרים ' + sellPct + '%',
    trendSummary: 'קונים ' + buyersTrend + ' · מוכרים ' + sellersTrend
  };
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
    tod: b.time < '10:30' ? 'open' : b.time < '14:30' ? 'mid' : 'late',
    flow: (function () { var p = (ctx && ctx.pressure) || pressure(A, {}); return p ? p.side : 'NA'; })()
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
// Pull an estimate toward 50 in proportion to how much the model actually
// knows. Full confidence (>=70) keeps the number as computed.
function shrink(pct, confidence) {
  var f = Math.max(0, Math.min(1, confidence / 70));
  return Math.round(50 + (pct - 50) * f);
}

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
      out.raw = out.up;
      out.up = shrink(out.raw, out.confidence);
      out.down = 100 - out.up;
      out.lowConfidence = out.confidence < 50;
      out.why.push(hit.n + ' מקרים דומים בהיסטוריה של הנייר');
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
  var pres = c.pressure || pressure(A, { tactical: T });
  if (pres) {
    out.pressure = pres;
    add(Math.max(-3, Math.min(3, pres.tilt)), 'לחץ קונים/מוכרים ' + pres.buyPct + '/' + pres.sellPct);
  }
  // Distance asymmetry: the nearer level is simply likelier to be reached.
  var dU = (upper - b.close) / atr, dD = (b.close - lower) / atr;
  var geom = dU + dD > 0 ? (dD - dU) / (dU + dD) : 0;
  add(Math.round(geom * 3), 'הרמה ' + (geom > 0 ? 'העליונה' : 'התחתונה') + ' קרובה יותר');
  var pct = Math.round(100 / (1 + Math.exp(-score / 3.2)));
  out.source = 'model';
  out.confidence = Math.max(20, Math.min(55, 25 + Math.abs(score) * 3));
  out.raw = Math.max(10, Math.min(90, pct));
  // A number like 87% next to "confidence 43" reads as certainty the model does
  // not have. The displayed probability is pulled toward 50 in proportion to
  // the confidence, so the two can never tell different stories.
  out.up = shrink(out.raw, out.confidence);
  out.down = 100 - out.up;
  out.lowConfidence = out.confidence < 50;
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
  SESSION_CLOSED: 'המסחר הסתיים',
  WATCH_ONLY: 'לא לסחור — רק לעקוב',
  DO_NOT_CHASE: 'לא לרדוף — להמתין לפולבק'
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
  DO_NOT_CHASE: 'DO_NOT_CHASE',
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

  // ---- one active scenario only. The plan already picked pullback OR
  // breakout; whatNow must never narrate the other one as a live instruction.
  var scenario = !P || !P.kind ? { kind: 'none', label: 'אין setup פעיל' }
    : P.kind === 'breakout' ? { kind: 'breakout', label: 'פריצה מעל ' + n2(watch) }
    : { kind: 'pullback', label: 'חזרה לאזור ' + n2(P.zone[0]) + '–' + n2(P.zone[1]) };

  // ---- no-edge gate. When the model's own numbers say there is nothing here,
  // it must not offer an entry "if X happens".
  var edge = c.edge || null;
  var noEdge = !!(edge && edge.noEdge);
  var actionKey = ended ? 'SESSION_CLOSED'
    : noEdge ? 'WATCH_ONLY'
    : (PLAN_TO_ACTION[P ? P.state : 'NO_SETUP'] || 'DO_NOT_BUY');
  var W = { action: actionKey, actionText: ACTIONS[actionKey], sessionEnded: !!ended,
    price: b.close, watch: watch, probability: prob, plan: P, scenario: scenario,
    noEdge: noEdge, edge: edge, up: [], down: [], why: [] };

  // The one line that matters
  if (ended) W.next = 'המסחר הסתיים — הרמות למטה הן לקראת המסחר הבא, לא להוראה עכשיו';
  else if (noEdge) W.next = 'אין כרגע יתרון מספיק לכניסה. לעקוב אם המחיר מגיע ל-' + n2(watch) + '.';
  else if (P && P.state === 'FAILED') W.next = 'אין כניסה. צריך מצב חדש לפני שמסתכלים שוב.';
  else if (P && (P.state === 'READY_PARTIAL' || P.state === 'READY_ADD')) W.next = 'המחיר במקום שתכננו — ' + P.headline;
  else W.next = 'לשים לב אם המחיר מגיע ל-' + n2(watch);

  // If it goes up
  var above = T.above.filter(function (l) { return l.price > b.close + 0.05 * atr; });
  var t1 = above[1] ? above[1].price : watch + 1.2 * atr;
  var t2 = above[2] ? above[2].price : t1 + 1.5 * atr;
  if (noEdge && !ended) {
    // What would have to change before any entry is even discussed.
    W.up.push('אם המחיר עולה מעל ' + n2(watch) + ' ונשאר שם — ייבחן מחדש');
    W.up.push('כרגע אין הוראת כניסה');
  } else if (!ended) {
    if (P && P.state === 'READY_PARTIAL' && hasZone) {
      W.up.push('אם המחיר נשאר מעל ' + n2(P.zone[0]) + ' — אפשר להיכנס בחלק מהסכום סביב ' + n2(P.entry));
      W.up.push('אם אחרי זה עולה מעל ' + n2(P.addAbove) + ' ונשאר שם — אפשר להוסיף');
    } else if (scenario.kind === 'breakout' && P.entry != null) {
      W.up.push('אם עובר את ' + n2(watch) + ' ונשאר מעל — אפשר להיכנס סביב ' + n2(P.entry));
    } else if (scenario.kind === 'pullback' && hasZone) {
      W.up.push('אם המחיר יורד לאזור ' + n2(P.zone[0]) + '–' + n2(P.zone[1]) + ' ונבלם — כניסה חלקית ב-' + n2(P.entry));
      W.up.push('אם אחרי זה עולה מעל ' + n2(P.addAbove) + ' — אפשר להוסיף');
    } else {
      W.up.push('אם עולה מעל ' + n2(watch) + ' ונשאר שם — להתחיל לעקוב מקרוב');
    }
    if (!noEdge) { W.up.push('יעד ראשון ' + n2(t1) + ' — שם לממש חלק'); W.up.push('יעד שני ' + n2(t2)); }
  } else {
    W.up.push('הרמה החשובה למעלה הייתה ' + n2(watch));
  }

  // If it goes down
  var below = T.below.filter(function (l) { return l.price < b.close - 0.05 * atr; });
  var s1 = T.support ? T.support.price : (below[0] ? below[0].price : b.close - atr);
  var s2 = below.find(function (l) { return l.price < s1 - 0.1 * atr; });
  var s3 = P && P.invalidation != null ? P.invalidation : (s2 ? s2.price - 0.5 * atr : s1 - atr);
  if (noEdge && !ended) {
    W.down.push('אם יורד ל-' + n2(s1) + ' — לבדוק אם קונים נכנסים שם');
    W.down.push('מתחת ' + n2(s3) + ' — התרחיש החיובי יורד מהפרק');
  } else if (!ended) {
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
  var pres = c.pressure || pressure(A, { tactical: T, plan: P });
  if (pres) {
    W.pressure = pres;
    W.why.push('בדקות האחרונות ' + (pres.side === 'buyers' ? 'הקונים חזקים יותר' : pres.side === 'sellers' ? 'המוכרים חזקים יותר' : 'הכוחות שקולים')
      + ' (' + pres.buyPct + '/' + pres.sellPct + ')');
    if (pres.support && pres.support.state !== 'far')
      W.why.push('התמיכה ב-' + n2(pres.support.price) + ' ' + pres.support.verdict);
    if (pres.resistance && pres.resistance.state !== 'far')
      W.why.push('ההתנגדות ב-' + n2(pres.resistance.price) + ' ' + pres.resistance.verdict);
  }
  return W;
}


// ---------------------------------------------------------------- ticker state
//
// ONE snapshot per symbol per refresh. Every UI surface — the radar row and the
// detail sheet — renders from this object, so a score can never differ between
// them. Nothing downstream recalculates.
//
// Level roles are explicit and each level has exactly one job:
//   watch                 the price we are waiting for
//   entry                 where a position would actually be opened
//   target1 / target2     profit areas, always above entry for a long
//   tacticalInvalidation  cancels the immediate entry idea
//   hardStop              structure is broken; the whole idea is off
//   probUpper / probLower the two boundaries the probability question uses
var STATE_VERSION = 4;

function buildTickerState(symbol, A, ctx) {
  var c = ctx || {};
  var now = c.now || Date.now();
  if (!A || !A.state) {
    return { symbol: symbol, state_version: STATE_VERSION, calculated_at: now, data_through: null,
      valid: false, violations: [{ code: 'NO_DATA', severity: 'block', text: 'אין נתונים' }],
      status: 'NO DATA', action: 'DO_NOT_BUY', actionText: ACTIONS.DO_NOT_BUY };
    }
  var S = A.state, b = S.bar, atr = b.atr20 || b.avgRange || 1;
  var T = E.tactical(A);
  var plan = E.executionPlan(A, { label: c.market || 'Neutral' });
  var pres = pressure(A, { tactical: T, plan: plan });

  // --- levels, derived once
  var lv = { watch: null, entry: null, target1: null, target2: null,
    tacticalInvalidation: null, hardStop: null, probUpper: null, probLower: null };
  if (plan && plan.kind) {
    lv.watch = plan.kind === 'breakout' ? plan.zone[0] : plan.zone[1];
    lv.entry = plan.entry;
    lv.tacticalInvalidation = plan.kind === 'breakout' ? plan.zone[0] - 0.2 * atr : plan.zone[0];
    lv.hardStop = plan.invalidation;
  } else {
    lv.watch = T.resistance ? T.resistance.price : b.dayHigh;
    lv.tacticalInvalidation = T.support ? T.support.price : b.dayLow;
    lv.hardStop = lv.tacticalInvalidation - 0.5 * atr;
  }
  // Targets are always resolved ABOVE the entry. A level at or below the entry
  // can be the watch level or resistance, but never target 1.
  // With no entry planned, targets are measured from the WATCH level, not from
  // the current price — otherwise the first level above price is both the thing
  // we are waiting for and the first target, which is meaningless.
  var anchor = lv.entry != null ? lv.entry : (lv.watch != null ? lv.watch : b.close);
  var aboveEntry = T.above.filter(function (x) { return x.price >= anchor + 0.3 * atr; })
    .sort(function (x, y) { return x.price - y.price; });
  lv.target1 = aboveEntry[0] ? aboveEntry[0].price : anchor + 1.0 * atr;
  lv.target2 = aboveEntry[1] && aboveEntry[1].price >= lv.target1 + 0.3 * atr ? aboveEntry[1].price : lv.target1 + 1.0 * atr;
  lv.probUpper = lv.watch;
  lv.probLower = lv.tacticalInvalidation;

  var prob = pathProbability(A, { tactical: T, upper: lv.probUpper, lower: lv.probLower, horizonMin: 60,
    daily: c.daily, baseline: c.baseline, calibration: c.calibration, market: c.market, pressure: pres });

  // ---- edge check. The recommendation has to agree with the model's own
  // numbers: a low score, a coin-flip probability, low confidence and balanced
  // flow together mean there is nothing to act on, whatever the plan says.
  var row0 = E.radarRow(symbol, A, c.marketCtx || { label: c.market || 'Neutral' }, c.freshness);
  var score0 = row0.bl ? row0.bl.confidence : 0;
  var weak = [];
  if (score0 <= 2) weak.push('ציון setup נמוך');
  if (Math.abs(prob.up - 50) <= 8) weak.push('הסיכויים שקולים');
  if (prob.confidence < 50) weak.push('ביטחון נמוך');
  if (pres && pres.side === 'balanced') weak.push('קונים ומוכרים מאוזנים');
  var structureFlat = (row0.structure === 'RANGE') && (row0.momentum === 'FLAT');
  if (structureFlat) weak.push('אין מבנה ואין מומנטום');
  var edge = { noEdge: weak.length >= 4, reasons: weak, score: score0,
    probUp: prob.up, confidence: prob.confidence, flow: pres ? pres.side : 'NA' };

  var W = whatNow(A, { tactical: T, plan: plan, market: c.market, daily: c.daily,
    baseline: c.baseline, calibration: c.calibration, pressure: pres, probability: prob,
    sessionEnded: c.sessionEnded, levels: lv, edge: edge });

  // Nothing actionable may remain on the state when there is no edge, so the
  // technical block underneath cannot contradict the headline.
  if (edge.noEdge && !c.sessionEnded) {
    lv.entry = null; lv.target1 = null; lv.target2 = null;
  }
  var row = row0;

  var st = {
    symbol: symbol, state_version: STATE_VERSION, calculated_at: now,
    data_through: { time: b.time, date: b.date || c.date || null, unix: b.unix != null ? b.unix : null },
    price: b.close, atr: atr,
    status: row.status, score: row.bl ? row.bl.confidence : 0,
    action: W.action, actionText: W.actionText,
    structure: row.structure, momentum: row.momentum,
    levels: lv, plan: plan, tactical: T, pressure: pres, probability: prob, whatNow: W,
    scenario: W.scenario, edge: edge, noEdge: edge.noEdge,
    levelStates: { support: T.support ? levelState(A, T.support.price, true) : null,
                   resistance: T.resistance ? levelState(A, T.resistance.price, false) : null },
    row: row, sessionEnded: !!c.sessionEnded, freshness: c.freshness || 'LIVE'
  };
  // Keep the row pointing at the same snapshot so nothing can drift.
  row.score = st.score; row.state = st; row.pressure = pres;
  if (edge.noEdge && !c.sessionEnded) {
    row.status = row.status === 'AVOID' ? 'AVOID' : 'WATCH';
    row.why = 'אין יתרון — רק מעקב';
    st.status = row.status; st.action = 'WATCH_ONLY'; st.actionText = ACTIONS.WATCH_ONLY;
  }
  var v = validateState(st);
  st.violations = v.violations; st.valid = v.valid;
  if (!v.valid) {
    st.status = 'AVOID';
    st.action = 'DO_NOT_BUY';
    st.actionText = 'המתן — מצב המודל לא עקבי';
    st.whatNow.actionText = st.actionText;
    st.whatNow.next = 'הנתונים סותרים את עצמם, לכן לא מוצגת הוראת מסחר. יחושב מחדש בעדכון הבא.';
    st.whatNow.up = []; st.whatNow.down = [];
    // Nothing actionable may survive a blocked state.
    st.levels = Object.assign({}, st.levels, { entry: null, target1: null, target2: null });
  }
  return st;
}

// ---------------------------------------------------------------- validation
// Runs before anything is shown. A blocking violation replaces the trade
// instruction with an explicit "state inconsistent" message rather than
// letting a wrong instruction reach the screen.
function validateState(st) {
  var v = [], add = function (code, severity, text) { v.push({ code: code, severity: severity, text: text }); };
  var lv = st.levels, p = st.price, plan = st.plan, atr = st.atr;
  var actionable = ['ENTRY_AVAILABLE', 'HOLD', 'TAKE_PARTIAL'].indexOf(st.action) >= 0
    || ['READY', 'ACTIVE'].indexOf(st.status) >= 0;

  if (lv.entry != null) {
    if (lv.target1 != null && lv.target1 <= lv.entry) add('TARGET_BELOW_ENTRY', 'block', 'יעד ראשון ' + n2(lv.target1) + ' אינו מעל הכניסה ' + n2(lv.entry));
    if (lv.target2 != null && lv.target1 != null && lv.target2 <= lv.target1) add('TARGET2_BELOW_TARGET1', 'block', 'יעד שני אינו מעל יעד ראשון');
    if (lv.hardStop != null && lv.hardStop >= lv.entry) add('STOP_ABOVE_ENTRY', 'block', 'הסטופ ' + n2(lv.hardStop) + ' אינו מתחת לכניסה ' + n2(lv.entry));
    if (lv.tacticalInvalidation != null && lv.hardStop != null && lv.hardStop > lv.tacticalInvalidation)
      add('STOP_ORDER', 'warn', 'הסטופ המבני אינו מתחת לביטול הטקטי');
    // an entry the price has already left behind must not read as available
    if (actionable && p > lv.entry + 0.6 * atr) add('ENTRY_BEHIND_PRICE', 'block', 'המחיר כבר רחוק מעל אזור הכניסה');
  }
  if (lv.probUpper != null && lv.probLower != null && lv.probUpper <= lv.probLower)
    add('PROB_BOUNDS', 'block', 'גבולות ההסתברות אינם בסדר הנכון');
  if (lv.watch != null && lv.target1 != null && Math.abs(lv.watch - lv.target1) < 1e-9)
    add('LEVEL_DOUBLE_ROLE', 'block', 'אותה רמה משמשת גם כרמת מעקב וגם כיעד');

  // descriptive text must agree with where price is
  var pf = st.pressure;
  if (pf && pf.support && pf.support.verdict === 'נשברת' && p > pf.support.price + 0.05 * st.atr)
    add('TEXT_CONTRADICTS_PRICE', 'block', 'נטען שהתמיכה נשברת בזמן שהמחיר מעליה');
  if (pf && pf.resistance && pf.resistance.verdict === 'נפרצת' && p < pf.resistance.price - 0.05 * st.atr)
    add('TEXT_CONTRADICTS_PRICE', 'block', 'נטען שההתנגדות נפרצת בזמן שהמחיר מתחתיה');

  // the headline and the technical block must describe the same situation
  var passive = ['DO_NOT_BUY', 'WATCH_ONLY', 'SESSION_CLOSED', 'SETUP_CANCELLED'].indexOf(st.action) >= 0;
  if (passive && lv.entry != null) add('ACTION_VS_ENTRY', 'block', 'ההוראה היא להמתין בזמן שמוצגת רמת כניסה');
  if (passive && st.whatNow && st.whatNow.up.some(function (s) { return /אפשר להיכנס|כניסה חלקית ב-/.test(s); }))
    add('ACTION_VS_INSTRUCTION', 'block', 'ההוראה היא להמתין בזמן שמוצגת הוראת כניסה');
  if (st.noEdge && lv.target1 != null) add('NO_EDGE_TARGETS', 'block', 'אין יתרון אבל מוצגים יעדים');
  // exactly one entry scenario may be narrated at a time
  if (st.whatNow) {
    var entryLines = st.whatNow.up.filter(function (s) { return /אפשר להיכנס|כניסה חלקית ב-/.test(s); });
    var mentionsBoth = entryLines.some(function (s) { return /עובר את/.test(s); })
      && entryLines.some(function (s) { return /יורד לאזור/.test(s); });
    if (mentionsBoth) add('TWO_SCENARIOS', 'block', 'מוצגים שני תרחישי כניסה במקביל');
  }
  // a level description must match its current state
  if (st.levelStates && st.levelStates.support && st.pressure && st.pressure.support) {
    if (st.pressure.support.verdict === 'נשברה' && st.levelStates.support.state !== 'broken')
      add('LEVEL_TEXT_STALE', 'block', 'תיאור התמיכה אינו תואם את מצבה הנוכחי');
  }

  // status vs plan
  if (st.status === 'ACTIVE' && plan && plan.state === 'FAILED') add('STATUS_VS_PLAN', 'block', 'הסטטוס פעיל בזמן שה-setup בוטל');
  if (st.status === 'READY' && st.action === 'DO_NOT_BUY') add('ACTION_VS_STATUS', 'block', 'סטטוס מוכן מול הוראה לא לקנות');

  // pressure conclusion vs its own numbers
  if (pf && pf.agreement === 'תומך' && pf.direction === 'deteriorating')
    add('PRESSURE_CONCLUSION', 'block', 'נטען שהלחץ תומך בזמן שהוא נחלש');
  if (pf && pf.agreement === 'תומך' && pf.buyPct < 50)
    add('PRESSURE_CONCLUSION', 'block', 'נטען שהקונים תומכים בזמן שהם במיעוט');

  // probability vs confidence
  var pr = st.probability;
  if (pr && pr.confidence < 50 && (pr.up >= 80 || pr.up <= 20))
    add('PROB_CONFIDENCE', 'block', 'הסתברות קיצונית עם ביטחון נמוך');
  if (pr && pr.upper != null && lv.probUpper != null && Math.abs(pr.upper - lv.probUpper) > 1e-9)
    add('PROB_STALE_LEVELS', 'block', 'ההסתברות חושבה מול רמות אחרות מאלה שמוצגות');

  return { valid: !v.some(function (x) { return x.severity === 'block'; }), violations: v };
}


// ---------------------------------------------------------------- analysis pack
//
// Everything another trader (or another model) needs to re-do the analysis from
// scratch: the raw data AND the decision state, from ONE snapshot. Any field the
// system does not have says NOT AVAILABLE rather than being quietly dropped.
var NA = 'NOT AVAILABLE';
function nz(v, d) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? NA : (d != null && typeof v === 'number' ? v.toFixed(d) : String(v)); }

function aggregate(rows, minutes) {
  var out = [], bucket = null;
  (rows || []).forEach(function (r) {
    var m = parseInt(r.time.slice(0, 2), 10) * 60 + parseInt(r.time.slice(3), 10);
    var key = Math.floor(m / minutes);
    if (!bucket || bucket.key !== key) {
      if (bucket) out.push(bucket);
      bucket = { key: key, time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, date: r.date };
    } else {
      bucket.high = Math.max(bucket.high, r.high); bucket.low = Math.min(bucket.low, r.low);
      bucket.close = r.close; bucket.volume += r.volume;
    }
  });
  if (bucket) out.push(bucket);
  return out;
}
function candleLine(sym, r, avgVol) {
  var range = r.high - r.low, pct = function (x) { return range > 0 ? Math.round(x / range * 1000) / 10 : 0; };
  var dir = r.close > r.open ? 'BULL' : r.close < r.open ? 'BEAR' : 'FLAT';
  return [sym, r.date || '', r.time, r.open, r.high, r.low, r.close, r.volume, dir,
    pct(Math.abs(r.close - r.open)), pct(r.high - Math.max(r.open, r.close)), pct(Math.min(r.open, r.close) - r.low),
    Math.round(range * 10000) / 10000, avgVol > 0 ? Math.round(r.volume / avgVol * 100) / 100 : 0].join(',');
}
var CANDLE_HEADER = 'symbol,date,time,open,high,low,close,volume,dir,body_pct,upper_wick_pct,lower_wick_pct,range,vol_x';

function analysisPack(ctx) {
  var c = ctx || {}, st = c.snap;
  var L = [], add = function (s) { L.push(s == null ? '' : s); };
  var head = function (t) { add(''); add('===== ' + t + ' ====='); };
  if (!st) return 'NO SNAPSHOT — ' + NA;
  var A = c.analysis, b = st.price != null ? st : null;
  var bar = A && A.state ? A.state.bar : null;
  var lv = st.levels || {}, P = st.plan, W = st.whatNow, pr = st.probability, pf = st.pressure;
  var rows = c.rows || [], atr = st.atr;

  add('FULL ANALYSIS PACK · ' + st.symbol);
  add('Generated from one atomic snapshot: state_version ' + st.state_version + ', calculated_at ' + new Date(st.calculated_at).toISOString());

  head('1. TIME & DATA STATE');
  add('Symbol: ' + st.symbol);
  add('Date (ET): ' + nz(st.data_through && st.data_through.date || c.date));
  add('Last closed candle (ET): ' + nz(st.data_through && st.data_through.time));
  add('Current price (last close): ' + nz(st.price, 2));
  add('Quote timestamp: ' + nz(c.quoteTime) + '   (the feed is 1-minute bars; there is no separate quote stream)');
  add('Data age / stale seconds: ' + nz(c.staleSeconds));
  add('Freshness: ' + nz(st.freshness));
  add('Session: ' + nz(c.session) + '   (PRE / REGULAR / AFTER / CLOSED)');
  add('Data source: Yahoo Finance 1-minute bars via Cloudflare Worker');

  head('2. MODEL DECISION');
  add('Status: ' + nz(st.status));
  add('Primary action: ' + nz(st.actionText) + ' [' + nz(st.action) + ']');
  add('Setup Score: ' + nz(st.score) + '/10');
  add('Active setup type: ' + (st.scenario ? st.scenario.kind + ' — ' + st.scenario.label : NA));
  add('Setup state: ' + (P ? P.state : NA));
  add('Reason: ' + (W ? nz(W.next) : NA));
  add('Model state valid: ' + (st.valid ? 'yes' : 'NO — ' + (st.violations || []).map(function (v) { return v.code; }).join(', ')));
  if (st.noEdge) add('No-edge reasons: ' + ((st.edge && st.edge.reasons) || []).join(' · '));

  head('3. PRICE LEVELS AND THEIR ROLES');
  var role = function (name, val, note) {
    add(name + ': ' + (val == null ? NA : val.toFixed(2) + (atr ? '  (' + E.fmtR((val - st.price) / atr) + ')' : '')) + (note ? '  — ' + note : ''));
  };
  role('Watch level', lv.watch, 'the price being waited for');
  role('Entry zone low', P && P.zone ? P.zone[0] : null);
  role('Entry zone high', P && P.zone ? P.zone[1] : null);
  role('Planned entry', lv.entry);
  role('Breakout / reclaim trigger', P && P.kind === 'breakout' ? lv.watch : (st.plan && st.plan.addAbove != null ? st.plan.addAbove : null), 'confirms an add');
  role('Tactical support', st.tactical && st.tactical.support ? st.tactical.support.price : null, st.tactical && st.tactical.support ? st.tactical.support.why : '');
  role('Tactical resistance', st.tactical && st.tactical.resistance ? st.tactical.resistance.price : null, st.tactical && st.tactical.resistance ? st.tactical.resistance.why : '');
  role('Entry cancellation (tactical)', lv.tacticalInvalidation);
  role('Setup invalidation / structural stop', lv.hardStop);
  role('Stop', lv.hardStop, 'same as structural invalidation; no separate money stop is computed');
  role('Target 1', lv.target1);
  role('Target 2', lv.target2);
  add('Target 3: ' + NA);
  role('Reclaim level (broken and being retested)', st.plan && st.plan.state !== 'FAILED' && A && A.state ? A.state.reclaim : null);
  add('');
  add('Level states (approaching / testing / held / broken / reclaimed / rejected / lost / far):');
  ['support', 'resistance'].forEach(function (k) {
    var s = st.levelStates && st.levelStates[k];
    add('  ' + k + ': ' + (s ? s.price.toFixed(2) + ' — ' + s.state + ' (' + LEVEL_TEXT[s.state] + '), ' + E.fmtR(s.distanceR) + ', touches ' + s.touches + ', recoveries ' + s.recoveries + ', rejections ' + s.rejections : NA));
  });

  head('4. WHAT-IF');
  add('NOW: ' + (W ? W.actionText + ' — ' + W.next : NA));
  add('IF UP:');
  ((W && W.up) || []).forEach(function (s) { add('  - ' + s); });
  if (!W || !W.up.length) add('  ' + NA);
  add('IF DOWN:');
  ((W && W.down) || []).forEach(function (s) { add('  - ' + s); });
  if (!W || !W.down.length) add('  ' + NA);
  add('Confirms entry: ' + (P ? nz(P.ifConfirmed) : NA));
  add('Cancels entry: ' + (lv.tacticalInvalidation != null ? 'close below ' + lv.tacticalInvalidation.toFixed(2) : NA));
  add('Cancels the whole setup: ' + (lv.hardStop != null ? 'close below ' + lv.hardStop.toFixed(2) : NA));
  add('After entry: ' + (P ? nz(P.nextStep) : NA));
  add('At target 1: ' + (lv.target1 != null ? 'take partial at ' + lv.target1.toFixed(2) : NA));
  add('Add to position when: ' + (P && P.addAbove != null ? 'two closes above ' + P.addAbove.toFixed(2) : NA));
  add('Exit when: ' + (lv.hardStop != null ? 'close below ' + lv.hardStop.toFixed(2) + ', or at target' : NA));

  head('5. PROBABILITY');
  if (!pr) add(NA); else {
    add('UP: ' + pr.up + '%   DOWN: ' + pr.down + '%');
    add('Event measured: price reaches ' + pr.upper.toFixed(2) + ' before ' + pr.lower.toFixed(2));
    add('Horizon: ' + pr.horizonMin + ' minutes');
    add('Confidence: ' + pr.confidence + '/100' + (pr.lowConfidence ? '  (LOW — displayed % is pulled toward 50)' : ''));
    add('Source: ' + (pr.source === 'empirical' ? 'empirical, ' + pr.n + ' comparable cases in this symbol\'s own loaded history'
      : 'MODEL ESTIMATE — not a measured frequency' + (pr.raw != null ? ' (raw ' + pr.raw + '%, shrunk for confidence)' : '')));
    add('Why: ' + pr.why.join(' | '));
  }

  head('6. BUYERS / SELLERS (inferred from candles)');
  if (!pf) add(NA); else {
    add('Buyers: ' + pf.buyPct + '%   Sellers: ' + pf.sellPct + '%   (window ' + pf.window + ' bars)');
    add('Buyers: ' + pf.buyersTrend + '   Sellers: ' + pf.sellersTrend + '   Direction: ' + pf.direction);
    add('Conclusion: ' + pf.conclusion);
    add('Agreement with the setup: ' + pf.agreement);
    add('METHOD: close location inside each bar weighted by that bar\'s volume. NOT order flow. hasOrderBook=' + pf.hasOrderBook + ' hasTape=' + pf.hasTape);
  }

  head('7. ORDER BOOK / LEVEL 2');
  var bk = c.book;
  if (!bk || bk.error || !bk.summary || bk.summary.bid_pct == null) {
    add(NA + ' — the Cboe book did not return data for this symbol at this time');
  } else {
    var s = bk.summary;
    add('PARTIAL BOOK — CBOE ONLY');
    add('Venues returning data: ' + (s.venues_ok.join(', ') || NA) + '   Not answering: ' + (s.venues_failed.join(', ') || 'none'));
    add('Missing from this book: ARCA, NYSE, Nasdaq and all other venues. This is NOT the NBBO and NOT consolidated depth.');
    add('Book timestamp: ' + nz(bk.fetched_at));
    add('Best bid: ' + nz(s.best_bid, 2) + '   Best ask: ' + nz(s.best_ask, 2) + '   Spread: ' + nz(s.spread, 4));
    add('Total bid depth: ' + s.bid_shares + ' shares   Total ask depth: ' + s.ask_shares + ' shares');
    add('Imbalance: ' + s.bid_pct + '% bid / ' + s.ask_pct + '% ask  (net ' + s.imbalance + ')');
    add('Levels available: ' + s.depth_levels + ' per side per venue (' + NA + ' beyond 5 — the public viewer publishes 5)');
    add('');
    add('venue,side,level,price,shares');
    (bk.venues || []).forEach(function (v) {
      if (v.error) { add(v.venue + ',ERROR,,,' + v.error); return; }
      (v.asks || []).forEach(function (l, i) { add(v.venue + ',ask,' + (i + 1) + ',' + l.price + ',' + l.shares); });
      (v.bids || []).forEach(function (l, i) { add(v.venue + ',bid,' + (i + 1) + ',' + l.price + ',' + l.shares); });
    });
    add('');
    add('Depth change over the last 30-60s: ' + (c.bookPrev ? 'bid ' + (s.bid_shares - c.bookPrev.bid_shares) + ', ask ' + (s.ask_shares - c.bookPrev.ask_shares) : NA + ' (no earlier snapshot held)'));
  }

  head('8. TAPE / TIME & SALES');
  add('TAPE NOT AVAILABLE — this feed carries 1-minute bars only. No per-trade prints, no at-bid/at-ask flags, no aggressive volume split.');

  head('9. STRUCTURE & MOMENTUM');
  add('Main structure: ' + nz(st.structure) + (A && A.state ? '  (' + A.state.reason + ')' : ''));
  add('Announced trend: ' + (A && A.state ? nz(A.state.announced) : NA));
  add('Short momentum: ' + nz(st.momentum) + (st.row && st.row.mom ? '   move over last 5 bars: ' + st.row.mom.net.toFixed(2) + 'R' : ''));
  add('Recent swings (K=3 confirmed):');
  var sw = A ? A.swings.filter(function (w) { return w.confirmedAt <= A.bars.length - 1; }).slice(-10) : [];
  if (!sw.length) add('  ' + NA);
  sw.forEach(function (w) { add('  ' + w.label + '  ' + w.price.toFixed(2) + '  @' + w.time + (w.outside ? '  (outside bar — not counted as structure)' : '')); });

  head('10. INDICATORS');
  if (!bar) add(NA); else {
    add('VWAP: ' + bar.vwap.toFixed(2) + '   price is ' + (bar.aboveVwap ? 'ABOVE' : 'BELOW') + '   distance: ' + (st.price - bar.vwap).toFixed(2) + ' (' + E.fmtR((st.price - bar.vwap) / atr) + ')');
    add('EMA9: ' + bar.ema9.toFixed(2) + '   EMA20: ' + bar.ema20.toFixed(2) + '   state: ' + bar.align +
      '   separation: ' + Math.abs(bar.ema9 - bar.ema20).toFixed(3) + ' (minimum for a call: ' + (0.15 * atr).toFixed(3) + ')');
    add('Average candle range (20 bars): ' + atr.toFixed(4) + '   = 1R throughout this pack');
    add('Relative volume (vs session average): ' + bar.volx.toFixed(2) + 'x' + (bar.auction ? '  [CLOSING AUCTION BAR — excluded from scoring]' : ''));
    add('Time-of-day normalised volume: ' + (c.baseline ? (volxTod(bar, c.baseline) != null ? volxTod(bar, c.baseline).toFixed(2) + 'x vs the same minute on ' + c.baseline.days + ' prior days' : NA) : NA + ' (no prior days loaded)'));
    var dl = function (name, v) { return v == null ? name + ': ' + NA : name + ': ' + (st.price - v).toFixed(2) + ' (' + E.fmtR((st.price - v) / atr) + ')'; };
    add('Distance from levels — ' + dl('support', st.tactical && st.tactical.support ? st.tactical.support.price : null) +
      '   ' + dl('resistance', st.tactical && st.tactical.resistance ? st.tactical.resistance.price : null));
  }

  head('11. MARKET CONTEXT');
  var mk = c.marketCtx;
  if (!mk || !mk.parts || !mk.parts.length) add(NA); else {
    add('Regime: ' + mk.label);
    mk.parts.forEach(function (p) {
      add('  ' + p.symbol + ': ' + p.close.toFixed(2) + '   VWAP ' + p.vwap.toFixed(2) + ' (' + (p.aboveVwap ? 'above' : 'below') + ')   EMA ' + p.align + '   trend ' + p.trend);
    });
    add('Sector ETF: ' + (c.sectorEtf || NA));
    add('Does the market support this symbol: ' + (mk.label === 'Bullish' ? 'supports a long' : mk.label === 'Bearish' ? 'contradicts a long' : 'neutral'));
  }

  head('12. MULTI-DAY CONTEXT');
  var d = c.daily;
  if (!d) add(NA + ' — no prior sessions loaded'); else {
    add('Sessions loaded: ' + d.days + ' (prior: ' + d.priorDays + ')');
    add('Daily trend: ' + d.trend + ' (' + d.trendWhy + ')');
    add('Previous day: high ' + nz(d.prevHigh, 2) + '  low ' + nz(d.prevLow, 2) + '  close ' + nz(d.prevClose, 2));
    add('Gap today vs previous close: ' + nz(d.gap, 2));
    add('Average daily range: ' + nz(d.atrDaily, 2));
    add('');
    add('date,open,high,low,close,volume');
    (c.dailyBars || []).forEach(function (x) { add([x.date, x.open, x.high, x.low, x.close, x.volume].join(',')); });
    if (!(c.dailyBars || []).length) add(NA);
    var hi = (c.dailyBars || []).reduce(function (m, x) { return Math.max(m, x.high); }, -Infinity);
    var lo = (c.dailyBars || []).reduce(function (m, x) { return Math.min(m, x.low); }, Infinity);
    add('');
    add('Multi-day high/low: ' + (isFinite(hi) ? hi.toFixed(2) + ' / ' + lo.toFixed(2) : NA));
  }

  head('13. EVENTS');
  var evs = A ? A.events.slice(-40).reverse() : [];
  if (!evs.length) add(NA);
  evs.forEach(function (s2) {
    var parts = s2.events.map(function (e) {
      return e.type + (e.level != null ? ' @' + e.level.toFixed(2) : '') + (e.confirmed === true ? ' [confirmed]' : e.confirmed === false ? ' [unconfirmed]' : '') + (e.side ? ' ' + e.side : '');
    });
    if (parts.length) add(s2.time + '  ' + s2.close.toFixed(2) + '  ' + parts.join(' · ') + '  (score ' + s2.score + ')');
  });

  head('14. POSITION');
  var pos = c.position;
  if (!pos) {
    add('Position: NOT AVAILABLE — this application does not track positions, orders or account state.');
    add('Quantity / average entry / P&L / current stop / invested / remaining / partials taken: ' + NA);
  } else {
    add('Position: ' + nz(pos.state));
    add('Quantity: ' + nz(pos.qty) + '   Average entry: ' + nz(pos.avg, 2));
    add('P&L: ' + nz(pos.pnl, 2) + ' (' + nz(pos.pnlPct, 2) + '%)   Current stop: ' + nz(pos.stop, 2));
    add('Invested: ' + nz(pos.invested) + '   Remaining planned: ' + nz(pos.remaining) + '   Partials taken: ' + nz(pos.partials));
  }

  head('15. CANDLES — LAST 50 ONE-MINUTE (closed only)');
  var avgVol = rows.length ? rows.reduce(function (a2, x) { return a2 + x.volume; }, 0) / rows.length : 0;
  add(CANDLE_HEADER);
  rows.slice(-50).forEach(function (r) { add(candleLine(st.symbol, r, avgVol)); });
  if (!rows.length) add(NA);

  head('16. CANDLES — LAST 20 FIVE-MINUTE (aggregated from 1-minute)');
  var f5 = aggregate(rows, 5).slice(-20);
  add(CANDLE_HEADER);
  var avg5 = f5.length ? f5.reduce(function (a2, x) { return a2 + x.volume; }, 0) / f5.length : 0;
  f5.forEach(function (r) { add(candleLine(st.symbol, r, avg5)); });
  if (!f5.length) add(NA);

  head('17. CANDLES — LAST 10 DAILY');
  add('symbol,date,open,high,low,close,volume');
  (c.dailyBars || []).slice(-10).forEach(function (x) { add([st.symbol, x.date, x.open, x.high, x.low, x.close, x.volume].join(',')); });
  if (!(c.dailyBars || []).length) add(NA + ' — no prior sessions loaded');

  head('END OF PACK');
  add('Fields marked ' + NA + ' are genuinely absent from this data feed, not omitted.');
  return L.join('\n');
}

module.exports = { analysisPack: analysisPack, aggregate: aggregate, pressure: pressure, levelState: levelState, LEVEL_TEXT: LEVEL_TEXT, buildTickerState: buildTickerState, validateState: validateState, STATE_VERSION: STATE_VERSION, shrink: shrink, volumeBaseline: volumeBaseline, volxTod: volxTod, dailyContext: dailyContext,
  calibrate: calibrate, pathProbability: pathProbability, whatNow: whatNow, ACTIONS: ACTIONS, features: features,
  marketContext: E.marketContext };
