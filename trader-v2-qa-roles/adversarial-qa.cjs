// ADVERSARIAL QA — synthetic regimes chosen to break state and structure
// handling, not to demonstrate profit. Each scenario asserts a behaviour the
// engine must exhibit, and a scenario that produces nothing at all is itself a
// result worth recording.
module.exports = function adversarialQA(ctx) {
  const { V, R } = ctx;
  const eng = { computeBars: V.computeBars, decide: V.decide };
  const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const mk = (n, base, drift, noise, seed) => {
    const o = []; let p = base, s = seed || 5;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < n; i++) {
      const q = p, c = q + drift(i) + (rnd() - 0.5) * noise;
      o.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +q.toFixed(2),
        high: +(Math.max(q, c) + rnd() * noise * 0.5).toFixed(2),
        low: +(Math.min(q, c) - rnd() * noise * 0.5).toFixed(2),
        close: +c.toFixed(2), volume: 5000 + Math.floor(rnd() * 8000) });
      p = c;
    }
    return o;
  };
  const join = (...parts) => {
    const out = [];
    parts.forEach(p => p.forEach(r => out.push(Object.assign({}, r,
      { time: tm(out.length), unix: 1788000000 + out.length * 60 }))));
    return out;
  };

  const scenarios = [
    ['strong uptrend',        mk(200, 230, () => 0.03, 0.45, 7),
      r => r.counts.ready > 0, 'an uptrend should produce at least one entry'],
    ['strong downtrend',      mk(200, 230, () => -0.03, 0.45, 11),
      r => r.states.filter(s => s.state === 'READY' && s.trend === 'DOWN').length === 0,
      'no READY while the structure is a declared downtrend'],
    ['sideways chop',         mk(200, 230, () => 0, 0.55, 13),
      r => r.counts.ready <= 6, 'chop must not manufacture endless entries'],
    ['volatile open',         join(mk(20, 230, () => 0, 2.2, 3), mk(180, 230, () => 0.01, 0.4, 5)),
      r => r.states.slice(0, 15).every(s => s.state !== 'READY'), 'no READY in the first minutes of chaos'],
    ['gap down then base',    join(mk(60, 240, () => -0.02, 0.4, 9), mk(140, 232, () => 0.005, 0.35, 17)),
      r => true, 'records behaviour after a gap'],
    ['failed breakout',       join(mk(80, 230, () => 0.03, 0.4, 21), mk(120, 232.4, () => -0.04, 0.5, 23)),
      r => r.states.some(s => s.state === 'FAILED') || r.counts.ready === 0,
      'a breakout that fails must invalidate rather than persist'],
    ['fake reclaim',          join(mk(90, 230, () => -0.03, 0.45, 29), mk(12, 227.3, () => 0.09, 0.3, 31), mk(98, 228.4, () => -0.05, 0.5, 37)),
      r => true, 'records whether a brief reclaim was trusted'],
    ['falling knife',         mk(200, 240, () => -0.09, 0.7, 41),
      r => r.counts.ready === 0, 'a collapse must produce no entries at all'],
    ['repeated support hits', join(...Array.from({length: 6}, (_, k) => mk(30, 230 + (k % 2 ? 0.6 : 0), () => (k % 2 ? -0.02 : 0.02), 0.35, 43 + k))),
      r => true, 'records how many setups repeated touches create'],
    ['shallow pullback',      join(mk(90, 230, () => 0.03, 0.35, 47), mk(14, 232.7, () => -0.02, 0.3, 51), mk(96, 232.4, () => 0.03, 0.35, 53)),
      r => true, 'a shallow retest should remain tradable'],
    ['deep pullback',         join(mk(90, 230, () => 0.03, 0.35, 59), mk(40, 232.7, () => -0.06, 0.5, 61), mk(70, 230.3, () => 0.02, 0.4, 67)),
      r => true, 'a deep pullback should not be treated as a shallow one'],
    ['late-day breakout',     join(mk(360, 230, () => 0.002, 0.35, 71), mk(30, 230.7, () => 0.08, 0.4, 73)),
      r => true, 'records whether a late breakout is taken'],
    ['huge breakout candle',  join(mk(150, 230, () => 0.004, 0.3, 79), mk(50, 236, () => 0.5, 0.4, 83)),
      r => r.states.filter(s => s.state === 'READY' && s.extension > V.CFG.chaseATR).length === 0,
      'never READY while beyond the chase limit'],
    ['long stall after arm',  join(mk(60, 230, () => 0.04, 0.4, 89), mk(240, 232.4, () => 0, 0.06, 97)),
      r => r.states.every(s => !(s.setupAgeBars > V.CFG.maxSetupAgeBars && ['SETUP','ARMED','READY'].includes(s.state))),
      'a stalled setup must expire'],
    ['new base after a move', join(mk(70, 230, () => 0.04, 0.4, 101), mk(60, 232.8, () => 0, 0.25, 103), mk(70, 232.8, () => 0.04, 0.4, 107)),
      r => true, 'records whether a second consolidation earns its own id']
  ];

  return scenarios.map(([name, rows, assertion, why]) => {
    const res = R.analyseDay(rows, eng, { symbol: 'SYNTH' });
    let ok = true, err = null;
    try { ok = assertion(res); } catch (e) { ok = false; err = String(e); }
    const ids = new Set(res.states.filter(s => s.setupId).map(s => s.setupId));
    return { name, expectation: why, ok, error: err,
      bars: rows.length, setups: res.counts.setups, ids: ids.size,
      ready: res.counts.ready, trades: res.counts.entered,
      states: Object.entries(res.states.reduce((a, s) => (a[s.state] = (a[s.state] || 0) + 1, a), {}))
        .map(([k, v]) => k + ':' + v).join(' ') };
  });
};
