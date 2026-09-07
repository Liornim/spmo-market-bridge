// ============================================================================
// TRADER V2 — an experimental long-only decision engine.
//
// Independent of the production scanner: it imports nothing from engine.cjs,
// layers.cjs or candidate.cjs, and reimplements what it needs so that a change
// here can never reach the live Radar.
//
// The premise it exists to test:
//
//     PRICE REACHED A LEVEL IS NOT A REASON TO BUY.
//
// Touching support, VWAP, an EMA or a prior breakout is a LOCATION. The old
// engine treated arrival as permission. Here, READY requires evidence that
// buyers took control — a reclaim that held, a higher low, a trigger actually
// broken — and every state carries the reason it was reached.
// ============================================================================

var CFG = {
  K: 3,                    // bars each side for a confirmed pivot
  readyScore: 6,           // minimum score to promote to READY
  armedScore: 3,           // below this a setup is only WATCH
  chaseATR: 1.2,           // extension beyond the trigger that forbids entry
  retestMaxATR: 1.5,       // a pullback deeper than this is not a shallow retest
  stopPadATR: 0.25,        // stop placed this far beyond the structural low
  minRR: 1.5,              // a plan below this is not worth showing as READY
  holdBars: 2,             // bars a reclaim must hold before it counts
  failCooldown: 5,         // bars after a failure before ANY new setup can arm
  volSurge: 1.2,           // relative volume that counts as participation
  maxSetupAgeBars: 45,     // an unresolved setup expires
  warmup: 15               // bars needed before structure means anything
};

// ---------------------------------------------------------------- indicators
// Recomputed here rather than imported, so this engine owns its own numbers.
function computeBars(rows) {
  var out = [], pv = 0, vol = 0, ema9 = null, ema20 = null;
  var k9 = 2 / 10, k20 = 2 / 21, trs = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var typical = (r.high + r.low + r.close) / 3;
    pv += typical * (r.volume || 0); vol += (r.volume || 0);
    ema9 = ema9 == null ? r.close : r.close * k9 + ema9 * (1 - k9);
    ema20 = ema20 == null ? r.close : r.close * k20 + ema20 * (1 - k20);
    var prev = i ? rows[i - 1] : null;
    var tr = prev ? Math.max(r.high - r.low, Math.abs(r.high - prev.close), Math.abs(r.low - prev.close))
                  : r.high - r.low;
    trs.push(tr);
    var atrWin = trs.slice(-14);
    out.push({
      i: i, time: r.time, date: r.date, unix: r.unix,
      open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume || 0,
      vwap: vol ? pv / vol : r.close,
      ema9: ema9, ema20: ema20,
      atr: atrWin.reduce(function (a, b) { return a + b; }, 0) / atrWin.length,
      range: r.high - r.low
    });
  }
  // relative volume against the day so far, which is all a live engine has
  var runningSum = 0;
  out.forEach(function (b, i) {
    runningSum += b.volume;
    var avg = runningSum / (i + 1);
    b.relVol = avg > 0 ? b.volume / avg : 1;
  });
  return out;
}

// ---------------------------------------------------------------- structure
// A pivot at index i is only KNOWN at i + K. Returning pivots that a live
// engine could not yet have seen would be leakage dressed as analysis.
function swings(bars, K, upto) {
  var hi = [], lo = [];
  var last = Math.min(bars.length - 1, upto);
  for (var i = K; i <= last - K; i++) {
    var isHi = true, isLo = true;
    for (var j = 1; j <= K; j++) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) isHi = false;
      if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) isLo = false;
    }
    if (isHi) hi.push({ i: i, price: bars[i].high, time: bars[i].time, confirmedAt: i + K });
    if (isLo) lo.push({ i: i, price: bars[i].low, time: bars[i].time, confirmedAt: i + K });
  }
  return { highs: hi, lows: lo };
}

// HH / HL / LH / LL, and the trend they imply.
function structure(sw) {
  var H = sw.highs, L = sw.lows;
  var labels = [];
  for (var i = 1; i < H.length; i++)
    labels.push({ kind: H[i].price > H[i - 1].price ? 'HH' : 'LH', i: H[i].i, price: H[i].price, time: H[i].time });
  for (var j = 1; j < L.length; j++)
    labels.push({ kind: L[j].price > L[j - 1].price ? 'HL' : 'LL', i: L[j].i, price: L[j].price, time: L[j].time });
  labels.sort(function (a, b) { return a.i - b.i; });

  var recent = labels.slice(-4);
  // Compare the last two highs against each other and the last two lows against
  // each other. A mixed window of the last four labels sorted by index put an
  // old LH beside a fresh HL and called a rising day a downtrend — the labels
  // were right and the reading of them was wrong.
  var hUp = H.length > 1 ? H[H.length - 1].price > H[H.length - 2].price : null;
  var lUp = L.length > 1 ? L[L.length - 1].price > L[L.length - 2].price : null;
  var trend = 'RANGE';
  if (hUp === true && lUp === true) trend = 'UP';
  else if (hUp === false && lUp === false) trend = 'DOWN';
  else if (hUp === null && lUp === true) trend = 'UP';
  else if (hUp === null && lUp === false) trend = 'DOWN';
  else if (lUp === null && hUp === true) trend = 'UP';
  else if (lUp === null && hUp === false) trend = 'DOWN';
  // Disagreement between highs and lows is a range, whichever came last: a
  // higher low under a lower high is a contraction, not a direction.

  return {
    trend: trend, labels: labels, recent: recent,
    lastHigh: H.length ? H[H.length - 1] : null,
    prevHigh: H.length > 1 ? H[H.length - 2] : null,
    lastLow: L.length ? L[L.length - 1] : null,
    prevLow: L.length > 1 ? L[L.length - 2] : null,
    // the most recent lower high is the level a reversal must reclaim
    lastLH: labels.filter(function (x) { return x.kind === 'LH'; }).slice(-1)[0] || null
  };
}

