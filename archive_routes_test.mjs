import { makeArchiveRoutes } from './archive_routes.js';
const H={}; const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s});
const calls=[];
const base=1791375000-1791375000%86400+13*3600+30*60; // some day 13:30Z
const sb=async(env,q,o)=>{calls.push(q); if(q.startsWith('archive_symbols'))return {text:JSON.stringify([{id:5,symbol:'BITX',bars:1}])};
  const rows=[...Array(3)].map((_,i)=>({unix:base+i*60,o:1e5,h:1e5,l:1e5,c:1e5,v:1})); return {text: o?'unix,o\n':JSON.stringify(q.includes('gt.')&&!q.includes(`gt.${base-1}`)?[]:rows)};};
const h=makeArchiveRoutes({sb,json,H,validSym:s=>/^[A-Z.\-]+$/.test(s),isSessionMinute:()=>true,localDateTime:u=>({date:new Date(u*1000).toISOString().slice(0,10),time:'09:30'}),authorized:()=>true,ghOn:()=>false,gh:async()=>({})});
const env={SUPABASE_URL:'x',SUPABASE_KEY:'k'};
const d=new Date(base*1000).toISOString().slice(0,10);
for (const path of [['day','BITX',d],['days','BITX'],['export','BITX'],['daily']]) {
  const r=await h(env,path,new URL('https://x/xa/'+path.join('/')),new Request('https://x'));
  const t=await r.text(); console.log(path.join('/'), r.status, t.slice(0,80)); if(path[0]!=='daily'&&r.status!==200){console.log('FAIL');process.exit(1)}
}
const r=await h(env,['raw','BITX'],new URL('https://x/xa/raw/BITX?ext=1'),new Request('https://x')); await r.text();
const q=calls.filter(c=>c.includes('ext')).pop(); console.log('raw ext query:', q); if(!q||!q.startsWith('archive_ext_bars')){console.log('FAIL');process.exit(1)} console.log('archive routes: PASS');
// regression (v297): a query edit leaked a route-only variable into readRange and
// every /xa/day, /xa/days, /xa/export answered 500 — each must answer 200 here
// /xa/db/* ("בדיקת DB" page): database only, the right table and range per query
{
  const sb2=async(env,q,o)=>{calls.push(q); if(q.startsWith('archive_symbols'))return {text:JSON.stringify([{id:5,symbol:'BITX',bars:1}])};
    if(o&&o.method==='HEAD')return {text:'',headers:new Headers({'content-range':'0-0/1234'})};
    if(q.startsWith('rpc/db_size'))return {text:'279000000'}; return {text:'unix,o,h,l,c,v\n1,2,3,4,5,6\n'};};
  const h2=makeArchiveRoutes({sb:sb2,json,H,validSym:s=>/^[A-Z.\-]+$/.test(s),authorized:()=>true,ghOn:()=>false,gh:async()=>({})});
  const go=async u=>{const x=new URL('https://x'+u);const r=await h2(env,x.pathname.split('/').slice(2),x,new Request('https://x'));return [r.status,await r.text()]};
  const fail=m=>{console.log('FAIL '+m);process.exit(1)};
  let [st,t]=await go('/xa/db/stats'); const j=JSON.parse(t);
  if(st!==200||j.db_bytes!==279000000||j.symbols.length!==1)fail('db stats '+t);
  calls.length=0; [st,t]=await go('/xa/db/count?symbol=BITX&table=ext&sess=pre&lo=1791000000&hi=1791172800');
  if(JSON.parse(t).rows!==1234||!calls.some(c=>c.startsWith('archive_ext_bars?symbol_id=eq.5&unix=gte.1791000000&unix=lt.1791172800&or=(and(')))fail('db count ext pre '+calls.join(' | '));
  calls.length=0; [st,t]=await go('/xa/db/rows?symbol=BITX&table=main&lo=1&hi=2&after=5');
  if(!calls.some(c=>c.startsWith('bars?symbol=eq.BITX&unix=gte.1&unix=lt.2&select=unix,open,high,low,close,volume&order=unix.asc&limit=1000&unix=gt.5')))fail('db rows main '+calls.join(' | '));
  calls.length=0; await go('/xa/db/rows?symbol=BITX&table=reg');
  if(!calls.some(c=>c.startsWith('archive_bars?symbol_id=eq.5&select=unix,o,h,l,c,v')))fail('db rows reg '+calls.join(' | '));
  [st]=await go('/xa/db/rows?symbol=BITX&table=yahoo'); if(st!==400)fail('db rows bad table');
  console.log('db routes: PASS');
}
