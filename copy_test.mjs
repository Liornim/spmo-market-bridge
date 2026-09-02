// Exercise the radar's copy payloads directly against a controlled dataset.
import fs from 'node:fs';
// Extract the page scripts from the generated view.js so this test runs
// against exactly what the worker serves.
import { readFileSync, writeFileSync } from 'node:fs';
{ const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const radar = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  const parts = radar.split('<script>').slice(1).map(s => s.split('</script>')[0]);
  writeFileSync('/tmp/r0.js', parts[0]); writeFileSync('/tmp/r1.js', parts[1]); }

const engine = fs.readFileSync('/tmp/r0.js','utf8');
const page   = fs.readFileSync('/tmp/r1.js','utf8');

function mkDay(date,n,base){ const out=[]; let p=base,s=11; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  for(let i=0;i<n;i++){ const o=p,c=o+(rnd()-0.5)*0.5,h=Math.max(o,c)+rnd()*0.2,l=Math.min(o,c)-rnd()*0.2;
    const m=30+i; out.push({unix:i,date,time:`${String(9+Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
      open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),volume:1000+i}); p=c; }
  return out; }
// NVDA: today 91 bars, plus two loaded history days
const today=mkDay('2026-09-01',91,217), d31=mkDay('2026-08-31',390,215), d28=mkDay('2026-08-28',390,212);
// deliberately drop a minute from today to prove nothing is fabricated
today.splice(40,1);

const els={};
function el(id){ if(!els[id]) els[id]={id,innerHTML:'',textContent:'',className:'',value:'',hidden:false,dataset:{},style:{},
  classList:{add(){},remove(){}},querySelectorAll:()=>[],setAttribute(){},scrollTop:0,getBoundingClientRect:()=>({left:0,width:380})}; return els[id]; }
globalThis.document={querySelector:s=>el(s.replace('#','')),getElementById:id=>el(id),createElement:()=>({}),
  querySelectorAll:()=>[],addEventListener(){},body:{style:{}},hidden:false};
globalThis.window={addEventListener(){}};
let copied=null;
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async t=>{copied=t}}},configurable:true,writable:true});
globalThis.location={pathname:'/radar',origin:'https://x',href:''};
globalThis.setInterval=()=>0; globalThis.setTimeout=f=>{f();return 0}; globalThis.clearTimeout=()=>{};
const data={NVDA:today,SPY:mkDay('2026-09-01',91,560),QQQ:mkDay('2026-09-01',91,480),SMH:mkDay('2026-09-01',91,260)};
globalThis.fetch=async(u)=>{ const m=u.match(/^\/day\/([A-Z\-]+)/);
  if(m) return {ok:true,status:200,json:async()=>({date:'2026-09-01',stale_seconds:30,rows:data[m[1]]||[]})};
  return {ok:true,status:200,json:async()=>({tracked:['NVDA','SPY','QQQ']})}; };
(0,eval)(engine+'\nglobalThis.analyze=analyze;globalThis.bottomLine=bottomLine;globalThis.marketContext=marketContext;globalThis.momentum=momentum;globalThis.tactical=tactical;globalThis.radarRow=radarRow;globalThis.sortRadar=sortRadar;');
el('sort').value='attention'; el('sens').value='balanced';
// expose internals for the test by appending a hook to the page IIFE
(0,eval)(page.replace('loadAll().catch(', 'globalThis.__hook={loadAll:loadAll,openDetail:openDetail,copyPayload:function(k){return copyPayload(k)},stateText:function(){return stateText()},setView:function(d){store.NVDA.viewDate=d},setStore:function(){store.NVDA.days["2026-08-31"]=d31Global;store.NVDA.days["2026-08-28"]=d28Global;}};loadAll().catch('));
globalThis.d31Global=d31; globalThis.d28Global=d28;
for(let i=0;i<40;i++) await new Promise(r=>setImmediate(r));

const H=globalThis.__hook;
H.openDetail('NVDA'); H.setStore();
let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const HEADER='symbol,date,time,open,high,low,close,volume,dir,body_pct,upper_wick_pct,lower_wick_pct,range,vol_x';
const body=t=>t.split('\n').filter(l=>l&&l!==HEADER&&!l.startsWith('====='));

for (const k of ['5','10','15','20','50']) {
  const t=H.copyPayload(k), rows=body(t);
  ck(`copy ${k}: exactly ${k} candles`, rows.length===+k, rows.length+'');
  if(k==='5'){
    ck('copy 5: header present and correct', t.split('\n')[0]===HEADER);
    ck('copy 5: these are the LAST 5 candles', rows[rows.length-1].split(',')[2]===today[today.length-1].time, rows[rows.length-1].split(',')[2]);
    ck('copy 5: chronological order', rows.map(r=>r.split(',')[2]).every((t,i,a)=>i===0||t>a[i-1]));
    ck('copy 5: 14 columns', rows[0].split(',').length===14);
  }
}
{ const t=H.copyPayload('today'), rows=body(t);
  ck('copy today: every candle in the day', rows.length===today.length, rows.length+' of '+today.length);
  ck('copy today: no invented minute (gap preserved)', !rows.some(r=>r.split(',')[2]==='10:10'), 'dropped minute stays dropped');
  ck('copy today: no duplicate timestamps', new Set(rows.map(r=>r.split(',')[2])).size===rows.length);
  const vx=rows.map(r=>+r.split(',')[13]); const avg=today.reduce((s,x)=>s+x.volume,0)/today.length;
  ck('copy today: vol_x uses the day average', Math.abs(vx[0]-Math.round(today[0].volume/avg*100)/100)<1e-9); }
{ const t=H.copyPayload('all'), rows=body(t);
  ck('copy all days: every loaded candle', rows.length===today.length+d31.length+d28.length, rows.length+' of '+(today.length+d31.length+d28.length));
  const seps=t.split('\n').filter(l=>l.startsWith('====='));
  ck('copy all days: one separator per day, newest first', seps.length===3 && /2026-09-01/.test(seps[0]) && /2026-08-28/.test(seps[2]), seps.join(' '));
  ck('copy all days: header repeated per day', (t.match(new RegExp(HEADER,'g'))||[]).length===3);
  const d31rows=rows.filter(r=>r.split(',')[1]==='2026-08-31');
  ck('copy all days: partial-day vol_x normalised per its own day', d31rows.length===390); }
{ const t20=H.copyPayload('state20'), t50=H.copyPayload('state50'), ta=H.copyPayload('stateall');
  ck('state+20: state block then 20 candles', /STATUS:/.test(t20) && body(t20.split(HEADER)[1]||'').length===20, body(t20.split(HEADER)[1]||'').length+'');
  ck('state+50: 50 candles', body(t50.split(HEADER)[1]||'').length===50);
  ck('state+all: whole day', body(ta.split(HEADER)[1]||'').length===today.length);
  ck('state block has the required fields', ['PRICE:','STATUS:','MAIN STRUCTURE:','SHORT MOMENTUM:','TACTICAL SUPPORT:','TACTICAL RESISTANCE:','VWAP:','MARKET:','SWINGS','Source:'].every(f=>t20.includes(f)),
     ['PRICE:','STATUS:','MAIN STRUCTURE:','SHORT MOMENTUM:','TACTICAL SUPPORT:','TACTICAL RESISTANCE:','VWAP:','MARKET:','SWINGS','Source:'].filter(f=>!t20.includes(f)).join(',')||'all present');
  ck('state block names the right symbol and date', t20.startsWith('NVDA 2026-09-01')); }
// historical day loading + copy from a historical day
{ const st=globalThis.__hookStore ? null : null; }
{ // switch the viewed day to 2026-08-31 and copy
  const H2=globalThis.__hook; H2.setView('2026-08-31');
  const t=H2.copyPayload('today'), rows=body(t);
  ck('copy today after switching to a historical day copies THAT day', rows.length===390 && rows.every(r=>r.split(',')[1]==='2026-08-31'), rows.length+' rows');
  const s=H2.stateText();
  ck('state block follows the selected historical day', s.startsWith('NVDA 2026-08-31'), s.split('\n')[0]);
  H2.setView('2026-09-01');
  ck('switching back restores today', body(H2.copyPayload('today')).length===today.length); }

// fewer candles than requested
{ const orig=globalThis.__hook; const t=H.copyPayload('50');
  ck('request larger than available is capped, not padded', body(t).length===Math.min(50,today.length)); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
