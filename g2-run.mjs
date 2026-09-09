// v192 VALIDATION GROUP 2. Live discipline, one closed candle at a time,
// nothing tuned. Every anomaly class the brief names is measured.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('./trader-v2-engine.cjs'), R = require('./trader-v2-replay.cjs');
const eng = { computeBars: V.computeBars, decide: V.decide };
const SYMS = ['ALAB','CRDO','RBLX','AMD','SMCI','DELL','MRVL','MSFT'];
const TRADED = 'RECLAIM_CONTINUATION';
const load = s => readFileSync(`fixtures/live/g2/${s}.csv`, 'utf8').split('\n').filter(Boolean).slice(1)
  .map(l => { const p = l.split(','); return { symbol:p[0], date:p[1], time:p[2], open:+p[3], high:+p[4], low:+p[5], close:+p[6], volume:+p[7], unix: Math.floor(Date.parse(p[1]+'T'+p[2]+':00Z')/1000) }; })
  .filter(r => r.time <= '15:59');
const n2 = v => v == null ? '—' : (+v).toFixed(2);
const A = {}, anomalies = [], allTrades = [], setupRows = [];
const flag = (k, sym, detail) => anomalies.push({ kind: k, symbol: sym, detail });

for (const sym of SYMS) {
  const rows = load(sym), tl = [];
  let position = null, consumed = {};            // the Live page's execution state
  for (let i = 0; i < rows.length; i++) {
    const st = R.runV2(rows.slice(0, i + 1), eng, {});   // <= T only
    const s = st[st.length - 1]; if (!s) continue;
    const bars = V.computeBars(rows.slice(0, i + 1)), b = bars[bars.length - 1];
    const tradable = s.setup && s.setup.type === TRADED;
    const authExt = s.plan ? (b.close - s.plan.entry) / (b.atr || 0.01) : null;
    let decision = 'WAIT';
    if (position && s.setupId === position.setupId) decision = 'ACTIVE';
    else if (s.setupId && consumed[s.setupId]) decision = 'NO TRADE (consumed)';
    else if (s.state === 'READY' && tradable) decision = 'BUY NOW';
    else if (s.state === 'FAILED') decision = 'FAILED';
    else if (s.state === 'AVOID') decision = 'NO TRADE';
    else if (s.state === 'READY' && !tradable) decision = 'NO TRADE (shadow)';
    // --- anomaly checks, at the decision itself
    if (decision === 'BUY NOW') {
      if (authExt > V.CFG.chaseATR) flag('BUY beyond chase limit', sym, `${s.time} ext ${authExt.toFixed(2)} ATR > ${V.CFG.chaseATR}`);
      if (s.plan) { const p = s.plan;
        if (!(p.stop < p.entry)) flag('invalid geometry', sym, `${s.time} stop ${p.stop} not below entry ${p.entry}`);
        if (!(p.t1 > p.entry)) flag('invalid geometry', sym, `${s.time} T1 ${p.t1} not above entry ${p.entry}`);
        if (!(p.t2 >= p.t1)) flag('invalid geometry', sym, `${s.time} T2 ${p.t2} below T1 ${p.t1}`);
        if (p.rr < V.CFG.minRR) flag('invalid geometry', sym, `${s.time} R:R ${p.rr} below minRR ${V.CFG.minRR}`); }
      if (position) flag('repeated actionable BUY while ACTIVE', sym, `${s.time} while ${position.setupId} open`);
      if (consumed[s.setupId]) flag('consumed setup traded again', sym, `${s.time} ${s.setupId}`);
      // the page's own execution state: mark it taken, as a live user would
      position = { setupId: s.setupId, entry: s.plan.entry, stop: s.plan.stop, t1: s.plan.t1, at: s.time, exec: b.close };
    }
    if (s.state === 'READY' && !tradable) flag('shadow-family READY (not tradable, correctly)', sym, `${s.time} ${s.setup.type}`);
    if (position) {   // close the position on stop or target, as the trade would
      if (rows[i].low <= position.stop) { consumed[position.setupId] = true; position = null; }
      else if (rows[i].high >= position.t1 && rows[i].time > position.at) { consumed[position.setupId] = true; position = null; }
    }
    tl.push({ time: s.time, price: b.close, decision, state: s.state, family: s.setup ? s.setup.type : '',
      setupId: s.setupId || '', age: s.setupAgeBars, score: s.score,
      ext: authExt == null ? '' : +authExt.toFixed(2),
      entry: s.plan ? s.plan.entry : '', stop: s.plan ? s.plan.stop : '',
      t1: s.plan ? s.plan.t1 : '', t2: s.plan ? s.plan.t2 : '', rr: s.plan ? s.plan.rr : '',
      waiting: (s.waiting && s.waiting.stillRequired || []).join(' | ') });
  }
  A[sym] = tl;
  // resurrection + identity stability
  const dead = {};
  tl.forEach(x => { if (x.state === 'FAILED' && x.setupId) dead[x.setupId] = x.time;
    if (x.setupId && dead[x.setupId] && x.state === 'READY') flag('same setupId resurrection', sym, `${x.time} ${x.setupId} failed at ${dead[x.setupId]}`); });
  const rec = {}; tl.filter(x => /^RECLAIM/.test(x.setupId)).forEach(x => { (rec[x.setupId] = rec[x.setupId] || []).push(x); });
  Object.entries(rec).forEach(([id, xs]) => {
    const trigs = new Set(xs.filter(x => x.entry !== '').map(x => x.entry));
    if (trigs.size > 1) flag('unstable setupId (trigger moved under one id)', sym, `${id} triggers ${[...trigs].join(',')}`);
    setupRows.push({ symbol: sym, setupId: id, first: xs[0].time, last: xs[xs.length-1].time, bars: xs.length,
      maxState: xs.some(x=>x.state==='READY') ? 'READY' : xs.some(x=>x.state==='ARMED') ? 'ARMED' : xs[0].state,
      ended: xs.some(x=>x.state==='FAILED') ? 'FAILED' : xs[xs.length-1].state,
      trigger: [...trigs][0] ?? '', stop: xs.find(x=>x.stop!=='')?.stop ?? '' });
  });
  // the simulator's own trades, and Live/Replay parity
  const res = R.analyseDay(rows, eng, { symbol: sym });
  res.trades.filter(t => t.type === TRADED && !t.shadow).forEach(t => allTrades.push(Object.assign({ symbol: sym }, t)));
  const replay = R.runV2(rows, eng, {});
  let diverge = 0;
  for (let i = 20; i < rows.length; i += 3) {
    const live = R.runV2(rows.slice(0, i + 1), eng, {}).pop();
    const F = s => JSON.stringify([s.state, s.setupId, s.score, s.setupAgeBars, s.plan, s.reason]);
    if (F(live) !== F(replay[i])) { diverge++; if (diverge === 1) flag('Live/Replay divergence', sym, `${rows[i].time}`); }
  }
  if (!diverge) flag('_parity_ok', sym, '0 divergences');
}
writeFileSync('g2-timeline.json', JSON.stringify(A));
writeFileSync('g2-anomalies.json', JSON.stringify(anomalies, null, 1));
writeFileSync('g2-setups.json', JSON.stringify(setupRows, null, 1));
writeFileSync('g2-trades.json', JSON.stringify(allTrades, null, 1));

console.log('=== 1. ALL EIGHT ===');
console.log('sym    bars  RECLAIM setups  READY  BUY  ACTIVE  FAILED  shadow-READY  trades  R');
SYMS.forEach(s => { const t = A[s];
  const recIds = new Set(t.filter(x => /^RECLAIM/.test(x.setupId)).map(x => x.setupId));
  const tr = allTrades.filter(x => x.symbol === s && x.outcome !== 'no_fill');
  console.log(`${s.padEnd(6)}${String(t.length).padStart(5)}${String(recIds.size).padStart(15)}${String(t.filter(x=>x.state==='READY'&&x.family===TRADED).length).padStart(7)}${String(t.filter(x=>x.decision==='BUY NOW').length).padStart(5)}${String(t.filter(x=>x.decision==='ACTIVE').length).padStart(8)}${String(t.filter(x=>x.state==='FAILED').length).padStart(8)}${String(t.filter(x=>x.state==='READY'&&x.family&&x.family!==TRADED).length).padStart(14)}${String(tr.length).padStart(8)}${String(tr.reduce((a,x)=>a+x.R,0).toFixed(2)).padStart(7)}`);
});
