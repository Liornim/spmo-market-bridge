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
        type: 'CONTINUATION',
        trigger: +(microHigh + 0.01).toFixed(2),
        structuralLow: st.lastLow.price,
        anchor: st.lastLow,
        what: 'מבנה עולה, שפל גבוה יותר ב-' + st.lastLow.price.toFixed(2)
          + (brokeHigh ? ', פריצת השיא הקודם' : '')
      };
    }
  }

  // ---- REVERSAL: only after the decline has demonstrably stopped
  if (st.trend === 'DOWN' && st.lastLH) {
    var lows = st.lows || [];
    var madeNewLow = st.lastLow && st.prevLow && st.lastLow.price < st.prevLow.price;
    var failedNewLow = st.lastLow && st.prevLow && st.lastLow.price >= st.prevLow.price;
    // The reclaim must be of the most recent lower high, and it must hold.
    var reclaimed = b.close > st.lastLH.price;
    var heldBars = 0;
    for (var i = n - 1; i >= 0 && bars[i].close > st.lastLH.price; i--) heldBars++;
    if (failedNewLow && reclaimed && heldBars >= cfg.holdBars) {
      return {
        type: 'REVERSAL',
        trigger: +(Math.max.apply(null, bars.slice(-cfg.holdBars).map(function (x) { return x.high; })) + 0.01).toFixed(2),
        structuralLow: st.lastLow.price,
        anchor: st.lastLow,
        what: 'ירידה נעצרה, שפל חדש נכשל ב-' + st.lastLow.price.toFixed(2)
          + ', והמחיר החזיר את ' + st.lastLH.price.toFixed(2) + ' ל-' + heldBars + ' נרות'
      };
    }
    // Downtrend without that evidence is explicitly not tradable long.
    return { type: null, blocked: 'DOWNTREND',
      what: 'מבנה יורד' + (madeNewLow ? ' עם שפל חדש' : '')
        + '. נדרש: עצירה, שפל שנכשל, החזרת ' + st.lastLH.price.toFixed(2) + ' והחזקה מעליו' };
  }

  // ---- PULLBACK in a healthy uptrend that has not yet made a higher low
  if (st.trend === 'UP' && st.lastHigh && b.close < st.lastHigh.price && b.close > b.vwap) {
    var depth = (st.lastHigh.price - b.close) / atr;
    if (depth > 0.3 && depth <= cfg.retestMaxATR * 1.6) {
      return {
        type: 'PULLBACK',
        trigger: +(Math.max.apply(null, bars.slice(-3).map(function (x) { return x.high; })) + 0.01).toFixed(2),
        structuralLow: Math.min.apply(null, bars.slice(-6).map(function (x) { return x.low; })),
        anchor: null,
        what: 'נסיגה של ' + depth.toFixed(1) + '× ATR מהשיא, מעל VWAP'
      };
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

  add('מבנה', st.trend === 'UP' ? 2 : st.trend === 'RANGE' ? 1 : 0, 2, st.trend);

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
function buildPlan(bars, st, setup, sc, cfg) {
  var b = bars[bars.length - 1], atr = b.atr || 0.01;
  if (!setup.type || setup.trigger == null) return null;
  var entry = setup.trigger;
  var low = setup.structuralLow != null ? setup.structuralLow
    : Math.min.apply(null, bars.slice(-6).map(function (x) { return x.low; }));
  var stop = +(low - cfg.stopPadATR * atr).toFixed(2);
  var risk = entry - stop;
  if (risk <= 0) return null;
  // Targets from structure where one exists, otherwise multiples of risk.
  var overhead = st.highs && st.highs.length
    ? st.highs.map(function (h) { return h.price; }).filter(function (p) { return p > entry; }).sort(function (a, c) { return a - c; })[0]
    : null;
  var t1 = +(overhead && overhead > entry + risk * 0.8 ? overhead : entry + risk * 1.5).toFixed(2);
  var t2 = +(entry + risk * 2.5).toFixed(2);
  return {
    entry: +entry.toFixed(2), zone: [+entry.toFixed(2), +(entry + 0.15 * atr).toFixed(2)],
    stop: stop, invalidation: +low.toFixed(2), t1: t1, t2: t2,
    risk: +risk.toFixed(2), rr: +((t1 - entry) / risk).toFixed(2)
  };
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

  var out = {
    time: b.time, price: b.close, bars: n,
    trend: st.trend, quality: quality,
    vwap: b.vwap, ema9: b.ema9, ema20: b.ema20, relVol: b.relVol, atr: b.atr,
    labels: st.recent
  };

  // ---- a failure must be reset by NEW structure, not merely by time
  var cooling = prior && prior.state === 'FAILED'
    && (n - (prior.failedAtBar || 0)) < cfg.failCooldown;
  var sameFailedSetup = prior && prior.failedSetupId && setup.type
    && setupKey(setup, st) === prior.failedSetupId;

  if (!setup.type) {
    out.state = setup.blocked === 'DOWNTREND' ? 'AVOID' : 'WATCH';
    out.reason = setup.what;
    out.next = setup.blocked === 'DOWNTREND'
      ? 'לא נכנסים בירידה מוצהרת. צריך עצירה, שפל שנכשל והחזרה שמחזיקה.'
      : 'ממתין למבנה: שפל גבוה יותר או פריצה עם החזקה.';
    out.score = 0; out.setup = null; out.plan = null; out.setupId = null;
    out.failedSetupId = prior && prior.failedSetupId || null;
    out.failedAtBar = prior && prior.failedAtBar || null;
    return out;
  }

  var id = setupKey(setup, st);
  var sc = scoreSetup(bars, st, setup, quality, cfg);
  var plan;
  // A trigger recomputed every bar is the current high plus a cent, which by
  // construction can never be broken — the setup would arm forever and never
  // fire. The trigger is fixed when the setup first arms and travels with the
  // setup's identity; only a NEW setup gets a new trigger.
  var carried = prior && prior.setupId === id && prior.plan
    && ['SETUP', 'ARMED', 'READY', 'ACTIVE'].indexOf(prior.state) >= 0;
  if (carried) plan = prior.plan;
  else plan = buildPlan(bars, st, setup, sc, cfg);
  out.setup = setup; out.score = sc.score; out.scoreParts = sc.parts;
  out.extension = sc.extension; out.plan = plan; out.setupId = id;
  out.planCarried = !!carried;
  out.failedSetupId = prior && prior.failedSetupId || null;
  out.failedAtBar = prior && prior.failedAtBar || null;

  // ---- invalidation of a live setup
  if (prior && prior.plan && prior.setupId === id
      && (prior.state === 'ARMED' || prior.state === 'READY' || prior.state === 'ACTIVE')
      && b.low < prior.plan.invalidation) {
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

  if (cooling || sameFailedSetup) {
    out.state = 'WATCH';
    out.reason = 'הסטאפ הקודם נכשל' + (sameFailedSetup ? ' וזהו אותו מבנה' : '');
    out.next = 'ממתין למבנה חדש לפני הצבת טריגר.';
    return out;
  }

  // ---- do not chase
  if (sc.extension > cfg.chaseATR) {
    out.state = 'WATCH';
    out.reason = 'המחיר כבר ' + sc.extension.toFixed(1) + '× ATR מעל הטריגר';
    out.next = 'לא רודפים. נסיגה צפויה ' + (plan.entry - 0.6 * b.atr).toFixed(2)
      + '–' + plan.entry.toFixed(2) + ', ואז שפל גבוה יותר וטריגר חדש.';
    return out;
  }

  if (plan.rr < cfg.minRR) {
    out.state = 'SETUP';
    out.reason = setup.what;
    out.next = 'יחס סיכון/סיכוי ' + plan.rr.toFixed(2) + ' נמוך מ-' + cfg.minRR + '. צריך כניסה נמוכה יותר או יעד רחוק יותר.';
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
    out.next = 'קנייה רק מעל ' + plan.entry.toFixed(2)
      + '. סטופ מתחת ' + plan.invalidation.toFixed(2) + '. ציון ' + sc.score + '/10'
      + (sc.score < cfg.readyScore ? ' — נדרש ' + cfg.readyScore + ' לכניסה.' : '.');
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
  var anchor = setup.structuralLow != null ? setup.structuralLow.toFixed(2) : 'x';
  return setup.type + '@' + anchor;
}

if (typeof module !== 'undefined') module.exports = {
  CFG: CFG, computeBars: computeBars, swings: swings, structure: structure,
  longQuality: longQuality, detectSetup: detectSetup, scoreSetup: scoreSetup,
  buildPlan: buildPlan, decide: decide, setupKey: setupKey
};
