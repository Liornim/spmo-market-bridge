import { readFileSync } from 'node:fs';
const src = readFileSync('/home/claude/vault/view.js','utf8');
const page = JSON.parse(src.split('export const BARS_HTML = ')[1].split('\n')[0].trim().replace(/;$/,''));
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const vals = { bSyms:'AMD', bFrom:'2026-08-06', bTo:'2026-09-05', bRes:'minute', bFmt:'each',
  sym:'AAPL', find:'', dSym:'', dFrom:'', dTo:'' };
const els = {};
const el = id => els[id] || (els[id] = {
  get value(){ return vals[id] ?? ''; }, set value(v){ vals[id]=v; },
  innerHTML:'', textContent:'', hidden:false, className:'', dataset:{}, style:{},
  disabled:false, onclick:null, onchange:null, oninput:null, checked:false,
  querySelector:()=>null, querySelectorAll:()=>[], closest:()=>null, click(){}, appendChild(){},
  addEventListener(e,f){this['on'+e]=f}, contains:()=>true });
const KNOWN=['bSyms','bFrom','bTo','bRes','bFmt','bDl','bGo','bStop','bEst','bProg','bStatus',
  'bDefault','bTracked','bAll','bClear','bulkWrap','tabDay','tabDaily','tabBulk','sym','date','find','count',
  'days','sum','tbl','dTbl','dSym','dFrom','dTo','dGo','dCount','dAsk','copy','order','dl','dlAll','dlRange',
  'range','rFrom','rTo','rTracked','rEst','rGo','rCancel','prog','toast','dCopy','dDl','dailyWrap','pickMin','pickDaily'];
globalThis.document={ querySelector:s=>{ const id=s.replace(/^#/,''); 
    if(KNOWN.includes(id))return el(id);
    if(/^\./.test(s)||/[ >:]/.test(s))return null;   // a real DOM returns null
    return null; }, querySelectorAll:()=>[],
  addEventListener(){}, body:{style:{}}, createElement:()=>({click(){},href:'',download:''}) };
globalThis.window={JSZip:null}; globalThis.location={hash:'',search:''}; globalThis.history={replaceState(){}};
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{}}},configurable:true});
globalThis.Blob=class{constructor(a){this.a=a}}; globalThis.URL.createObjectURL=()=>'blob:'; globalThis.URL.revokeObjectURL=()=>{};
globalThis.confirm=()=>true; globalThis.prompt=()=>{}; globalThis.alert=()=>{};
const calls=[];
globalThis.fetch=async(u)=>{ calls.push(String(u).replace(/[?&]ts=\d+/,''));
  const s=String(u);
  if(/\/bars\/index/.test(s))return{ok:true,status:200,json:async()=>({symbols:['AMD'],tracked:['AMD']})};
  if(/\/bars\/count/.test(s))return{ok:true,status:200,json:async()=>({estimate_total:7800,trading_days_in_range:21,d1_rows_exact:7800,archive_rows_estimate:8190})};
  if(/\/bars\/export/.test(s))return{ok:true,status:200,text:async()=>'symbol,date,time,open,high,low,close,volume\nAMD,2026-09-04,09:30,1,1,1,1,1\nAMD,2026-09-04,09:31,1,1,1,1,1'};
  if(/\/days\//.test(s))return{ok:true,status:200,json:async()=>({days:[]})};
  return{ok:true,status:200,json:async()=>({rows:[]}),text:async()=>''};
};
let err=null;
try { (0,eval)(script); } catch(e){ err=e; }
const settle=async()=>{for(let i=0;i<120;i++)await new Promise(r=>setImmediate(r));};
await settle();
console.log('script threw at load:', err ? err.message : 'no');
const dl=el('bDl');
console.log('bDl.onclick bound:', typeof dl.onclick);
calls.length=0;
if(typeof dl.onclick==='function'){ try{ dl.onclick(); }catch(e){ console.log('onclick threw:', e.message); } }
await settle();
console.log('requests made:', calls.length ? calls.join('\n  ') : 'NONE');
console.log('bEst text:', el('bEst').innerHTML || el('bEst').textContent || '(empty)');
console.log('bProg text:', el('bProg').textContent || '(empty)');
console.log('bStatus:', el('bStatus').textContent || '(empty)');

let pass = 0, fail = 0;
const ck = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (x ? '   [' + x + ']' : '')); };
ck('the page script does not throw when a selector matches nothing', err === null, err ? err.message : 'clean');
ck('the download button is bound', typeof dl.onclick === 'function');
ck('clicking it counts first', calls.some(c => /\/bars\/count/.test(c)));
ck('and then exports the symbol', calls.some(c => /\/bars\/export\/AMD/.test(c)));
ck('the run reports completion', /completed|הושלם/.test(el('bStatus').textContent));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