// ---------------------------------------------------------------- day quality
// "Is this stock worth trading long today?" — asked separately from "can I buy
// here", because a weak stock reaching support repeatedly is exactly what
// produced dozens of meaningless signals in the old engine.
function longQuality(bars, st, ctx) {
  var b = bars[bars.length - 1];
  var parts = [];
  var add = function (name, pts, max, why) { parts.push({ name: name, pts: pts, max: max, why: why }); };

  add('מבנה', st.trend === 'UP' ? 2 : st.trend === 'RANGE' ? 1 : 0, 2,
    st.trend === 'UP' ? 'HH + HL' : st.trend === 'DOWN' ? 'LH + LL' : 'טווח');

  var aboveV = b.close > b.vwap;
  add('VWAP', aboveV ? 2 : b.close > b.vwap * 0.998 ? 1 : 0, 2,
    aboveV ? 'מעל' : 'מתחת');

  var emaOk = b.ema9 > b.ema20;
  add('EMA', emaOk ? 1 : 0, 1, emaOk ? 'EMA9 מעל EMA20' : 'EMA9 מתחת');

  // sustained upside: how much of the session was spent above VWAP
  var above = bars.filter(function (x) { return x.close > x.vwap; }).length;
  var pctAbove = bars.length ? above / bars.length : 0;
  add('החזקה מעל VWAP', pctAbove > 0.65 ? 2 : pctAbove > 0.4 ? 1 : 0, 2,
    Math.round(pctAbove * 100) + '% מהיום');

  // range expansion: is the stock actually moving
  var dayRange = Math.max.apply(null, bars.map(function (x) { return x.high; }))
    - Math.min.apply(null, bars.map(function (x) { return x.low; }));
  var expansion = b.atr > 0 ? dayRange / b.atr : 0;
  add('טווח', expansion > 12 ? 1 : 0, 1, expansion.toFixed(1) + '× ATR');

  // relative strength against the benchmark, when one was supplied
  var rs = null;
  if (ctx && ctx.benchBars && ctx.benchBars.length) {
    var bb = ctx.benchBars;
    var symRet = (b.close - bars[0].open) / bars[0].open;
    var benRet = (bb[bb.length - 1].close - bb[0].open) / bb[0].open;
    rs = symRet - benRet;
    add('חוזק יחסי', rs > 0.004 ? 2 : rs > 0 ? 1 : 0, 2,
      (rs >= 0 ? '+' : '') + (rs * 100).toFixed(2) + '% מול המדד');
  } else add('חוזק יחסי', 0, 2, 'אין נתוני מדד');

  var score = parts.reduce(function (s, p) { return s + p.pts; }, 0);
  var max = parts.reduce(function (s, p) { return s + p.max; }, 0);
  var pct = max ? score / max : 0;
  var label = pct >= 0.75 ? 'Strong' : pct >= 0.55 ? 'Good' : pct >= 0.38 ? 'Neutral'
    : pct >= 0.2 ? 'Weak' : 'Avoid';
  return { score: score, max: max, pct: pct, label: label, parts: parts, rs: rs };
}

