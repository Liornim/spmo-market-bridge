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

  // Validity: the band within which THIS snapshot still describes the market.
  // Beyond it the structure that produced the decision may no longer hold, so
  // the honest answer is RECHECK rather than a stale yes or no.
  var half = Math.max(0.02, 0.6 * atr);
  var vLow = +(px - half).toFixed(2), vHigh = +(px + half).toFixed(2);
  out.validity = { low: vLow, high: vHigh };

  // ---- the decision --------------------------------------------------------
  if (!hasEdge) {
    out.decision = 'NO SETUP';
    out.reasons.push(st.why || 'אין setup קנייה כרגע');
  } else {
    var zLow = Math.min(zone[0], zone[1]), zHigh = Math.max(zone[0], zone[1]);
    // Does the buy zone overlap the band this snapshot can speak about?
    var overlaps = zHigh >= vLow && zLow <= vHigh;
    out.decision = overlaps ? 'BUY' : 'WAIT';
    if (!overlaps) out.reasons.push('אזור הקנייה (' + n2(zLow) + '–' + n2(zHigh)
      + ') מחוץ לטווח שהכרטיס יכול לדבר עליו');
  }

  // ---- the price decision map ---------------------------------------------
  // Read as: the number you are looking at in your broker, right now.
  var rows = [];
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
  out.map = rows;

  // ---- supporting readings, all taken from what already exists -------------
  out.quality = out.decision === 'BUY' ? 'תקין'
    : out.decision === 'NO SETUP' ? 'אין' : 'חלש';
  out.confidence = (st.score != null)
    ? (st.score >= 7 ? 'גבוה' : st.score >= 4 ? 'בינוני' : 'נמוך') : NA;

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
  var T = st.tactical || null;
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

if (typeof module !== 'undefined') module.exports = { buyCard: buyCard };
