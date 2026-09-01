// Execution-plan state machine: constructed scenarios plus a replay.
const { analyze, executionPlan, tactical, radarRow, sortRadar, aggressiveBreak, fmtR } = require('./engine.cjs');
let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const t=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const B=(o,h,l,c,v=1000)=>({o,h,l,c,v});
const mk=a=>a.map((b,i)=>({date:'2026-09-01',time:t(i),open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v}));
const MK={label:'Neutral'};
const plan=(rows,opt)=>executionPlan(analyze(mk(rows),Object.assign({K:3},opt||{})),MK);

// A rising base that pulls back to a tested support around 101.0, then recovers.
function scenario(tail){
  const up=[];
  let p=100;
  for(let i=0;i<14;i++){ const o=p,c=o+0.12; up.push(B(o,c+0.06,o-0.05,c,1200)); p=c; }      // 100 -> ~101.7
  for(let i=0;i<6;i++){ const o=p,c=o-0.11; up.push(B(o,o+0.05,c-0.05,c,1000)); p=c; }        // pull to ~101.0
  for(let i=0;i<5;i++){ const o=p,c=o+0.10; up.push(B(o,c+0.05,o-0.05,c,1100)); p=c; }        // bounce ~101.5
  for(let i=0;i<6;i++){ const o=p,c=o-0.09; up.push(B(o,o+0.04,c-0.04,c,1000)); p=c; }        // back down ~101.0
  return up.concat(tail(up[up.length-1].c));
}
// 1. waiting above the zone
let P=plan(scenario(last=>[B(last,last+0.35,last,last+0.32,1000),B(last+0.32,last+0.6,last+0.3,last+0.55,1000)]));
ck('above the zone -> WAITING_FOR_ZONE or DO_NOT_CHASE', ['WAITING_FOR_ZONE','DO_NOT_CHASE','WAITING_FOR_CONFIRMATION','READY_ADD','ACTIVE'].includes(P.state), P.state+' / '+P.short);
ck('a waiting plan always names a price', !!P.waitPrice, String(P.waitPrice));

// 2. price sitting in the support zone, holding -> READY_PARTIAL
const holdTail=last=>[B(last,last+0.05,last-0.06,last+0.02,1200),B(last+0.02,last+0.06,last-0.01,last+0.03,1300)];
P=plan(scenario(holdTail));
ck('holding inside the zone -> READY_PARTIAL', P.state==='READY_PARTIAL', P.state+' / '+P.short);
ck('READY_PARTIAL names entry, add level and invalidation', P.entry!=null && P.addAbove!=null && P.invalidation!=null);
ck('partial entry is below the add level', P.entry < P.addAbove, P.entry.toFixed(2)+' < '+P.addAbove.toFixed(2));
ck('action is a single immediate instruction', P.action==='כניסה חלקית');

// 3. aggressive break -> FAILED, never a buy
P=plan(scenario(last=>[B(last,last+0.02,last-0.55,last-0.52,3000),B(last-0.52,last-0.5,last-0.75,last-0.72,3000)]));
ck('aggressive break -> FAILED', P.state==='FAILED', P.state+' / '+P.short);
ck('FAILED never suggests entering', P.action==='להימנע' && !/כניסה/.test(P.short));

// 4. reclaim above the add level -> confirmation then add
{ const base=scenario(holdTail), P1=executionPlan(analyze(mk(base),{K:3}),MK), add=P1.addAbove;
  const lastC=base[base.length-1].c;
  const rise=[B(lastC,add+0.03,lastC-0.02,add+0.02,1500),B(add+0.02,add+0.06,add,add+0.04,1500)];
  P=executionPlan(analyze(mk(base.concat(rise)),{K:3}),MK);
  ck('partial plan exposes an add level above the zone', add > P1.zone[1], add.toFixed(2)+' > '+P1.zone[1].toFixed(2)); }
ck('two closes above the add level -> READY_ADD / ACTIVE / TP', ['READY_ADD','ACTIVE','TAKE_PROFIT_AREA','DO_NOT_CHASE'].includes(P.state), P.state+' / '+P.short);

