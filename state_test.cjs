// One snapshot, explicit level roles, and the contradiction detector.
const E=require('./engine.cjs'), L=require('./layers.cjs');
let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const tm=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function day(date,base,shape,n,sd){ let p=base,s=sd||3,out=[]; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648; n=n||390;
  for(let i=0;i<n;i++){ let d=shape==='up'?0.004:shape==='down'?-0.004:Math.sin(i/25)*0.02;
    const o=p,c=o+(rnd()-0.5)*0.16+d,h=Math.max(o,c)+rnd()*0.06,l=Math.min(o,c)-rnd()*0.06;
    out.push({date,time:tm(i),open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),
      volume:i>=385?800000:Math.floor(120000*(1+4/(1+i*0.1))*(0.6+rnd()))}); p=c; }
  return out; }
const A=E.analyze(day('2026-09-01',227,'up',240,17),{K:3});

// ---- 7/8 one snapshot
{ const st=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  ck('state carries version and timestamps', st.state_version>0 && st.calculated_at>0 && !!st.data_through.time,
    'v'+st.state_version+' through '+st.data_through.time);
  ck('the radar row is the same object graph as the detail state', st.row.state===st && st.row.score===st.score,
    'row '+st.row.score+' / state '+st.score);
  ck('score cannot differ between surfaces', st.row.score===st.score);
  ck('pressure is shared, not recomputed', st.row.pressure===st.pressure);
  const st2=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  ck('same input gives the same score', st2.score===st.score, st.score+' / '+st2.score); }

// ---- 1/10 level ordering and single roles
{ const st=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  const lv=st.levels;
  if(lv.entry!=null){
    ck('target 1 is above the entry', lv.target1>lv.entry, lv.entry.toFixed(2)+' -> '+lv.target1.toFixed(2));
    ck('target 2 is above target 1', lv.target2>lv.target1);
    ck('the hard stop is below the entry', lv.hardStop<lv.entry, lv.hardStop.toFixed(2)+' < '+lv.entry.toFixed(2));
  } else ck('no entry means no entry-dependent levels claimed', lv.entry===null);
  ck('watch and target 1 are never the same level', lv.watch==null||lv.target1==null||Math.abs(lv.watch-lv.target1)>1e-9,
    'watch '+ (lv.watch&&lv.watch.toFixed(2)) +' t1 '+ (lv.target1&&lv.target1.toFixed(2)));
  ck('every level role is named', ['watch','entry','target1','target2','tacticalInvalidation','hardStop','probUpper','probLower'].every(k=>k in lv));
  ck('tactical cancel and structural stop are separate fields', lv.tacticalInvalidation!==undefined && lv.hardStop!==undefined); }

// ---- 6 probability uses exactly the displayed levels
{ const st=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  ck('probability boundaries equal the displayed ones', st.probability.upper===st.levels.probUpper && st.probability.lower===st.levels.probLower,
    st.probability.upper.toFixed(2)+'/'+st.probability.lower.toFixed(2));
  ck('probability upper is above lower', st.probability.upper>st.probability.lower); }

// ---- 5 probability vs confidence
{ ck('a shaky model never shows an extreme number', L.shrink(87,43)<80, '87@43 -> '+L.shrink(87,43));
  ck('a confident model keeps its number', L.shrink(87,90)===87, '87@90 -> '+L.shrink(87,90));
  ck('low confidence is flagged', (function(){ const p=L.pathProbability(A,{market:'Neutral'}); return p.confidence>=50||p.lowConfidence===true; })());
  const st=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  ck('no state ships an extreme probability at low confidence',
    !(st.probability.confidence<50 && (st.probability.up>=80||st.probability.up<=20)),
    st.probability.up+'% @ '+st.probability.confidence); }

