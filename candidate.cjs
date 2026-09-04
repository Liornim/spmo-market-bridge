// Candidate scoring — "is this stock worth my attention today?"
//
// THREE SEPARATE QUESTIONS, and this file must never blur them:
//
//   Candidate Score  is this worth WATCHING today?      0-100, from history
//   Live Interest    is it still worth live attention?  0-100, from the session
//   Setup Score      is a trade developing RIGHT NOW?   0-10, engine.cjs
//
// A stock can be a strong candidate with no setup at all: a quiet coil under a
// multi-day high is exactly that. Equally, a live symbol can hold a setup and
// have stopped being interesting, because the range died.
//
// Everything here is computed from CLOSED sessions. Nothing in this file may
// produce a live instruction, and yesterday's execution state (ACTIVE, FAILED,
// WAITING, DO_NOT_CHASE) is deliberately not carried in: structure and levels
// survive a session boundary, decisions do not.

var E = require('./engine.cjs');

// ---------------------------------------------------------------- daily bars
// One bar per session out of per-minute rows.
// A US regular session is 390 one-minute bars. A set materially shorter than
// that is a session still being collected, or one fetched mid-day — and
// aggregating it yields a daily candle that is wrong with no outward sign.
var SESSION_BARS = 390, MIN_COVERAGE = 0.98;
function toDaily(daysRows, opts) {
  var o2 = opts || {};
  var auth = {};
  (o2.authoritative || []).forEach(function (b) { auth[b.date] = b; });
  var out = (daysRows || []).filter(function (r) { return r && r.length; }).map(function (rows) {
    var h = -Infinity, l = Infinity, v = 0;
    rows.forEach(function (r) { h = Math.max(h, r.high); l = Math.min(l, r.low); v += r.volume; });
    var o = rows[0].open, c = rows[rows.length - 1].close;
    var regular = rows.filter(function (r) { return r.time >= '09:30' && r.time <= '16:00'; });
    var cov = regular.length / SESSION_BARS;
    var a = auth[rows[0].date];
    if (a) return { date: a.date, open: a.open, high: a.high, low: a.low, close: a.close,
      volume: a.volume, range: a.high - a.low,
      closePos: a.high > a.low ? (a.close - a.low) / (a.high - a.low) : 0.5,
      bars: rows.length, coverage: Math.round(cov * 1000) / 1000, complete: true, source: 'authoritative' };
    return { date: rows[0].date, open: o, high: h, low: l, close: c, volume: v,
      range: h - l, closePos: h > l ? (c - l) / (h - l) : 0.5, bars: rows.length,
      coverage: Math.round(cov * 1000) / 1000, complete: cov >= MIN_COVERAGE, source: 'aggregated' };
  });
  // An incomplete session is dropped rather than scored: every component here
  // reads high, low, close or volume, and all four are wrong on a partial day.
  return out.filter(function (b) { return b.complete; });
}

// ---------------------------------------------------------------- components
// Each returns { points, max, why } so the score can always be explained. A
// number with no reasons attached is not usable for a decision.

// Multi-day direction: higher closes AND higher lows, or the mirror.
function trendComponent(daily) {
  var out = { points: 0, max: 25, why: null, label: 'RANGE' };
  if (daily.length < 4) { out.why = null; return out; }
  var w = daily.slice(-4);
  var upC = 0, upL = 0, dnC = 0, dnL = 0;
  for (var i = 1; i < w.length; i++) {
    if (w[i].close > w[i - 1].close) upC++; else if (w[i].close < w[i - 1].close) dnC++;
    if (w[i].low > w[i - 1].low) upL++; else if (w[i].low < w[i - 1].low) dnL++;
  }
  if (upC >= 2 && upL >= 2) { out.points = 12 + Math.min(13, (upC + upL) * 3); out.label = 'UP';
    out.why = 'מגמה רב-יומית עולה — ' + upC + ' סגירות ו-' + upL + ' שפלים עולים'; }
  else if (dnC >= 2 && dnL >= 2) { out.points = 10 + Math.min(10, (dnC + dnL) * 2); out.label = 'DOWN';
    out.why = 'מגמה רב-יומית יורדת — ' + dnC + ' סגירות ו-' + dnL + ' שיאים יורדים'; }
  else { out.points = 4; out.label = 'RANGE'; out.why = 'ללא כיוון רב-יומי ברור'; }
  return out;
}