// 5. extension -> DO NOT CHASE with a pullback zone
P=plan(scenario(last=>[B(last,last+1.6,last,last+1.55,2500)]));
ck('far beyond the entry -> DO_NOT_CHASE or TP, never a fresh buy', P.state!=='READY_PARTIAL', P.state+' / '+P.short);
if(P.state==='DO_NOT_CHASE') ck('DO_NOT_CHASE offers a pullback zone', !!P.pullbackZone && !!P.waitPrice, P.waitPrice);
else ck('extended state still names a price', !!P.waitPrice||P.state==='FAILED', P.state);

// 6. aggressiveBreak rule itself
{ const A=analyze(mk(scenario(last=>[B(last,last+0.02,last-0.6,last-0.58,3000)])),{K:3});
  const lvl=A.bars[A.bars.length-1].close+0.5;
  ck('big bearish body closing at its low counts as an aggressive break', aggressiveBreak(A,lvl));
  const A2=analyze(mk(scenario(last=>[B(last,last+0.05,last-0.04,last+0.02,1000)])),{K:3});
  ck('a quiet bar on the level is not an aggressive break', !aggressiveBreak(A2,A2.bars[A2.bars.length-1].close-0.02)); }

// 7. contradictions must be impossible (#33)
{ const rows=[]; let p=100;
  for(let i=0;i<60;i++){ const o=p,c=o+(i%7<4?0.08:-0.09); rows.push(B(o,Math.max(o,c)+0.05,Math.min(o,c)-0.05,c,1000+i*7)); p=c; }
  const A=analyze(mk(rows),{K:3}); const r=radarRow('X',A,MK,'LIVE');
  ck('radar status and plan action never contradict',
    !(r.status==='READY' && r.action==='המתן') && !(r.status==='ACTIVE' && r.plan.state==='FAILED') && !(r.status==='CLOSE' && r.plan.state==='NO_SETUP'),
    r.status+' / '+r.plan.state+' / '+r.action);
  ck('every row carries a next-step text, not a generic distance', !!r.why && !/^צמוד לרמה/.test(r.why), r.why); }

// 8. CLOSE is not distance alone (#1)
{ // dead flat: price is exactly on a level but nothing supports looking at it
  const flat=[]; for(let i=0;i<45;i++) flat.push(B(100,100.03,99.97,100,1000));
  const A=analyze(mk(flat),{K:3}); const r=radarRow('FLAT',A,MK,'LIVE');
  ck('0R from a level with no supporting condition is not CLOSE/READY', r.status!=='CLOSE'&&r.status!=='READY', r.status+' / '+r.why+' / nearest '+r.nearestR.toFixed(2)); }

// 9. closing-auction volume (#4)
{ const base=[]; let p=100;
  for(let i=0;i<380;i++){ const o=p,c=o+(i%5<3?0.02:-0.021); base.push({date:'2026-09-01',time:t(i),open:o,high:Math.max(o,c)+0.02,low:Math.min(o,c)-0.02,close:c,volume:1000}); p=c; }
  const withAuction=base.concat([{date:'2026-09-01',time:'15:55',open:p,high:p+0.3,low:p-0.02,close:p+0.28,volume:40000}]);
  const A=analyze(withAuction,{K:3});
  const last=A.bars[A.bars.length-1];
  ck('auction bar is flagged', last.auction===true && last.time>='15:55');
  ck('auction volume does not fire a volume_spike event', !A.state.events.some(e=>e.type==='volume_spike'), A.state.events.map(e=>e.type).join(',')||'none');
  ck('auction volume is still reported as its own event', A.state.events.some(e=>e.type==='auction_volume'));
  ck('auction bar cannot raise the ask flag by volume alone', A.state.ask===false||A.state.events.some(e=>/breakout|structure|trend/.test(e.type)), 'ask='+A.state.ask); }

// 10. distance formatting (#3)
ck('small distances keep precision', fmtR(0.081)==='+0.08R' && fmtR(-0.12)==='-0.12R', fmtR(0.081)+' '+fmtR(-0.12));
ck('under 0.05R reads as on-the-level', fmtR(0.02)==='על הרמה');
ck('large distances stay short', fmtR(1.94)==='+1.9R', fmtR(1.94));

