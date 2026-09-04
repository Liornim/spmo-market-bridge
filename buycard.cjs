// ============================================================================
// BUY DECISION CARD — an additional view. Nothing here is read by any other
// surface, and this file reads the state the application has already built.
//
// The premise that shapes everything: we do NOT know the price the trader is
// looking at in his broker. So the card must never say "if it reaches X, buy" —
// that is a limit order, and it assumes we can see the market. It says instead:
// given the price ON YOUR SCREEN RIGHT NOW, here is the decision.
//
// Four states only. BUY, WAIT, RECHECK, NO SETUP. RECHECK is not a refusal —
// it means the snapshot no longer covers the price being seen, and the answer
// has to be recomputed from newer candles. A lower price may be a better
// entry; a higher one may be a breakout. Neither is knowable from here.
// ============================================================================

function buyCard(st, A, ctx) {
  var c = ctx || {};
  var NA = '—';
  var n2 = function (x) { return x == null ? NA : (+x).toFixed(2); };

  var out = {
    symbol: st && st.symbol || (c.symbol || NA),
    snapshotTime: c.snapshotTime || null,
    lastBarTime: null, lastClose: null,
    coverage: null, decision: 'NO SETUP', quality: NA, confidence: NA,
    map: [], validity: null, reasons: [], levels: [], blocked: null
  };
  if (!st || !A || !A.state) { out.blocked = 'אין ניתוח זמין'; return out; }

  var bars = (A.rawBars && A.rawBars.length) ? A.rawBars : A.bars;
  var last = bars && bars.length ? bars[bars.length - 1] : null;
  var b = A.state.bar;
  var atr = (b && (b.atr20 || b.avgRange)) || 0;
  out.lastBarTime = last ? last.time : null;
  out.lastClose = last ? last.close : null;
  out.coverage = st.coverage || null;

  // ---- data safety comes before anything else -----------------------------
  // An unusable session cannot produce a BUY, whatever the setup looks like.
  var cov = st.coverage || {};
  if (st.stale) out.blocked = 'נתונים ישנים — לא ניתן להחליט';
  else if (st.sessionIncomplete)
    out.blocked = 'סשן חלקי (' + (cov.receivedMinutes || 0) + '/' + (cov.expectedMinutes || 0)
      + ' דקות) — לא ניתן להחליט';
  else if (st.tooOldToEnter) out.blocked = 'הנר האחרון ישן מדי להחלטה';
  else if (!last) out.blocked = 'אין נרות';
  if (out.blocked) {
    out.decision = 'RECHECK';
    out.reasons.push(out.blocked);
    return out;
  }

  // ---- what the existing analysis already decided --------------------------
  var P = st.plan || null;
  var lv = st.levels || {};
  var px = out.lastClose;

  // The BUY range is the zone the existing plan already identified, not a
  // percentage invented around the last price. Without a plan there is no zone
  // and therefore no buy.
  var zone = (P && P.zone && P.zone.length === 2) ? P.zone.slice() : null;
  var hasEdge = !!(P && zone && !st.noEdge);

  // Validity comes from STRUCTURE, not from a band drawn around the last price.
  // 616.42-617.08 around 616.75 is arbitrary symmetry dressed up as analysis:
  // it says nothing about where the reading actually stops holding. The real
  // boundaries are the levels the setup depends on — the zone, the
  // invalidation, the nearest support and resistance. Where none of those
  // exist, there is no validity range and none is invented.
  var T = st.tactical || null;
  var bounds = [];
  var addBound = function (v, why) {
    if (v == null || !isFinite(v)) return;
    bounds.push({ price: +(+v).toFixed(2), why: why });
  };
  if (T && T.support) addBound(T.support.price, 'תמיכה');
  if (T && T.resistance) addBound(T.resistance.price, 'התנגדות');
  if (lv.tacticalInvalidation != null) addBound(lv.tacticalInvalidation, 'ביטול');
  if (lv.watch != null) addBound(lv.watch, 'רמת מעקב');
  if (P && P.zone && P.zone.length === 2) { addBound(P.zone[0], 'אזור'); addBound(P.zone[1], 'אזור'); }

  var below = bounds.filter(function (x) { return x.price < px; }).sort(function (a, b2) { return b2.price - a.price; })[0];
  var above = bounds.filter(function (x) { return x.price > px; }).sort(function (a, b2) { return a.price - b2.price; })[0];
  var vLow = below ? below.price : null;
  var vHigh = above ? above.price : null;
  out.validity = (vLow != null && vHigh != null)
    ? { low: vLow, high: vHigh, lowWhy: below.why, highWhy: above.why } : null;

  // ---- the decision --------------------------------------------------------
  if (!hasEdge) {
    // NO SETUP is its own answer, not a weak version of one. There is nothing
    // whose validity could be mapped, so there is no price map, no validity
    // range and no confidence — confidence in a setup that does not exist is a
    // number about nothing. And it is never RECHECK: RECHECK means an ACTIVE
    // setup no longer covers the price, which presupposes a setup.
    out.decision = 'NO SETUP';
    out.reasons.push(st.why || 'אין setup קנייה כרגע');
    out.map = [];
    out.validity = null;
    out.quality = 'אין';
    out.confidence = NA;
    out.hasMap = false;
  } else {
    var zLow = Math.min(zone[0], zone[1]), zHigh = Math.max(zone[0], zone[1]);
    // Does the buy zone overlap the band this snapshot can speak about?
    var overlaps = zHigh >= vLow && zLow <= vHigh;
    out.decision = overlaps ? 'BUY' : 'WAIT';
    if (!overlaps) out.reasons.push('אזור הקנייה (' + n2(zLow) + '–' + n2(zHigh)
      + ') מחוץ לטווח שהכרטיס יכול לדבר עליו');
  }

  // ---- the price decision map ---------------------------------------------
  // Only where there IS an active setup, and only where structure gives real
  // boundaries. Read as: the number you are looking at in your broker.
  var rows = [];
  var canMap = hasEdge && out.validity != null;
  out.hasMap = canMap;
  if (canMap) {
  if (out.decision === 'BUY') {
    var zl = Math.max(vLow, Math.min(zone[0], zone[1]));
    var zh = Math.min(vHigh, Math.max(zone[0], zone[1]));
    rows.push({ from: zl, to: zh, decision: 'BUY', text: 'קונה' });
    if (zh < vHigh) rows.push({ from: +(zh + 0.01).toFixed(2), to: vHigh, decision: 'WAIT', text: 'לא קונה' });
    if (zl > vLow) rows.push({ from: vLow, to: +(zl - 0.01).toFixed(2), decision: 'WAIT', text: 'לא קונה' });
  } else if (out.decision === 'WAIT' || out.decision === 'NO SETUP') {
    rows.push({ from: vLow, to: vHigh, decision: out.decision === 'WAIT' ? 'WAIT' : 'NO SETUP',
      text: out.decision === 'WAIT' ? 'לא קונה' : 'אין setup' });
  }
  rows.sort(function (x, y) { return y.from - x.from; });
  rows.push({ above: vHigh, decision: 'RECHECK', text: 'לבדוק מחדש' });
  rows.push({ below: vLow, decision: 'RECHECK', text: 'לבדוק מחדש' });
  }
  out.map = rows;

  // ---- supporting readings, all taken from what already exists -------------
  if (out.decision !== 'NO SETUP') {
    out.quality = out.decision === 'BUY' ? 'תקין' : 'חלש';
    out.confidence = (st.score != null)
      ? (st.score >= 7 ? 'גבוה' : st.score >= 4 ? 'בינוני' : 'נמוך') : NA;
  }

  out.structure = st.structure || (A.state.announced || A.state.trend) || NA;
  out.momentum = st.momentum || NA;
  out.vwap = b ? b.vwap : null;
  out.aboveVwap = b ? !!b.aboveVwap : null;
  out.ema9 = b ? b.ema9 : null;
  out.ema20 = b ? b.ema20 : null;
  out.market = c.market || NA;

  var pf = st.pressure || null;
  if (pf) {
    out.buyersPct = pf.buyers; out.sellersPct = pf.sellers;
    out.buyersTrend = pf.buyersTrend; out.sellersTrend = pf.sellersTrend;
  }

  // Nearby levels that actually bear on a buy decision.
  if (T) {
    if (T.support) out.levels.push({ name: 'תמיכה קרובה', price: T.support.price });
    if (T.resistance) out.levels.push({ name: 'התנגדות קרובה', price: T.resistance.price });
  }
  if (lv.watch != null) out.levels.push({ name: 'רמת מעקב', price: lv.watch });

  // A probability is shown only if it measures THIS decision. The path model
  // answers "which of two levels is touched first", which is a different
  // question, so it is deliberately not carried over.
  out.probability = null;
  out.probabilityNote = 'הסתברות לא מוצגת: המודל הקיים מודד אירוע אחר';

  if (!out.reasons.length && st.why) out.reasons.push(st.why);
  return out;
}

