// WHAT NOW section on screen: ordering, plain language, live recalculation,
// multi-day loading, session-close behaviour.
import fs from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
{ const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
  const radar = JSON.parse(src.split('export const RADAR_HTML = ')[1].trim().replace(/;$/, ''));
  const parts = radar.split('<script>').slice(1).map(s => s.split('</script>')[0]);
  writeFileSync('/tmp/r0.js', parts[0]); writeFileSync('/tmp/r1.js', parts[1]); }
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
let live={ NVDA:day('2026-09-01',203,'up',240,31), AAPL:day('2026-09-01',230,'down',240,41),
  SPY:day('2026-09-01',560,'up',240,51), QQQ:day('2026-09-01',480,'up',240,61) };
hist['2026-09-01']=live.NVDA;

const els={};
function el(id){ if(!els[id]) els[id]={id,innerHTML:'',textContent:'',className:'',value:'',hidden:false,dataset:{},style:{},
  children:[],classList:{add(){},remove(){}},querySelectorAll:()=>[],querySelector:()=>null,setAttribute(){},scrollTop:0,
  appendChild(c){this.children.push(c)},removeChild(c){this.children=this.children.filter(x=>x!==c)},get firstChild(){return this.children[0]},remove(){},
  getBoundingClientRect:()=>({left:0,width:380})}; return els[id]; }
globalThis.document={querySelector:s=>el(s.replace('#','')),getElementById:id=>el(id),
  createElement:()=>({className:'',innerHTML:'',onclick:null,remove(){}}),querySelectorAll:()=>[],addEventListener(){},body:{style:{}},hidden:false};
globalThis.window={addEventListener(){}};
Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{}}},configurable:true,writable:true});
globalThis.location={pathname:'/radar',origin:'https://x',href:''};
const timers=[]; globalThis.setInterval=(f,ms)=>{timers.push({f,ms});return timers.length};
globalThis.setTimeout=()=>0; globalThis.clearTimeout=()=>{};
let calls=[]; let staleSec=30;
globalThis.fetch=async(u)=>{ calls.push(u); await new Promise(r=>setImmediate(r));
  const dm=u.match(/^\/day\/([A-Z\-]+)\/(\d{4}-\d{2}-\d{2})/);
  if(dm) return {ok:true,status:200,json:async()=>({date:dm[2],stale_seconds:0,rows:hist[dm[2]]||[]})};
  const m=u.match(/^\/day\/([A-Z\-]+)/);
  if(m) return {ok:true,status:200,json:async()=>({date:'2026-09-01',stale_seconds:staleSec,rows:live[m[1]]||[]})};
  if(u.startsWith('/days/')) return {ok:true,status:200,json:async()=>({days:DATES.slice().reverse().map(d=>({date:d,bars:390}))})};
  return {ok:true,status:200,json:async()=>({tracked:['NVDA','AAPL','SPY','QQQ']})}; };
(0,eval)(engine+'\n'+['analyze','bottomLine','marketContext','momentum','tactical','radarRow','sortRadar','executionPlan','fmtR','whatNow','pathProbability','dailyContext','volumeBaseline','calibrate','volxTod'].map(n=>`globalThis.${n}=${n};`).join(''));
el('sort').value='attention'; el('sens').value='balanced'; el('every').value='30';
(0,eval)(page.replace('loadAll().catch(','globalThis.__h={refresh:refresh,openDetail:openDetail,store:()=>store,setEnded:v=>{sessionEnded=v},drawDetail:()=>drawDetail()};loadAll().catch('));
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
live.NVDA=live.NVDA.concat([0,1,2,3,4,5].map(i=>{ const last=live.NVDA[live.NVDA.length-1].close;
  const o=last-(i+1)*0.35; return {date:'2026-09-01',time:tm(240+i),open:+o.toFixed(4),high:+(o+0.03).toFixed(4),
    low:+(o-0.4).toFixed(4),close:+(o-0.36).toFixed(4),volume:700000}; }));
await H.refresh(); await settle(); H.drawDetail();
p=el('panel').innerHTML;
const after={act:(p.match(/class="a">([^<]+)</)||[])[1], odds:(p.match(/למעלה (\d+)%/)||[])[1], next:(p.match(/class="n">([^<]+)</)||[])[1]};
ck('a sharp drop changes the decision block', after.act!==before.act||after.odds!==before.odds||after.next!==before.next,
  JSON.stringify(before)+' -> '+JSON.stringify(after));
ck('the odds moved against the up-side', Number(after.odds||0)<=Number(before.odds||100), before.odds+'% -> '+after.odds+'%');
ck('no stale instruction left on screen', p.indexOf(before.next)<0 || after.next===before.next);

// 7. session closed
H.setEnded(true); H.store().NVDA.row.freshness='SESSION ENDED'; H.drawDetail();
p=el('panel').innerHTML;
ck('session closed shows its own action', /המסחר הסתיים/.test(p));
ck('session closed does not offer a live entry', !/אפשר להיכנס בחלק מהסכום|אפשר להיכנס סביב/.test(p));
ck('session closed still names the levels for next time', /הרמה החשובה למעלה הייתה|התמיכה החשובה הייתה/.test(p));


// 8. buyer / seller pressure on screen
H.setEnded(false); H.store().NVDA.row.freshness='LIVE'; H.drawDetail();
p=el('panel').innerHTML;
ck('pressure block rendered', /class="flow"/.test(p) && /קונים/.test(p) && /מוכרים/.test(p));
const pctPair=p.match(/קונים (\d+)%[\s\S]{0,80}?מוכרים (\d+)%/);
ck('buyers and sellers sum to 100', !!pctPair && (+pctPair[1]+ +pctPair[2])===100, pctPair?pctPair[1]+'/'+pctPair[2]:'not found');
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
  ck('the probability line names the role of each boundary', /רמת המעקב/.test(p3)&&/ביטול הכניסה/.test(p3)); }

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