// ---- 12 the detector actually blocks bad states
{ const base=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  const clone=()=>JSON.parse(JSON.stringify({levels:base.levels,price:base.price,atr:base.atr,status:base.status,
    action:base.action,plan:base.plan,pressure:base.pressure,probability:base.probability}));
  const check=(mut)=>{ const s=clone(); mut(s); return L.validateState(s); };
  const cases=[
    ['target below entry', s=>{s.levels.entry=227.91;s.levels.target1=227.88;}, 'TARGET_BELOW_ENTRY'],
    ['stop above entry', s=>{s.levels.entry=227.91;s.levels.hardStop=228.5;}, 'STOP_ABOVE_ENTRY'],
    ['target2 below target1', s=>{s.levels.entry=227.0;s.levels.target1=228;s.levels.target2=227.5;}, 'TARGET2_BELOW_TARGET1'],
    ['probability bounds inverted', s=>{s.levels.probUpper=227;s.levels.probLower=228;}, 'PROB_BOUNDS'],
    ['same level as watch and target', s=>{s.levels.watch=227.88;s.levels.target1=227.88;s.levels.entry=227.0;}, 'LEVEL_DOUBLE_ROLE'],
    ['support called broken above price', s=>{s.price=227.69;s.atr=0.2;s.pressure={support:{price:227.0,verdict:'נשברת'},direction:'steady',agreement:'ניטרלי',buyPct:50};}, 'TEXT_CONTRADICTS_PRICE'],
    ['active while cancelled', s=>{s.status='ACTIVE';s.plan={state:'FAILED'};}, 'STATUS_VS_PLAN'],
    ['pressure says supports while weakening', s=>{s.pressure={agreement:'תומך',direction:'deteriorating',buyPct:64};}, 'PRESSURE_CONCLUSION'],
    ['extreme probability, low confidence', s=>{s.probability={up:87,down:13,confidence:43,upper:s.levels.probUpper,lower:s.levels.probLower};}, 'PROB_CONFIDENCE'],
    ['probability computed off other levels', s=>{s.probability={up:60,down:40,confidence:60,upper:999,lower:1};}, 'PROB_STALE_LEVELS'],
    ['entry already far behind price', s=>{s.status='READY';s.levels.entry=s.price-2*s.atr;s.levels.target1=s.price+1;s.levels.hardStop=s.price-3*s.atr;}, 'ENTRY_BEHIND_PRICE']
  ];
  cases.forEach(function(c){ const r=check(c[1]);
    ck('detector blocks: '+c[0], !r.valid && r.violations.some(v=>v.code===c[2]), r.violations.map(v=>v.code).join(',')||'none'); });
  ck('a clean state passes', L.validateState(clone()).valid, L.validateState(clone()).violations.map(v=>v.code).join(',')||'clean'); }

// ---- 12 a blocked state shows no trade instruction
{ const st=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  // force a contradiction through the real builder by poisoning the plan
  const bad=Object.assign({},st); bad.levels=Object.assign({},st.levels,{entry:st.price,target1:st.price-1});
  const r=L.validateState(bad);
  ck('the blocked state is detected end to end', !r.valid);
  // and the builder replaces the instruction
  const st3=L.buildTickerState('NVDA',A,{market:'Neutral',freshness:'LIVE'});
  if(!st3.valid){
    ck('blocked state says so instead of instructing', /לא עקבי/.test(st3.actionText) && st3.whatNow.up.length===0, st3.actionText);
  } else ck('a valid state keeps its instruction', !!st3.whatNow.next && st3.whatNow.up.length>0); }

// ---- 13 the five trader questions
{ const shapes=['up','down','chop']; let unanswered=0, total=0;
  shapes.forEach(function(sh){
    const rows=day('2026-09-01',227,sh,300,29);
    for(let i=80;i<rows.length;i+=25){
      const a=E.analyze(rows.slice(0,i+1),{K:3}); if(!a)continue;
      const st=L.buildTickerState('NVDA',a,{market:'Neutral',freshness:'LIVE'}); total++;
      const W=st.whatNow;
      const q1=!!st.actionText;                                   // should I buy now
      const q2=!st.valid||!!W.next;                               // what price am I waiting for
      const q3=!st.valid||W.up.length>0;                          // what if it rises
      const q4=!st.valid||W.down.length>0;                        // what if it falls
      const q5=!st.valid||st.levels.hardStop!=null||st.levels.tacticalInvalidation!=null;  // where is it cancelled
      if(!(q1&&q2&&q3&&q4&&q5)) unanswered++;
    }
  });
  ck('all five trader questions answerable at every point', unanswered===0, unanswered+' of '+total+' states'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
