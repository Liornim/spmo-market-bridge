// TRADER QA — reads each decision the way the person acting on it would.
// Decision-time only: it may not look at what happened next.
module.exports = function traderQA(ctx) {
  const { states, rows, CFG } = ctx;
  const reviews = [];

  states.filter(s => s.state === 'READY').forEach(s => {
    const flags = [], p = s.plan || {};
    if (!p.entry || !p.stop || !p.t1) flags.push('READY without a complete plan');
    if (/ממתין לאישור|wait for confirmation/i.test(s.next || '')) flags.push('vague: says wait for confirmation while READY');
    if (s.extension != null && s.extension > CFG.chaseATR) flags.push('chasing: ' + s.extension.toFixed(1) + 'x ATR above the trigger');
    if (p.rr != null && p.rr < CFG.minRR) flags.push('R:R below the minimum yet READY');
    if (p.stop && p.entry && (p.entry - p.stop) / (rows[s.i].close || 1) > 0.02)
      flags.push('risk wider than 2% of price');
    if (rows[s.i].high < p.entry) flags.push('READY before the trigger was reached');
    // late in the session with a long target
    if (s.time >= '15:45') flags.push('entry within 15 minutes of the close');
    reviews.push({
      time: s.time, i: s.i, setupId: s.setupId, score: s.score,
      quality: s.quality ? s.quality.label : null,
      actionable: !!(p.entry && p.stop && p.t1),
      verdict: flags.length ? 'QUESTIONABLE' : 'ACTIONABLE',
      flags
    });
  });

  // repeated READY on the same structure
  const byId = {};
  states.filter(s => s.state === 'READY').forEach(s => (byId[s.setupId] = (byId[s.setupId] || 0) + 1));
  const repeated = Object.entries(byId).filter(([, n]) => n > 1);

  // WAIT states must say what is needed
  const muteWaits = states.filter(s => ['WATCH','SETUP','ARMED'].includes(s.state) && !s.next).length;
  // AVOID must be justified
  const muteAvoids = states.filter(s => s.state === 'AVOID' && !s.reason).length;

  return { reviews, repeatedReady: repeated, muteWaits, muteAvoids };
};