// ---------------------------------------------------------------- setups
// Three shapes, each with its own evidence requirement.
function detectSetup(bars, st, prior, cfg) {
  var n = bars.length, b = bars[n - 1], atr = b.atr || 0.01;
  var recent = bars.slice(-Math.min(n, 30));

  // ---- CONTINUATION: impulse, breakout, shallow retest that HELD
  if (st.trend === 'UP' && st.lastHigh && st.lastLow) {
    var brokeHigh = st.prevHigh && b.high > st.prevHigh.price;
    var pullDepth = st.lastHigh ? (st.lastHigh.price - b.low) / atr : 99;
    var higherLow = st.lastLow && st.prevLow && st.lastLow.price > st.prevLow.price;
    if ((brokeHigh || higherLow) && pullDepth <= cfg.retestMaxATR) {
      // The trigger is the micro-high since the pullback low, not the original
      // breakout: demanding a full return to the breakout is what made the old
      // engine miss shallow continuations.
      var sinceLow = bars.slice(st.lastLow.i);
      var microHigh = Math.max.apply(null, sinceLow.map(function (x) { return x.high; }));
      return {
        type: 'PULLBACK_CONTINUATION',
        trigger: +(microHigh + 0.01).toFixed(2),
        structuralLow: st.lastLow.price,
        anchor: st.lastLow,
        what: 'מבנה עולה, שפל גבוה יותר ב-' + st.lastLow.price.toFixed(2)
          + (brokeHigh ? ', פריצת השיא הקודם' : '')
      };
    }
  }

  // ---- REVERSAL
  // Sequence, in order: active decline -> selling stops (a low that FAILED to
  // make a new LL) -> a meaningful lower high reclaimed -> the reclaim HOLDS
  // -> a higher low forms above the reclaimed level -> continuation trigger.
  // "Price touched support" appears nowhere in that list, and a reversal long
  // cannot exist before the failed low and the held reclaim are both on the
  // tape. Morning knives on a weak stock stay blocked by the first two steps.
  if (st.lastLow && (st.lows || []).length >= 2 && (st.highs || []).length >= 1) {
    var lows2 = st.lows || [];
    // "selling stops" is judged against the DECLINE'S low — the lowest of the
    // recent pivot lows — not against whichever pivot happened to come just
    // before. Comparing to the immediate predecessor called a low that held
    // above the bottom of the decline a 'new LL' because the pivot in between
    // was a bounce. The failed-low is a later low that did not undercut it.
    var recentLows = lows2.slice(-4);
    var declineLow = recentLows.reduce(function (m, x) { return x.price < m.price ? x : m; });
    var failedLL = st.lastLow.i > declineLow.i && st.lastLow.price >= declineLow.price - 0.1 * atr;
    // the resistance to reclaim is the most recent confirmed swing high formed
    // during the decline, whatever its label
    var lh = null;
    for (var hj = st.highs.length - 1; hj >= 0; hj--) {
      if (st.highs[hj].i > declineLow.i && st.highs[hj].i < st.lastLow.i) { lh = st.highs[hj]; break; }
    }
    if (!lh) for (var hk = st.highs.length - 1; hk >= 0; hk--) { if (st.highs[hk].i > declineLow.i) { lh = st.highs[hk]; break; } }
    if (failedLL && lh) {
      // reclaim: closes above the LH, and how many bars it has held
      var heldBars = 0;
      for (var i2 = n - 1; i2 >= 0 && bars[i2].close > lh.price; i2--) heldBars++;
      var reclaimed = heldBars >= cfg.holdBars;
      // higher low AFTER the reclaim began, above the reclaimed level
      var sinceReclaim = bars.slice(Math.max(0, n - heldBars));
      var hlAfter = st.lastLow && st.lastLow.i >= n - heldBars - cfg.K && st.lastLow.price > lh.price - 0.2 * atr;
      if (reclaimed) {
        var microHigh2 = Math.max.apply(null, sinceReclaim.map(function (x) { return x.high; }));
        return {
          type: 'REVERSAL',
          trigger: +(microHigh2 + 0.01).toFixed(2),
          structuralLow: hlAfter ? st.lastLow.price : Math.min.apply(null, sinceReclaim.map(function (x) { return x.low; })),
          anchor: st.lastLow, anchorLowTime: st.lastLow.time, anchorHighTime: lh.time,
          confirmation: hlAfter ? 'HL_AFTER_RECLAIM' : 'RECLAIM_HELD', reclaimLevel: +lh.price.toFixed(2),
          what: 'היפוך: שפל חדש נכשל ב-' + st.lastLow.price.toFixed(2) + ', LH ' + lh.price.toFixed(2)
            + ' (' + lh.time + ') הוחזר ומחזיק ' + heldBars + ' נרות'
            + (hlAfter ? ', שפל גבוה יותר מעליו' : ', ממתין לשפל גבוה יותר')
        };
      }
    }
  }
  if (st.trend === 'DOWN') {
    var lhTxt = st.lastLH ? st.lastLH.price.toFixed(2) : 'השיא האחרון';
    return { type: null, blocked: 'DOWNTREND',
      what: 'מבנה יורד' + (st.lastLow && st.prevLow && st.lastLow.price < st.prevLow.price ? ' עם שפל חדש' : '')
        + '. נדרש: שפל שנכשל, החזרת ' + lhTxt + ' והחזקה מעליו' };
  }

  // ---- RECLAIM_CONTINUATION
  // Constructive broader context -> a meaningful level lost temporarily ->
  // reclaimed -> the reclaim holds -> continuation above the reclaim's
  // micro-high. It does not need a fresh base: the trend already supplied the
  // context. The level is VWAP or the last confirmed swing low, whichever the
  // price actually lost and regained.
  if (st.trend !== 'DOWN' && b.close > b.vwap && st.lastLow) {
    var levels = [{ price: b.vwap, name: 'VWAP' }];
    if (st.prevLow) levels.push({ price: st.prevLow.price, name: 'שפל ' + st.prevLow.time });
    var look = bars.slice(-14, -1);
    for (var li = 0; li < levels.length; li++) {
      var L = levels[li];
      var lostAt = -1;
      for (var k = look.length - 1; k >= 0; k--) if (look[k].close < L.price - 0.05 * atr) { lostAt = k; break; }
      if (lostAt < 0) continue;
      // reclaimed after the loss, and holding since
      var held2 = 0;
      for (var m2 = n - 1; m2 >= 0 && bars[m2].close > L.price; m2--) held2++;
      if (held2 >= cfg.holdBars && held2 < look.length - lostAt + 1) {
        var since = bars.slice(n - held2);
        var mh = Math.max.apply(null, since.map(function (x) { return x.high; }));
        var lowSince = Math.min.apply(null, since.map(function (x) { return x.low; }));
        return {
          type: 'RECLAIM_CONTINUATION',
          trigger: +(mh + 0.01).toFixed(2),
          structuralLow: lowSince,
          anchor: null, anchorLowTime: since[0].time, anchorHighTime: bars[n - 1].time,
          reclaimLevel: +L.price.toFixed(2), reclaimLevelName: L.name,
          what: L.name + ' ' + L.price.toFixed(2) + ' אבד ב-' + look[lostAt].time
            + ', הוחזר ומחזיק ' + held2 + ' נרות; מבנה ' + st.trend
        };
      }
    }
  }

  // ---- PULLBACK in a healthy uptrend that has not yet made a higher low
  // A pullback needs a CONFIRMED higher low to hang on. Without one the trigger
  // was the highest of the last three bars and the invalidation the lowest of
  // the last six — two arbitrary numbers that fire on almost any bar inside an
  // uptrend. That produced 203 of 251 trades on the development set at -0.22R,
  // with an average MAE of -0.90R: entries taken before the pullback had
  // actually ended, stopped by the noise they were entered into.
  //
  // The anchor is now the confirmed swing low itself, which also gives the stop
  // something real to sit under and the setup an identity that survives.
  if (st.trend === 'UP' && st.lastHigh && st.lastLow && st.prevLow
      && b.close < st.lastHigh.price && b.close > b.vwap) {
    var hl2 = st.lastLow.price > st.prevLow.price - 0.05 * atr;
    var lowIsRecent = st.lastLow.i > st.lastHigh.i;          // the low came AFTER the high
    var confirmed = st.lastLow.confirmedAt <= n - 1;
    var depth = (st.lastHigh.price - b.close) / atr;
    var holdsAboveLow = b.close > st.lastLow.price;
    if (hl2 && lowIsRecent && confirmed && holdsAboveLow
        && depth > 0.3 && depth <= cfg.retestMaxATR * 1.6) {
      var sinceHL = bars.slice(st.lastLow.i);
      return {
        type: 'PULLBACK_CONTINUATION',
        trigger: +(Math.max.apply(null, sinceHL.map(function (x) { return x.high; })) + 0.01).toFixed(2),
        structuralLow: st.lastLow.price,
        anchor: st.lastLow, anchorLowTime: st.lastLow.time, anchorHighTime: st.lastHigh.time,
        what: 'נסיגה ' + depth.toFixed(1) + '× ATR מהשיא ' + st.lastHigh.price.toFixed(2)
          + ', שפל גבוה יותר מאושר ' + st.lastLow.price.toFixed(2) + ' (' + st.lastLow.time + ')'
      };
    }
  }

  // ---- STRUCTURAL BASE
  //
  // The sliding-window detector this replaces measured the width of two
  // adjacent windows, and that proxy failed in both directions at once: it
  // missed a real base whose window happened to contain one old wide bar, and
  // it sliced a single continuous rise into three "new" bases because the
  // window's low drifted upward every minute. Width is not structure.
  //
  // A base is a pair of confirmed pivots — a defended low and the resistance
  // above it — and everything else follows from them. The identity of the setup
  // is those two pivots, so the same structure keeps the same id however many
  // times it is re-observed, and a drifting window cannot manufacture a new one.
  var lows = st.lows || [], highs = st.highs || [];
  if (lows.length >= 2 && highs.length >= 1) {
    // the defended low: the most recent confirmed low that is not a new LL
    var anchorLow = lows[lows.length - 1];
    var priorLow = lows[lows.length - 2];
    var isHL = anchorLow.price >= priorLow.price - 0.05 * atr;

    // the resistance that caps the base: a confirmed high AFTER that low
    var anchorHigh = null;
    for (var hi2 = highs.length - 1; hi2 >= 0; hi2--) {
      if (highs[hi2].i > anchorLow.i) anchorHigh = highs[hi2]; else break;
    }
    // no high after the low yet: the base has no ceiling, so no trigger
    if (isHL && anchorHigh && anchorHigh.confirmedAt <= n - 1) {
      var baseLow = anchorLow.price, baseHigh = anchorHigh.price;
      var height = baseHigh - baseLow;

      // bars strictly between the two anchors and after them, EXCLUDING the
      // current one: the base is what came before the breakout.
      var inside = bars.slice(anchorLow.i, n - 1);
      var holds = inside.filter(function (x) { return x.low >= baseLow - 0.15 * atr; }).length;
      var heldRatio = inside.length ? holds / inside.length : 0;

      // no meaningful new low since the anchor
      var lowestSince = inside.length
        ? Math.min.apply(null, inside.map(function (x) { return x.low; })) : baseLow;
      var noNewLL = lowestSince >= baseLow - 0.25 * atr;

      var sane = height > 0.2 * atr && height <= 6 * atr;
      var vwapOk = b.close >= b.vwap - 0.25 * atr;
      var emaOk = b.ema9 >= b.ema20 - 0.1 * atr;
      var enoughBars = inside.length >= 4;
      var insideStructure = b.close >= baseLow;

      if (sane && enoughBars && heldRatio >= 0.7 && noNewLL && vwapOk && emaOk && insideStructure) {
        return {
          type: 'STRUCTURAL_BASE',
          // frozen at the resistance pivot, never at the current bar's high
          trigger: +(baseHigh + 0.01).toFixed(2),
          structuralLow: baseLow,
          anchor: anchorLow,
          anchorLowTime: anchorLow.time, anchorHighTime: anchorHigh.time,
          baseHigh: +baseHigh.toFixed(2), baseLow: +baseLow.toFixed(2),
          what: 'בסיס מבני: שפל מוגן ' + baseLow.toFixed(2) + ' (' + anchorLow.time
            + ') מול התנגדות ' + baseHigh.toFixed(2) + ' (' + anchorHigh.time + '), '
            + Math.round(heldRatio * 100) + '% מהנרות החזיקו מעל השפל'
        };
      }
    }
  }

  return { type: null, what: st.trend === 'RANGE' ? 'טווח ללא כיוון' : 'אין מבנה כניסה' };
}