// Enough daily movement to be worth watching at all. A name whose whole day is
// 0.4% cannot pay for the attention, however clean its structure.
function rangeComponent(daily) {
  var out = { points: 0, max: 15, why: null, atrPct: null };
  if (!daily.length) return out;
  var w = daily.slice(-5);
  var avg = w.reduce(function (s, b) { return s + b.range; }, 0) / w.length;
  var px = w[w.length - 1].close || 1;
  var pct = avg / px * 100;
  out.atrPct = Math.round(pct * 100) / 100;
  if (pct >= 3) { out.points = 15; out.why = 'טווח יומי רחב — ' + out.atrPct + '% מהמחיר'; }
  else if (pct >= 1.8) { out.points = 12; out.why = 'טווח יומי טוב — ' + out.atrPct + '%'; }
  else if (pct >= 1.0) { out.points = 7; out.why = 'טווח יומי בינוני — ' + out.atrPct + '%'; }
  else { out.points = 1; out.why = 'טווח יומי צר — ' + out.atrPct + '%, קשה להוציא ממנו מהלך'; }
  return out;
}

// A contraction into a decision point is the classic pre-move condition: the
// last two sessions narrower than the ones before them.
function coilComponent(daily, atrPct, relVol) {
  var out = { points: 0, max: 12, why: null, coiled: false };
  if (daily.length < 5) return out;
  // A dead stock is narrow and quiet too. Contraction only means something when
  // the name has enough daily range to matter and the volume has not collapsed
  // with it — otherwise this rewards exactly the stocks worth ignoring.
  if (atrPct != null && atrPct < 1.0) { out.why = null; return out; }
  if (relVol != null && relVol < 0.6) { out.why = null; return out; }
  var recent = daily.slice(-2), prior = daily.slice(-5, -2);
  var r = recent.reduce(function (s, b) { return s + b.range; }, 0) / recent.length;
  var p = prior.reduce(function (s, b) { return s + b.range; }, 0) / prior.length;
  if (!(p > 0)) return out;
  var ratio = r / p;
  if (ratio <= 0.6) { out.points = 12; out.coiled = true; out.why = 'התכווצות טווח חדה לפני הפתיחה — ' + Math.round(ratio * 100) + '% מהממוצע'; }
  else if (ratio <= 0.8) { out.points = 8; out.coiled = true; out.why = 'התכווצות טווח — ' + Math.round(ratio * 100) + '% מהממוצע'; }
  return out;
}

// Where the last session closed inside its own range. A close on the high into
// a multi-day high is the setup that most often continues.
function closeComponent(daily) {
  var out = { points: 0, max: 10, why: null };
  if (!daily.length) return out;
  var last = daily[daily.length - 1];
  if (last.closePos >= 0.85) { out.points = 10; out.why = 'סגר בשיא היום — ' + Math.round(last.closePos * 100) + '% מהטווח'; }
  else if (last.closePos >= 0.7) { out.points = 7; out.why = 'סגר בחלק העליון של היום'; }
  else if (last.closePos <= 0.15) { out.points = 6; out.why = 'סגר בשפל היום — חולשה שמעניינת לשורט או לריבאונד'; }
  else if (last.closePos <= 0.3) { out.points = 4; out.why = 'סגר בחלק התחתון של היום'; }
  return out;
}

// Volume behind the last session, against its own recent average.
function volumeComponent(daily) {
  var out = { points: 0, max: 13, why: null, relVol: null };
  if (daily.length < 3) return out;
  var last = daily[daily.length - 1], prior = daily.slice(-6, -1);
  if (!prior.length) return out;
  var avg = prior.reduce(function (s, b) { return s + b.volume; }, 0) / prior.length;
  if (!(avg > 0)) return out;
  var rel = last.volume / avg;
  out.relVol = Math.round(rel * 100) / 100;
  if (rel >= 1.8) { out.points = 13; out.why = 'מחזור חריג בסשן האחרון — ×' + out.relVol; }
  else if (rel >= 1.3) { out.points = 10; out.why = 'מחזור מוגבר — ×' + out.relVol; }
  else if (rel >= 0.9) { out.points = 5; out.why = 'מחזור רגיל — ×' + out.relVol; }
  else { out.points = 2; out.why = 'מחזור דל — ×' + out.relVol + ', עניין נמוך'; }
  return out;
}

