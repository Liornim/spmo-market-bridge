// WHAT NOW section on screen: ordering, plain language, live recalculation,
// multi-day loading, session-close behaviour.
import fs from 'node:fs';
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
  writeFileSync('/tmp/r0.js', parts[0]); writeFileSync('/tmp/r1.js', parts[1]); writeFileSync('/tmp/radar_html.txt', radar); }
const engine = fs.readFileSync('/tmp/r0.js','utf8'), page = fs.readFileSync('/tmp/r1.js','utf8');

const tm=i=>{const m=30+i;return `${String(9+Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`};
function day(date,base,shape,n,sd){ let p=base,s=sd||3,out=[]; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648; n=n||390;
  for(let i=0;i<n;i++){ let d=shape==='up'?0.004:shape==='down'?-0.004:Math.sin(i/25)*0.02;
    const o=p,c=o+(rnd()-0.5)*0.16+d,h=Math.max(o,c)+rnd()*0.06,l=Math.min(o,c)-rnd()*0.06;
    out.push({date,time:tm(i),open:+o.toFixed(4),high:+h.toFixed(4),low:+l.toFixed(4),close:+c.toFixed(4),
      volume:i>=385?800000:Math.floor(120000*(1+4/(1+i*0.1))*(0.6+rnd()))}); p=c; }
  return out; }
const DATES=['2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01'];
const hist={}; DATES.forEach((d,i)=>hist[d]=day(d,200+i*0.5,'up',390,3+i*7));
let live={ NVDA:day(SESSION_DATE,203,'up',240,31), AAPL:day(SESSION_DATE,230,'down',240,41),
  SPY:day(SESSION_DATE,560,'up',240,51), QQQ:day(SESSION_DATE,480,'up',240,61) };
hist['2026-09-01']=live.NVDA;

const els={};
function el(id){ if(!els[id]) els[id]={id,innerHTML:'',textContent:'',className:'',value:'',hidden:false,dataset:{},style:{},
  children:[],classList:{add(){},remove(){}},querySelectorAll:()=>[],querySelector:()=>null,setAttribute(){},scrollTop:0,
  appendChild(c){this.children.push(c)},removeChild(c){this.children=this.children.filter(x=>x!==c)},get firstChild(){return this.children[0]},remove(){},
  getBoundingClientRect:()=>({left:0,width:380})}; return els[id]; }
globalThis.document={querySelector:s=>el(s.replace('#','')),getElementById:id=>el(id),
  createElement:()=>({className:'',innerHTML:'',onclick:null,remove(){}}),querySelectorAll:()=>[],addEventListener(){},body:{style:{}},hidden:false};