// ---------------------------------------------------------------- scoring
// Every point is attributable. A READY with a score of zero, which the old
// engine could produce, is a contradiction this makes impossible.
function scoreSetup(bars, st, setup, quality, cfg) {
  var b = bars[bars.length - 1], atr = b.atr || 0.01;
  var parts = [], add = function (n2, p, m, w) { parts.push({ name: n2, pts: p, max: m, why: w }); };

  // A qualified base IS structure. Scoring it as a directionless range would
  // guarantee it never reaches READY, which is the bug in a different place.
  add('מבנה', setup.type === 'STRUCTURAL_BASE' ? 2
    : st.trend === 'UP' ? 2 : st.trend === 'RANGE' ? 1 : 0, 2,
    setup.type === 'STRUCTURAL_BASE' ? 'בסיס בנוי' : st.trend);

  var hl = st.lastLow && st.prevLow && st.lastLow.price > st.prevLow.price;
  add('שפל גבוה יותר', hl ? 2 : 0, 2, hl ? 'מאושר' : 'אין');

  var reclaim = setup.type === 'REVERSAL' ? 2 : (b.close > b.vwap ? 1 : 0);
  add('החזרה', reclaim, 2, setup.type === 'REVERSAL' ? 'החזיר LH' : (b.close > b.vwap ? 'מעל VWAP' : 'מתחת VWAP'));

  var mom = b.close > b.open && b.close > bars[Math.max(0, bars.length - 4)].close;
  add('מומנטום', mom ? 1 : 0, 1, mom ? 'עולה' : 'חלש');

  add('נפח', b.relVol >= cfg.volSurge ? 1 : 0, 1, '×' + b.relVol.toFixed(2));

  add('EMA', b.ema9 > b.ema20 ? 1 : 0, 1, b.ema9 > b.ema20 ? 'תואם' : 'לא תואם');

  add('איכות המניה', quality.pct >= 0.75 ? 2 : quality.pct >= 0.55 ? 1 : 0, 2, quality.label);

  // extension penalty: buying far above the trigger is chasing
  var ext = setup.trigger ? (b.close - setup.trigger) / atr : 0;
  var chasePenalty = ext > cfg.chaseATR ? -2 : ext > cfg.chaseATR / 2 ? -1 : 0;
  add('מרדף', chasePenalty, 0, ext > 0 ? ext.toFixed(1) + '× ATR מעל הטריגר' : 'לא מורחב');

  var raw = parts.reduce(function (s, p) { return s + p.pts; }, 0);
  var max = parts.reduce(function (s, p) { return s + Math.max(0, p.max); }, 0);
  var score = Math.max(0, Math.min(10, Math.round(raw / max * 10)));
  return { score: score, raw: raw, max: max, parts: parts, extension: ext };
}

// ---------------------------------------------------------------- the plan
//
// TARGET GENERATION and R:R VALIDATION are two separate steps, on purpose.
// The old builder set T1 to entry + risk * minRR, rounded it for display, and
// then failed its own test at 1.49 against 1.50 — a target manufactured to
// equal the minimum was being used as proof the minimum was met.
//
// Targets come from structure first: the nearest confirmed swing high above
// the entry, the session high, the day's prior high. An R-multiple is used
// only where no structural objective exists, and it is then labelled as such.
// Every comparison uses unrounded values; rounding happens once, for display.
function structuralTargets(bars, st, entry) {
  var out = [];
  (st.highs || []).forEach(function (h) { if (h.price > entry) out.push({ price: h.price, why: 'שיא ' + h.time }); });
  var sessHigh = Math.max.apply(null, bars.map(function (x) { return x.high; }));
  if (sessHigh > entry) out.push({ price: sessHigh, why: 'שיא הסשן' });
  out.sort(function (a, b) { return a.price - b.price; });
  // de-duplicate targets within a cent of each other
  return out.filter(function (t, i) { return i === 0 || t.price - out[i - 1].price > 0.01; });
}