// Sitting just under a multi-day high (or over a low) is a decision point: the
// session opens with something to resolve.
function levelComponent(daily) {
  var out = { points: 0, max: 25, why: null, levels: [] };
  if (daily.length < 2) return out;
  var last = daily[daily.length - 1], prior = daily.slice(0, -1);
  var px = last.close, atr = daily.slice(-5).reduce(function (s, b) { return s + b.range; }, 0) / Math.min(5, daily.length);
  if (!(atr > 0)) return out;

  var hi = Math.max.apply(null, prior.map(function (b) { return b.high; }));
  var lo = Math.min.apply(null, prior.map(function (b) { return b.low; }));
  var pd = prior[prior.length - 1];

  out.levels = [
    { name: 'גבוה רב-יומי', price: hi },
    { name: 'גבוה אתמול', price: pd.high },
    { name: 'סגירת אתמול', price: pd.close },
    { name: 'נמוך אתמול', price: pd.low },
    { name: 'נמוך רב-יומי', price: lo }
  ].filter(function (x) { return isFinite(x.price); });

  // The same guard: "right under the multi-day high" is meaningless when the
  // multi-day range is a fraction of a percent.
  var spanPct = (hi - lo) / (px || 1) * 100;
  if (spanPct < 1.0) { out.points = 2; out.why = 'הטווח הרב-יומי צר מדי מכדי שרמה תהיה נקודת הכרעה'; return out; }
  var dHi = (hi - px) / atr, dLo = (px - lo) / atr;
  if (px > hi) { out.points = 22; out.why = 'סגר מעל הגבוה הרב-יומי — פריצה שצריכה אישור'; }
  else if (dHi >= 0 && dHi <= 0.35) { out.points = 25; out.why = 'ממש מתחת לגבוה הרב-יומי — נקודת הכרעה בפתיחה'; }
  else if (dHi > 0.35 && dHi <= 1) { out.points = 18; out.why = 'קרוב לגבוה הרב-יומי'; }
  else if (px < lo) { out.points = 16; out.why = 'סגר מתחת לנמוך הרב-יומי — שבירה'; }
  else if (dLo >= 0 && dLo <= 0.35) { out.points = 17; out.why = 'ממש מעל הנמוך הרב-יומי — נקודת הכרעה'; }
  else { out.points = 5; out.why = 'באמצע הטווח הרב-יומי'; }
  return out;
}

// ---------------------------------------------------------------- the score
//
// candidateScore(daysRows) -> { score, reasons, structure, levels, ... }
//
// daysRows: an array of sessions, oldest first, each an array of 1-minute rows.
// Every session here is CLOSED. Nothing about a live setup enters this.
function candidateScore(daysRows, opts) {
  var o = opts || {};
  var all = (daysRows || []).filter(function (r) { return r && r.length; });
  var daily = toDaily(all, o);
  var dropped = all.length - daily.length;
  if (!daily.length) {
    return { score: null, reasons: [], structure: null, levels: [], sessions: 0,
      incomplete_sessions: dropped,
      note: dropped ? 'הסשנים הקיימים אינם שלמים — לא ניתן לחשב' : 'אין נתונים היסטוריים' };
  }
  var range = rangeComponent(daily), volume = volumeComponent(daily);
  var parts = {
    trend: trendComponent(daily),
    range: range,
    coil: coilComponent(daily, range.atrPct, volume.relVol),
    close: closeComponent(daily),
    volume: volume,
    level: levelComponent(daily)
  };
  var got = 0, max = 0;
  Object.keys(parts).forEach(function (k) { got += parts[k].points; max += parts[k].max; });
  // Normalised so a symbol with only three sessions is not punished for the
  // components that need five — its max is smaller, not its score.
  var score = Math.round(got / max * 100);
  // A stock whose daily range cannot pay for a trade is not a candidate, no
  // matter how tidy its structure looks. This is a ceiling, not a deduction:
  // the components stay honest and the verdict is capped.
  var capped = null;
  if (range.atrPct != null && range.atrPct < 0.8 && score > 30) { capped = score; score = 30; }
  else if (range.atrPct != null && range.atrPct < 1.2 && score > 55) { capped = score; score = 55; }

  // Reasons, strongest first, so the screen can show the top two.
  var reasons = Object.keys(parts)
    .map(function (k) { return { key: k, points: parts[k].points, text: parts[k].why }; })
    .filter(function (x) { return x.text; })
    .sort(function (a, b) { return b.points - a.points; });

  var last = daily[daily.length - 1];
  return {
    score: score, reasons: reasons, parts: parts,
    cappedFrom: capped,
    capReason: capped != null ? 'הציון הוגבל: טווח יומי של ' + range.atrPct + '% קטן מכדי להצדיק מעקב' : null,
    structure: parts.trend.label,
    structureWhy: parts.trend.why,
    levels: parts.level.levels,
    atrPct: parts.range.atrPct, relVol: parts.volume.relVol, coiled: parts.coil.coiled,
    sessions: daily.length, incomplete_sessions: dropped,
    incompleteNote: dropped ? dropped + ' סשנים לא שלמים לא נכללו בחישוב' : null,
    dataSource: daily.every(function (b) { return b.source === 'authoritative'; }) ? 'authoritative'
      : daily.some(function (b) { return b.source === 'authoritative'; }) ? 'mixed' : 'aggregated',
    lastClose: last.close, lastDate: last.date, closePos: Math.round(last.closePos * 100),
    daily: daily
  };
}