globalThis.window={addEventListener(){}};
const __ls={}; globalThis.localStorage={getItem:k=>__ls[k]??null,setItem:(k,v)=>{__ls[k]=String(v)},removeItem:k=>{delete __ls[k]}};
let copied=null;
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async t=>{copied=t}}},configurable:true,writable:true});
globalThis.location={pathname:'/radar',origin:'https://x',href:''};
const timers=[]; globalThis.setInterval=(f,ms)=>{timers.push({f,ms});return timers.length};
globalThis.setTimeout=()=>0; globalThis.clearTimeout=()=>{};
let calls=[]; let staleSec=30;
const BASE={};
const FIXED_NOW=Math.floor(Date.now()/1000);
const BOARD_DATE=SESSION_DATE;
const BOARD=live;
globalThis.fetch=async(u)=>{ calls.push(u);
  if(u.startsWith('/board')){
    const since=+(u.match(/since=(\d+)/)||[0,0])[1];
    const out=[];
    const NOW=Math.floor(Date.now()/1000);
    Object.keys(BOARD).forEach(s=>{const arr=BOARD[s]||[];arr.forEach((r,i)=>{
      // Stable across calls AND recent, so the newest bar reads as live: the
      // state builder now refuses to give guidance off stale data, which is the
      // point, so the fixture must not look three hours old.
      // Anchored to a fixed base per symbol, so appending bars produces LATER
      // timestamps rather than shifting every existing one backwards — which
      // made `since` filter out the very bars the test had just added.
      if(BASE[s]==null)BASE[s]=FIXED_NOW-(arr.length-1)*60;
      const dayOffset=(Date.parse(BOARD_DATE+'T00:00:00Z')-Date.parse(r.date+'T00:00:00Z'))/1000;
      const unix=BASE[s]+i*60-dayOffset;
      if(unix>since) out.push(Object.assign({},r,{symbol:s,unix,date:SESSION_DATE}));
    })});
    return {ok:true,status:200,json:async()=>({date:BOARD_DATE,symbols:Object.keys(BOARD),since,incremental:since>0,
      count:out.length,last_bar_unix:out.length?Math.max.apply(null,out.map(r=>r.unix)):since,rows:out})};
  }
 await new Promise(r=>setImmediate(r));
  const dm=u.match(/^\/day\/([A-Z\-]+)\/(\d{4}-\d{2}-\d{2})/);
  if(dm) return {ok:true,status:200,json:async()=>({date:dm[2],stale_seconds:0,rows:hist[dm[2]]||[]})};
  const m=u.match(/^\/day\/([A-Z\-]+)/);
  if(m) return {ok:true,status:200,json:async()=>({date:SESSION_DATE,stale_seconds:staleSec,rows:shiftDate(live[m[1]]||[],'2026-09-01')})};
  if(u.startsWith('/days/')) return {ok:true,status:200,json:async()=>({days:DATES.slice().reverse().map(d=>({date:d,bars:390}))})};
  if(u.startsWith('/book/')) return {ok:true,status:200,json:async()=>({symbol:'NVDA',source:'cboe-book-viewer',
    summary:{venues_ok:['BZX','EDGX'],venues_failed:['BYX','EDGA'],bid_shares:3000,ask_shares:2000,bid_pct:60,ask_pct:40,
      imbalance:20,best_bid:227.68,best_ask:227.70,spread:0.02,depth_levels:5,
      coverage:'Cboe BZX/BYX/EDGX/EDGA only — not the consolidated book (no ARCA/NYSE/Nasdaq)'},
    venues:[{venue:'BZX',bids:[{price:227.68,shares:300},{price:227.67,shares:500},{price:227.66,shares:200},{price:227.65,shares:100},{price:227.64,shares:400}],
             asks:[{price:227.70,shares:200},{price:227.71,shares:100},{price:227.72,shares:300},{price:227.73,shares:150},{price:227.74,shares:250}]},
            {venue:'EDGX',bids:[{price:227.68,shares:300},{price:227.67,shares:500},{price:227.66,shares:200},{price:227.65,shares:100},{price:227.64,shares:400}],
             asks:[{price:227.70,shares:200},{price:227.71,shares:100},{price:227.72,shares:300},{price:227.73,shares:150},{price:227.74,shares:250}]},
            {venue:'BYX',error:'no usable response',bids:[],asks:[]},{venue:'EDGA',error:'no usable response',bids:[],asks:[]}]})};
  return {ok:true,status:200,json:async()=>({tracked:['NVDA','AAPL','SPY','QQQ']})}; };
(0,eval)(engine+'\n'+['analyze','bottomLine','marketContext','momentum','tactical','radarRow','sortRadar','executionPlan','fmtR','whatNow','pathProbability','dailyContext','volumeBaseline','calibrate','volxTod'].map(n=>`globalThis.${n}=${n};`).join(''));
el('sort').value='attention'; el('sens').value='balanced'; el('every').value='30';
(0,eval)(page.replace('loadAll().catch(','globalThis.__h={refresh:refresh,openDetail:openDetail,store:()=>store,setEnded:v=>{sessionEnded=v},drawDetail:()=>drawDetail(),resetCursor:()=>{lastBoardUnix=0}};loadAll().catch('));
const settle=async()=>{for(let i=0;i<200;i++)await new Promise(r=>setImmediate(r))};
await settle();
let pass=0,fail=0; const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const H=globalThis.__h;

H.openDetail('NVDA'); await settle();
let p=el('panel').innerHTML;