function buildPlan(bars, st, setup, sc, cfg) {
  var b = bars[bars.length - 1], atr = b.atr || 0.01;
  if (!setup.type || setup.trigger == null) return null;
  var entry = setup.trigger;
  var low = setup.structuralLow != null ? setup.structuralLow
    : Math.min.apply(null, bars.slice(-6).map(function (x) { return x.low; }));
  var stopRaw = low - cfg.stopPadATR * atr;
  var riskRaw = entry - stopRaw;
  if (riskRaw <= 0) return null;

  // 1. TARGET GENERATION — structure first
  var targets = structuralTargets(bars, st, entry);
  // a target must be far enough to be worth the risk; anything inside 0.8R is
  // in the way, not an objective
  // The nearest swing high above is often an obstacle on the way to the real
  // objective, not the objective. The target is the nearest structural level
  // that actually pays the minimum; levels inside that distance are noted as
  // resistance en route. If structure exists above but none of it pays, the
  // R:R is genuinely poor and the plan says so.
  var paying = targets.filter(function (t) { return (t.price - entry) / riskRaw >= cfg.minRR; });
  var enRoute = targets.filter(function (t) { return (t.price - entry) / riskRaw < cfg.minRR; });
  var t1, t1Why, t2, t2Why, targetSource;
  if (paying.length) {
    t1 = paying[0].price; t1Why = paying[0].why; targetSource = 'structural';
    t2 = paying.length > 1 ? paying[1].price : entry + riskRaw * 2.5;
    t2Why = paying.length > 1 ? paying[1].why : 'x2.5R (אין מבנה מעל)';
  } else if (targets.length) {
    // structure above, none of it worth the risk: report the nearest and let
    // the R:R validation reject it honestly
    t1 = targets[0].price; t1Why = targets[0].why + ' (קרוב מדי)'; targetSource = 'structural-insufficient';
    t2 = entry + riskRaw * 2.5; t2Why = 'x2.5R';
  } else {
    // no structural objective: an R-multiple, labelled as such, and NOT the
    // minimum — a target invented to sit exactly on the bar proves nothing
    t1 = entry + riskRaw * 2.0; t1Why = 'x2.0R (אין יעד מבני)'; targetSource = 'r-multiple';
    t2 = entry + riskRaw * 3.0; t2Why = 'x3.0R';
  }

  // 2. R:R VALIDATION — unrounded, against the structural target actually chosen
  var rrRaw = (t1 - entry) / riskRaw;
  var rrOk = rrRaw >= cfg.minRR;

  return {
    entry: +entry.toFixed(2), zone: [+entry.toFixed(2), +(entry + 0.15 * atr).toFixed(2)],
    stop: +stopRaw.toFixed(2), invalidation: +low.toFixed(2),
    t1: +t1.toFixed(2), t2: +t2.toFixed(2), t1Why: t1Why, t2Why: t2Why,
    targetSource: targetSource,
    resistanceEnRoute: (typeof enRoute !== 'undefined' ? enRoute : []).map(function (t) { return +t.price.toFixed(2); }),
    risk: +riskRaw.toFixed(2), rr: +rrRaw.toFixed(2),
    // the internal truth, kept separately from the display values
    _raw: { stop: stopRaw, risk: riskRaw, t1: t1, t2: t2, rr: rrRaw },
    rrOk: rrOk
  };
}

// A structure is broken on a CLOSE below its invalidation, or on a tick that
// runs well past the stop. A one-tick sweep of the base low that closes back
// on top of the base is not a break — it is the most common shape a real
// breakout takes, and judging it on the wick killed the best setups first.
// The simulated trade's stop still fills on a touch; that is the trade's
// reality, and it is kept separate from whether the THESIS is broken.
function structureBroken(b, plan, cfg) {
  if (!plan) return false;
  if (b.close < plan.invalidation) return true;
  // a tick guard only for a genuine collapse; a sweep that closes back on top
  // of the structure is judged by its close
  var atrPad = (b.atr || 0.01) * 1.5;
  return b.low < plan.stop - atrPad;
}