// Is the interest improving or fading? The same score computed one session
// earlier, compared with today's. Without at least three sessions there is
// nothing to compare and the honest answer is that we do not know.
function candidateTrend(daysRows) {
  var rows = (daysRows || []).filter(function (r) { return r && r.length; });
  if (rows.length < 3) return { direction: 'unknown', delta: null, text: 'אין מספיק ימים להשוואה' };
  var now = candidateScore(rows), before = candidateScore(rows.slice(0, -1));
  if (now.score == null || before.score == null) return { direction: 'unknown', delta: null, text: 'אין מספיק ימים להשוואה' };
  var d = now.score - before.score;
  return {
    direction: d >= 6 ? 'improving' : d <= -6 ? 'fading' : 'steady',
    delta: d,
    text: d >= 6 ? 'העניין מתחזק (+' + d + ')' : d <= -6 ? 'העניין נחלש (' + d + ')' : 'ללא שינוי מהותי'
  };
}

// ---------------------------------------------------------------- live interest
//
// For symbols already on the watchlist, during the session: is this still worth
// the attention it is taking? This is NOT the setup score — a symbol can hold a
// valid setup and still have gone quiet, and a symbol with no setup can be the
// most alive thing on the screen.
function liveInterest(A, ctx) {
  var c = ctx || {};
  if (!A || !A.state) return { score: null, reasons: [], verdict: 'אין נתונים' };
  var S = A.state, b = S.bar, bars = A.bars, n = bars.length;
  var atr = b.atr20 || b.avgRange || 1;
  var reasons = [], score = 0;

  // Movement over the last half hour, judged BOTH against the symbol's own
  // average bar and against its price. Measuring only in ATR units made a dead
  // stock look active: when the average bar is a cent, six cents is "6R" and
  // nothing at all has happened.
  var w = bars.slice(-30);
  var hi = Math.max.apply(null, w.map(function (x) { return x.high; }));
  var lo = Math.min.apply(null, w.map(function (x) { return x.low; }));
  var swing = (hi - lo) / atr;
  var swingPct = b.close > 0 ? (hi - lo) / b.close * 100 : 0;
  var moving = swingPct >= 0.25;                  // a quarter percent in 30 min
  if (swing >= 6 && moving) { score += 30; reasons.push('תנועה חזקה בחצי השעה האחרונה'); }
  else if (swing >= 3 && moving) { score += 20; reasons.push('תנועה סבירה בחצי השעה האחרונה'); }
  else if (swing >= 1.5 && moving) { score += 10; reasons.push('תנועה מוגבלת'); }
  else { reasons.push('כמעט ללא תנועה בחצי השעה האחרונה (' + (Math.round(swingPct * 100) / 100) + '%)'); }

  // is volume still arriving
  var recentVol = w.reduce(function (s, x) { return s + x.volume; }, 0) / Math.max(1, w.length);
  var dayVol = bars.reduce(function (s, x) { return s + x.volume; }, 0) / Math.max(1, n);
  var rel = dayVol > 0 ? recentVol / dayVol : 0;
  if (rel >= 1.3) { score += 25; reasons.push('מחזור מתגבר (×' + (Math.round(rel * 100) / 100) + ')'); }
  else if (rel >= 0.8) { score += 15; reasons.push('מחזור יציב'); }
  else { score += 3; reasons.push('המחזור דועך (×' + (Math.round(rel * 100) / 100) + ')'); }

  // proximity to a level that matters
  var T = c.tactical || E.tactical(A);
  var near = [T.support, T.resistance].filter(Boolean).map(function (l) { return Math.abs(l.r); });
  var d = near.length ? Math.min.apply(null, near) : Infinity;
  if (d <= 0.5) { score += 25; reasons.push('צמוד לרמה משמעותית'); }
  else if (d <= 1.5) { score += 15; reasons.push('קרוב לרמה'); }
  else if (isFinite(d)) { score += 5; reasons.push('רחוק מרמות'); }

  // a structure worth following
  var st = S.announced || S.trend;
  if (st === 'UP' || st === 'DOWN') { score += 20; reasons.push('מבנה תוך-יומי מוכרז (' + st + ')'); }
  else { score += 5; reasons.push('ללא מבנה תוך-יומי'); }

  // Nothing else can rescue a symbol that is not moving: structure and levels
  // are only worth watching on something that travels.
  if (!moving) { score = Math.min(score, 30); reasons.push('אין תנועה — לא מצדיק תשומת לב חיה'); }
  score = Math.max(0, Math.min(100, score));
  return {
    score: score, reasons: reasons, movingPct: Math.round(swingPct * 100) / 100,
    verdict: score >= 60 ? 'שווה תשומת לב חיה' : score >= 35 ? 'עניין בינוני' : 'כבר לא מעניין',
    quiet: score < 35, swingR: Math.round(swing * 10) / 10, volRel: Math.round(rel * 100) / 100
  };
}

