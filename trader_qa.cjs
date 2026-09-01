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

console.log('\n--- findings ---');
if(!findings.length) console.log('no CRITICAL or HIGH findings');
findings.forEach(f=>console.log(f.sev+': '+f.what));
process.exit(findings.some(f=>f.sev==='CRITICAL')?1:0);