// ---------------------------------------------------------------- the decision
// One minute in. `prior` is the engine's own previous output, which is how a
// setup keeps its identity and how a failure enforces a reset.
function decide(rows, ctx, prior, config) {
  var cfg = Object.assign({}, CFG, config || {});
  var bars = (ctx && ctx.bars) || computeBars(rows);
  var n = bars.length;
  if (n < cfg.warmup) {
    return { state: 'AVOID', reason: 'פחות מ-' + cfg.warmup + ' נרות — אין מבנה', score: 0,
      next: 'ממתין ל-' + (cfg.warmup - n) + ' נרות נוספים לפני שאפשר לזהות מבנה.',
      quality: null, setup: null, plan: null, setupId: null, bars: n,
      time: n ? bars[n - 1].time : null, price: n ? bars[n - 1].close : null };
  }
  var b = bars[n - 1];
  var sw = swings(bars, cfg.K, n - 1);
  var st = structure(sw); st.highs = sw.highs; st.lows = sw.lows;
  var quality = longQuality(bars, st, ctx);
  var setup = detectSetup(bars, st, prior, cfg);

  // A LIVE setup survives a bar in which detection happens to find nothing.
  //
  // detectSetup re-evaluates from scratch every minute, so a momentary flicker
  // in the structure — one bar dipping past the retest limit, a pivot arriving
  // and shifting the trend read — made a live setup vanish along with its plan.
  // That produced the exact regression the spec calls out: the ARMED trigger is
  // broken, nothing is invalidated, and the state falls to WATCH saying "no
  // entry structure". A setup ends when it is invalidated or when it expires,
  // not because this particular bar could not re-derive it.
  var liveStates = ['SETUP', 'ARMED', 'READY', 'ACTIVE'];
  if (!setup.type && prior && prior.setup && prior.setup.type && prior.plan
      && liveStates.indexOf(prior.state) >= 0) {
    var ageBars = n - (prior.setupDetectedBar || n);
    var stillValid = b.low >= prior.plan.invalidation && ageBars < cfg.maxSetupAgeBars;
    if (stillValid) { setup = prior.setup; setup.carried = true; }
  }

  var out = {
    time: b.time, price: b.close, bars: n,
    trend: st.trend, quality: quality,
    vwap: b.vwap, ema9: b.ema9, ema20: b.ema20, relVol: b.relVol, atr: b.atr,
    labels: st.recent
  };

  // ---- invalidation is checked against the LIVE setup FIRST, whatever this
  // bar happens to detect. Checking it only when the ids matched meant a breach
  // that coincided with a different setup type being found was never recorded:
  // the engine switched ids, pinned the new invalidation at that bar's low, and
  // the old setup evaporated into WATCH without ever being FAILED — so neither
  // the cooldown nor the retired-id rule engaged.
  if (prior && prior.plan && prior.setupId
      && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0
      && structureBroken(b, prior.plan, cfg)) {
    out.state = 'FAILED';
    out.reason = 'המחיר שבר את ' + prior.plan.invalidation.toFixed(2) + ' — הסטאפ ' + prior.setupId + ' בוטל';
    out.next = 'נדרש מבנה חדש: בסיס, שפל גבוה יותר או פריצה חדשה.';
    out.failedSetupId = prior.setupId; out.failedAtBar = n;
    out.setupId = prior.setupId; out.setup = prior.setup; out.plan = null; out.score = 0;
    // The failed bar still belongs to the setup it failed: its age and creation
    // bar are carried so the lifecycle is continuous up to and including death.
    out.setupDetectedBar = prior.setupDetectedBar; out.setupAgeBars = n - (prior.setupDetectedBar || n);
    out.setupAges = (prior && prior.setupAges) || {};
    out.retiredSetups = Object.assign({}, (prior && prior.retiredSetups) || {});
    out.retiredSetups[prior.setupId] = n;
    out.setupPlans = Object.assign({}, (prior && prior.setupPlans) || {});
    delete out.setupPlans[prior.setupId];
    return out;
  }

  // ---- a failure must be reset by NEW structure, not merely by time
  var cooling = prior && prior.state === 'FAILED'
    && (n - (prior.failedAtBar || 0)) < cfg.failCooldown;
  var sameFailedSetup = prior && prior.failedSetupId && setup.type
    && setupKey(setup, st) === prior.failedSetupId;

  if (!setup.type) {
    // A live setup does not evaporate because the structure turned against it:
    // it is recorded as FAILED and retired, with the reason. Letting it vanish
    // into AVOID is the silent disappearance the lifecycle rules forbid, and it
    // also skipped the cooldown that should follow a broken thesis.
    if (prior && prior.setupId && prior.plan
        && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0) {
      out.state = 'FAILED';
      out.setupId = prior.setupId; out.setup = prior.setup; out.plan = null; out.score = 0;
      out.reason = (setup.blocked === 'DOWNTREND' ? 'המבנה התהפך לירידה' : 'המבנה נעלם')
        + ' — הסטאפ ' + prior.setupId + ' בוטל';
      out.next = setup.what;
      out.setupDetectedBar = prior.setupDetectedBar;
      out.setupAgeBars = n - (prior.setupDetectedBar || n);
      out.failedSetupId = prior.setupId; out.failedAtBar = n;
      out.setupAges = (prior && prior.setupAges) || {};
      out.retiredSetups = Object.assign({}, (prior && prior.retiredSetups) || {});
      out.retiredSetups[prior.setupId] = n;
      out.setupPlans = Object.assign({}, (prior && prior.setupPlans) || {});
      delete out.setupPlans[prior.setupId];
      return out;
    }
    out.state = setup.blocked === 'DOWNTREND' ? 'AVOID' : 'WATCH';
    out.reason = setup.what;
    out.next = setup.blocked === 'DOWNTREND'
      ? 'לא נכנסים בירידה מוצהרת. צריך עצירה, שפל שנכשל והחזרה שמחזיקה.'
      : 'ממתין למבנה: שפל גבוה יותר או פריצה עם החזקה.';
    out.score = 0; out.setup = null; out.plan = null; out.setupId = null;
    out.failedSetupId = prior && prior.failedSetupId || null;
    out.failedAtBar = prior && prior.failedAtBar || null;
    out.setupAges = (prior && prior.setupAges) || {};
    out.retiredSetups = (prior && prior.retiredSetups) || {};
    out.setupPlans = (prior && prior.setupPlans) || {};
    return out;
  }

  var id = setupKey(setup, st);
  // A base on a stock that should not be held long is chop with a nice name.
  if (setup.type === 'STRUCTURAL_BASE' && (quality.label === 'Weak' || quality.label === 'Avoid')) {
    // The same rule as the downtrend gate: a LIVE setup that this gate now
    // refuses is recorded as FAILED and retired, never silently dropped.
    // ANET 2026-09-01 11:02 fell from ARMED to WATCH here with no FAILED,
    // so neither the cooldown nor retirement ran.
    if (prior && prior.setupId === setupKey(setup, st) && prior.plan
        && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0) {
      out.state = 'FAILED';
      out.setupId = prior.setupId; out.setup = prior.setup; out.plan = null; out.score = 0;
      out.reason = 'איכות המניה ירדה ל-' + quality.label + ' — הסטאפ ' + prior.setupId + ' בוטל';
      out.next = 'לא נכנסים לבסיס במניה חלשה. נדרש שיפור באיכות היום ומבנה חדש.';
      out.setupDetectedBar = prior.setupDetectedBar; out.setupAgeBars = n - (prior.setupDetectedBar || n);
      out.failedSetupId = prior.setupId; out.failedAtBar = n;
      out.setupAges = (prior && prior.setupAges) || {};
      out.retiredSetups = Object.assign({}, (prior && prior.retiredSetups) || {}); out.retiredSetups[prior.setupId] = n;
      out.setupPlans = Object.assign({}, (prior && prior.setupPlans) || {}); delete out.setupPlans[prior.setupId];
      return out;
    }
    out.state = 'WATCH';
    out.reason = 'בסיס זוהה אבל איכות המניה ' + quality.label + ' — לא מועמד לונג';
    out.next = 'לא נכנסים לבסיס במניה חלשה. נדרש שיפור באיכות היום.';
    out.score = 0; out.setup = null; out.plan = null; out.setupId = null;
    out.failedSetupId = prior && prior.failedSetupId || null;
    out.failedAtBar = prior && prior.failedAtBar || null;
    out.setupAges = (prior && prior.setupAges) || {};
    out.retiredSetups = (prior && prior.retiredSetups) || {};
    out.setupPlans = (prior && prior.setupPlans) || {};
    return out;
  }

  var plan;
  // A trigger recomputed every bar is the current high plus a cent, which by
  // construction can never be broken — the setup would arm forever and never
  // fire. The trigger is fixed when the setup first arms and travels with the
  // setup's identity; only a NEW setup gets a new trigger.
  // The plan lives in a per-id ledger, exactly as the age does. Reading it only
  // from the previous bar meant a one-bar interruption by a different setup
  // rebuilt the trigger under the SAME identity — 475.56 became 476.69 with
  // nothing structural having changed. A frozen trigger is frozen for the life
  // of the id, not for as long as nothing else happens to be detected.
  var plans = Object.assign({}, (prior && prior.setupPlans) || {});
  var carried = !!plans[id];
  // The plan is resolved BEFORE scoring, and the score's chase distance is
  // measured from the plan's frozen trigger. It was measured from
  // setup.trigger, which detectSetup recomputes every bar as the current
  // micro-high — so a live setup's chase check compared price to a number
  // that moved with price, and four READYs fired 1.27–1.78 ATR beyond the
  // trigger the trade was actually taken at. The frozen trigger is the only
  // reference for the whole life of the setup.
  if (carried) plan = plans[id];
  else { var sc0 = scoreSetup(bars, st, setup, quality, cfg); plan = buildPlan(bars, st, setup, sc0, cfg); if (plan) plans[id] = plan; }
  out.setupPlans = plans;
  var sc = scoreSetup(bars, st, plan ? Object.assign({}, setup, { trigger: plan.entry }) : setup, quality, cfg);
  // Age travels with the setupId and is NEVER refreshed by re-detecting the same
  // structure. Detecting the same base again is not news; it is the same setup
  // being observed again.
  // Age is kept per setupId in a ledger that survives gaps. Reading it from the
  // previous bar alone was not enough: a setup that lapsed to WATCH for a minute
  // and then re-armed under the SAME id had its clock reset, so re-detecting the
  // same structure refreshed its age — exactly what must not happen. Re-seeing a
  // structure is not news about it.
  var ages = Object.assign({}, (prior && prior.setupAges) || {});
  var retired = Object.assign({}, (prior && prior.retiredSetups) || {});
  if (ages[id] == null) ages[id] = n;
  out.setupAges = ages; out.retiredSetups = retired;
  out.setupDetectedBar = ages[id];
  out.setupAgeBars = n - ages[id];

  // A retired id stays retired — but retiring ONE structure must not discard a
  // different one that is live and uninvalidated. Detection returning a stale
  // id on some bar was cancelling the whole minute, so a live setup whose
  // trigger had just been met fell to WATCH: the SM-006 regression, 25 sessions.
  // If a live setup exists and still holds, it continues and the stale
  // detection is simply ignored.
  if (retired[id] && prior && prior.setupId && prior.setupId !== id && prior.plan
      && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0
      && !structureBroken(b, prior.plan, cfg)
      && (n - (ages[prior.setupId] != null ? ages[prior.setupId] : n)) <= cfg.maxSetupAgeBars) {
    setup = prior.setup; id = prior.setupId;
    sc = scoreSetup(bars, st, setup, quality, cfg);
    plan = plans[id] || prior.plan;
    out.setupDetectedBar = ages[id]; out.setupAgeBars = n - ages[id];
  } else if (retired[id]) {
    out.state = 'WATCH';
    out.reason = 'המבנה הזה כבר פג היום — ' + id;
    out.next = 'נדרש מבנה חדש, לא חזרה על אותו בסיס.';
    out.score = 0; out.plan = null; out.expired = true;
    out.setupPlans = plans;
    return out;
  }

  // EXPIRY — the invariant QA-010 exists to enforce. Previously the age was only
  // consulted on the carry path, so a setup that kept being re-derived was never
  // checked at all and could live indefinitely. That is the opposite failure of
  // the one persistence was added to solve, and both are now closed: a setup
  // survives a detection flicker, and it still dies of old age.
  if (out.setupAgeBars > cfg.maxSetupAgeBars) {
    out.state = 'WATCH';
    out.reason = 'הסטאפ פג — ' + out.setupAgeBars + ' נרות ללא הכרעה (מקסימום '
      + cfg.maxSetupAgeBars + ')';
    out.next = 'נדרש מבנה חדש. הטריגר הישן ' + (plan ? plan.entry.toFixed(2) : '—')
      + ' כבר לא רלוונטי.';
    out.expired = true;
    out.score = 0; out.plan = null;
    // The id is retired so the same structure cannot immediately re-arm as if
    // it were new.
    out.failedSetupId = id; out.failedAtBar = n;
    return out;
  }
  out.setup = setup; out.score = sc.score; out.scoreParts = sc.parts;
  out.extension = sc.extension; out.plan = plan; out.setupId = id;
  out.planCarried = !!carried;
  out.failedSetupId = prior && prior.failedSetupId || null;
  out.failedAtBar = prior && prior.failedAtBar || null;

  // ---- invalidation of a live setup
  if (prior && prior.plan && prior.setupId === id
      && (prior.state === 'ARMED' || prior.state === 'READY' || prior.state === 'ACTIVE')
      && structureBroken(b, prior.plan, cfg)) {
    out.state = 'FAILED';
    out.reason = 'המחיר שבר את ' + prior.plan.invalidation.toFixed(2) + ' — הסטאפ בוטל';
    out.next = 'נדרש מבנה חדש: בסיס, שפל גבוה יותר או פריצה חדשה.';
    out.failedSetupId = id; out.failedAtBar = n;
    return out;
  }

  if (!plan) {
    out.state = 'WATCH'; out.reason = setup.what;
    out.next = 'אין תוכנית עם סיכון תקין עדיין.';
    return out;
  }

  // The cooldown governs STARTING a new setup on a thesis that just failed. It
  // cannot apply to a setup that is already live: at 15:49 a setup is ARMED, at
  // 15:50 the same id is judged "the setup that failed" and the live setup is
  // discarded on the bar its trigger was met. A live setup is past the point
  // the cooldown exists to guard.
  var alreadyLive = prior && prior.setupId === id
    && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0;
  if ((cooling || sameFailedSetup) && !alreadyLive) {
    out.state = 'WATCH';
    out.reason = 'הסטאפ הקודם נכשל' + (sameFailedSetup ? ' וזהו אותו מבנה' : '');
    out.next = 'ממתין למבנה חדש לפני הצבת טריגר.';
    return out;
  }

  // ---- do not chase
  // The setup stays ARMED, not WATCH. Refusing to pay this price is not the
  // same as having nothing to act on: the structure is intact, the trigger is
  // known, and what changed is only that the entry has run away. Dropping to
  // WATCH here is the regression QA-009 exists to catch — it reads as "no
  // setup" one bar after the setup did exactly what it was waiting for.
  if (sc.extension > cfg.chaseATR) {
    out.state = 'ARMED';
    out.reason = 'הטריגר ' + plan.entry.toFixed(2) + ' נפרץ, אבל המחיר כבר '
      + sc.extension.toFixed(1) + '× ATR מעליו';
    out.next = 'לא רודפים. נסיגה צפויה ' + (plan.entry - 0.6 * b.atr).toFixed(2)
      + '–' + plan.entry.toFixed(2) + '. אם היא מחזיקה ונוצר שפל גבוה יותר — כניסה מעל השיא הקטן שייווצר.';
    out.noChase = true;
    return out;
  }

  if (!plan.rrOk) {
    out.state = 'SETUP';
    out.reason = setup.what;
    out.next = 'יחס סיכון/סיכוי ' + plan.rr.toFixed(2) + ' נמוך מ-' + cfg.minRR + '. צריך כניסה נמוכה יותר או יעד רחוק יותר.';
    return out;
  }

  // A reversal without a higher low above the reclaimed level is a held reclaim
  // and nothing more. The mandated sequence puts the HL BEFORE the continuation
  // trigger, so until it prints the setup is capped at ARMED — a careless READY
  // inside unresolved local weakness is exactly what this prevents.
  if (setup.type === 'REVERSAL' && setup.confirmation !== 'HL_AFTER_RECLAIM') {
    out.state = 'ARMED';
    out.reason = setup.what;
    out.next = 'ההחזרה מחזיקה; נדרש שפל גבוה יותר מעל ' + (setup.reclaimLevel || plan.invalidation).toFixed(2)
      + ' לפני כניסה. טריגר ' + plan.entry.toFixed(2) + ' רק אחרי ה-HL.';
    return out;
  }

  // ---- the trigger itself: has it actually been taken?
  var triggered = b.high >= plan.entry && b.close >= plan.entry - 0.1 * b.atr;
  if (triggered && sc.score >= cfg.readyScore) {
    out.state = 'READY';
    out.reason = setup.what + '. הטריגר ' + plan.entry.toFixed(2) + ' נלקח.';
    out.next = 'קנייה ' + plan.zone[0].toFixed(2) + '–' + plan.zone[1].toFixed(2)
      + '. סטופ ' + plan.stop.toFixed(2) + '. יעד 1 ' + plan.t1.toFixed(2)
      + '. יעד 2 ' + plan.t2.toFixed(2) + '. R:R ' + plan.rr.toFixed(1) + '.';
    return out;
  }
  if (sc.score >= cfg.armedScore) {
    out.state = 'ARMED';
    out.reason = setup.what;
    // "What are we waiting for" — stated from the rules that actually exist,
    // nothing invented: the trigger must be taken on a bar that closes near
    // it, the score must reach the READY threshold, and price must not be
    // beyond the chase limit. The invalidation is what ends it.
    var need = [];
    if (!(b.high >= plan.entry)) need.push('פריצה של ' + plan.entry.toFixed(2));
    else if (!(b.close >= plan.entry - 0.1 * b.atr)) need.push('סגירה קרוב ל-' + plan.entry.toFixed(2) + ' (לא רק נגיעה)');
    if (sc.score < cfg.readyScore) need.push('ציון ' + cfg.readyScore + ' (כרגע ' + sc.score + ')');
    if (sc.extension > cfg.chaseATR) need.push('נסיגה לטווח ' + cfg.chaseATR + ' ATR מהטריגר (כרגע ' + sc.extension.toFixed(1) + ')');
    out.waiting = { state: 'WAIT', level: setup.reclaimLevel != null ? setup.reclaimLevel : null,
      trigger: plan.entry, stillRequired: need, invalidation: plan.invalidation,
      readyWhen: 'הטריגר ' + plan.entry.toFixed(2) + ' נלקח בסגירה קרובה, ציון ≥ ' + cfg.readyScore + ', לא מעבר ל-' + cfg.chaseATR + ' ATR',
      killedWhen: 'סגירה מתחת ' + plan.invalidation.toFixed(2) };
    out.next = 'WAIT · ' + (setup.reclaimLevel != null ? 'רמה ' + setup.reclaimLevel.toFixed(2) + ' · ' : '')
      + 'טריגר ' + plan.entry.toFixed(2) + ' · עדיין נדרש: ' + (need.join(', ') || 'כלום — ממתין לנר הבא')
      + ' · ביטול ' + plan.invalidation.toFixed(2);
    return out;
  }
  // A live plan floors the state at ARMED. A falling score is a reason not to
  // BUY; it is not a reason to pretend the setup stopped existing. Only an
  // invalidation or an expiry ends a setup, and both are handled above — so a
  // trigger that was satisfied can never be followed by "no setup here".
  var livePlan = prior && prior.setupId === id && prior.plan
    && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0;
  if (livePlan) {
    out.state = 'ARMED';
    out.reason = setup.what + ' — האיכות ירדה לציון ' + sc.score + '/10';
    out.next = 'הטריגר ' + plan.entry.toFixed(2) + ' עדיין עומד והביטול ' + plan.invalidation.toFixed(2)
      + ' לא נשבר, אבל בציון הזה לא נכנסים. נדרש ' + cfg.readyScore + '.';
    return out;
  }
  out.state = 'WATCH';
  out.reason = setup.what + ' (ציון ' + sc.score + '/10)';
  out.next = 'המבנה קיים אבל האיכות נמוכה מדי. נדרש ציון ' + cfg.armedScore + ' להצבת טריגר.';
  return out;
}