// ---------------------------------------------------------------- suggestions
//
// Recommends only. Nothing here moves a symbol on its own — the trader decides,
// and a screen that silently reshuffled the watchlist would be worse than one
// that said nothing.
//
//   watch: [{ symbol, candidate, live }]
//   scan:  [{ symbol, candidate, trend }]
function suggestions(watch, scan, opts) {
  var o = opts || {};
  var PROMOTE_AT = o.promoteAt == null ? 60 : o.promoteAt;
  var DEMOTE_AT = o.demoteAt == null ? 35 : o.demoteAt;

  var weakest = (watch || []).filter(function (x) {
    return x.live && x.live.score != null && x.live.score < DEMOTE_AT;
  }).sort(function (a, b) { return a.live.score - b.live.score; });

  var promote = (scan || []).filter(function (x) {
    if (!x.candidate || x.candidate.score == null) return false;
    if (x.candidate.score < PROMOTE_AT) return false;
    // Improving matters as much as high: a score that is high and fading is
    // yesterday's story.
    return !x.trend || x.trend.direction !== 'fading';
  }).sort(function (a, b) {
    var d = b.candidate.score - a.candidate.score;
    if (d) return d;
    return (b.trend && b.trend.delta || 0) - (a.trend && a.trend.delta || 0);
  });

  var room = Math.max(0, (o.max == null ? 40 : o.max) - (watch || []).length);
  return {
    promote: promote.slice(0, 8).map(function (x, i) {
      // Only pair a promotion with a removal when the list is actually full.
      var swap = (!room && weakest[i]) ? weakest[i] : null;
      return {
        symbol: x.symbol, score: x.candidate.score,
        why: (x.candidate.reasons || []).slice(0, 2).map(function (r) { return r.text; }),
        direction: x.trend ? x.trend.direction : 'unknown',
        directionText: x.trend ? x.trend.text : null,
        insteadOf: swap ? swap.symbol : null,
        insteadOfWhy: swap ? swap.live.verdict + ' (' + swap.live.score + ')' : null
      };
    }),
    demote: weakest.slice(0, 8).map(function (x) {
      return { symbol: x.symbol, score: x.live.score, why: x.live.reasons.slice(0, 2),
        verdict: x.live.verdict };
    }),
    room: room,
    note: room ? 'יש מקום — הוספה לא מחייבת הסרה' : 'המעקב מלא: הוספה מחייבת הסרה'
  };
}

module.exports = { candidateScore, candidateTrend, liveInterest, suggestions, toDaily };
