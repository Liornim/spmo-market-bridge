import { readFileSync } from 'node:fs';
const src = readFileSync('/home/claude/vault/view.js','utf8');
const page = JSON.parse(src.split('export const BARS_HTML = ')[1].split('\n')[0].trim().replace(/;$/,''));
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

const vals = { dSym:'', dRange:'30', dFrom:'', dTo:'', sym:'NVDA', find:'', order:'', thr:'', win:'' };
const els = {};
const el = id => els[id] || (els[id] = {
  get value(){ return vals[id] ?? ''; }, set value(v){ vals[id]=v; },
  innerHTML:'', textContent:'', hidden:false, className:'', dataset:{}, style:{},
  querySelector:()=>null, querySelectorAll:()=>[], onclick:null, onchange:null, oninput:null,
  checked:false, scrollTop:0, appendChild(){}, closest:()=>null
});
globalThis.document = { querySelector: s => el(s.replace('#','')), querySelectorAll: () => [],
  addEventListener(){}, body:{style:{}}, createElement:()=>({click(){},href:'',download:''}) };
globalThis.window = {}; globalThis.location = { hash:'', search:'' };
globalThis.history = { replaceState(){} };
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{}}},configurable:true});
globalThis.setTimeout=(f)=>0; globalThis.clearTimeout=()=>{}; globalThis.setInterval=()=>0;
globalThis.Blob=class{}; globalThis.URL.createObjectURL=()=>'blob:'; globalThis.URL.revokeObjectURL=()=>{};
globalThis.confirm=()=>false; globalThis.prompt=()=>{};

const asked = [];
globalThis.fetch = async (u) => { asked.push(String(u)); return { ok:true, status:200,
  json: async () => ({ symbols:['AAPL','NVDA'], tracked:['NVDA'], rows:[], days:[] }) }; };

(0,eval)(script);
const settle = async () => { for (let i=0;i<40;i++) await new Promise(r=>setImmediate(r)); };
await settle();

console.log('--- what the page requests for each filter choice ---');
const daily = () => asked.filter(u => u.includes('/bars/daily')).pop() || '(none)';
const strip = u => u.replace(/[?&]ts=\d+/,'').replace('https://x','');

for (const [label, set] of [
  ['default 30d',      () => { vals.dFrom='2026-08-06'; vals.dTo='2026-09-05'; vals.dSym=''; }],
  ['one exact day',    () => { vals.dFrom='2026-09-04'; vals.dTo='2026-09-04'; }],
  ['all days (empty)', () => { vals.dFrom=''; vals.dTo=''; }],
  ['one symbol',       () => { vals.dSym='NVDA'; vals.dFrom='2026-09-04'; vals.dTo='2026-09-04'; }]
]) {
  set();
  asked.length = 0;
  const g = el('dGo'); if (g.onclick) g.onclick();
  await settle();
  console.log(('  ' + label).padEnd(22) + strip(daily()));
}
