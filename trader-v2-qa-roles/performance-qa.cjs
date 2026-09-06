// PERFORMANCE QA — outcome accounting, kept strictly apart from setup quality.
// A valid setup that loses is not a false positive, and this never conflates them.
module.exports = function performanceQA(ctx) {
  const { result, structureReviews } = ctx;
  const trades = result.trades.filter(t => t.outcome !== 'no_fill');
  const validByTime = {};
  (structureReviews || []).forEach(r => { validByTime[r.time] = r.verdict; });

  const rows = trades.map(t => Object.assign({}, t, {
    structureVerdict: validByTime[t.readyTime] || 'UNREVIEWED',
    // outcome and quality are two separate columns, on purpose
    classification: (validByTime[t.readyTime] === 'INVALID STRUCTURE') ? 'FALSE POSITIVE'
      : (t.R > 0 ? 'VALID SETUP THAT WON' : 'VALID SETUP THAT LOST')
  }));
  const by = (key) => {
    const g = {};
    rows.forEach(t => { const k = key(t) || 'unknown'; (g[k] = g[k] || []).push(t); });
    const out = {};
    Object.keys(g).forEach(k => {
      const a = g[k], w = a.filter(x => x.R > 0);
      out[k] = { trades: a.length, wins: w.length,
        winRate: +(w.length / a.length * 100).toFixed(1),
        avgR: +(a.reduce((s, x) => s + x.R, 0) / a.length).toFixed(2) };
    });
    return out;
  };
  return {
    trades: rows, metrics: result.metrics,
    byType: by(t => t.type), byQuality: by(t => t.quality),
    byHour: by(t => (t.readyTime || '').slice(0, 2) + ':00'),
    classification: {
      won: rows.filter(t => t.classification === 'VALID SETUP THAT WON').length,
      lost: rows.filter(t => t.classification === 'VALID SETUP THAT LOST').length,
      falsePositive: rows.filter(t => t.classification === 'FALSE POSITIVE').length
    }
  };
};
