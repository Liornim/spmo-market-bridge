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