// The same card as plain text. Built from the card object rather than scraped
// from the DOM, so what is copied is exactly what was decided — a copy that can
// drift from the screen is worse than none.
function buyCardText(card, opts) {
  var o = opts || {};
  var NA = '—';
  var n2 = function (x, d) { return x == null ? NA : (+x).toFixed(d == null ? 2 : d); };
  var L = [];
  var DEC = { BUY: 'BUY — אפשר לקנות', WAIT: 'WAIT — לא קונה כרגע',
    RECHECK: 'RECHECK — לבדוק מחדש', 'NO SETUP': 'NO SETUP — אין setup' };

  L.push(card.symbol + (card.snapshotTime ? ' · תמונת מצב ' + card.snapshotTime : ''));
  var cov = card.coverage || {};
  L.push('נר אחרון: ' + n2(card.lastClose, 3)
    + (cov.receivedMinutes != null ? ' · ' + cov.receivedMinutes + '/' + cov.expectedMinutes
      + ' נרות ' + (cov.complete ? 'תקין' : 'חסר') : ''));
  L.push('');
  L.push(DEC[card.decision] || card.decision);
  if (card.blocked) L.push(card.blocked);
  L.push('');
  L.push('מצב קנייה: ' + card.quality);
  L.push('ביטחון: ' + card.confidence);

  if (card.hasMap && card.validity) {
    L.push('');
    L.push(o.live ? 'מחיר Trading שלך עכשיו' : 'מפת מחיר');
    (card.map || []).forEach(function (r) {
      var range = r.above != null ? ('מעל ' + n2(r.above))
        : r.below != null ? ('מתחת ' + n2(r.below))
        : (n2(r.from) + '–' + n2(r.to));
      L.push('  ' + range + '  ->  ' + r.decision + ' — ' + r.text);
    });
    L.push('');
    L.push('תקפות הכרטיס: ' + n2(card.validity.low) + '–' + n2(card.validity.high)
      + ' (' + card.validity.lowWhy + ' / ' + card.validity.highWhy + ')');
    L.push('מחוץ לטווח -> RECHECK עם הנרות החדשים.');
    L.push('מחיר נמוך יותר עשוי ליצור setup טוב יותר, גבוה יותר עשוי ליצור פריצה.');
  }

  if ((card.reasons || []).length) {
    L.push('');
    L.push('למה');
    card.reasons.forEach(function (r) { L.push('  ' + r); });
  }

  L.push('');
  L.push('נתונים');
  L.push('  מבנה: ' + card.structure);
  L.push('  מומנטום: ' + card.momentum);
  L.push('  ' + (card.vwap == null ? 'VWAP: ' + NA
    : (card.aboveVwap ? 'מחיר מעל VWAP ' : 'מחיר מתחת VWAP ') + n2(card.vwap)));
  L.push('  EMA9 / EMA20: ' + n2(card.ema9) + ' / ' + n2(card.ema20));
  L.push('  שוק: ' + card.market);

  if (card.buyersPct != null) {
    L.push('');
    L.push('קונים / מוכרים');
    L.push('  ' + card.buyersPct + '% / ' + card.sellersPct + '%');
    if (card.buyersTrend) L.push('  קונים ' + card.buyersTrend);
    if (card.sellersTrend) L.push('  מוכרים ' + card.sellersTrend);
  }

  if ((card.levels || []).length) {
    L.push('');
    L.push('רמות');
    card.levels.forEach(function (l) { L.push('  ' + l.name + ': ' + n2(l.price)); });
  }

  L.push('');
  L.push(card.probabilityNote);
  return L.join('\n');
}

if (typeof module !== 'undefined') module.exports = { buyCard: buyCard, buyCardText: buyCardText };