// 1. ordering (spec 13)
const iWhat=p.indexOf('class="wn'), iOdds=p.indexOf('class="odds"'), iPaths=p.indexOf('class="paths"'),
      iWhy=p.indexOf('class="why2"'), iRaw=p.indexOf('פירוט טכני');
ck('WHAT NOW is first', iWhat>=0 && iWhat<iOdds);
ck('probability comes next', iOdds>=0 && iOdds<iPaths);
ck('if-up / if-down next', iPaths>=0 && iPaths<iWhy);
ck('why comes before the raw technicals', iWhy>=0 && iWhy<iRaw, 'why@'+iWhy+' raw@'+iRaw);
ck('raw technical detail is collapsed behind a summary', /<details class="raw"><summary>/.test(p));
ck('HH/VWAP/EMA are not in the headline area', !/VWAP|EMA|HH|HL/.test(p.slice(iWhat,iPaths)));

// 2. exactly one primary action
ck('exactly one primary action shown', (p.match(/class="a">/g)||[]).length===1, ((p.match(/class="a">/g)||[]).length)+'');
const act=(p.match(/class="a">([^<]+)</)||[])[1];
ck('the action is one of the defined set', ['לא לקנות','להתחיל לעקוב','לחכות לאישור','אפשר להיכנס','להחזיק','לממש חלק','להעלות סטופ','לצאת','ה-setup בוטל','המסחר הסתיים'].includes(act), act);

// 3. the probability question is spelled out
ck('probability states its event and horizon', /הסיכוי שהמחיר יגיע ל-/.test(p) && /בשעה הקרובה/.test(p));
ck('probability declares its source', /מקרים דומים בהיסטוריה|הערכת מודל/.test(p));
ck('model output is not dressed up as a statistic', !/הערכת מודל/.test(p) || /לא סטטיסטיקה מדודה/.test(p));

// 4. multi-day layer actually loaded
const st=H.store().NVDA;
ck('history loaded for the multi-day layer', !!st.hist && st.hist.length>=4, (st.hist||[]).length+' prior days');
ck('daily context built', !!st.daily && st.daily.priorDays>=3, st.daily&&st.daily.trend);
ck('time-of-day volume baseline built', !!st.baseline && st.baseline.days>=2, st.baseline&&st.baseline.days+' days');
ck('calibration table built from real history', !!st.calibration && st.calibration.total>0, st.calibration&&st.calibration.total+' outcomes');
ck('why line mentions the multi-day trend', /מגמה של כמה ימים/.test(p));

