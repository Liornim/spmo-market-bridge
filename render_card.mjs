// Render the REAL buyDecisionHtml from the deployed page, at a closed market,
// and check the output for each thing the spec demands.
import { readFileSync } from 'node:fs';
const src = readFileSync('/home/claude/vault/view.js','utf8');
const page = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/,''));
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

const els={}; const el=id=>els[id]||(els[id]={innerHTML:'',textContent:'',className:'',value:'',hidden:false,dataset:{},style:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],setAttribute(){},scrollTop:0,getBoundingClientRect:()=>({left:0,width:380})});
globalThis.document={querySelector:s=>el(s.replace('#','')),querySelectorAll:()=>[],addEventListener(){},body:{style:{}},hidden:false};
globalThis.window={}; globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{}}},configurable:true});
globalThis.setInterval=()=>0; globalThis.setTimeout=(f)=>0; globalThis.clearTimeout=()=>{};

const D='2026-09-04';
const tm=i=>{const m=30+i;return String(9+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const t0=Math.floor(Date.parse(D+'T13:30:00Z')/1000);
const rows=[];let p=616.7;for(let i=0;i<390;i++){const o=p,c=o+Math.sin(i/17)*0.06;
  rows.push({symbol:'META',date:D,time:tm(i),unix:t0+i*60,open:+o.toFixed(3),high:+(Math.max(o,c)+0.03).toFixed(3),low:+(Math.min(o,c)-0.03).toFixed(3),close:+c.toFixed(3),volume:5000});p=c}

globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/\/board/.test(url))return {ok:true,status:200,json:async()=>({date:D,symbols:['META'],rows,count:rows.length,last_bar_unix:rows[rows.length-1].unix})};
  if(/\/status/.test(url)||url.endsWith('/')||/\/\?/.test(url))return {ok:true,status:200,json:async()=>({tracked:['META'],symbols:[{symbol:'META'}]})};
  return {ok:true,status:200,json:async()=>({})};
};
// make the page believe the market is CLOSED, whatever the real clock says
const closedScript = scripts.join('\n').replace(/function marketPhase\(\)\{/, 'function marketPhase(){ return "post"; /* forced closed for this test */');
const hooked = closedScript.replace('loadAll().then(function(){return auditIfDue()}).catch(',
  'globalThis.__h={openDetail:openDetail,store:()=>store,drawBuy:()=>drawBuy(),html:()=>buyDecisionHtml(),setOpen:v=>{buyOpen=v}};loadAll().then(function(){return auditIfDue()}).catch(');
(0,eval)(hooked);
const settle=async()=>{for(let i=0;i<80;i++)await new Promise(r=>setImmediate(r))};
await settle();

// open META and switch to the buy card the way a tap would
const H=globalThis.__h;
H.openDetail('META'); await settle();
const st0=H.store().META; console.log('store.META:', st0?Object.keys(st0).join(','):'MISSING', '| rows:', st0&&st0.rows&&st0.rows.length, '| snap:', !!(st0&&st0.snap), '| A:', !!(st0&&st0.A));
const sn=H.store().META.snap; console.log('snap.pressure:', sn&&sn.pressure?JSON.stringify({buyPct:sn.pressure.buyPct,sellPct:sn.pressure.sellPct,buyersTrend:sn.pressure.buyersTrend}):'NO PRESSURE');
H.setOpen(true); H.drawBuy();
const out=el('panel').innerHTML;
const txt=out.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
console.log('--- rendered card text ---');
console.log(txt.slice(0,900));
console.log('--------------------------');
ck('header names the closing session', /סגירת 09\/04/.test(txt));
ck('verdict says close', /אין setup קנייה בסגירה/.test(txt));
ck('market reads closed, not Unavailable', /שוק\s*סגור/.test(txt) && !/Unavailable/.test(txt));
ck('buyers/sellers percentages are shown', /\d+% \/ \d+%/.test(txt), (txt.match(/\d+% \/ \d+%/)||[''])[0]);
ck('and their direction beside them', /כיוון הכוח/.test(txt));
ck('why is a sentence from the data, not a label', /המחיר סיים ב-\d/.test(txt));
ck('BUY NOW line says the market is closed', /BUY NOW\s*— המסחר סגור/.test(txt));
ck('no price map', !/מחיר Trading שלך עכשיו/.test(txt) && !/מפת מחיר\s*$/.test(txt));
console.log(`\n${pass} passed, ${fail} failed`);
