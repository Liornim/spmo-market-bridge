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
// A US regular session is 390 one-minute bars, 09:30 to 15:59, plus the 16:00
// auction print. Anything materially short of that is a session still being
// collected or one that was fetched mid-day — and aggregating it produces a
// daily candle that is simply wrong, with no outward sign.
//
// Measured: a WMT session truncated at 13:20 reported a high of 106.44 when the
// real high was 106.78, and that number reached the screen as "yesterday's
// high". A partial session is now marked and excluded from anything that claims
// to be a completed day.
var SESSION_BARS = 390, MIN_COVERAGE = 0.85;
// Counting bars alone is the wrong test. A thinly traded name has no print in
// some minutes and the feed omits them, so a COMPLETE session can arrive with
// 343 bars — PGR, BLK and HON were all refused that way. What actually
// distinguishes a complete session is that it SPANS the session: it starts at
// the open and runs to the close. A day truncated at 13:20 fails that however
// many bars it has.
function sessionSpans(rows) {
  if (!rows || !rows.length) return false;
  var times = rows.map(function (r) { return r.time; }).sort();
  return times[0] <= '09:35' && times[times.length - 1] >= '15:55';
}
function sessionCoverage(rows) {
  if (!rows || !rows.length) return 0;
  var regular = rows.filter(function (r) { return r.time >= '09:30' && r.time <= '16:00'; });
  return regular.length / SESSION_BARS;
}
function aggregateSession(rows) {
  var o = rows[0].open, c = rows[rows.length - 1].close;
  var h = -Infinity, l = Infinity, v = 0;
  rows.forEach(function (r) { h = Math.max(h, r.high); l = Math.min(l, r.low); v += r.volume; });
  var cov = sessionCoverage(rows), spans = sessionSpans(rows);
  return { date: rows[0].date, open: o, high: h, low: l, close: c, volume: v, range: h - l,
    closeStrength: h > l ? (c - l) / (h - l) : 0.5,
    bars: rows.length, coverage: Math.round(cov * 1000) / 1000, spans: spans,
    complete: spans && cov >= MIN_COVERAGE,
    hasAuction: rows.some(function (r) { return r.time === '16:00'; }),
    source: 'aggregated' };
}

