// Drive the REAL radar page against a board that behaves like production:
// incremental, with a cursor that never held the open.
import { readFileSync } from 'node:fs';
const src = readFileSync('/home/claude/vault/view.js','utf8');
const page = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/,''));
const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

const els={}; const el=id=>els[id]||(els[id]={innerHTML:'',textContent:'',className:'',value:'',hidden:false,
  dataset:{},style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],setAttribute(){},scrollTop:0,
  getBoundingClientRect:()=>({left:0,width:380})});
globalThis.document={querySelector:s=>el(s.replace('#','')),querySelectorAll:()=>[],addEventListener(){},body:{style:{}},hidden:false};
globalThis.window={}; globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{}}},configurable:true});
let timers=[];
globalThis.setInterval=()=>0;
globalThis.setTimeout=(f,ms)=>{timers.push(f);return 0};
globalThis.clearTimeout=()=>{};

const D='2026-09-04';
const tm=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const t0=Math.floor(Date.parse(D+'T13:30:00Z')/1000);
const SYMS=['TQQQ','NVDA','SPY','QQQ','SMH'];
const full=s=>{const out=[];for(let i=0;i<346;i++){const px=500+Math.sin(i/40);
  out.push({symbol:s,date:D,time:tm(i),unix:t0+i*60,open:+px.toFixed(2),high:+(px+0.05).toFixed(2),
    low:+(px-0.05).toFixed(2),close:+px.toFixed(2),volume:5000})}return out};

let boardCalls=0, dayCalls=[];
globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/\/day\//.test(url)){
    const sym=url.match(/\/day\/([A-Z]+)/)[1];
    dayCalls.push(sym);
    return {ok:true,status:200,json:async()=>({symbol:sym,date:D,rows:full(sym),stale_seconds:30})};
  }
  if(/\/board/.test(url)){
    boardCalls++;
    // PRODUCTION SHAPE: only the last 254 minutes, as an incremental cursor gives
    const rows=[]; SYMS.forEach(s=>full(s).slice(92).forEach(r=>rows.push(r)));
    return {ok:true,status:200,json:async()=>({date:D,symbols:SYMS,rows,count:rows.length,
      last_bar_unix:rows[rows.length-1].unix})};
  }
  if(/\/audit/.test(url))return {ok:true,status:200,json:async()=>({verdict:'OK',findings:[]})};
  return {ok:true,status:200,json:async()=>({})};
};

(0,eval)(scripts.join('\n'));
const settle=async()=>{for(let i=0;i<80;i++)await new Promise(r=>setImmediate(r))};
await settle();

let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};

const store=globalThis.__store||null;
ck('the board was called', boardCalls>0, boardCalls+' calls');
ck('the short session triggered a full-day fetch', dayCalls.length>0, dayCalls.join(',')||'NONE');

// run the timers the page scheduled (the repair is one of them)
for(const f of timers.slice()) { try{ f(); }catch(e){} }
await settle();
ck('EVERY short symbol was repaired, not just some',
  SYMS.every(s=>dayCalls.indexOf(s)>=0), 'repaired: '+dayCalls.join(',')+' of '+SYMS.join(','));
const missed=SYMS.filter(s=>dayCalls.indexOf(s)<0);
if(missed.length) console.log('   MISSED:', missed.join(','));

// the point of the whole exercise: coverage must read complete afterwards
const anySt = (globalThis.__probe && globalThis.__probe()) || null;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