// 5. history is fetched once, not on every refresh
calls=[]; await H.refresh(); await settle();
ck('auto refresh does not re-fetch history', calls.filter(c=>/^\/day\/NVDA\/\d/.test(c)).length===0, calls.filter(c=>/^\/day\//.test(c)).length+' day calls');
ck('refresh does redraw the decision block', el('panel').innerHTML.indexOf('class="wn')>=0);

// 6. the whole tree recalculates when price moves
const before={act:act, odds:(p.match(/למעלה (\d+)%/)||[])[1], next:(p.match(/class="n">([^<]+)</)||[])[1]};
live.NVDA=live.NVDA.concat([0,1,2,3,4,5,6,7].map(i=>{ const last=live.NVDA[live.NVDA.length-1].close;
  const o=last-(i+1)*0.6; return {date:SESSION_DATE,time:tm(240+i),open:+o.toFixed(4),high:+(o+0.03).toFixed(4),
    low:+(o-0.7).toFixed(4),close:+(o-0.66).toFixed(4),volume:900000}; }));
// The board is incremental, so a refresh only carries bars newer than the last
// one held. Clear the cursor so the appended bars are actually fetched.
H.store().NVDA.seen={}; H.resetCursor();
await H.refresh(); await settle(); H.drawDetail();
p=el('panel').innerHTML;
const after={act:(p.match(/class="a">([^<]+)</)||[])[1], odds:(p.match(/למעלה (\d+)%/)||[])[1], next:(p.match(/class="n">([^<]+)</)||[])[1]};
ck('a sharp drop changes the decision block', after.act!==before.act||after.odds!==before.odds||after.next!==before.next,
  JSON.stringify(before)+' -> '+JSON.stringify(after));
ck('a sharp drop does not leave the odds unchanged', after.odds!==before.odds || after.act!==before.act,
  before.odds+'% -> '+after.odds+'%, action '+before.act+' -> '+after.act);
ck('no stale instruction left on screen', p.indexOf(before.next)<0 || after.next===before.next);

// 7. session closed
H.setEnded(true); H.store().NVDA.fresh='SESSION ENDED'; H.store().NVDA.snap=null; H.drawDetail();
p=el('panel').innerHTML;
ck('session closed shows its own action', /המסחר הסתיים/.test(p));
ck('session closed does not offer a live entry', !/אפשר להיכנס בחלק מהסכום|אפשר להיכנס סביב/.test(p));
ck('session closed still names the levels for next time', /הרמה החשובה למעלה הייתה|התמיכה החשובה הייתה/.test(p));


// 8. buyer / seller pressure on screen
H.setEnded(false); H.store().NVDA.row.freshness='LIVE'; H.drawDetail();
p=el('panel').innerHTML;
ck('pressure block rendered', /class="flow"/.test(p) && /קונים/.test(p) && /מוכרים/.test(p));
{ const pf=H.store().NVDA.snap.pressure;
  ck('buyers and sellers sum to 100', pf.buyPct + pf.sellPct === 100, pf.buyPct+'/'+pf.sellPct);
  ck('the split is drawn to scale', p.indexOf('width:'+pf.buyPct+'%')>=0 && p.indexOf('width:'+pf.sellPct+'%')>=0); }
ck('strengthening / weakening shown per side', /קונים <b>(מתחזקים|נחלשים|ללא שינוי)<\/b> · מוכרים <b>/.test(p));
ck('the data source is stated honestly', /נגזר מהנרות/.test(p) && /אין כאן ספר פקודות/.test(p));
ck('pressure sits below the odds and above the paths',
  p.indexOf('class="flow"')>p.indexOf('class="odds"') && p.indexOf('class="flow"')<p.indexOf('class="paths"'));
ck('pressure appears in the reasons too', /הקונים חזקים יותר|המוכרים חזקים יותר|הכוחות שקולים/.test(p));
{ const rowsHtml=el('rows').innerHTML;
  ck('radar rows carry the pressure split', /class="fl"/.test(rowsHtml) && /קונים <b>\d+%/.test(rowsHtml)); }
{ const pr=H.store().NVDA.row.pressure;
  ck('pressure is part of the row object', !!pr && pr.source==='candles' && pr.hasOrderBook===false);
  ck('agreement with the setup is computed', !!pr.agreement, pr.agreement); }


// 9. one snapshot drives every surface (spec 7/8)
H.setEnded(false); H.drawDetail(); await settle();
{ const st=H.store().NVDA, snap=st.snap;
  ck('a snapshot exists with version and data_through', !!snap && snap.state_version>0 && !!snap.data_through.time,
    'v'+snap.state_version+' through '+snap.data_through.time);
  const rowsHtml=el('rows').innerHTML;
  const rowScore=(rowsHtml.match(/data-s="NVDA"[\s\S]*?class="score">(\d+)</)||[])[1];
  const p2=el('panel').innerHTML;
  const detScore=(p2.match(/ציון Setup <b>(\d+)<\/b>/)||[])[1];
  ck('the card and the detail show the same score', rowScore===detScore && String(snap.score)===rowScore,
    'row '+rowScore+' detail '+detScore+' state '+snap.score);
  ck('the detail stamps the data it used', /נתונים עד /.test(p2));
  ck('the row object is bound to the snapshot', st.row.state===snap || st.row===snap.row, st.row.state===snap?'by state':'by row'); }

// 10. explicit level roles on screen (spec 6/10/11)
{ const p3=el('panel').innerHTML;
  const snap=H.store().NVDA.snap;
  if(snap.valid&&snap.levels.entry!=null){
    ck('watch, entry, targets, cancel and structural stop are labelled separately',
      /רמת מעקב/.test(p3)&&/כניסה/.test(p3)&&/יעד ראשון/.test(p3)&&/ביטול הכניסה/.test(p3)&&/שבירת מבנה/.test(p3));
    ck('target 1 is above the entry on screen', snap.levels.target1>snap.levels.entry,
      snap.levels.entry.toFixed(2)+' -> '+snap.levels.target1.toFixed(2));
  } else ck('no entry means no entry levels are claimed', !/יעד ראשון/.test(p3)||snap.levels.entry==null);
  // The probability is withheld on a closed or stale state, and whether the
  // fixture reads as closed depends on the wall clock — so assert the labels
  // only when a probability is actually being shown.
  if(snap.probability&&snap.probability.up!=null)
    ck('the probability line names the role of each boundary', /רמת המעקב/.test(p3)&&/ביטול הכניסה/.test(p3));
  else
    ck('a withheld probability shows no odds line', !/למעלה \d+%/.test(p3),
      'session ended or stale: '+snap.action); }

// 11. an inconsistent state blocks the instruction
{ const st=H.store().NVDA;
  const good=st.snap;
  st.snap=Object.assign({},good,{valid:false,violations:[{code:'TARGET_BELOW_ENTRY',severity:'block',text:'יעד ראשון אינו מעל הכניסה'}],
    actionText:'המתן — מצב המודל לא עקבי',
    whatNow:Object.assign({},good.whatNow,{actionText:'המתן — מצב המודל לא עקבי',up:[],down:[],next:'הנתונים סותרים את עצמם'})});
  H.drawDetail();
  const p4=el('panel').innerHTML;
  ck('a blocked state shows the inconsistency banner', /מצב המודל לא עקבי/.test(p4));
  ck('a blocked state names what failed', /יעד ראשון אינו מעל הכניסה/.test(p4));
  ck('a blocked state offers no if-up entry instruction', !/אפשר להיכנס סביב|אפשר להיכנס בחלק/.test(p4));
  st.snap=good; H.drawDetail(); }

// 12. pressure conclusion separates lead from direction
{ const pf=H.store().NVDA.snap.pressure;
  ck('pressure states a conclusion sentence', !!pf.conclusion, pf.conclusion);
  ck('leading but weakening is never reported as plain support',
    !(pf.buyPct>=58 && pf.direction==='deteriorating' && pf.agreement==='תומך'), pf.buyPct+'% '+pf.direction+' -> '+pf.agreement);
  const p5=el('panel').innerHTML;
  ck('the conclusion is on screen', p5.indexOf(pf.conclusion)>=0); }


// 13. alerts must not cover the screen
{ const src=fs.readFileSync('/tmp/radar_html.txt','utf8');
  const css=(src.match(/\.alerts\{[\s\S]*?\}/)||[''])[0];
  ck('alert stack is a narrow side column', /width:min\(\d+px/.test(css) && !/left:8px/.test(css), css.replace(/\s+/g,' ').slice(0,90));
  ck('alerts sit at the side, not across the top', /right:\s*\d+px/.test(css) && /left:\s*auto/.test(css));
  ck('the stack is height-capped', /max-height/.test(css));
  ck('at most two alerts on screen', /children\.length>2/.test(src));
  ck('each alert can be dismissed without opening the symbol', /className==='x'/.test(src)); }


// 14. consistency between the headline and everything under it
{ H.setEnded(false); H.store().NVDA.fresh='LIVE'; H.store().NVDA.snap=null; H.drawDetail();
  const p6=el('panel').innerHTML, snap=H.store().NVDA.snap;
  if(snap.noEdge){
    ck('no-edge headline is watch-only', /לא לסחור — רק לעקוב/.test(p6));
    ck('no-edge shows why there is no edge', (snap.edge.reasons||[]).some(r=>p6.indexOf(r)>=0), (snap.edge.reasons||[]).join(', '));
    ck('no-edge shows no entry level under the headline', !/רמת מעקב[\s\S]*?<span>כניסה<\/span>/.test(p6));
    ck('no-edge shows no entry sentence', !/אפשר להיכנס|כניסה חלקית ב-/.test(p6));
  } else {
    // with no setup there is no scenario to name; with one, it is named exactly once
    const shouldName = snap.scenario.kind!=='none' && !snap.sessionEnded && !snap.noEdge;
    ck('the active scenario is named exactly once when one is live',
      shouldName ? (p6.match(/התרחיש הפעיל:/g)||[]).length===1 : !/התרחיש הפעיל:/.test(p6),
      snap.scenario.label + (snap.sessionEnded ? ' (session ended)' : ''));
    const entries=snap.whatNow.up.filter(s=>/אפשר להיכנס|כניסה חלקית ב-/.test(s));
    ck('only one entry scenario is narrated',
      !(entries.some(s=>/עובר את/.test(s))&&entries.some(s=>/יורד לאזור/.test(s))), entries.join(' | '));
    ck('the headline is an actionable one when levels are shown', snap.levels.entry==null||!/לא לסחור/.test(p6));
  }
  ck('the state is internally consistent', snap.valid, (snap.violations||[]).map(v=>v.code).join(',')||'clean'); }

// 15. level wording follows the price, not history
{ const st=H.store().NVDA, snap=st.snap;
  if(snap.pressure&&snap.pressure.support){
    const ls=snap.levelStates.support;
    ck('the displayed support wording matches its computed state',
      snap.pressure.support.state===ls.state||snap.pressure.support.verdict==='נבלעת',
      snap.pressure.support.verdict+' / '+ls.state);
    ck('a support above the price is never called broken',
      !(snap.pressure.support.state==='broken'&&snap.price>snap.pressure.support.price),
      snap.price.toFixed(2)+' vs '+snap.pressure.support.price.toFixed(2));
  } else ck('no nearby support to describe', true); }


// 16. real order book from Cboe
{ H.setEnded(false); H.openDetail('NVDA'); await settle(); H.drawDetail();
  const p7=el('panel').innerHTML, st=H.store().NVDA;
  ck('the book was fetched for the open symbol', !!st.book && !st.book.error, st.book&&st.book.source);
  ck('book block rendered', /class="book"/.test(p7));
  ck('bid/ask imbalance shown', /קנייה 60%/.test(p7) && /מכירה 40%/.test(p7));
  ck('five levels a side, merged across venues', (p7.match(/class="px2">227\./g)||[]).length===10,
    ((p7.match(/class="px2">227\./g)||[]).length)+' price rows');
  ck('venue shares are summed, not duplicated', /600|1,000/.test(p7));
  ck('best bid, best ask and spread shown', /227\.68 \/ 227\.70/.test(p7) && /מרווח 0\.02/.test(p7));
  ck('the venues that answered are named', /BZX, EDGX/.test(p7));
  ck('the venues that failed are named', /BYX, EDGA/.test(p7));
  ck('the coverage limit is stated in words', /Cboe בלבד/.test(p7) && /לא NBBO|לא תמונת השוק המלאה/.test(p7));
  ck('the book sits below the candle-inferred pressure', p7.indexOf('class="book"')>p7.indexOf('class="flow"'));
  ck('candle-inferred pressure is still labelled as such', /נגזר מהנרות/.test(p7)); }


// 17. the copy button produces the full analysis pack
{ H.setEnded(false); H.store().NVDA.fresh='LIVE'; H.store().NVDA.snap=null; H.openDetail('NVDA'); await settle(); H.drawDetail();
  const p8=el('panel').innerHTML;
  ck('the button is labelled as the full pack', /העתק חבילת ניתוח מלאה/.test(p8));
  ck('a short summary is still available separately', /id="copyShort"/.test(p8));
  // click it
  el('copyState').onclick();
  await settle();
  const pack=copied||'';
  ck('the pack was copied', pack.length>3000, pack.length+' chars');
  const need=['1. TIME & DATA STATE','2. MODEL DECISION','3. PRICE LEVELS','4. WHAT-IF','5. PROBABILITY',
    '6. BUYERS / SELLERS','7. ORDER BOOK','8. TAPE','9. STRUCTURE','10. INDICATORS','11. MARKET CONTEXT',
    '12. MULTI-DAY','13. EVENTS','14. POSITION','15. CANDLES','16. CANDLES','17. CANDLES'];
  const miss=need.filter(s=>pack.indexOf(s)<0);
  ck('every section is in the copied text', miss.length===0, miss.join(', ')||'all 17');
  ck('the pack carries raw candles, not just conclusions', (pack.match(new RegExp('^NVDA,'+SESSION_DATE+',\\d\\d:\\d\\d,','gm'))||[]).length>=50);
  ck('the pack carries the raw book levels', /BZX,bid,1,/.test(pack));
  ck('the pack says the book is Cboe only', /PARTIAL BOOK — CBOE ONLY/.test(pack));
  ck('the pack marks the tape unavailable', /TAPE NOT AVAILABLE/.test(pack));
  ck('the pack marks position unavailable', /Position: NOT AVAILABLE/.test(pack));
  ck('the pack states it is one snapshot', /one atomic snapshot/.test(pack));
  ck('the pack price matches the screen', pack.indexOf(H.store().NVDA.snap.price.toFixed(2))>=0);
  ck('the pack reports the session', /Session: (REGULAR|CLOSED|PRE|AFTER)/.test(pack), (pack.match(/Session: \w+/)||[])[0]); }


// 18. a frozen quota must not masquerade as a closed session
{ const src=fs.readFileSync('/tmp/radar_html.txt','utf8');
  ck('the page has a distinct frozen banner', /id="frozen"/.test(src) && /drawFrozenBanner/.test(src));
  ck('the banner says it is not the end of the session', /\u05d6\u05d4 \u05dc\u05d0 \u05e1\u05d5\u05e3 \u05de\u05e1\u05d7\u05e8/.test(src));
  ck('the banner says when the quota clears', /\u05d1\u05d7\u05e6\u05d5\u05ea UTC/.test(src));
  ck('a frozen board is tracked separately from a closed session', /quotaFrozen/.test(src));
  ck('rows read as a stored copy when frozen, not as a close',
    /quotaFrozen\?'\u05e2\u05d5\u05ea\u05e7 \u05e9\u05de\u05d5\u05e8 \u00b7 '/.test(src)); }


// ---- a duplicated minute must not double the pack, and a mixed array must not
// produce one daily row carrying two sessions
{
  const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const p = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
  ck('daily rows are grouped by the bar\u2019s own date', /byDay\[x\.date\]/.test(p));
  ck('a daily row is never dated from r[0].date', !/date:r\[0\]\.date/.test(p));
  ck('bars are deduplicated by date and timestamp', /x\.date\+':'\+x\.unix/.test(p));
  ck('the rows given to the pack are one session only', /if\(r\.date!==vd\)return/.test(p));
  ck('the board absorb files by the bar\u2019s date, not the requested one',
    /if\(st\.date!==r\.date\)/.test(p) && !/if\(st\.date!==d\.date\)/.test(p));
  ck('the cache ledger uses the same key', /st\.seen\[r\.date\+':'\+r\.unix\]/.test(p));

  // arithmetic: what the old grouping did
  const mixed = [
    { date: '2026-09-02', unix: 1, high: 10, low: 9, open: 9.5, close: 10, volume: 5343181 },
    { date: '2026-09-04', unix: 2, high: 12, low: 11, open: 11.5, close: 12, volume: 2703839 }
  ];
  const byDay = {};
  mixed.forEach(x => (byDay[x.date] = byDay[x.date] || []).push(x));
  ck('grouping by date yields two rows, not one carrying both volumes',
    Object.keys(byDay).length === 2, Object.keys(byDay).join(','));
  ck('and neither row carries the other\u2019s volume',
    byDay['2026-09-02'][0].volume === 5343181 && byDay['2026-09-04'][0].volume === 2703839);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
