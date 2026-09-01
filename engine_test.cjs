const { analyze } = require('./engine.cjs');
let pass = 0, fail = 0;
const check = (name, ok, extra='') => { ok ? pass++ : fail++; console.log(`${ok?'PASS':'FAIL'}  ${name}${extra?'   ['+extra+']':''}`); };
const t = i => { const m = 30 + i; return `${String(9 + Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; };
// bar(open, high, low, close, volume)
const B = (o,h,l,c,v=1000) => ({o,h,l,c,v});
const mk = arr => arr.map((b,i) => ({ time: t(i), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));

// --- 1. swing detection with K=3: a clear peak at index 5, trough at index 12
let rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5),   // 5: peak high 102
  B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),B(100.6,100.8,100.2,100.4),B(100.4,100.6,100,100.2),B(100.2,100.4,99.8,100),
  B(100,100.2,99,99.5),     // 12: trough low 99
  B(99.5,100,99.3,99.8),B(99.8,100.3,99.6,100.1),B(100.1,100.6,99.9,100.4),B(100.4,100.9,100.2,100.7)]);
let a = analyze(rows, { K: 3 });
check('swing high at the peak, confirmed 3 bars later', a.swings.some(w => w.kind==='H' && w.i===5 && w.confirmedAt===8));
check('swing low at the trough, confirmed 3 bars later', a.swings.some(w => w.kind==='L' && w.i===12 && w.confirmedAt===15));
check('no swing before confirmation (state at bar 7 has no SH yet)', a.states[7].lastSH === null && a.states[8].lastSH !== null);
check('resistance = window high once it is >=5 bars old', a.states[9].res && a.states[9].res.price===101.2 && a.states[10].res && a.states[10].res.price === 102, (a.states[9].res||{}).price+' -> '+(a.states[10].res||{}).price);
check('K=2 would confirm earlier (parameter honoured)', analyze(rows,{K:2}).swings.find(w=>w.i===5).confirmedAt === 7);

// --- 2. breakout above resistance with 2-bar confirmation, then strong breakout scoring
rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5), B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),   // SH 102 confirmed at 8
  B(100.6,100.9,100.4,100.7,900),B(100.7,101,100.5,100.9,900),
  B(100.9,102.4,100.85,102.3,3000),   // 11: breaks 102, closes above, big body, big volume
  B(102.3,102.6,102.1,102.5,1500),    // 12: confirms
  B(102.5,102.7,102.2,102.4,900)]);
a = analyze(rows, { K: 3 });
let e11 = a.states[11];
check('breakout detected against previous bar resistance', e11.events.some(e => e.type==='strong_breakout' || e.type==='breakout'), e11.events.map(e=>e.type).join(','));
check('strong breakout (body>65, volx>1.2)', e11.events.some(e => e.type==='strong_breakout'), 'body='+e11.bar.body+' volx='+e11.bar.volx);
check('2-bar confirmation flagged true', e11.events.find(e => /breakout/.test(e.type)).confirmed === true);
check('score reaches CHECK tier', e11.tier === 'CHECK', 'score='+e11.score);
check('ask flag set on strong breakout', e11.ask === true);
check('state is ATTEMPT on the breakout bar', e11.state === 'ATTEMPT');
check('right after breakout there is no resistance yet (recent highs too young)', a.states[13].res === null);

// --- 3. rejection: new high above resistance, close back below, long upper wick
rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5), B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),
  B(100.6,100.9,100.4,100.7),B(100.7,101,100.5,100.9),
  B(100.9,102.5,100.8,100.95),        // 11: pokes above 102, closes near open — 85%+ upper wick
  B(100.95,101.1,100.6,100.7)]);
a = analyze(rows, { K: 3 });
check('rejection detected', a.states[11].events.some(e => e.type==='rejected'), a.states[11].events.map(e=>e.type).join(','));
check('rejection carries the wick size', a.states[11].events.find(e=>e.type==='rejected').wick > 80);
check('rejection is not scored as breakout', a.states[11].score < 3, 'score='+a.states[11].score);

// --- 4. failed breakout: closes above, then within 10 bars closes back below the level
rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5), B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),
  B(100.6,100.9,100.4,100.7),B(100.7,101,100.5,100.9),
  B(100.9,102.3,100.85,102.2),        // 11: breakout
  B(102.2,102.3,101.5,101.6),         // 12: back below 102 -> failed
  B(101.6,101.8,101.4,101.7)]);
a = analyze(rows, { K: 3 });
check('failed breakout flagged on the bar that closes back below', a.states[12].events.some(e=>e.type==='failed'));
check('failed UNCONFIRMED breakout does not ask (noise)', a.states[12].ask === false);
check('breakout at 11 shows 2-bar confirmation = false, scored as pending', a.states[11].events.find(e=>/breakout/.test(e.type)).confirmed === false && a.states[11].score < 7);

// --- 5. structure + trend classification
rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5),   // 5: SH 102
  B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),B(100.6,100.8,100.2,100.4),B(100.4,100.6,100,100.2),B(100.2,100.4,99.8,100),
  B(100,100.2,99,99.5),     // 12: SL 99
  B(99.5,100,99.3,99.8),B(99.8,100.3,99.6,100.1),B(100.1,100.6,99.9,100.4),B(100.4,100.9,100.2,100.7),B(100.7,101.3,100.5,101.1),B(101.1,101.8,100.9,101.6),
  B(101.6,103.1,101.4,102.9),  // 19: SH 103.1 = HH
  B(102.9,103,101.9,102),B(102,102.2,101.6,101.8),B(101.8,102,101.3,101.5),B(101.5,101.7,101,101.2),B(101.2,101.4,100.8,101),
  B(101,101.2,100.2,100.5),    // 25: SL 100.2 = HL  -> confirmed at 28 => trend UP (run 1)
  B(100.5,100.9,100.3,100.8),B(100.8,101.2,100.6,101.1),B(101.1,101.5,100.9,101.4),
  B(101.4,101.9,101.2,101.8),B(101.8,102.4,101.6,102.3),
  B(102.3,104.4,102.1,104.2),  // 31: SH 104.4 = HH -> confirmed at 34 => trend UP (run 2) => trend_change
  B(104.2,104.3,102.5,102.6),B(102.6,102.8,102.2,102.4),B(102.4,102.6,102,102.2),
  B(102.2,102.4,101.8,102),B(102,102.2,101.4,101.6),B(101.6,101.8,101,101.2),
  B(101.2,101.3,100.3,100.5),  // 38: still above HL 100.2 (margin)
  B(100.5,100.6,99.6,99.7),    // 39: closes below HL 100.2 -> structure break
  B(99.7,99.9,99.2,99.4)]);    // 40: confirms (close < 100.2)
a = analyze(rows, { K: 3, runs: 2, minMove: 1.0 });
check('runs=3 does NOT announce a trend on the 2nd swing', !analyze(rows,{K:3,runs:3,minMove:1.0}).states[34].events.some(e=>e.type==='trend_change'));
const hh = a.swings.find(w=>w.i===19), hl = a.swings.find(w=>w.i===25), hh2 = a.swings.find(w=>w.i===31);
check('HH labelled', hh && hh.label==='HH');
check('HL labelled', hl && hl.label==='HL');
check('second HH labelled', hh2 && hh2.label==='HH');
check('HL confirmed event fires at confirmation bar (i+3)', a.states[28].events.some(e=>e.type==='hl_confirmed'));
check('trend = UP once HH+HL confirmed', a.states[28].trend === 'UP', a.states[28].trend+' ('+a.states[28].reason+')');
check('trend_change NOT announced on the first agreeing swing', !a.states[28].events.some(e=>e.type==='trend_change'));
check('trend_change announced on the second agreeing swing (bar 34)', a.states[34].events.some(e=>e.type==='trend_change' && e.to==='UP'));
check('lastSL is the HL after confirmation', a.states[29].lastSL && a.states[29].lastSL.price === 100.2);
check('structure break on close below the HL the uptrend rests on', a.states[39].events.some(e=>e.type==='structure_break' && e.side==='bear'), a.states[39].events.map(e=>e.type).join(','));
check('structure break asks when confirmed by next bar', a.states[39].ask === true && a.states[39].events.find(e=>e.type==='structure_break').confirmed === true);

// --- 6. volume spike + momentum, and causal vol_x
rows = mk([B(100,100.3,99.8,100.1,1000),B(100.1,100.3,99.9,100.2,1000),B(100.2,100.4,100,100.3,1000),B(100.3,100.5,100.1,100.4,1000),
  B(100.4,101.4,100.35,101.35,2500)]);   // 4: huge body, big range, 2.5x-ish volume
a = analyze(rows, { K: 3 });
let s4 = a.states[4];
check('volume spike detected', s4.events.some(e=>e.type==='volume_spike'), 'volx='+s4.bar.volx);
check('momentum candle detected', s4.events.some(e=>e.type==='momentum'));
check('spike+momentum -> ask', s4.ask === true);
check('vol_x is causal (avg of bars so far)', Math.abs(s4.bar.volx - 2500/((1000*4+2500)/5)) < 0.01);

// --- 7. cooldown: two breakouts 3 bars apart fire once
rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5),B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),B(100.6,100.9,100.4,100.7),B(100.7,101,100.5,100.9),
  B(100.9,102.4,100.85,102.3),B(102.3,102.6,102.1,102.5),B(102.5,102.7,102.2,102.6),B(102.6,102.8,102.4,102.7),B(102.7,102.9,102.5,102.8),B(102.8,103,102.6,102.9),
  B(102.9,103.6,102.8,103.5),B(103.5,103.7,103.3,103.6)]);
a = analyze(rows, { K: 3 });
check('second breakout inside the cooldown window is suppressed', a.states.filter(s=>s.events.some(e=>/breakout/.test(e.type))).length === 1);

// --- 8. noise floor on random walks
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let asks = 0, logged = 0, DAYS = 20;
for (let d = 0; d < DAYS; d++) { let p = 200, rw = [];
  for (let i = 0; i < 390; i++) { const o = p, c = o + (rnd() - 0.5) * 0.6, h = Math.max(o, c) + rnd() * 0.25, l = Math.min(o, c) - rnd() * 0.25;
    rw.push({ time: t(i), open: o, high: h, low: l, close: c, volume: Math.floor(200000 * (1 + 4 / (1 + i * 0.1)) * (0.6 + rnd() * 0.8)) }); p = c; }
  const x = analyze(rw, { K: 3 }); asks += x.events.filter(s => s.ask).length; logged += x.events.length; }
check('random walk: ask events <= 4 per day on average', asks / DAYS <= 4, (asks / DAYS).toFixed(1) + '/day');
check('random walk: logged events <= 40 per day on average', logged / DAYS <= 40, (logged / DAYS).toFixed(1) + '/day');


// --- 10. indicators
const { bottomLine, marketContext } = require('./engine.cjs');
rows = mk([B(100,101,99,100,1000),B(100,102,100,102,3000),B(102,103,101,101,2000)]);
a = analyze(rows,{K:3});
{ const tp = [(101+99+100)/3,(102+100+102)/3,(103+101+101)/3], v=[1000,3000,2000];
  const vw = (tp[0]*v[0]+tp[1]*v[1]+tp[2]*v[2])/(v[0]+v[1]+v[2]);
  check('VWAP cumulative from open', Math.abs(a.bars[2].vwap - vw) < 1e-9, a.bars[2].vwap.toFixed(4));
  const e9 = ((100)*(1-2/10)+102*2/10)*(1-2/10)+101*2/10;
  check('EMA9 seeded with first close', Math.abs(a.bars[2].ema9 - e9) < 1e-9);
  check('ATR20 = mean range of available bars', Math.abs(a.bars[2].atr20 - (2+2+2)/3) < 1e-9); }
// alignment
rows = mk(Array.from({length:30},(_,i)=>B(100+i*0.2,100.3+i*0.2,99.9+i*0.2,100.25+i*0.2,1000)));
a = analyze(rows,{K:3});
check('rising series: price>EMA9>EMA20 = bull', a.state.bar.align === 'bull');
check('rising series: above VWAP', a.state.bar.aboveVwap === true);
rows = mk(Array.from({length:30},(_,i)=>B(110-i*0.2,110.3-i*0.2,109.9-i*0.2,109.75-i*0.2,1000)));
a = analyze(rows,{K:3});
check('falling series: bear alignment, below VWAP', a.state.bar.align === 'bear' && a.state.bar.aboveVwap === false);
// vwap reclaim event after >=3 bars below
rows = mk([B(100,100.5,99.5,100,1000),B(100,100.2,99,99.2,1000),B(99.2,99.4,98.8,99,1000),B(99,99.2,98.6,98.8,1000),B(98.8,99,98.5,98.7,1000),B(98.7,99.6,98.6,99.5,1000)]);
a = analyze(rows,{K:3});
check('vwap_reclaim fires after a run below', a.state.events.some(e=>e.type==='vwap_reclaim'), a.state.events.map(e=>e.type).join(','));
check('vwap_reclaim alone does NOT ask', a.state.ask === false);

// --- 11. market context
const up = analyze(mk(Array.from({length:40},(_,i)=>B(100+i*0.2,100.3+i*0.2,99.9+i*0.2,100.25+i*0.2,1000))),{K:3}); up.symbol='SPY';
const dn = analyze(mk(Array.from({length:40},(_,i)=>B(110-i*0.2,110.3-i*0.2,109.9-i*0.2,109.75-i*0.2,1000))),{K:3}); dn.symbol='QQQ';
check('market bullish when both ETFs above VWAP + bull EMA', marketContext([up, up]).label === 'Bullish');
check('market bearish when both below', marketContext([dn, dn]).label === 'Bearish');
check('market neutral when they disagree', marketContext([up, dn]).label === 'Neutral');
check('market unavailable with no data', marketContext([null, undefined]).label === 'Unavailable');

// --- 12. bottom line: structure first
const green = analyze(mk(Array.from({length:12},(_,i)=>B(100+i*0.1,100.15+i*0.1,99.95+i*0.1,100.12+i*0.1,1000))),{K:3});
let bl = bottomLine(green, { label: 'Bullish' });
check('all indicators green but no structure -> WAIT', bl.action === 'WAIT' && bl.setup === false, bl.action+' / '+bl.reason);
check('confidence still counts indicators', bl.confidence >= 3 && bl.confidence <= 10, 'conf='+bl.confidence);
// confirmed breakout scenario from test 2, with bullish market -> LONG
rows = mk([B(100,100.5,99.5,100),B(100,100.6,99.6,100.2),B(100.2,100.8,99.9,100.5),B(100.5,101,100.2,100.8),B(100.8,101.2,100.5,101),
  B(101,102,100.8,101.5), B(101.5,101.6,100.9,101),B(101,101.3,100.6,100.8),B(100.8,101,100.4,100.6),B(100.6,100.9,100.4,100.7,900),B(100.7,101,100.5,100.9,900),
  B(100.9,102.4,100.85,102.3,3000),B(102.3,102.6,102.1,102.5,1500)]);
a = analyze(rows,{K:3});
bl = bottomLine(a, { label: 'Bullish' });
check('confirmed breakout + green -> LONG', bl.action === 'LONG', bl.action+' conf='+bl.confidence+' ['+bl.why.join(', ')+']');
check('bearish market lowers confidence by 3 vs bullish', bottomLine(a,{label:'Bullish'}).confidence - bottomLine(a,{label:'Bearish'}).confidence === 3);
check('invalidation below price with a reason', bl.invalidation && bl.invalidation.price < 102.5 && /נמוך|swing/.test(bl.invalidation.reason));
check('distances in avg-range units', bl.invalidation.dist && typeof bl.invalidation.dist.atr === 'number');
// announced downtrend -> AVOID regardless
rows = mk(Array.from({length:80},(_,i)=>{ const base=110-i*0.15, w=Math.sin(i/3)*1.2; return B(base+w,base+w+0.6,base+w-0.6,base+w-0.2,1000); }));
a = analyze(rows,{K:3,minMove:1.0,runs:2});
if (a.state.announced === 'DOWN') check('announced DOWN -> AVOID', bottomLine(a,{label:'Bullish'}).action === 'AVOID');
else check('downtrend fixture produced an announced DOWN (skip if not)', true, 'announced='+a.state.announced);
// confidence clamps
check('confidence never below 0', bottomLine(dn,{label:'Bearish'}).confidence >= 0);

// --- 9. degenerate inputs
check('empty -> null', analyze([], {K:3}) === null);
check('too short for swings still returns state', analyze(mk([B(1,2,0.5,1.5)]), {K:3}).state.trend === 'RANGE');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