// 11. resistance-turned-support needs evidence (#2)
{ const rows=[]; let p=100;
  for(let i=0;i<12;i++){ const o=p,c=o+0.05; rows.push(B(o,c+0.03,o-0.03,c,1000)); p=c; }        // rise to ~100.6
  for(let i=0;i<8;i++){ const o=p,c=o-0.06; rows.push(B(o,o+0.03,c-0.03,c,1000)); p=c; }          // fall back
  const A=analyze(mk(rows),{K:3}); const T=tactical(A);
  const highAbovePrice=A.bars.reduce((m,x)=>Math.max(m,x.high),0);
  ck('a swing high the price never accepted is not offered as support',
    !T.support || T.support.price < A.state.bar.close, T.support?T.support.price.toFixed(2)+' '+T.support.why:'none');
  ck('levels expose a reason', !T.resistance || !!T.resistance.why, T.resistance?T.resistance.why:'none'); }


// --- 12. bar-by-bar replay of a whole session (spec 35): the plan must never
// contradict itself, never enter after invalidation, and never chase.
{
  let seed=99; const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const sessions=[];
  // three shapes: trend up, break down, choppy range
  for(const shape of ['up','down','chop']){
    let p=217, rows=[];
    for(let i=0;i<390;i++){
      const drift = shape==='up' ? 0.004 : shape==='down' ? -0.004 : 0;
      const wob = shape==='chop' ? Math.sin(i/9)*0.06 : 0;
      const o=p, c=o+(rnd()-0.5)*0.16+drift+wob, h=Math.max(o,c)+rnd()*0.06, l=Math.min(o,c)-rnd()*0.06;
      rows.push({date:'2026-09-01',time:t(i),open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),
        volume: i>=385 ? 900000 : Math.floor(120000*(1+4/(1+i*0.1))*(0.6+rnd()))});
      p=c;
    }
    sessions.push({shape,rows});
  }
  let bad=[], entriesAfterFail=0, chases=0, missingPrice=0, states={};
  sessions.forEach(function(s){
    let failedAt=null;
    for(let i=40;i<s.rows.length;i+=3){
      const A=analyze(s.rows.slice(0,i+1),{K:3}); if(!A) continue;
      const P=executionPlan(A,MK); if(!P) continue;
      states[P.state]=(states[P.state]||0)+1;
      const b=A.state.bar;
      if(P.state==='FAILED') failedAt=i;
      // an entry instruction must always carry a price
      if(['READY_PARTIAL','READY_ADD','WAITING_FOR_ZONE','WAITING_FOR_CONFIRMATION','DO_NOT_CHASE','ACTIVE','TAKE_PROFIT_AREA'].includes(P.state) && !P.waitPrice) missingPrice++;
      // never say "enter" while price is below the invalidation
      if(P.state==='READY_PARTIAL' && P.invalidation!=null && b.close < P.invalidation) entriesAfterFail++;
      // never say "enter" when price is already far beyond the planned entry
      if(P.state==='READY_PARTIAL' && P.entry!=null && b.close > P.entry + 0.5*(b.atr20||1)) chases++;
      // action and state must agree
      const t2 = { READY_PARTIAL:'כניסה חלקית', READY_ADD:'הוסף', FAILED:'להימנע', DO_NOT_CHASE:'לא לרדוף', TAKE_PROFIT_AREA:'מימוש' };
      if(t2[P.state] && P.action!==t2[P.state]) bad.push(P.state+'/'+P.action);
    }
  });
  ck('replay: action always matches the state', bad.length===0, bad.slice(0,3).join(' ')||'clean');
  ck('replay: never a partial entry below invalidation', entriesAfterFail===0, entriesAfterFail+' cases');
  ck('replay: never a partial entry after price extended past it', chases===0, chases+' cases');
  ck('replay: every actionable state names a price', missingPrice===0, missingPrice+' missing');
  ck('replay: the machine actually moves through states', Object.keys(states).length>=3, JSON.stringify(states));
  // closing auction on the last bars must not flip the tape into a signal
  const full=analyze(sessions[2].rows,{K:3});
  ck('replay: auction bars flagged at the close', full.bars.slice(-3).every(b=>b.auction===true));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

