// Trader QA: can an active trader answer the operational questions from what
// the screen actually contains, on realistic replays? Findings are classified.
const { analyze, executionPlan, radarRow, sortRadar, tactical, momentum } = require('./engine.cjs');
const t=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
function session(shape,base,n){ let p=base,s=13,out=[]; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  for(let i=0;i<(n||390);i++){ let d=0;
    if(shape==='trend') d=0.006;
    if(shape==='breakdown') d=i<150?0.006:-0.012;
    if(shape==='range') d=Math.sin(i/22)*0.02;
    if(shape==='pullback') d=i<180?0.008:i<250?-0.012:0.006;
    const o=p,c=o+(rnd()-0.5)*0.18+d,h=Math.max(o,c)+rnd()*0.07,l=Math.min(o,c)-rnd()*0.07;
    out.push({date:'2026-09-01',time:t(i),open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),
      volume:i>=385?900000:Math.floor(130000*(1+4/(1+i*0.1))*(0.6+rnd()))}); p=c; }
  return out; }
const MK={label:'Neutral'};
const findings=[];
const finding=(sev,what)=>findings.push({sev,what});

// Q1..Q9 answered from the row + plan, at many points across four session shapes
const shapes=['trend','breakdown','range','pullback'];
let checked=0, noAction=0, noPrice=0, noNext=0, noInvalid=0, contradictions=0, chaseLeaks=0, genericWhy=0;
shapes.forEach(function(shape){
  const rows=session(shape,217);
  for(let i=60;i<rows.length;i+=7){
    const A=analyze(rows.slice(0,i+1),{K:3}); if(!A)continue;
    const r=radarRow('TEST',A,MK,'LIVE'); const P=r.plan; checked++;
    if(!r.action) noAction++;
    if(!r.why||/^צמוד לרמה$/.test(r.why)) genericWhy++;
    if(P&&P.state!=='NO_SETUP'&&P.state!=='FAILED'){
      if(!P.waitPrice) noPrice++;
      if(!P.nextStep) noNext++;
      if(P.invalidation==null) noInvalid++;
    }
    if(r.status==='READY'&&r.action==='המתן') contradictions++;
    if(r.status==='ACTIVE'&&P.state==='FAILED') contradictions++;
    if(r.status==='CLOSE'&&P.state==='NO_SETUP') contradictions++;
    // extended price must never read as a fresh entry
    const b=A.state.bar;
    if(P&&P.state==='READY_PARTIAL'&&P.entry!=null&&b.close>P.entry+0.5*(b.atr20||1)) chaseLeaks++;
  }
});
console.log(`replayed ${checked} decision points across ${shapes.length} session shapes`);
const q=(name,bad,sev)=>{ console.log(`${bad===0?'PASS':'FAIL'}  ${name}   [${bad} of ${checked}]`); if(bad) finding(sev,name+': '+bad+' cases'); };
q('every point states an immediate action',noAction,'CRITICAL');
q('every live setup names the price being waited for',noPrice,'CRITICAL');
q('every live setup names the next step',noNext,'HIGH');
q('every live setup names an invalidation',noInvalid,'CRITICAL');
q('status and action never contradict',contradictions,'CRITICAL');
q('no fresh-entry advice once price extended',chaseLeaks,'CRITICAL');
q('why-text is never the old generic distance',genericWhy,'HIGH');

// "which stock do I look at" — the top of the radar must be the one with a live step
const board=['trend','pullback','breakdown','range'].map(function(sh,i){
  const A=analyze(session(sh,200+i*10),{K:3});
  return radarRow(['AAA','BBB','CCC','DDD'][i],A,MK,'LIVE');
});
const sorted=sortRadar(board,'attention');
console.log('radar order:',sorted.map(r=>r.symbol+':'+r.status+'/'+(r.plan?r.plan.state:'-')).join('  '));
const top=sorted[0];
const topActionable=['READY_PARTIAL','READY_ADD','ACTIVE','TAKE_PROFIT_AREA','WAITING_FOR_CONFIRMATION','DO_NOT_CHASE'].includes(top.plan&&top.plan.state)
  || sorted.every(r=>!['READY_PARTIAL','READY_ADD','ACTIVE','TAKE_PROFIT_AREA','WAITING_FOR_CONFIRMATION'].includes(r.plan&&r.plan.state));
console.log(`${topActionable?'PASS':'FAIL'}  the top row is the most actionable one`);
if(!topActionable) finding('CRITICAL','radar ranks a non-actionable symbol above an actionable one');
const failedRanked=sorted.findIndex(r=>r.plan&&r.plan.state==='FAILED');
const readyRanked=sorted.findIndex(r=>r.status==='READY');
console.log(`${failedRanked===-1||readyRanked===-1||readyRanked<failedRanked?'PASS':'FAIL'}  a failed setup never outranks a ready one`);

