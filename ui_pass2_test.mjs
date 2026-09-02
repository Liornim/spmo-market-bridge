// Radar pass-2: execution plan on screen, auto-refresh discipline, alert
// dedup, session-ended behaviour, date-range copy.
import fs from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
{ const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const radar = JSON.parse(src.split('export const RADAR_HTML = ')[1].trim().replace(/;$/, ''));
  const parts = radar.split('<script>').slice(1).map(s => s.split('</script>')[0]);
  writeFileSync('/tmp/r0.js', parts[0]); writeFileSync('/tmp/r1.js', parts[1]); }
const engine = fs.readFileSync('/tmp/r0.js','utf8'), page = fs.readFileSync('/tmp/r1.js','utf8');

// --- data: a symbol that pulls back to support and holds, one that breaks down
function day(date,n,base,shape){ const out=[]; let p=base,s=5; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  for(let i=0;i<n;i++){ let d=0;
    if(shape==='hold') d = i<n*0.45?0.03 : i<n*0.8?-0.028 : 0.004;
    if(shape==='break') d = i<n*0.5?0.03:-0.05;
    const o=p,c=o+(rnd()-0.5)*0.12+d,h=Math.max(o,c)+rnd()*0.05,l=Math.min(o,c)-rnd()*0.05;
    const m=30+i; out.push({date,time:`${String(9+Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
      open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),volume:120000+i}); p=c; }
  return out; }
const DATES=['2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01'];
const hist={}; DATES.forEach((d,i)=>{ hist[d]=day(d,390,215+i*0.4,'hold'); });
const live={ NVDA:day('2026-09-01',200,217,'hold'), AAPL:day('2026-09-01',200,230,'break'),
  SPY:day('2026-09-01',200,560,'hold'), QQQ:day('2026-09-01',200,480,'hold'), SMH:day('2026-09-01',200,260,'hold') };

let calls=[], failNext=null;
const els={};
function el(id){ if(!els[id]) els[id]={id,innerHTML:'',textContent:'',className:'',value:'',hidden:false,dataset:{},style:{},
  children:[],classList:{add(){},remove(){}},querySelectorAll:()=>[],querySelector:()=>null,setAttribute(){},scrollTop:0,
  appendChild(c){this.children.push(c)},removeChild(c){this.children=this.children.filter(x=>x!==c)},get firstChild(){return this.children[0]},
  remove(){},getBoundingClientRect:()=>({left:0,width:380})}; return els[id]; }
globalThis.document={querySelector:s=>el(s.replace('#','')),getElementById:id=>el(id),
  createElement:()=>({className:'',innerHTML:'',onclick:null,remove(){}}),querySelectorAll:()=>[],addEventListener(){},body:{style:{}},hidden:false};
globalThis.window={addEventListener(){}};
let copied=null;
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async t=>{copied=t}}},configurable:true,writable:true});
globalThis.location={pathname:'/radar',origin:'https://x',href:''};
const timers=[]; globalThis.setInterval=(f,ms)=>{timers.push({f,ms});return timers.length};
globalThis.setTimeout=(f)=>{return 0}; globalThis.clearTimeout=()=>{};
let inflight=0, maxInflight=0;
globalThis.fetch=async(u)=>{ calls.push(u); inflight++; maxInflight=Math.max(maxInflight,inflight);
  await new Promise(r=>setImmediate(r));
  inflight--;
  const dm=u.match(/^\/day\/([A-Z\-]+)\/(\d{4}-\d{2}-\d{2})/);
  if(dm){ const rows=hist[dm[2]]||[]; return {ok:true,status:200,json:async()=>({date:dm[2],stale_seconds:0,rows})}; }
  const m=u.match(/^\/day\/([A-Z\-]+)/);
  if(m) return {ok:true,status:200,json:async()=>({date:'2026-09-01',stale_seconds:30,rows:live[m[1]]||[]})};
  if(u.startsWith('/days/')) return {ok:true,status:200,json:async()=>({days:DATES.slice().reverse().map(d=>({date:d,bars:390}))})};
  return {ok:true,status:200,json:async()=>({tracked:['NVDA','AAPL','SPY','QQQ']})}; };
(0,eval)(engine+'\nglobalThis.analyze=analyze;globalThis.bottomLine=bottomLine;globalThis.marketContext=marketContext;globalThis.momentum=momentum;globalThis.tactical=tactical;globalThis.radarRow=radarRow;globalThis.sortRadar=sortRadar;globalThis.executionPlan=executionPlan;globalThis.fmtR=fmtR;');
el('sort').value='attention'; el('sens').value='balanced'; el('every').value='30';
(0,eval)(page.replace('loadAll().catch(','globalThis.__h={loadAll:loadAll,refresh:refresh,openDetail:openDetail,copyPayload:k=>copyPayload(k),fetchRange:(s,f,t)=>fetchRange(s,f,t),alertLog:()=>alertLog,fireAlerts:()=>fireAlerts(),setSym:s=>{openSym=s},store:()=>store,setEnded:v=>{sessionEnded=v},csvRows:(s,r)=>csvRows(s,r),CSV:()=>CSV};loadAll().catch('));
const settle=async()=>{for(let i=0;i<80;i++)await new Promise(r=>setImmediate(r))};
await settle();

let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const H=globalThis.__h;

// 1. execution plan on the detail screen
H.openDetail('NVDA'); await settle();
const panel=el('panel').innerHTML;
ck('detail leads with the execution plan', panel.indexOf('class="plan')>=0 && panel.indexOf('class="plan')<panel.indexOf('מבנה ראשי'), 'plan before structure');
ck('plan shows one immediate action', (panel.match(/class="act"/g)||[]).length===1);
const st=H.store().NVDA, plan=st.row.plan;
ck('plan exposes a state', !!plan && !!plan.state, plan&&plan.state);
if(plan.state!=='NO_SETUP'){
  ck('plan names a waited price', !!plan.waitPrice, String(plan.waitPrice));
  ck('plan names the next step', !!plan.nextStep, plan.nextStep);
  ck('plan names invalidation', plan.invalidation!=null||plan.state==='FAILED');
  ck('panel renders the waited price', panel.includes(String(plan.waitPrice||'')));
} else { ck('no-setup plan states why', !!plan.reason, plan.reason); }

// 2. radar why-text is the next action, not a generic distance
const rowsHtml=el('rows').innerHTML;
ck('radar why-text is action-led', !/צמוד לרמה/.test(rowsHtml), 'no generic text');
ck('radar shows an action per row', H.store().NVDA.row.action!=null);

// 3. auto refresh: one timer, no overlap, countdown, OFF works
// two 1s timers exist by design: the wall clock and the refresh driver.
const tickTimer=timers.filter(t=>t.ms===1000)[1];
ck('exactly one refresh driver (plus the clock)', timers.filter(t=>t.ms===1000).length===2 && !!tickTimer);
calls=[]; el('every').value='10';
let sawCountdown=false;
for(let i=0;i<10;i++){ tickTimer.f(); if(/עוד \d+ש/.test(el('prog').textContent)) sawCountdown=true; }
await settle();
ck('auto refresh fires after the interval', calls.some(c=>c.startsWith('/day/')), calls.length+' calls');
ck('countdown is shown while waiting', sawCountdown, el('prog').textContent);
calls=[]; el('every').value='0';
for(let i=0;i<30;i++) tickTimer.f();
await settle();
ck('OFF really stops polling', calls.length===0, calls.length+' calls');
el('every').value='10';
// overlap guard
calls=[]; const p1=H.loadAll(), p2=H.loadAll(); await Promise.all([p1,p2]); await settle();
const uniq=new Set(calls.map(c=>c.split('?')[0]));
ck('a second refresh during one in flight is dropped', uniq.size===calls.length, calls.length+' calls, '+uniq.size+' unique');

// 4. UI state survives a refresh
H.openDetail('NVDA'); await settle(); const before=el('panel').innerHTML.length;
await H.refresh(); await settle();
ck('refresh keeps the detail open on the same symbol', el('sheet').hidden===false && el('panel').innerHTML.length>0 && before>0);

// 5. alert dedup
const log0=H.alertLog().length;
H.fireAlerts(); H.fireAlerts(); H.fireAlerts();
ck('repeated refreshes do not repeat the same alert', H.alertLog().length===log0, H.alertLog().length+' vs '+log0);
{ // a genuinely new state fires again
  const r=H.store().NVDA.row; const old=r.plan.state;
  r.plan.state='FAILED'; r.plan.invalidation=1; H.fireAlerts();
  ck('a new state fires a new alert', H.alertLog().length===log0+1, H.alertLog().length+'');
  r.plan.state=old; }

// 6. session ended stops alerts
H.setEnded(true); const n1=H.alertLog().length;
H.store().NVDA.row.plan.state='READY_PARTIAL'; H.fireAlerts();
ck('no live alerts once the session ended', H.alertLog().length===n1);
H.setEnded(false);

// 7. date-range copy fetches days never opened
H.openDetail('NVDA'); await settle();
H.store().NVDA.dates=DATES.slice().reverse();
// drop two days from memory to prove the range fetches what it does not have
delete H.store().NVDA.days['2026-08-26']; delete H.store().NVDA.days['2026-08-27'];
calls=[];
const res=await H.fetchRange('NVDA','2026-08-26','2026-09-01'); await settle();
const dayReqs=calls.filter(c=>/^\/day\/NVDA\/\d/.test(c));
ck('range fetches days it does not already hold', dayReqs.length===2, dayReqs.length+' day requests');
ck('range does not re-fetch days already in memory', !dayReqs.some(c=>/2026-08-31|2026-08-28/.test(c)));
ck('range covers every trading day in it', res.days.length===5, res.days.join(','));
const EXPECT=4*390+live.NVDA.length;
ck('range reports a candle count', res.count===EXPECT, res.count+' expected '+EXPECT);
ck('range skips days with no data instead of inventing them', res.failed.length===0);
{ const txt=res.days.map(d=>'===== '+d+' =====\n'+[H.CSV()].concat(H.csvRows('NVDA',H.store().NVDA.days[d])).join('\n')).join('\n\n');
  const seps=txt.split('\n').filter(l=>l.startsWith('====='));
  ck('range output has one separator per day, oldest first', seps.length===5 && /2026-08-26/.test(seps[0]) && /2026-09-01/.test(seps[4]));
  const body=txt.split('\n').filter(l=>l&&!l.startsWith('=====')&&l!==H.CSV());
  ck('range output holds every candle', body.length===EXPECT, body.length+'');
  ck('range output has no duplicate day+time', new Set(body.map(l=>{const f=l.split(',');return f[1]+f[2]})).size===body.length); }
{ const one=await H.fetchRange('NVDA','2026-08-28','2026-08-28');
  ck('single-day range works', one.days.length===1 && one.count===390);
  const gap=await H.fetchRange('NVDA','2026-08-29','2026-08-30');   // weekend
  ck('a weekend-only range returns nothing, not fake sessions', gap.days.length===0 && gap.count===0); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
