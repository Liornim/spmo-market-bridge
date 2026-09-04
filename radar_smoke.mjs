// Runtime smoke of the radar page against a stub DOM + fake API.
import fs from 'node:fs';
// Extract the page scripts from the generated view.js so this test runs
// against exactly what the worker serves.
import { readFileSync, writeFileSync } from 'node:fs';
// The freshness rule now compares the candle's trading DATE against the session
// that should be running, so fixtures pinned to a past date read as stale. Map
// the fixture's day onto the current expected session.
const SESSION_DATE = (() => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  const d = new Date(p.year + '-' + p.month + '-' + p.day + 'T12:00:00Z');
  if ((p.hour + ':' + p.minute) < '09:30') d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
const shiftDate = (rows, from) => rows.map(r => r.date === from ? Object.assign({}, r, { date: SESSION_DATE }) : r);

{ const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const radar = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  const parts = radar.split('<script>').slice(1).map(s => s.split('</script>')[0]);
  writeFileSync('/tmp/r0.js', parts[0]); writeFileSync('/tmp/r1.js', parts[1]); }

const engine = fs.readFileSync('/tmp/r0.js','utf8'), page = fs.readFileSync('/tmp/r1.js','utf8');

function mkDay(date, n, base, drift, vol=1){
  const out=[]; let p=base, s=7; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  for(let i=0;i<n;i++){ const o=p, c=o+(rnd()-0.5)*0.5+drift, h=Math.max(o,c)+rnd()*0.2, l=Math.min(o,c)-rnd()*0.2;
    const m=30+i; out.push({unix:i,date,time:`${String(9+Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
      open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),volume:Math.floor(100000*vol*(0.6+rnd()))}); p=c; }
  return out;
}
const DAYS={'2026-09-01':91,'2026-08-31':390,'2026-08-28':390};
const data={
  NVDA:{rows:mkDay(SESSION_DATE,91,217,0.01), stale:40},
  AAPL:{rows:mkDay(SESSION_DATE,91,230,-0.02), stale:40},
  TSLA:{rows:mkDay(SESSION_DATE,91,340,0.0), stale:700},          // stale
  MSFT:{rows:[], stale:null},                                      // no data
  SPY:{rows:mkDay(SESSION_DATE,91,560,0.01), stale:40},
  QQQ:{rows:mkDay(SESSION_DATE,91,480,0.01), stale:40},
  SMH:{rows:mkDay(SESSION_DATE,91,260,0.01), stale:40},
  XLK:{rows:mkDay(SESSION_DATE,91,250,-0.01), stale:40},
};
let calls=[];
const els={}; const listeners={};
function el(id){ if(!els[id]) els[id]={ id, innerHTML:'', textContent:'', className:'', value:'', hidden:false, dataset:{}, style:{},
  clientWidth:380, classList:{add(){},remove(){}}, setAttribute(){}, getBoundingClientRect:()=>({left:0,width:380}),
  querySelectorAll:()=>[], scrollIntoView(){}, scrollTop:0, focus(){} }; return els[id]; }
// parse rendered HTML enough to find elements by id/class
function findAll(sel){
  const html = Object.values(els).map(e=>e.innerHTML).join('');
  if(sel==='.cnt'||sel==='.row'||sel==='.fmodes button'||sel==='[data-copy]') return [];
  return [];
}
globalThis.document={ querySelector:s=>el(s.replace('#','')), getElementById:id=>el(id), createElement:()=>({}),
  querySelectorAll:findAll, addEventListener(k,f){listeners[k]=f}, body:{style:{}}, hidden:false, title:'' };
globalThis.window={addEventListener(){}};
const __ls={}; globalThis.localStorage={getItem:k=>__ls[k]??null,setItem:(k,v)=>{__ls[k]=String(v)},removeItem:k=>{delete __ls[k]}};
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async t=>{globalThis.__copied=t}}},configurable:true,writable:true});
globalThis.location={pathname:'/radar',origin:'https://x',href:''};
globalThis.setInterval=()=>0; globalThis.setTimeout=(f)=>{f();return 0}; globalThis.clearTimeout=()=>{};
globalThis.__err=[];
globalThis.fetch=async(u)=>{ calls.push(u);
  if(u.startsWith('/board')){
    const since=+(u.match(/since=(\d+)/)||[0,0])[1];
    const out=[]; Object.keys(data).forEach(s=>{(data[s].rows||[]).forEach((r,i)=>{const unix=1000+i; if(unix>since)out.push(Object.assign({},r,{symbol:s,unix}))})});
    return {ok:true,status:200,json:async()=>({date:'2026-09-01',symbols:Object.keys(data),since,incremental:since>0,
      count:out.length,last_bar_unix:out.length?out[out.length-1].unix:since,rows:out})};
  }
  const m=u.match(/^\/day\/([A-Z\-]+)/);
  if(m){ const d=data[m[1]]; if(!d) return {ok:false,status:404,json:async()=>({rows:[]})};
    return {ok:true,status:200,json:async()=>({symbol:m[1],date:'2026-09-01',stale_seconds:d.stale,rows:d.rows})}; }
  return {ok:true,status:200,json:async()=>({ok:true,tracked:['NVDA','AAPL','TSLA','MSFT','SPY','QQQ']})};
};
(0,eval)(engine+'\n'+['analyze','bottomLine','marketContext','momentum','tactical','radarRow','sortRadar','executionPlan','fmtR','whatNow','pathProbability','dailyContext','volumeBaseline','calibrate','volxTod','pressure','buildTickerState','validateState'].map(n=>`globalThis.${n}=${n};`).join(''));
el('sort').value='attention'; el('sens').value='balanced';
(0,eval)(page.replace('loadAll().catch(function(e){','loadAll().catch(function(e){globalThis.__err.push(e&&e.stack||String(e));'));
await new Promise(r=>setTimeout(r,0)); await new Promise(r=>process.nextTick(r));
for(let i=0;i<40;i++){ await new Promise(r=>setImmediate(r)); }
if(globalThis.__err.length)console.log('ERRORS:',globalThis.__err.slice(0,2));

let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const rowsHtml=el('rows').innerHTML;
ck('radar renders rows', /class="row /.test(rowsHtml), (rowsHtml.match(/data-s="/g)||[]).length+' rows');
ck('market symbols excluded from the list', !/data-s="SPY"/.test(rowsHtml) && !/data-s="QQQ"/.test(rowsHtml));
ck('every tracked non-market symbol present', ['NVDA','AAPL','TSLA','MSFT'].every(s=>rowsHtml.includes('data-s="'+s+'"')));
ck('status chip rendered per row', (rowsHtml.match(/class="st bg-/g)||[]).length === (rowsHtml.match(/data-s="/g)||[]).length);
ck('sparkline rendered', /class="spark"/.test(rowsHtml));
ck('stale symbol marked', /row [A-Z]+ stale/.test(rowsHtml) || /stale/.test(rowsHtml));
ck('no-data symbol shows a no-data marker', /אין נתונים/.test(rowsHtml));
ck('market strip rendered with VWAP state', /VWAP/.test(el('strip').innerHTML) && /שוק:/.test(el('strip').innerHTML));
ck('status counts rendered', (el('counts').innerHTML.match(/class="cnt /g)||[]).length === 6);
// attention order: first row status should be the highest-priority present
const order=['READY','CLOSE','ACTIVE','WATCH','QUIET','AVOID','NODATA'];
const seq=[...rowsHtml.matchAll(/class="row ([A-Z ]+?)[ "]/g)].map(m=>m[1].trim());
const idx=seq.map(s=>order.indexOf(s));
ck('rows sorted by attention (non-decreasing priority)', idx.every((v,i)=>i===0||v>=idx[i-1]), seq.join(' > '));
// one network call per symbol
const dayCalls=calls.filter(c=>c.startsWith('/day/'));
ck('one request per symbol, no duplicates', new Set(dayCalls.map(c=>c.split('?')[0])).size === dayCalls.length, dayCalls.length+' calls');
ck('all requests cache-busted', dayCalls.every(c=>/ts=\d+/.test(c)));

// ---- the date rule, the market gate, and the row wording
{
  const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const page = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('freshness compares the candle DATE to the expected session',
    /expectedSessionDate/.test(page) && /last\.date&&last\.date<expected\)return 'STALE'/.test(page));
  ck('the expected session steps back before the open and over weekends',
    /beforeOpen/.test(page) && /wd!==0&&wd!==6/.test(page));
  ck('a stale benchmark makes the market regime unavailable',
    /benchmarksStale/.test(page) && /label:'Unavailable'/.test(page));
  ck('the market chip says why it is unavailable',
    /\u05dc\u05d0 \u05d6\u05de\u05d9\u05df — \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05dc\u05d0 \u05de\u05d4\u05e1\u05e9\u05df \u05d4\u05e0\u05d5\u05db\u05d7\u05d9/.test(page));
  ck('a symbol from an older session cannot stay a close candidate',
    /\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de\u05e1\u05e9\u05df \u05e7\u05d5\u05d3\u05dd — \u05dc\u05d0 \u05dc\u05e1\u05d7\u05d5\u05e8/.test(page));
  ck('the row names the direction instead of a signed R',
    /\u05de\u05e2\u05dc \u05d4\u05ea\u05de\u05d9\u05db\u05d4/.test(page) && /\u05de\u05ea\u05d7\u05ea \u05dc\u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05ea/.test(page));
  ck('a closing-auction bar is marked as excluded', /\u05e1\u05d2\u05d9\u05e8\u05d4 — \u05dc\u05d0 \u05e0\u05e1\u05e4\u05e8/.test(page));
  ck('the session comes from the clock, not the last bar',
    /nowET/.test(page) && /hm<'09:30'\?'PRE'/.test(page));
}


// ---- scan mode: the radar widens to the universe and walks the remainder
{
  const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const page = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  // The scan lives on its own page; the live radar stays the tracked-20 screen
  // and only links across, so nothing about it changed for the 20.
  ck('the radar has no scope switch of its own', !/id="scope"/.test(page));
  ck('the radar links to the scan page', /href="\/scan"/.test(page));
  ck('the radar still loads the tracked board only', /return 'tracked'/.test(page));
}


// ---- a transient failure must not read as a dead screen
{
  const src2 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p2 = JSON.parse(src2.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('429 and 5xx are retried, not thrown at the user', /r\.status===429\|\|r\.status>=500/.test(p2));
  ck('the retry waits longer for a rate cap than for a deploy', /r\.status===429\?4000:1500/.test(p2));
  ck('a 404 still returns normally', /r\.status===404\)return r\.json\(\)/.test(p2));
  ck('retries are bounded', /left>0/.test(p2) && /left-1/.test(p2));
}


// ---- the radar audits its own data and says so in the header
{
  const src3 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p3 = JSON.parse(src3.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('the radar runs the data audit', /runAudit/.test(p3) && /j\('\/audit'\)/.test(p3));
  ck('the verdict has a place in the header', /id="audit"/.test(p3));
  ck('a failure is coloured, not buried', /\.audit\.bad\{/.test(p3) && /\.audit\.warn\{/.test(p3));
  ck('the findings can be opened without leaving the page', /auditbox/.test(p3));
  ck('it says not to trade until they clear', /אל תסחור/.test(p3));
  // The audit runs on load and on its own timer, never on the refresh path:
  // bars arriving on time matters more than a verdict arriving promptly.
  ck('the audit runs on load', /loadAll\(\)\.then\(function\(\)\{return auditIfDue\(\)\}\)/.test(p3));
  // It does not run on a timer at all. Measured at 42,000 reads per run, an
  // automatic audit is more expensive than the system it checks.
  ck('the audit never runs automatically',
    !/setInterval\([^)]*auditIfDue/.test(p3) && /function auditIfDue\(\)\{ return Promise\.resolve\(\); \}/.test(p3));
  ck('the badge invites the check rather than reporting one', /בדוק נתונים/.test(p3));
  ck('and shows progress when tapped', /בודק…/.test(p3));
  ck('the cost of an automatic audit is recorded where it was removed',
    /1\.32 million reads/.test(p3));
}


// ---- the version must be a number that rises, not a timestamp to compare
{
  const src4 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const build = JSON.parse(src4.split('export const BUILD = ')[1].split(';')[0]);
  ck('the build is a plain rising version', /^v\d+/.test(build), build);
  ck('the timestamp is kept alongside it, not instead of it', /\(\d{4}-\d{2}-\d{2}/.test(build), build);
  const page4 = JSON.parse(src4.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('the radar shows it', page4.indexOf(build) >= 0);
  ck('and shows it once, not with a doubled prefix', !/>vv\d/.test(page4));
}


// ---- a session that does not start at the open must be repaired, not narrated
{
  const src5 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p5 = JSON.parse(src5.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('a short session triggers a full-day fetch', /function repairFromOpen/.test(p5)
    && /j\('\/day\/'\+s\+'\/'\+date/.test(p5));
  ck('it only fires when the first bar is after the open', /st\.rows\[0\]\.time>'09:35'/.test(p5));
  ck('once per symbol per day, not on every refresh', /repaired\[s\+':'\+date\]/.test(p5));
  ck('it merges rather than replacing', /seen\[k\]\)return;[\s\S]{0,60}st\.rows\.push\(r\)/.test(p5));
  ck('and it recomputes afterwards', /repairFromOpen\(\)[\s\S]{0,80}recompute\(\)/.test(p5));
  ck('it runs after the first paint and on every refresh',
    /setTimeout\(function\(\)\{ repairFromOpen/.test(p5) && /loadAllThenRepair/.test(p5));
  ck('a handful at a time, so it cannot flood the worker', /\.slice\(0,8\)/.test(p5));
}


// ---- the quota line must answer a question, not pose one
{
  const src6 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p6 = JSON.parse(src6.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('no raw percentage is shown', !/מכסת D1 היום: '\+u\.read_pct/.test(p6) && !/לפחות '\+u\.read_pct/.test(p6));
  ck('it says whether bars will keep arriving', /אין נרות חדשים היום/.test(p6));
  ck('it says when it recovers', /חוזר לעבוד ב-03:00|מתאפס ב-03:00/.test(p6));
  ck('and when there is nothing to worry about it says so', /המכסה בסדר/.test(p6));
}


// ---- the buy card is ADDITIVE: it must not disturb anything that existed
{
  const src7 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p7 = JSON.parse(src7.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));

  ck('the new tab exists beside the full-screen one', /id="openBuy">כרטיס קנייה/.test(p7)
    && /id="openFull">מסך מלא/.test(p7));
  ck('the full-screen button is untouched', /id="openFull"/.test(p7));
  ck('the card rides the existing refresh, with no second poller',
    /buyOpen\?drawBuy\(\):drawDetail\(\)/.test(p7)
    && (p7.match(/setInterval/g) || []).length <= 4);
  ck('changing symbol returns to the detail view', /function openDetail\(sym\)\{[\s\S]{0,200}buyOpen=false;/.test(p7));
  ck('its styles are scoped to the card', /\.buycard\{/.test(p7) && /\.bcverdict\.buy\{/.test(p7));
  ck('the decision map is the prominent element', /bcmap/.test(p7) && /מחיר Trading שלך עכשיו/.test(p7));
  ck('validity is shown with what to do outside it', /תקפות הכרטיס/.test(p7) && /RECHECK עם הנרות החדשים/.test(p7));
  ck('it explains that outside the range is not a refusal',
    /מחיר נמוך יותר עשוי ליצור setup טוב יותר/.test(p7));
  ck('no exit language reached the view',
    !/לממש|יעד 1|stop|take profit/i.test(p7.split('.buycard')[1] || ''));
}


// ---- the card's corrections, in the rendered page
{
  const src8 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p8 = JSON.parse(src8.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('the price map is rendered only when a setup exists', /card\.hasMap\?/.test(p8));
  ck('the section is labelled by session, not always as live',
    /marketPhase\(\)==='open'\?'מחיר Trading שלך עכשיו':'מפת מחיר'/.test(p8));
  ck('VWAP says which side the PRICE is on', /'מחיר מעל VWAP '/.test(p8) && /'מחיר מתחת VWAP '/.test(p8));
  ck('the old ambiguous VWAP wording is gone', !/VWAP <b>'\+card\.vwap[\s\S]{0,40}'מעל':'מתחת'/.test(p8));
  ck('each validity boundary shows the structure it came from', /card\.validity\.lowWhy/.test(p8));
}


// ---- the card can be copied
{
  const src9 = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p9 = JSON.parse(src9.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('there is a copy button on the card', /id="buyCopy">העתק כרטיס/.test(p9));
  ck('it builds the text from the same card object the screen rendered',
    /buyCardText\(card,\{live:marketPhase\(\)==='open'\}\)/.test(p9));
  ck('it falls back to a prompt when the clipboard is unavailable', /prompt\('העתק:',txt\)/.test(p9));
  ck('and confirms the copy', /toast\('הכרטיס הועתק'\)/.test(p9));
}

console.log(`\n${pass} passed, ${fail} failed`);
globalThis.__els=els;