// answers must be short enough to read at a glance
const longWhy=board.filter(r=>(r.why||'').length>34);
console.log(`${longWhy.length===0?'PASS':'FAIL'}  why-text stays short   [${longWhy.map(r=>r.why).join(' | ')||'ok'}]`);
if(longWhy.length) finding('LOW','why-text runs long on some rows');


// ---- Trader QA round 2: the WHAT NOW block, read as a beginner would.
const L=require('./layers.cjs');
console.log('\n--- trader QA: WHAT NOW ---');
{
  const days=['2026-08-26','2026-08-27','2026-08-28','2026-08-31'].map((d,i)=>session(['trend','range','pullback','breakdown'][i],210+i));
  const cal=L.calibrate(days,{}), base=L.volumeBaseline(days);
  let noAction=0, noNext=0, noUp=0, noDown=0, jargon=0, liveAfterClose=0, fakeStat=0, longLines=0, checked=0;
  const bad=['HH','HL','LH','LL','VWAP','EMA','ATR','momentum','swing','breakout','R)'];
  ['trend','breakdown','range','pullback'].forEach(function(shape){
    const rows=session(shape,217);
    for(let i=80;i<rows.length;i+=15){
      const A=analyze(rows.slice(0,i+1),{K:3}); if(!A)continue;
      const daily=L.dailyContext(days.concat([rows.slice(0,i+1)]));
      const W=L.whatNow(A,{market:'Neutral',daily:daily,baseline:base,calibration:cal}); checked++;
      if(!W.actionText) noAction++;
      if(!W.next) noNext++;
      if(!W.up.length) noUp++;
      if(!W.down.length) noDown++;
      const text=[W.next].concat(W.up,W.down,W.why).join(' ');
      if(bad.some(j=>text.indexOf(j)>=0)) jargon++;
      if(W.probability&&W.probability.source==='model'&&!W.probability.bias) fakeStat++;
      if([W.next].concat(W.up,W.down).some(s=>s.length>95)) longLines++;
      // closed session must never read as a live order
      const C=L.whatNow(A,{market:'Neutral',daily:daily,sessionEnded:true});
      if(/אפשר להיכנס|לחכות לאישור/.test([C.next].concat(C.up,C.down).join(' '))) liveAfterClose++;
    }
  });
  const q2=(name,badN,sev)=>{ console.log(`${badN===0?'PASS':'FAIL'}  ${name}   [${badN} of ${checked}]`); if(badN) finding(sev,name+': '+badN); };
  q2('every refresh states one plain action',noAction,'CRITICAL');
  q2('every refresh states the next thing to watch',noNext,'CRITICAL');
  q2('an if-up path is always given',noUp,'HIGH');
  q2('an if-down path is always given',noDown,'HIGH');
  q2('user-facing text stays free of jargon',jargon,'HIGH');
  q2('a model estimate is never presented as a measured statistic',fakeStat,'CRITICAL');
  q2('a closed session never reads as a live order',liveAfterClose,'CRITICAL');
  q2('lines stay short enough to scan',longLines,'LOW');
}


// ---- trader QA round 3: pressure must be readable and never overclaimed
console.log('\n--- trader QA: buyer/seller pressure ---');
{
  let noRead=0, badSum=0, overclaim=0, contradictsSilently=0, checked=0;
  ['trend','breakdown','range','pullback'].forEach(function(shape){
    const rows=session(shape,217);
    for(let i=60;i<rows.length;i+=13){
      const A=analyze(rows.slice(0,i+1),{K:3}); if(!A)continue;
      const P=executionPlan(A,MK);
      const pf=L.pressure(A,{plan:P}); checked++;
      if(!pf){noRead++;continue}
      if(pf.buyPct+pf.sellPct!==100) badSum++;
      if(pf.source!=='candles'||pf.hasOrderBook||pf.hasTape) overclaim++;
      // if the flow contradicts a long setup, the trader must be able to see it
      const bullish=['READY_PARTIAL','READY_ADD','ACTIVE'].includes(P&&P.state);
      if(bullish&&pf.side==='sellers'&&pf.agreement!=='סותר') contradictsSilently++;
    }
  });
  const q3=(name,badN,sev)=>{ console.log(`${badN===0?'PASS':'FAIL'}  ${name}   [${badN} of ${checked}]`); if(badN) finding(sev,name+': '+badN); };
  q3('a pressure read is always available',noRead,'HIGH');
  q3('the two sides always sum to 100',badSum,'CRITICAL');
  q3('the system never claims order-book or tape data it does not have',overclaim,'CRITICAL');
  q3('flow against a long setup is always flagged as contradicting',contradictsSilently,'CRITICAL');
}