function dailyContext(daysRows, opts) {
  var o2 = opts || {};
  var days = (daysRows || []).filter(function (r) { return r && r.length; });
  if (!days.length) return null;
  var bars = days.map(aggregateSession);
  // An authoritative daily candle, when the caller has one, replaces the
  // aggregation for that date entirely. Never a mix of the two.
  if (o2.authoritative) {
    var auth = {};
    (o2.authoritative || []).forEach(function (b) { auth[b.date] = b; });
    bars = bars.map(function (b) {
      var a = auth[b.date];
      if (!a) return b;
      return { date: b.date, open: a.open, high: a.high, low: a.low, close: a.close,
        volume: a.volume, range: a.high - a.low,
        closeStrength: a.high > a.low ? (a.close - a.low) / (a.high - a.low) : 0.5,
        bars: b.bars, coverage: b.coverage, complete: true, hasAuction: b.hasAuction,
        source: 'authoritative' };
    });
  }
  // Which of these IS today? Before the open there is no session for today at
  // all, and treating the newest stored row as "today" pushed every previous-day
  // value one session further back than its label claimed. The caller passes the
  // current trading date; without one the old positional rule stands, but the
  // result says which rule was used.
  var todayDate = o2.todayDate || null;
  var hasToday = todayDate ? bars.some(function (b) { return b.date === todayDate; }) : true;
  var todayIdx = todayDate
    ? (hasToday ? bars.map(function (b) { return b.date; }).indexOf(todayDate) : bars.length)
    : bars.length - 1;
  var today = bars[todayIdx] || bars[bars.length - 1] || null;
  // "Previous" must mean the previous COMPLETED session. A partial day is not a
  // day, and silently using one is how a truncated high became yesterday's high.
  var prior = bars.slice(0, todayIdx).filter(function (b) { return b.complete; });
  var excluded = bars.slice(0, todayIdx).filter(function (b) { return !b.complete; });
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
    incomplete: excluded.map(function (b) { return { date: b.date, bars: b.bars,
      coverage: Math.round(b.coverage * 100) + '%' }; }),
    hasToday: hasToday, todayDate: todayDate,
    previousDate: prior.length ? prior[prior.length - 1].date : null,
    dateRule: todayDate ? 'previous = newest COMPLETE session before ' + todayDate
      : 'previous = the row before the last (no trading date supplied)',
    sources: bars.map(function (b) { return { date: b.date, source: b.source, complete: b.complete }; }),
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
  reclaiming: 'נשברה וחוזרת מעליה', held: 'נשמרת', rejected: 'נדחתה', lost: 'אבדה', far: 'רחוקה'
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
  // Bars whose LOW went through a support, or whose HIGH went through a
  // resistance, without closing beyond it: pierced, not merely approached.
  var pierced = isSupport
    ? w.filter(function (x) { return x.low < level - 0.02 * atr; }).length
    : w.filter(function (x) { return x.high > level + 0.02 * atr; }).length;
  var rejections = w.filter(function (x) { return x.high > level && x.close < level; }).length;

  var state;
  if (isSupport) {
    // "Held" must mean the level was never given up. Requiring only two
    // recoveries let a support that CLOSED below five times in a row still read
    // as held: GOOGL closed 337.31, 337.31, 337.17, 337.32, 337.275 under
    // 337.57 and came back at 337.75, which is a break and a reclaim, not a
    // level that was defended.
    if (lastTwoBelow) state = 'broken';
    else if (closedBelow >= 2 && lastTwoAbove) state = 'reclaimed';
    else if (closedBelow >= 2 && d > 0) state = 'reclaiming';
    // Closes are not the whole story. GOOGL's 338.51 was traded through on four
    // separate bars — lows of 338.4233, 338.4096, 338.43, 338.42 — and still
    // read as held because none of them CLOSED below. A level price went
    // through is not a level that was defended.
    else if (closedBelow === 0 && pierced === 0 && recoveries >= 2 && d > 0) state = 'held';
    else if (closedBelow === 0 && pierced >= 2 && d > 0) state = 'reclaiming';
    else if (Math.abs(d) <= 0.25) state = 'testing';
    else if (Math.abs(d) <= 1.0) state = 'approaching';
    else state = 'far';
  } else {
    if (lastTwoAbove) state = 'broken';                  // resistance broken = price accepted above
    // "Lost" means the level stopped functioning. A resistance with price
    // sitting UNDER it is still a resistance: it was rejected, not lost.
    else if (closedAbove >= 2 && lastTwoBelow && d >= 0) state = 'lost';
    else if (closedAbove >= 2 && lastTwoBelow) state = 'rejected';
    else if (rejections >= 1 && d < 0) state = 'rejected';
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
  // When BOTH sides are fading, the buyers' edge may be widening but their
  // pressure is not strengthening. Saying it is contradicts the two trend
  // labels printed directly above it.
  // Who leads and how each side is moving are separate facts, and the sentence
  // must be built from BOTH. Saying "buyers strengthening" because the SELLERS
  // faded, while the buyers' own trend reads unchanged, contradicts the two
  // labels printed directly above it.
  var UP = 'מתחזקים', DOWN = 'נחלשים', SAME = 'ללא שינוי';
  var leaderTrend = side === 'sellers' ? sellersTrend : buyersTrend;
  var otherTrend = side === 'sellers' ? buyersTrend : sellersTrend;
  // 'own'      the leading side is itself doing more
  // 'relative' the leader is unchanged or fading, but the other side fades faster
  // 'fading'   the leading side is giving its lead back
  var direction = leaderTrend === UP ? 'own'
    : leaderTrend === DOWN ? (otherTrend === DOWN ? 'relative' : 'fading')
    : otherTrend === DOWN ? 'relative'
    : otherTrend === UP ? 'fading' : 'steady';

  var leadWord = side === 'sellers' ? 'המוכרים' : 'הקונים';
  var conclusion;
  if (side === 'balanced') {
    conclusion = buyersTrend === UP && sellersTrend !== UP ? 'הכוחות שקולים, הקונים משתפרים'
      : sellersTrend === UP && buyersTrend !== UP ? 'הכוחות שקולים, המוכרים משתפרים'
      : 'הכוחות שקולים';
  } else if (direction === 'own') {
    conclusion = leadWord + ' מובילים והלחץ שלהם מתחזק';
  } else if (direction === 'relative') {
    // The leader is not stronger. The gap widened because the other side eased.
    conclusion = leadWord + ' מובילים; היתרון היחסי שלהם משתפר משום ש'
      + (side === 'sellers' ? 'הקונים' : 'המוכרים') + ' נחלשים'
      + (leaderTrend === DOWN ? ', אך גם הלחץ שלהם עצמו נחלש' : '');
  } else if (direction === 'fading') {
    conclusion = leadWord + ' עדיין מובילים, אבל הלחץ שלהם נחלש';
  } else {
    conclusion = leadWord + ' מובילים, ללא שינוי בעוצמה';
  }
  var agreement = !bullishSetup ? 'לא רלוונטי'
    : side === 'buyers' ? (direction === 'own' ? 'תומך'
        : direction === 'fading' ? 'תומך אך נחלש'
        : direction === 'relative' ? 'תומך במידה' : 'תומך')
    : side === 'sellers' ? 'סותר'
    : (buyersTrend === 'נחלשים' ? 'נוטה נגד' : 'ניטרלי');

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

// How much of the session that SHOULD have happened by now do we actually hold?
// A window that starts at 11:02 on a day that opened at 09:30 is not a session:
// its open is not the open, its VWAP is not the VWAP, and its volume is a
// fraction. Everything derived from the session is refused until this passes.
function sessionCompleteness(rows, opts) {
  var o = opts || {};
  var out = { firstBar: null, lastBar: null, receivedMinutes: 0, expectedMinutes: null,
    coveragePct: null, fromOpen: false, complete: false };
  if (!rows || !rows.length) return out;
  var reg = rows.filter(function (r) { return r.time >= '09:30' && r.time <= '16:00'; });
  if (!reg.length) return out;
  var times = reg.map(function (r) { return r.time; }).sort();
  out.firstBar = times[0];
  out.lastBar = times[times.length - 1];
  var seen = {}; reg.forEach(function (r) { seen[r.time] = 1; });
  out.receivedMinutes = Object.keys(seen).length;
  // Minutes that should exist between the open and the newest bar we hold.
  var toMin = function (t) { var p = t.split(':'); return (+p[0]) * 60 + (+p[1]); };
  out.expectedMinutes = Math.max(1, toMin(out.lastBar) - toMin('09:30') + 1);
  out.coveragePct = Math.round(out.receivedMinutes / out.expectedMinutes * 100);
  out.fromOpen = out.firstBar <= '09:35';
  out.missingFromOpen = out.fromOpen ? 0 : toMin(out.firstBar) - toMin('09:30');
  // Holes AFTER the first bar are a separate failure and were not reported at
  // all: 49 bars scattered between 11:02 and 13:44 is not the same thing as a
  // clean window starting late. Both numbers, always.
  out.spanMinutes = toMin(out.lastBar) - toMin(out.firstBar) + 1;
  out.missingInside = Math.max(0, out.spanMinutes - out.receivedMinutes);
  out.missingTotal = out.missingFromOpen + out.missingInside;
  out.contiguous = out.missingInside === 0;
  // Both conditions: it must start at the open AND have most of the minutes in
  // between. Either alone lets a hole through.
  out.complete = out.fromOpen && out.coveragePct >= (o.minCoverage || 85);
  return out;
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

  // A probability is only meaningful if the two levels are far enough apart to
  // mean something for this instrument. Asking whether price reaches 146.63
  // before 146.62 — one cent, a fraction of a normal minute's range — produces
  // a confident-looking number about nothing.
  // The question only means "up or down" when the two levels BRACKET the price.
  // With both below it, "reaches 187.34 before 187.27" asks which small decline
  // happens first — and reporting that as UP 78% reads as a claim the stock will
  // rise. It also hands the model a free +6 for "the upper level is closer",
  // which is pure geometry: three cents against ten.
  var px = b.close;
  out.price = px;
  out.bracketed = lower < px && px < upper;
  // "Reaches 338.66 before 338.63" with price at 338.61 asks whether the far
  // level is touched before the near one on the SAME side, which cannot happen
  // on a continuous path — 338.63 is passed on the way. The bracket test below
  // catches it, but say plainly why rather than reporting it as a coincidence.
  out.samSideOrdering = (upper > px && lower > px && lower < upper)
    || (upper < px && lower < px && lower > upper);
  if (!out.bracketed) {
    out.up = null; out.down = null; out.confidence = 0;
    out.notDirectional = true;
    out.side = upper <= px ? 'both_below' : 'both_above';
    if (out.samSideOrdering)
      out.why.push('הרמות באותו צד והרחוקה נמצאת אחרי הקרובה — לא ניתן להגיע לאחת לפני השנייה בדרך רציפה');
    out.why.push(upper <= px
      ? 'שתי הרמות מתחת למחיר — השאלה אינה עלייה מול ירידה אלא איזו ירידה מגיעה קודם, ולכן לא מוצגת כהסתברות כיוון'
      : 'שתי הרמות מעל המחיר — השאלה אינה עלייה מול ירידה, ולכן לא מוצגת כהסתברות כיוון');
    return out;
  }

  var band = Math.abs(upper - lower);
  var MIN_BAND_ATR = 0.25;
  if (atr > 0 && band < MIN_BAND_ATR * atr) {
    out.up = null; out.down = null; out.confidence = 0; out.meaningless = true;
    out.band = band; out.minBand = MIN_BAND_ATR * atr;
    out.why.push('הרמות קרובות מדי זו לזו (' + (Math.round(band * 100) / 100) +
      ') ביחס לתנודה הרגילה — הסתברות כאן חסרת משמעות');
    return out;
  }

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
  DATA_STALE: 'נתונים לא עדכניים — לא לסחור',
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
function scenarioLabelFor(P, watch) {
  if (!P || !P.kind) return 'ללא setup';
  if (P.kind === 'breakout') return 'פריצה מעל ' + n2(watch);
  return P.zone ? 'חזרה לאזור ' + n2(P.zone[0]) + '–' + n2(P.zone[1]) : 'פולבק';
}

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
  var stale = !!c.stale;
  // The model's own cancellation rule, applied to the model's own price. If the
  // last close is already through the level that voids the idea, the idea is
  // void — it cannot still read START_WATCHING.
  var cancelAt = (c.levels && c.levels.tacticalStop != null) ? c.levels.tacticalStop
    : (P && P.invalidation != null ? P.invalidation : null);
  var alreadyCancelled = !ended && cancelAt != null && b.close != null && b.close < cancelAt;
  // Staleness outranks the plan. A setup derived from bars that stopped hours
  // ago is a description of a market that has already moved.
  var actionKey = ended ? 'SESSION_CLOSED'
    : stale ? 'DATA_STALE'
    : alreadyCancelled ? 'SETUP_CANCELLED'
    : noEdge ? 'WATCH_ONLY'
    : (PLAN_TO_ACTION[P ? P.state : 'NO_SETUP'] || 'DO_NOT_BUY');
  var W = { action: actionKey, actionText: ACTIONS[actionKey], sessionEnded: !!ended,
    stale: stale, cancelled: alreadyCancelled, price: b.close, watch: watch,
    // A probability computed from stale bars is not a probability about now.
    // A probability is a claim about the next hour. After the close there is no
    // next hour, and on stale bars it is a claim about a market that has moved.
    probability: (stale || ended || (prob && (prob.meaningless || prob.notDirectional))) ? null : prob,
    probabilityRaw: prob || null,
    plan: P, scenario: (stale || alreadyCancelled) ? { kind: 'none', label: 'אין setup פעיל' } : scenario,
    noEdge: noEdge, edge: edge, up: [], down: [], why: [] };

  // The one line that matters
  if (stale) W.next = 'הנרות האחרונים ישנים — אין כאן איתות חי. הרמות למטה הן לעיון בלבד.';
  else if (alreadyCancelled) W.next = 'המחיר כבר מתחת ל-' + n2(cancelAt) + ' — התרחיש בוטל. לחכות למבנה חדש.';
  else if (ended) W.next = 'המסחר הסתיים — הרמות למטה הן לקראת המסחר הבא, לא להוראה עכשיו';
  else if (noEdge) W.next = 'אין כרגע יתרון מספיק לכניסה. לעקוב אם המחיר מגיע ל-' + n2(watch) + '.';
  else if (P && P.state === 'FAILED') W.next = 'אין כניסה. צריך מצב חדש לפני שמסתכלים שוב.';
  else if (P && (P.state === 'READY_PARTIAL' || P.state === 'READY_ADD')) W.next = 'המחיר במקום שתכננו — ' + P.headline;
  else W.next = 'לשים לב אם המחיר מגיע ל-' + n2(watch);

  // If it goes up
  var above = T.above.filter(function (l) { return l.price > b.close + 0.05 * atr; });
  // The narrative must quote the SAME targets the levels block shows. Deriving
  // them separately here is how the text came to say 'second target 146.66'
  // while the levels said 146.73.
  var canon = c.levels || null;
  var t1 = (canon && canon.target1 != null) ? canon.target1
    : (above[1] ? above[1].price : watch + 1.2 * atr);
  var t2 = (canon && canon.target2 != null) ? canon.target2
    : (above[2] && above[2].price >= t1 + 0.2 * atr ? above[2].price : t1 + 1.5 * atr);
  // Two targets that print as the same number are not two targets. On quiet or
  // low-priced instruments the rounded levels collided.
  // Compare what will actually be PRINTED. Two levels 0.004 apart are distinct
  // numbers that render as the same string, which is what the reader sees.
  if (t1 != null && t2 != null && n2(t1) === n2(t2)) t2 = t1 + Math.max(0.01, 1.0 * atr);
  if (stale) {
    // Reference only. The last idea is described in the past tense, never as
    // something to act on.
    W.up.push('התרחיש האחרון שנרשם: ' + scenarioLabelFor(P, watch) + ' — לעיון בלבד');
    W.up.push('אין הוראת כניסה על נתונים ישנים');
  } else if (noEdge && !ended) {
    // What would have to change before any entry is even discussed.
    W.up.push('אם המחיר עולה מעל ' + n2(watch) + ' ונשאר שם — ייבחן מחדש');
    W.up.push('כרגע אין הוראת כניסה');
  } else if (!ended) {
    if (P && P.state === 'READY_PARTIAL' && hasZone) {
      W.up.push('אם המחיר נשאר מעל ' + n2(P.zone[0]) + ' — אפשר להיכנס בחלק מהסכום סביב ' + n2(P.entry));
      W.up.push('אישור חזק יותר מעל ' + n2(P.addAbove) + ' (המערכת אינה יודעת אם יש פוזיציה)');
    } else if (scenario.kind === 'breakout' && P.entry != null) {
      W.up.push('אם עובר את ' + n2(watch) + ' ונשאר מעל — אפשר להיכנס סביב ' + n2(P.entry));
    } else if (scenario.kind === 'pullback' && hasZone) {
      W.up.push('אם המחיר יורד לאזור ' + n2(P.zone[0]) + '–' + n2(P.zone[1]) + ' ונבלם — כניסה חלקית ב-' + n2(P.entry));
      W.up.push('אישור חזק יותר מעל ' + n2(P.addAbove));
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
  if (stale) {
    // The DOWN block describes the downside, in the past tense. It must not
    // repeat the UP block's lines — that duplication reached the screen.
    W.down.push('התמיכה האחרונה שנרשמה: ' + n2(s1) + ' — לעיון בלבד');
    W.down.push('אין רמת ביטול פעילה על נתונים ישנים');
  } else if (noEdge && !ended) {
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
  // Identical lines are never informative twice, whichever branch produced them.
  var uniq = function (list) { var seen = {}; return list.filter(function (x) {
    if (seen[x]) return false; seen[x] = 1; return true; }); };
  W.up = uniq(W.up); W.down = uniq(W.down); W.why = uniq(W.why);
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
  // A long is cancelled on the way DOWN, so the level hit first must be the
  // entry cancellation and the structural one must sit BELOW it. Reported the
  // other way round — entry at 187.27, structure at 187.28 — the whole setup
  // died before its own entry rule could ever fire.
  if (lv.tacticalInvalidation != null && lv.hardStop != null && lv.hardStop >= lv.tacticalInvalidation) {
    lv.hardStop = lv.tacticalInvalidation - Math.max(0.02, 0.3 * atr);
    lv.hardStopAdjusted = true;
  }
  // Targets are always resolved ABOVE the entry. A level at or below the entry
  // can be the watch level or resistance, but never target 1.
  // With no entry planned, targets are measured from the WATCH level, not from
  // the current price — otherwise the first level above price is both the thing
  // we are waiting for and the first target, which is meaningless.
  // The add trigger and target 1 cannot be the same price. One says "commit
  // more here", the other says "take some off here", and printing both against
  // 187.47 is an instruction to do two opposite things at once.
  var addAt = plan && plan.addAbove != null ? plan.addAbove : null;
  var anchor = lv.entry != null ? lv.entry : (lv.watch != null ? lv.watch : b.close);
  var aboveEntry = T.above.filter(function (x) { return x.price >= anchor + 0.3 * atr; })
    .sort(function (x, y) { return x.price - y.price; });
  lv.target1 = aboveEntry[0] ? aboveEntry[0].price : anchor + 1.0 * atr;
  // A target that lands on the add trigger is pushed to the next level above it,
  // or one ATR beyond — the trigger keeps its role, the target moves.
  if (addAt != null && Math.abs(lv.target1 - addAt) < 0.005) {
    var beyond = aboveEntry.filter(function (x) { return x.price > addAt + 0.005; });
    lv.target1 = beyond[0] ? beyond[0].price : addAt + Math.max(0.02, 0.5 * atr);
    lv.target1MovedFromAdd = true;
  }
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
  if (prob && prob.meaningless) weak.push('הרמות קרובות מדי למדידה');
  if (prob && prob.notDirectional) weak.push('הרמות אינן מקיפות את המחיר — אין הסתברות כיוון');
  if (prob && prob.up != null && Math.abs(prob.up - 50) <= 8) weak.push('הסיכויים שקולים');
  if (prob && prob.confidence < 50) weak.push('ביטחון נמוך');
  if (pres && pres.side === 'balanced') weak.push('קונים ומוכרים מאוזנים');
  var structureFlat = (row0.structure === 'RANGE') && (row0.momentum === 'FLAT');
  if (structureFlat) weak.push('אין מבנה ואין מומנטום');
  var edge = { noEdge: weak.length >= 4, reasons: weak, score: score0,
    probUp: prob.up, confidence: prob.confidence, flow: pres ? pres.side : 'NA' };

  // ---- staleness is a hard gate, not a label.
  // Bars that stopped arriving hours ago describe a market that has moved on.
  // Showing an entry, a probability or a buyer/seller split from them reads as
  // live guidance about a price that no longer exists, so none of it survives.
  // On a one-minute feed, four minutes of lag is long enough for price to have
  // left the entry zone entirely. An entry offered on data that old is an
  // instruction to trade a price that may no longer exist.
  var ENTRY_MAX_AGE = 180;                       // three minutes
  var STALE_SECONDS = 300;                       // five minutes of missing bars
  var ageSec = (c.staleSeconds != null) ? c.staleSeconds
    : (b.unix != null && c.nowUnix != null ? c.nowUnix - b.unix : null);
  var isStale = c.sessionEnded ? false
    : (c.freshness === 'STALE' || (ageSec != null && ageSec > STALE_SECONDS));
  // Not stale enough to freeze the whole state, but too old to act on.
  var tooOldToEnter = !c.sessionEnded && ageSec != null && ageSec > ENTRY_MAX_AGE;

  // And the session itself must be present. A window that starts at 11:02 on a
  // day that opened at 09:30 has no session open, no session VWAP and a
  // fraction of the volume — every figure derived from it is wrong while
  // looking entirely clean.
  // Measure the rows that were LOADED, not the ones analysis kept. A no-trade
  // minute is deliberately excluded from the analysis and is still a minute we
  // hold — counting the filtered set turned a complete session into "186 of 335
  // with 57 holes".
  var cover = sessionCompleteness((A && (A.rawBars || A.bars)) || [], {});
  var sessionIncomplete = !c.sessionEnded && !isStale && A && A.bars && A.bars.length > 0
    && !cover.complete;

  var W = whatNow(A, { tactical: T, plan: plan, market: c.market, daily: c.daily,
    baseline: c.baseline, calibration: c.calibration, pressure: pres, probability: prob,
    sessionEnded: c.sessionEnded, levels: lv, edge: edge, stale: isStale });

  // Nothing actionable may remain on the state when there is no edge, so the
  // technical block underneath cannot contradict the headline.
  if (edge.noEdge && !c.sessionEnded) {
    lv.entry = null; lv.target1 = null; lv.target2 = null;
  }
  // A closed session is a reference view, not an order. The levels stay visible
  // as context, but nothing actionable survives — otherwise the headline says
  // the market is shut while an entry price sits underneath it.
  if (c.sessionEnded) { lv.entry = null; lv.target1 = null; lv.target2 = null; }
  if (isStale) { lv.entry = null; lv.target1 = null; lv.target2 = null; }
  // Too old to act on, or built from part of a session: the levels stay as
  // context but no entry is offered, and the headline says which it is.
  // Staleness is the stronger statement and must not be overwritten by the
  // weaker one: data that is five minutes old is not merely "delayed".
  if (!isStale && !c.sessionEnded && (tooOldToEnter || sessionIncomplete)) {
    lv.entry = null; lv.target1 = null; lv.target2 = null;
    W.action = 'WAIT';
    W.actionText = sessionIncomplete
      ? 'סשן חלקי — לא לסחור'
      : 'נתונים באיחור — להמתין לנר טרי';
    W.next = sessionIncomplete
      ? ('נטענו ' + cover.receivedMinutes + ' דקות מתוך ' + cover.expectedMinutes
         + ' — חסרות ' + cover.missingFromOpen + ' מהפתיחה ועוד ' + cover.missingInside
         + ' בתוך החלון, אז הפתיחה, ה-VWAP, המבנה והמחזור אינם של הסשן')
      : ('הנר האחרון בן ' + Math.round(ageSec) + ' שניות; בפיד של דקה זה מספיק כדי שהמחיר יעזוב את האזור');
    // The WHAT-IF lines are built before this gate and still carried "you can
    // enter around 338.68" with targets underneath a headline that says not to
    // trade. Rewrite them as observations: the levels are worth naming, the
    // instruction is not.
    var obs = function (list) {
      return (list || []).map(function (x) {
        return String(x)
          .replace(/אפשר להיכנס/g, 'רמה לצפייה')
          .replace(/כניסה חלקית/g, 'אזור לצפייה')
          .replace(/לממש/g, 'רמת יעד לשעבר')
          .replace(/להוסיף/g, 'רמת אישור');
      }).filter(function (x) { return !/להיכנס|לקנות|לממש חלק/.test(x); });
    };
    W.up = obs(W.up); W.down = obs(W.down);
    W.up.unshift(sessionIncomplete
      ? 'הרמות מוצגות לצפייה בלבד — הסדרה חסרה ' + cover.missingTotal + ' דקות'
      : 'הרמות מוצגות לצפייה בלבד — הנתונים אינם טריים מספיק לפעולה');
  }
  var row = row0;

  var st = {
    symbol: symbol, state_version: STATE_VERSION, calculated_at: now,
    data_through: { time: b.time, date: b.date || c.date || null, unix: b.unix != null ? b.unix : null },
    price: b.close, atr: atr,
    status: row.status, score: row.bl ? row.bl.confidence : 0,
    action: W.action, actionText: W.actionText,
    structure: row.structure, momentum: row.momentum,
    coverage: cover, sessionIncomplete: sessionIncomplete, tooOldToEnter: tooOldToEnter,
    levels: lv, plan: plan, tactical: T, pressure: pres, probability: W.probability,
    probabilityRaw: W.probabilityRaw || null, whatNow: W,
    scenario: W.scenario, edge: edge, noEdge: edge.noEdge,
    levelStates: { support: T.support ? levelState(A, T.support.price, true) : null,
                   resistance: T.resistance ? levelState(A, T.resistance.price, false) : null },
    row: row, sessionEnded: !!c.sessionEnded, freshness: c.freshness || 'LIVE',
    stale: isStale, data_age_seconds: ageSec
  };
  // Keep the row pointing at the same snapshot so nothing can drift.
  row.score = st.score; row.state = st; row.pressure = pres;
  if (edge.noEdge && !c.sessionEnded) {
    row.status = row.status === 'AVOID' ? 'AVOID' : 'WATCH';
    row.why = 'אין יתרון — רק מעקב';
    st.status = row.status; st.action = 'WATCH_ONLY'; st.actionText = ACTIONS.WATCH_ONLY;
  }
  // The row is what the board shows, so it must carry the same verdict.
  if (isStale) {
    row.status = 'AVOID';
    row.why = 'נתונים לא עדכניים — לא לסחור';
    st.status = 'AVOID';
    st.action = 'DATA_STALE'; st.actionText = ACTIONS.DATA_STALE;
    st.probability = null;
    st.pressure = pres ? Object.assign({}, pres, { current: false }) : pres;
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
  // `pr.up` is null when the probability was suppressed, and `null <= 20` is
  // true in JavaScript — which made a *withheld* probability look like an
  // extreme one and invalidated the whole state.
  if (pr && pr.up != null && pr.confidence < 50 && (pr.up >= 80 || pr.up <= 20))
    add('PROB_CONFIDENCE', 'block', 'הסתברות קיצונית עם ביטחון נמוך');
  if (pr && pr.upper != null && lv.probUpper != null && Math.abs(pr.upper - lv.probUpper) > 1e-9)
    add('PROB_STALE_LEVELS', 'block', 'ההסתברות חושבה מול רמות אחרות מאלה שמוצגות');

  // ---- staleness. A state built from bars that stopped arriving is not a
  // valid live state, whatever else it says.
  if (st.stale && st.action !== 'DATA_STALE' && st.action !== 'SESSION_CLOSED')
    add('STALE_BUT_ACTIONABLE', 'block', 'הנתונים ישנים אך המסך מציג הוראה חיה');
  if (st.stale && lv && (lv.entry != null || lv.target1 != null))
    add('STALE_WITH_LEVELS', 'block', 'הנתונים ישנים אך מוצגת רמת כניסה');
  if (st.stale && pr && pr.up != null)
    add('STALE_WITH_PROBABILITY', 'block', 'הנתונים ישנים אך מוצגת הסתברות כאילו היא נוכחית');

  // ---- a setup whose cancellation level the price has already crossed
  var cancelLv = (lv && lv.tacticalStop != null) ? lv.tacticalStop
    : (st.plan && st.plan.invalidation != null ? st.plan.invalidation : null);
  var LIVE_ACTIONS = ['START_WATCHING', 'WAIT_FOR_CONFIRMATION', 'ENTRY_AVAILABLE', 'HOLD', 'TAKE_PARTIAL'];
  if (!st.sessionEnded && cancelLv != null && st.price != null && st.price < cancelLv
      && LIVE_ACTIONS.indexOf(st.action) >= 0)
    add('CANCELLED_BUT_ACTIVE', 'block', 'המחיר כבר מתחת לרמת הביטול אך התרחיש מוצג כפעיל');

  // ---- the narrative targets must be the levels block's targets
  if (st.whatNow && Array.isArray(st.whatNow.up) && lv && lv.target1 != null && lv.target2 != null) {
    var txt = st.whatNow.up.join(' ');
    var m1 = txt.match(/\u05d9\u05e2\u05d3 \u05e8\u05d0\u05e9\u05d5\u05df ([\d.]+)/);
    var m2 = txt.match(/\u05d9\u05e2\u05d3 \u05e9\u05e0\u05d9 ([\d.]+)/);
    var near = function (a, b2) { return Math.abs(Number(a) - Number(b2)) < 0.005; };
    if (m1 && !near(m1[1], lv.target1)) add('TARGET1_TEXT_MISMATCH', 'block', 'יעד ראשון בטקסט שונה מהיעד ברמות');
    if (m2 && !near(m2[1], lv.target2)) add('TARGET2_TEXT_MISMATCH', 'block', 'יעד שני בטקסט שונה מהיעד ברמות');
  }

  return { valid: !v.some(function (x) { return x.severity === 'block'; }), violations: v };
}


// ---------------------------------------------------------------- analysis pack
//
// Everything another trader (or another model) needs to re-do the analysis from
// scratch: the raw data AND the decision state, from ONE snapshot. Any field the
// system does not have says NOT AVAILABLE rather than being quietly dropped.
var NA = 'NOT AVAILABLE';
function nz(v, d) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? NA : (d != null && typeof v === 'number' ? v.toFixed(d) : String(v)); }

// Buckets belong to the exchange clock: 09:30, 09:35, ... 11:00, 11:05. The
// grouping was already correct, but the LABEL came from the first bar that
// happened to fall inside — so a window starting at 11:02 produced a bar called
// "11:02", which is not a five-minute timeframe at all. A bucket missing some
// of its minutes is marked rather than silently presented as whole.
function aggregate(rows, minutes) {
  var out = [], bucket = null;
  var label = function (m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };
  (rows || []).forEach(function (r) {
    var m = parseInt(r.time.slice(0, 2), 10) * 60 + parseInt(r.time.slice(3), 10);
    var key = Math.floor(m / minutes);
    if (!bucket || bucket.key !== key) {
      if (bucket) out.push(bucket);
      bucket = { key: key, time: label(key * minutes), firstBar: r.time, minutes: 1,
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, date: r.date };
    } else {
      bucket.high = Math.max(bucket.high, r.high); bucket.low = Math.min(bucket.low, r.low);
      bucket.close = r.close; bucket.volume += r.volume; bucket.minutes++;
    }
  });
  if (bucket) out.push(bucket);
  out.forEach(function (b) { b.partial = b.minutes < minutes; });
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
  add('Active setup type: ' + (st.stale ? 'none (data stale)'
    : (st.scenario ? st.scenario.kind + ' — ' + st.scenario.label : NA)));
  add('Setup state: ' + (st.stale ? 'FROZEN (last known: ' + (P ? P.state : NA) + ') — reference only'
    : (P ? P.state : NA)));
  add('Reason: ' + (W ? nz(W.next) : NA));
  add('Model state valid: ' + (st.valid ? 'yes' : 'NO — ' + (st.violations || []).map(function (v) { return v.code; }).join(', ')));
  if (st.noEdge) add('No-edge reasons: ' + ((st.edge && st.edge.reasons) || []).join(' · '));

  head('3. PRICE LEVELS AND THEIR ROLES');
  // While frozen, every level is a record of what WAS, not a price to act on.
  // The labels say so, because a reader skimming the pack reads the label.
  var FROZEN = !!st.stale;
  var role = function (name, val, note) {
    var label = FROZEN ? 'LAST KNOWN ' + name : name;
    var n = FROZEN ? (note ? note + ' — REFERENCE ONLY' : 'REFERENCE ONLY') : note;
    add(label + ': ' + (val == null ? NA : val.toFixed(2) + (atr ? '  (' + E.fmtR((val - st.price) / atr) + ')' : '')) + (n ? '  — ' + n : ''));
  };
  if (FROZEN) add('NOTE: data is stale. Everything in this section is the last recorded state, not a current instruction.');
  role('Watch level', lv.watch, FROZEN ? 'the price that was being waited for' : 'the price being waited for');
  role('Entry zone low', P && P.zone ? P.zone[0] : null);
  role('Entry zone high', P && P.zone ? P.zone[1] : null);
  role('Planned entry', lv.entry);
  role('Breakout / reclaim trigger', P && P.kind === 'breakout' ? lv.watch : (st.plan && st.plan.addAbove != null ? st.plan.addAbove : null), FROZEN ? 'confirmed an add while the setup was live'
      : (lv.entry == null) ? 'a level to watch — there is no position to add to'
      : 'confirms an add');
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

  head('4. WHAT-IF' + (FROZEN ? ' — FROZEN, REFERENCE ONLY' : ''));
  add('NOW: ' + (W ? W.actionText + ' — ' + W.next : NA));
  add('IF UP:');
  ((W && W.up) || []).forEach(function (s) { add('  - ' + s); });
  if (!W || !W.up.length) add('  ' + NA);
  add('IF DOWN:');
  ((W && W.down) || []).forEach(function (s) { add('  - ' + s); });
  if (!W || !W.down.length) add('  ' + NA);
  // The same rule as FROZEN, for every state where no entry is planned. I fixed
  // this for stale data and left the identical contradiction standing when the
  // session is incomplete: "Planned entry: NOT AVAILABLE" above "Confirms
  // entry: partial entry on the pullback" tells you not to trade and how to
  // trade in the same breath.
  var NO_ENTRY = !FROZEN && (lv.entry == null);
  var noEntryWhy = st.sessionIncomplete ? 'the session is incomplete'
    : st.tooOldToEnter ? 'the data is too old to act on'
    : st.sessionEnded ? 'the session is closed'
    : 'no entry is planned';
  if (NO_ENTRY) {
    add('Confirms entry: ' + NA + ' — ' + noEntryWhy);
    add('Cancels entry: ' + NA + ' — there is no entry to cancel');
    add('Cancels the whole setup: ' + NA + ' — ' + noEntryWhy);
    add('After entry: ' + NA + ' — ' + noEntryWhy);
    add('At target 1: ' + NA + ' — ' + noEntryWhy);
    add('Confirmation strengthens above: ' + NA + ' — ' + noEntryWhy);
    add('Exit when: ' + NA + ' — ' + noEntryWhy);
    add('The levels above are reference only: with no entry there is nothing to add to, take off, or exit.');
  } else if (FROZEN) {
    // None of these may be phrased as something to do. They are the last
    // recorded rules of a setup that is no longer live.
    add('Confirms entry: ' + NA + ' — setup frozen (data stale)');
    add('After entry: ' + NA + ' — setup frozen (data stale)');
    add('At target 1: ' + NA + ' — setup frozen (data stale)');
    add('Confirmation strengthens above: ' + NA + ' — setup frozen (data stale)');
    add('Exit when: ' + NA + ' — setup frozen (data stale)');
    add('LAST KNOWN entry cancellation: ' + (lv.tacticalInvalidation != null ? lv.tacticalInvalidation.toFixed(2) + '  — REFERENCE ONLY' : NA));
    add('LAST KNOWN setup invalidation: ' + (lv.hardStop != null ? lv.hardStop.toFixed(2) + '  — REFERENCE ONLY' : NA));
    add('These are the rules the setup had when the data stopped. They are not active.');
  } else {
  add('Confirms entry: ' + (P ? nz(P.ifConfirmed) : NA));
  add('Cancels entry: ' + (lv.tacticalInvalidation != null ? 'close below ' + lv.tacticalInvalidation.toFixed(2) : NA));
  add('Cancels the whole setup: ' + (lv.hardStop != null ? 'close below ' + lv.hardStop.toFixed(2) : NA));
  add('After entry: ' + (P ? nz(P.nextStep) : NA));
  add('At target 1: ' + (lv.target1 != null ? 'take partial at ' + lv.target1.toFixed(2) : NA));
  add('Confirmation strengthens above: ' + (P && P.addAbove != null ? P.addAbove.toFixed(2) + ' (two closes); position state unknown to the system' : NA));
  add('Exit when: ' + (lv.hardStop != null ? 'close below ' + lv.hardStop.toFixed(2) + ', or at target' : NA));
  }

  head('4b. SESSION COVERAGE');
  var cv = st.coverage || {};
  add('First regular bar: ' + (cv.firstBar || NA));
  add('Last regular bar: ' + (cv.lastBar || NA));
  add('Expected minutes: ' + (cv.expectedMinutes != null ? cv.expectedMinutes : NA));
  add('Received unique minutes: ' + (cv.receivedMinutes != null ? cv.receivedMinutes : NA));
  add('Coverage: ' + (cv.coveragePct != null ? cv.coveragePct + '%' : NA));
  add('Starts at the open: ' + (cv.fromOpen ? 'yes' : 'NO — missing ' + (cv.missingFromOpen || '?') + ' minutes from 09:30'));
  add('Holes inside the loaded window: ' + (cv.missingInside
    ? cv.missingInside + ' minutes missing between ' + cv.firstBar + ' and ' + cv.lastBar
      + ' — the series is not continuous, so structure, momentum and the buyer/seller split describe a broken sequence'
    : 'none'));
  add('Total missing minutes: ' + (cv.missingTotal != null ? cv.missingTotal : NA));
  add('Session values usable: ' + (cv.complete ? 'yes' : 'NO — open, gap, VWAP, EMA, relative volume and any entry are derived from a partial window and are not the session\'s'));

  head('5. PROBABILITY');
  // A suppressed probability must still say WHAT was asked and WHY there is no
  // number. "NOT AVAILABLE" on its own leaves the reader unable to tell a stale
  // feed from a question that was never answerable.
  if (!pr) {
    var praw = (st && st.probabilityRaw) || null;
    add('UP: ' + NA + '   DOWN: ' + NA);
    add('Event measured: ' + (praw && praw.upper != null
      ? 'price reaches ' + praw.upper.toFixed(2) + ' before ' + praw.lower.toFixed(2) : NA));
    add('Horizon: ' + (praw ? praw.horizonMin + ' minutes' : NA));
    add('Confidence: ' + NA + ' — no probability is being claimed');
    add('Source: ' + NA);
    // Only the reason for the SUPPRESSION, never the half-computed scoring
    // inputs — those describe a number we have decided not to trust.
    var suppressWhy = (praw && (praw.notDirectional || praw.meaningless))
      ? praw.why.join(' | ')
      : (st && st.stale) ? 'the data is stale'
      : (st && st.coverage && !st.coverage.complete) ? 'the session is incomplete — the inputs are not the session\'s'
      : 'not answerable in this state';
    add('Why: ' + suppressWhy);
    add('Scoring inputs: ' + NA + ' — withheld with the probability they produced');
  } else {
    add('UP: ' + pr.up + '%   DOWN: ' + pr.down + '%');
    add('Event measured: price reaches ' + pr.upper.toFixed(2) + ' before ' + pr.lower.toFixed(2));
    add('Horizon: ' + pr.horizonMin + ' minutes');
    add('Confidence: ' + pr.confidence + '/100' + (pr.lowConfidence ? '  (LOW — displayed % is pulled toward 50)' : ''));
    add('Source: ' + (pr.source === 'empirical' ? 'empirical, ' + pr.n + ' comparable cases in this symbol\'s own loaded history'
      : 'MODEL ESTIMATE — not a measured frequency' + (pr.raw != null ? ' (raw ' + pr.raw + '%, shrunk for confidence)' : '')));
    add('Why: ' + pr.why.join(' | '));
    if (st.coverage && !st.coverage.complete)
      add('NOTE: these inputs come from a partial window and the probability above should not be relied on.');
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
  // Structure is a claim about a SEQUENCE. With minutes missing in the middle
  // the sequence is not the market's, so the reading is qualified rather than
  // stated — a swing "confirmed" across a hole may never have happened.
  var BROKEN = (st.coverage && st.coverage.contiguous === false)
    ? '  [SERIES NOT CONTINUOUS — ' + st.coverage.missingInside + ' minutes missing inside the window; this reading is not reliable]'
    : '';
  add('Main structure: ' + nz(st.structure) + (A && A.state ? '  (' + A.state.reason + ')' : '') + BROKEN);
  add('Announced trend: ' + (A && A.state ? nz(A.state.announced) : NA) + BROKEN);
  add('Short momentum: ' + nz(st.momentum) + (st.row && st.row.mom ? '   move over last 5 bars: ' + st.row.mom.net.toFixed(2) + 'R' : ''));
  add('Recent swings (K=3 confirmed):');
  var sw = A ? A.swings.filter(function (w) { return w.confirmedAt <= A.bars.length - 1; }).slice(-10) : [];
  if (!sw.length) add('  ' + NA);
  sw.forEach(function (w) { add('  ' + w.label + '  ' + w.price.toFixed(2) + '  @' + w.time + (w.outside ? '  (outside bar — not counted as structure)' : '')); });

  head('10. INDICATORS');
  // These are all session-scoped. Computed over a partial window they are not
  // what their names say, so every line carries the warning rather than the
  // reader being expected to remember a note from six sections earlier.
  var PART = (st.coverage && !st.coverage.complete) ? '  [PARTIAL WINDOW — NOT A SESSION INDICATOR]' : '';
  if (PART) add('NOTE: the session is incomplete — every figure below describes the loaded window only.');
  if (!bar) add(NA); else {
    add('VWAP: ' + bar.vwap.toFixed(2) + PART + '   price is ' + (bar.aboveVwap ? 'ABOVE' : 'BELOW') + '   distance: ' + (st.price - bar.vwap).toFixed(2) + ' (' + E.fmtR((st.price - bar.vwap) / atr) + ')');
    add('EMA9: ' + bar.ema9.toFixed(2) + PART + '   EMA20: ' + bar.ema20.toFixed(2) + '   state: ' + bar.align +
      '   separation: ' + Math.abs(bar.ema9 - bar.ema20).toFixed(3) + ' (minimum for a call: ' + (0.15 * atr).toFixed(3) + ')');
    add('Average candle range (20 bars): ' + atr.toFixed(4) + '   = 1R throughout this pack');
    add('Relative volume (vs session average): ' + bar.volx.toFixed(2) + 'x' + PART + (bar.auction ? '  [CLOSING AUCTION BAR — excluded from scoring]' : ''));
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
  if (st.coverage && !st.coverage.complete)
    add("NOTE: today's row is built from a PARTIAL session (" + (st.coverage.coveragePct || 0)
      + '% of the minutes since the open) — it is not a daily candle.');
  var d = c.daily;
  if (!d) add(NA + ' — no prior sessions loaded'); else {
    add('Sessions loaded: ' + d.days + ' (prior: ' + d.priorDays + ')');
    // The daily trend is computed over COMPLETED sessions only — today's row is
    // excluded by dailyContext. Say so, because a reader looking at a partial
    // row whose low is already below yesterday's will otherwise read the trend
    // as a claim about it.
    add('Daily trend: ' + d.trend + ' (' + d.trendWhy + ')'
      + '  [computed over the ' + (d.priorDays || 0) + ' COMPLETED sessions before today'
      + ((st.coverage && !st.coverage.complete) ? "; today's partial row is excluded" : '') + ']');
    add('Previous day: high ' + nz(d.prevHigh, 2) + '  low ' + nz(d.prevLow, 2) + '  close ' + nz(d.prevClose, 2));
    add('Gap today vs previous close: ' + ((st.coverage && !st.coverage.complete)
      ? NA + ' — the session open is missing, so there is nothing to measure the gap from'
      : nz(d.gap, 2)));
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

module.exports = { sessionCompleteness, analysisPack: analysisPack, aggregate: aggregate, pressure: pressure, levelState: levelState, LEVEL_TEXT: LEVEL_TEXT, buildTickerState: buildTickerState, validateState: validateState, STATE_VERSION: STATE_VERSION, shrink: shrink, volumeBaseline: volumeBaseline, volxTod: volxTod, dailyContext: dailyContext,
  calibrate: calibrate, pathProbability: pathProbability, whatNow: whatNow, ACTIONS: ACTIONS, features: features,
  marketContext: E.marketContext };
