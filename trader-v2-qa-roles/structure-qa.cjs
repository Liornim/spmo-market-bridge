// STRUCTURE QA — does the structure the engine claimed actually exist in the
// candles it had? Judged from the prefix only; outcomes are never consulted.
module.exports = function structureQA(ctx) {
  const { states, rows, V } = ctx;
  const reviews = [];

  states.filter(s => s.state === 'READY').forEach(s => {
    const prefix = rows.slice(0, s.i + 1);
    const bars = V.computeBars(prefix);
    const sw = V.swings(bars, V.CFG.K, bars.length - 1);
    const st = V.structure(sw); st.highs = sw.highs; st.lows = sw.lows;
    const claims = [], faults = [];
    const setup = s.setup || {};

    if (setup.type === 'STRUCTURAL_BASE') {
      const lowOk = sw.lows.some(l => bars[l.i].time === setup.anchorLowTime
        && Math.abs(l.price - setup.baseLow) < 0.006);   // baseLow is rounded to 2dp
      const highOk = sw.highs.some(h => bars[h.i].time === setup.anchorHighTime
        && Math.abs(h.price - setup.baseHigh) < 0.006);
      claims.push('anchor low ' + setup.anchorLowTime, 'anchor high ' + setup.anchorHighTime);
      if (!lowOk) faults.push('the claimed anchor low is not a confirmed pivot');
      if (!highOk) faults.push('the claimed anchor high is not a confirmed pivot');
      // and both must have been CONFIRMED by this minute
      const lowP = sw.lows.find(l => bars[l.i].time === setup.anchorLowTime);
      const highP = sw.highs.find(h => bars[h.i].time === setup.anchorHighTime);
      if (lowP && lowP.confirmedAt > bars.length - 1) faults.push('anchor low not yet confirmed');
      if (highP && highP.confirmedAt > bars.length - 1) faults.push('anchor high not yet confirmed');
    }
    if (setup.type === 'CONTINUATION' || setup.type === 'PULLBACK') {
      claims.push('trend ' + st.trend);
      if (st.trend !== 'UP') faults.push('claims a continuation while the structure reads ' + st.trend);
    }
    if (setup.type === 'REVERSAL') {
      claims.push('reclaim of the last lower high');
      if (!st.lastLH) faults.push('claims a reversal with no lower high to reclaim');
    }
    // the trigger must be at or below what price actually reached
    if (s.plan && rows[s.i].high < s.plan.entry)
      faults.push('READY without the trigger being reached');
    // the stop must be below the entry
    if (s.plan && s.plan.stop >= s.plan.entry) faults.push('stop at or above entry');

    reviews.push({
      time: s.time, i: s.i, setupId: s.setupId, type: setup.type || null,
      verdict: faults.length ? 'INVALID STRUCTURE' : 'VALID STRUCTURE',
      claims, faults, trend: st.trend, score: s.score,
      quality: s.quality ? s.quality.label : null
    });
  });
  return reviews;
};
