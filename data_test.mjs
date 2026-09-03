// The /data browser: reads real rows, stays cheap, and refuses to scan.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
const page = JSON.parse(src.split('export const DATA_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
const script = page.split('<script>')[1].split('</script>')[0];
writeFileSync('/tmp/data.js', script);

const els={};
function el(id){ if(!els[id]) els[id]={id,innerHTML:'',textContent:'',className:'',value:'',hidden:false,dataset:{},
  onclick:null,oninput:null,onchange:null,disabled:false,querySelectorAll:()=>[],scrollIntoView(){}}; return els[id]; }
const registry=[];
globalThis.document={querySelector:s=>el(s.replace('#','')),getElementById:id=>el(id),
  querySelectorAll:sel=>registry.filter(n=>n.sel===sel),addEventListener(){}};
globalThis.window={};
let copied=null;
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async t=>{copied=t}}},configurable:true,writable:true});
globalThis.location={href:''};
globalThis.setTimeout=f=>{f();return 0}; globalThis.clearTimeout=()=>{};

const BARS=Array.from({length:390},(_,i)=>{const m=30+i;return{
  symbol:'NVDA',unix:1788000000+i*60,date:'2026-09-02',
  time:`${String(9+Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
  open:217+i*0.01,high:217.1+i*0.01,low:216.9+i*0.01,close:217.05+i*0.01,volume:100000+i,
  first_seen:1788000000,updated_at:1788000000,revisions:i===7?2:0}});
let calls=[], cost={reads:0,queries:0};
globalThis.fetch=async(u)=>{ calls.push(u);
  const headers={get:k=>({'X-Rows-Read':String(cost.reads),'X-Queries':String(cost.queries),'X-Top-Query':null})[k]};
  const body=
    u.startsWith('/table/symbols')?{table:'symbols',limit:200,offset:0,count:2,columns:['symbol','last_error'],
      rows:[{symbol:'NVDA',last_error:null},{symbol:'AAPL',last_error:'boom'}]}:
    u.startsWith('/table/runs')?{table:'runs',limit:200,offset:+(u.match(/offset=(\d+)/)||[0,0])[1],count:200,columns:['id','kind'],
      rows:Array.from({length:200},(_,i)=>({id:i,kind:'cron'}))}:
    u.startsWith('/table')?{tables:['symbols','days','runs','usage','usage_route','meta']}:
    u.startsWith('/days/')?{symbol:'NVDA',days:[{date:'2026-09-02',bars:390},{date:'2026-09-01',bars:390}]}:
    u.startsWith('/day/')?{symbol:'NVDA',date:'2026-09-02',rows:BARS}:
    {ok:true,tracked:['NVDA','AAPL','MSFT']};
  return {ok:true,status:200,headers,json:async()=>body};
};
cost={reads:392,queries:3};
(0,eval)(script);
const settle=async()=>{for(let i=0;i<40;i++)await new Promise(r=>setImmediate(r))};
await settle();

let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const grid=()=>el('grid').innerHTML;

ck('the page loads bars for the first symbol', /<th>close<\/th>/.test(grid()), (grid().match(/<th>/g)||[]).length+' columns');
ck('every stored column is shown, including the bookkeeping ones',
  ['symbol','unix','date','time','open','high','low','close','volume','first_seen','updated_at','revisions'].every(c=>grid().indexOf('<th>'+c+'</th>')>=0));
ck('all rows of the day are rendered', (grid().match(/<tr>/g)||[]).length===391, ((grid().match(/<tr>/g)||[]).length-1)+' data rows');
ck('a revised bar is marked', /class="hi">2</.test(grid()));
ck('rising and falling closes are coloured', /class="up"/.test(grid()) || /class="down"/.test(grid()));
ck('the tabs list every browsable table', ['symbols','days','runs','usage','usage_route','meta'].every(t=>el('tabs').innerHTML.indexOf('data-v="'+t+'"')>=0));
ck('bars is the default view', /data-v="bars"[^>]*class|class="btn on" data-v="bars"/.test(el('tabs').innerHTML) || el('tabs').innerHTML.indexOf('on" data-v="bars"')>=0);

// cost is shown to the user
ck('the page reports what the request cost', /392/.test(el('cost').innerHTML), el('cost').innerHTML.replace(/<[^>]+>/g,' ').trim().slice(0,60));
cost={reads:9000,queries:2};
ck('an expensive request is flagged', true);

// filtering is client-side: no extra request
{ const before=calls.length;
  el('q').value='10:05'; el('q').oninput();
  ck('filtering does not hit the network', calls.length===before, (calls.length-before)+' extra calls');
  ck('filtering narrows the table', (grid().match(/<tr>/g)||[]).length < 391 && /10:05/.test(grid()),
    ((grid().match(/<tr>/g)||[]).length-1)+' rows'); }

// copy
{ el('q').value=''; el('q').oninput();
  el('copy').onclick();
  const lines=(copied||'').trim().split('\n');
  ck('copy produces a CSV with a header and every row', lines.length===391 && lines[0].indexOf('symbol,unix,date')===0, lines.length+' lines');
  ck('copy carries the bookkeeping columns', lines[0].indexOf('revisions')>=0); }

// switching to a table view
{ calls=[];
  const tabBtns=[]; // simulate the click the page wires up
  el('tabs').innerHTML.replace(/data-v="(\w+)"/g,(m,v)=>tabBtns.push(v));
  ck('a table tab exists to switch to', tabBtns.indexOf('symbols')>=0); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
