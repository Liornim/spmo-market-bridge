// LIVE SIMULATION. One closed candle at a time, the exact current Trader V2
// engine, no future data. Records precisely what the page would have shown.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('./trader-v2-engine.cjs'), R = require('./trader-v2-replay.cjs');
const eng = { computeBars: V.computeBars, decide: V.decide };
const TRADED = 'RECLAIM_CONTINUATION';
const SYMS = ['NVDA','AAPL','GOOGL','WFC','TSLA','INTC','HOOD','ARM','DDOG','AMZN'];
const n2 = v => v == null ? '' : (+v).toFixed(2);
const decisionOf = s => {
  const tradable = s.setup && s.setup.type === TRADED;
  if (s.state === 'READY' && tradable) return 'BUY NOW';
  if (s.state === 'FAILED') return 'FAILED';
  if (s.state === 'AVOID') return 'NO TRADE';
  if (s.state === 'READY' && !tradable) return 'NO TRADE (shadow)';
  return 'WAIT';
};
const all = {}, trades = [];
for (const sym of SYMS) {
  const rows = readFileSync(`fixtures/live/2026-09-08/${sym}.csv`, 'utf8').split('\n').filter(Boolean).slice(1)
    .map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open:+p[3], high:+p[4], low:+p[5], close:+p[6], volume:+p[7], unix: Math.floor(Date.parse(p[1]+'T'+p[2]+':00Z')/1000) }; })
    .filter(r => r.time <= '15:59');
  const tl = [];
  // exactly the live page: recompute from the closed prefix each minute
  for (let i = 0; i < rows.length; i++) {
    const st = R.runV2(rows.slice(0, i + 1), eng, {});
    const s = st[st.length - 1];
    if (!s) continue;
    tl.push({ time: rows[i].time, price: rows[i].close, decision: decisionOf(s), state: s.state,
      family: s.setup ? s.setup.type : '', setupId: s.setupId || '', age: s.setupAgeBars,
      score: s.score, quality: s.quality ? s.quality.label : '',
      waiting: (s.waiting && s.waiting.stillRequired || []).join(' | '),
      entry: s.plan ? s.plan.entry : '', stop: s.plan ? s.plan.stop : '',
      t1: s.plan ? s.plan.t1 : '', t2: s.plan ? s.plan.t2 : '', rr: s.plan ? s.plan.rr : '',
      reason: s.reason || '' });
  }
  all[sym] = tl;
  // what actually happened to each BUY NOW, simulated forward on real candles
  const full = R.runV2(rows, eng, {});
  const res = R.analyseDay(rows, eng, { symbol: sym });
  res.trades.filter(t => t.type === TRADED && t.outcome !== 'no_fill' && !t.shadow)
    .forEach(t => trades.push(Object.assign({ symbol: sym }, t)));
}
writeFileSync('live-sim-timeline.json', JSON.stringify(all));
writeFileSync('live-sim-trades.json', JSON.stringify(trades, null, 1));

console.log('=== PER-SYMBOL, as the live page would have shown ===');
console.log('sym   bars  BUY  WAIT  FAILED  NO-TRADE  distinct setupIds  first BUY');
SYMS.forEach(s => { const t = all[s];
  const buys = t.filter(x => x.decision === 'BUY NOW');
  console.log(`${s.padEnd(6)}${String(t.length).padStart(4)}${String(buys.length).padStart(6)}${String(t.filter(x=>x.decision==='WAIT').length).padStart(6)}${String(t.filter(x=>x.decision==='FAILED').length).padStart(8)}${String(t.filter(x=>/NO TRADE/.test(x.decision)).length).padStart(10)}${String(new Set(t.filter(x=>x.setupId).map(x=>x.setupId)).size).padStart(19)}  ${buys[0]?buys[0].time:'—'}`);
});
console.log('\n=== 1. COMPLETE TRADE LIST ===');
console.log('sym    READY  entry    stop     T1       T2       R:R  exit   why              R');
trades.sort((a,b)=>a.readyTime<b.readyTime?-1:1).forEach(t => console.log(
  `${t.symbol.padEnd(6)} ${t.readyTime}  ${n2(t.entryPrice).padStart(7)}  ${n2(t.stop).padStart(7)}  ${n2(t.t1).padStart(7)}  ${n2(t.t2).padStart(7)}  ${String(t.rr||'').padStart(4)}  ${(t.exitTime||'').padStart(5)}  ${(t.exitReason||'').padEnd(15)} ${String(t.R).padStart(6)}`));
const Rs = trades.map(t=>t.R), W=Rs.filter(x=>x>0);
console.log(`\n${trades.length} trades · ${W.length}W/${Rs.length-W.length}L · ${(W.length/Rs.length*100).toFixed(0)}% · total ${Rs.reduce((a,b)=>a+b,0).toFixed(2)}R · expectancy ${(Rs.reduce((a,b)=>a+b,0)/Rs.length).toFixed(3)}R`);