// A setup's identity: its type plus the structural low it hangs on. A new
// anchor is a new setup; the same anchor after a failure is not.
function setupKey(setup, st) {
  if (!setup || !setup.type) return null;
  // A structural base is identified by the two pivots that define it. Keying it
  // on a price meant a window drifting by one candle produced a new id every
  // minute, which slipped past the expiry rule and the failure rule alike.
  if (setup.type === 'STRUCTURAL_BASE')
    return 'STRUCTURAL_BASE|' + setup.anchorLowTime + '|' + setup.anchorHighTime;
  if (setup.type === 'RECLAIM_CONTINUATION')
    return 'RECLAIM_CONTINUATION|' + setup.reclaimLevelName + '@' + setup.reclaimLevel + '|' + setup.anchorLowTime;
  if (setup.type === 'REVERSAL')
    return 'REVERSAL|' + setup.anchorLowTime + '|' + setup.anchorHighTime;
  if (setup.type === 'PULLBACK_CONTINUATION' && setup.anchorLowTime)
    return 'PULLBACK_CONTINUATION|' + setup.anchorLowTime + '|' + setup.anchorHighTime;
  var anchor = setup.structuralLow != null ? setup.structuralLow.toFixed(2) : 'x';
  return setup.type + '@' + anchor;
}

if (typeof module !== 'undefined') module.exports = {
  CFG: CFG, computeBars: computeBars, swings: swings, structure: structure,
  longQuality: longQuality, detectSetup: detectSetup, scoreSetup: scoreSetup,
  buildPlan: buildPlan, decide: decide, setupKey: setupKey
};