// ---- trader QA round 4: consistency. Every published state must tell one story.
console.log('\n--- trader QA: consistency ---');
{
  let checked=0, badOrder=0, textVsPrice=0, probVsConf=0, scoreDrift=0, roleClash=0, blocked=0, silentBad=0;
  ['trend','breakdown','range','pullback'].forEach(function(shape){
    const rows=session(shape,227.5);
    for(let i=70;i<rows.length;i+=9){
      const A=analyze(rows.slice(0,i+1),{K:3}); if(!A)continue;
      const st=L.buildTickerState('QA',A,{market:'Neutral',freshness:'LIVE'}); checked++;
      if(!st.valid){ blocked++;
        // a blocked state must not carry a trade instruction
        if(st.whatNow.up.length||st.whatNow.down.length||/אפשר להיכנס/.test(st.actionText)) silentBad++;
        continue; }
      const lv=st.levels;
      if(lv.entry!=null&&(lv.target1<=lv.entry||lv.hardStop>=lv.entry||lv.target2<=lv.target1)) badOrder++;
      if(lv.watch!=null&&lv.target1!=null&&Math.abs(lv.watch-lv.target1)<1e-9) roleClash++;
      const pf=st.pressure;
      if(pf&&pf.support&&pf.support.verdict==='נשברת'&&st.price>pf.support.price+0.05*st.atr) textVsPrice++;
      if(pf&&pf.resistance&&pf.resistance.verdict==='נפרצת'&&st.price<pf.resistance.price-0.05*st.atr) textVsPrice++;
      const pr=st.probability;
      if(pr&&pr.confidence<50&&(pr.up>=80||pr.up<=20)) probVsConf++;
      if(st.row.score!==st.score) scoreDrift++;
    }
  });
  const q4=(name,badN,sev)=>{ console.log(`${badN===0?'PASS':'FAIL'}  ${name}   [${badN} of ${checked}]`); if(badN) finding(sev,name+': '+badN); };
  q4('long levels are always ordered stop < entry < t1 < t2',badOrder,'CRITICAL');
  q4('no level ever holds two roles at once',roleClash,'CRITICAL');
  q4('level descriptions never contradict the current price',textVsPrice,'CRITICAL');
  q4('no extreme probability at low confidence',probVsConf,'CRITICAL');
  q4('the score never differs between card and detail',scoreDrift,'CRITICAL');
  q4('a blocked state never carries an instruction',silentBad,'CRITICAL');
  console.log(`      (${blocked} of ${checked} states were blocked by the detector and showed no instruction)`);
}


// ---- trader QA round 5: one story per refresh
console.log('\n--- trader QA: single story ---');
{
  let checked=0, twoScenarios=0, waitWithEntry=0, staleLevel=0, edgeMismatch=0, noNext=0, noEdgeCount=0;
  ['trend','breakdown','range','pullback'].forEach(function(shape){
    const rows=session(shape,227.5);
    for(let i=70;i<rows.length;i+=8){
      const A=analyze(rows.slice(0,i+1),{K:3}); if(!A)continue;
      const st=L.buildTickerState('QA',A,{market:'Neutral',freshness:'LIVE'}); checked++;
      const W=st.whatNow;
      if(st.noEdge) noEdgeCount++;
      const entries=W.up.filter(s=>/אפשר להיכנס|כניסה חלקית ב-/.test(s));
      if(entries.some(s=>/עובר את/.test(s))&&entries.some(s=>/יורד לאזור/.test(s))) twoScenarios++;
      // DO_NOT_CHASE is a wait with a live pullback plan, so it may still name
      // a level; the truly passive actions may not.
      const passive=['DO_NOT_BUY','WATCH_ONLY','SESSION_CLOSED','SETUP_CANCELLED'].includes(st.action);
      if(passive&&(st.levels.entry!=null||entries.length)) waitWithEntry++;
      if(st.pressure&&st.pressure.support&&st.levelStates.support&&
         st.pressure.support.state!==st.levelStates.support.state&&st.pressure.support.verdict!=='נבלעת') staleLevel++;
      // the recommendation must agree with the numbers
      if(!st.noEdge&&st.score<=2&&Math.abs(st.probability.up-50)<=8&&st.probability.confidence<50&&
         st.pressure&&st.pressure.side==='balanced'&&st.levels.entry!=null) edgeMismatch++;
      if(!W.next) noNext++;
    }
  });
  const q5=(name,badN,sev)=>{ console.log(`${badN===0?'PASS':'FAIL'}  ${name}   [${badN} of ${checked}]`); if(badN) finding(sev,name+': '+badN); };
  q5('never two entry scenarios at once',twoScenarios,'CRITICAL');
  q5('a wait headline never carries an entry',waitWithEntry,'CRITICAL');
  q5('level wording always matches the level state',staleLevel,'CRITICAL');
  q5('an entry is never offered when the numbers say no edge',edgeMismatch,'CRITICAL');
  q5('there is always one next thing to watch',noNext,'CRITICAL');
  console.log(`      (${noEdgeCount} of ${checked} states were flagged no-edge and showed watch-only)`);
}

console.log('\n--- findings ---');
if(!findings.length) console.log('no CRITICAL or HIGH findings');
findings.forEach(f=>console.log(f.sev+': '+f.what));
process.exit(findings.some(f=>f.sev==='CRITICAL')?1:0);
