// TRADER V2 RADAR — radar.html cloned, with the verdict replaced by v192.
// The tests check exactly that: same page, different brain.
import { readFileSync } from 'node:fs';
let pass=0, fail=0;
const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const src=readFileSync('view.js','utf8');
const grab=k=>JSON.parse(src.split('export const '+k+' = ')[1].split('\n')[0].trim().replace(/;$/,''));
const v2=grab('TRADER_V2_RADAR_HTML'), prod=grab('RADAR_HTML');
const body=s=>s.slice(s.indexOf('</head>'));
const css=s=>s.slice(s.indexOf('<style>')+7,s.indexOf('</style>'));

// ---- IT IS THE RADAR
{
  const pc=css(prod), vc=css(v2);
  ck('the production Radar stylesheet is present verbatim', vc.includes(pc.trim().slice(0,8000)), pc.length+' bytes');
  const cls=s=>new Set(s.match(/\.[a-zA-Z][\w-]*(?=[\s{,:])/g)||[]);
  const miss=[...cls(pc)].filter(x=>!cls(vc).has(x));
  ck('no Radar CSS class is missing', miss.length===0, miss.join(' ')||'none');
  ['function render()','function drawDetail()','function openDetail(','function buildSnap(','function spark(',
   'function sortRadar(','function drawHead(','function loadAllThenRepair(','id="sheet"','class="panel"',
   'id="sort"','id="sens"','id="every"','id="alertsBtn"','class="row '].forEach(f=>
    ck('Radar machinery retained: '+f, v2.includes(f)));
  ck('the row markup is the Radar three-column grid', /grid-template-columns:60px 1fr 74px/.test(v2));
  // It is legitimately larger: the production engine (to keep the cloned page
  // working), the v192 engine and replay, and the Live Validation tab.
  ck('the page carries the Radar plus the V2 additions, and nothing wilder',
    v2.length > prod.length && v2.length < prod.length * 1.6, prod.length+' -> '+v2.length);
}

// ---- THE BRAIN IS v192
{
  ck('the v192 engine is bundled', /function decide\(rows, ctx, prior, config\)/.test(v2) && /function runV2\(rows, engine, opts\)/.test(v2));
  ck('it carries the v192 frozen-trigger substitution', /trigger: plan\.entry/.test(v2));
  ck('it carries the v192 authoritative chase guard', /extAuth > sc\.extension/.test(v2));
  ck('the verdict comes from v2ViewModel', /function v2ViewModel/.test(v2));
  const seam0=v2.slice(v2.indexOf('function buildSnap'), v2.indexOf('function v2ViewModel'));
  ck('buildSnap attaches the V2 model without overwriting production',
    /st\.row\.v2=v2ViewModel/.test(seam0) && !/st\.row\.status=/.test(seam0.slice(seam0.indexOf('TRADER V2'))));
  ck('the view model uses closed candles only', /rows\.slice\(0,-1\)/.test(v2));
  ck('only RECLAIM_CONTINUATION can be actionable', /'RECLAIM_CONTINUATION'/.test(v2) && /משפחת צל/.test(v2));
}

// ---- V2 SEMANTICS IN THE FAMILIAR SLOTS
{
  ck('the six status slots carry V2 meanings', /READY:'BUY NOW'/.test(v2) && /CLOSE:'קרוב מאוד'/.test(v2) && /AVOID:'לא נכנסים'/.test(v2));
  ['טריגר','עכשיו','סטופ','סיכון/מניה','T1','T2','R:R תוכנית','R:R בפועל','מרדף','ביטול','גיל סטאפ','setupId'].forEach(f=>
    ck('plan grid field: '+f, v2.includes(f)));
  ck('one plan renderer feeds both the row and the sheet', /function v2PlanGrid/.test(v2)
    && (v2.match(/v2PlanGrid\(/g)||[]).length>=3);
  ck('the row shows the plan when it matters', /function v2RowExtra/.test(v2));
  ck('the sheet leads with the V2 verdict', /v2Html\+\s*\n\s*'<div class="pstat"/.test(v2));
  ck('the sheet shows what is still required', /עדיין נדרש/.test(v2));
  ck('and the decision transitions for the symbol', /מעברי החלטה היום/.test(v2));
  ck('chase is explained in the sheet', /מהטריגר לא תוצע כניסה/.test(v2));
}

// ---- EXECUTION STATE
{
  ck('marking a BUY as taken is possible from row and sheet', (v2.match(/v2take/g)||[]).length>=3);
  ck('an active setup shows ACTIVE, never another BUY', /if\(pos&&s\.setupId===pos\.setupId\)\{status='ACTIVE'/.test(v2));
  ck('a consumed setup can never be entered again', /else if\(spent\)\{status='AVOID'/.test(v2));
  ck('closing a position consumes the setup', /v2Consumed\[v2Pos\[s\]\.setupId\]=true/.test(v2));
  ck('live R and distances are shown while active', /R חי/.test(v2) && /לסטופ/.test(v2) && /ל-T1/.test(v2));
}

// ---- LOGS, LABEL, SAFETY
{
  ck('an immutable row per evaluated closed candle', /v2Log\.push\(rec\)/.test(v2) && /Object\.freeze\(\{seq:v2Log\.length\+1/.test(v2));
  ck('a separate transition log', /if\(changed\)v2Trans\.push\(rec\)/.test(v2));
  ck('rows record what was waited for', /waiting_for:need\.join/.test(v2));
  ck('labelled TRADER V2 — EXPERIMENTAL', /TRADER V2 — EXPERIMENTAL/.test(v2));
  ck('the frozen engine is named on the page', /Trader V2 v192 · engine FROZEN/.test(v2));
  ck('production Radar is one click away', /href="\/radar"/.test(v2));
  ['submitOrder','ibkr','alpaca','placeTrade'].forEach(w=>
    ck('no execution path: '+w, !new RegExp('\\b'+w+'\\b','i').test(v2)));
}

// ---- SOURCE PURITY: no production field can enter the V2 view model
{
  // bound the slice to the function body by brace matching, so the assertion
  // measures v2ViewModel and not whatever follows it
  const vmStart=v2.indexOf('function v2ViewModel');
  let depth=0, vmEnd=vmStart;
  for(let i=v2.indexOf('{',vmStart);i<v2.length;i++){
    if(v2[i]==='{')depth++; else if(v2[i]==='}'){depth--; if(!depth){vmEnd=i+1;break}} }
  const vm=v2.slice(vmStart, vmEnd);
  // st.rows is the closed-candle array the page already loaded; that is the
  // engine's INPUT, not a production verdict. The forbidden things are
  // production's computed opinions.
  ['buildTickerState','radarRow','executionPlan','st.snap','st.row.','r.prod','marketCtxFor','st.A','analyze('].forEach(f=>
    ck('v2ViewModel never touches '+f, !vm.includes(f), f));
  ck('v2ViewModel is built from runV2 and computeBars only', /runV2\(closed/.test(vm) && /computeBars\(closed\)/.test(vm));
  ck('it carries its own indicator values', /ind:\{vwap:b\.vwap,ema9:b\.ema9,ema20:b\.ema20,atr:b\.atr/.test(vm));
  ck('and labels its source', /source:'Trader V2 v192'/.test(vm));

  // buildSnap must no longer overwrite anything
  const seam=v2.slice(v2.indexOf('function buildSnap'), v2.indexOf('function v2ViewModel'));
  ck('buildSnap does NOT overwrite the production verdict', !/st\.row\.status=v2\./.test(seam) && !/st\.row\.score=v2\./.test(seam));
  ck('production is preserved under its own key', /st\.row\.prod=\{status:st\.row\.status/.test(seam));
  ck('the V2 model is attached, not merged', /st\.row\.v2=v2ViewModel/.test(seam));
  ck('nothing named prodStatus survives', !/prodStatus/.test(v2));

  // warm-up
  ck('a warm-up model is returned below the bar minimum', /if\(closed\.length<V2_MIN_BARS\)/.test(v2) && /warmup:true/.test(v2));
  ck('the row shows V2 מתחמם with the bar count', /V2 מתחמם/.test(v2) && /closedBars\+'\/'\+v\.need/.test(v2));
  ck('a warming row shows no V2 status, score or plan',
    /if\(!v\|\|!v\.ready\)return '<span class="st bg-NODATA">V2 מתחמם/.test(v2)
    && /if\(!v\|\|!v\.ready\)return '<div class="score"[^>]*>—/.test(v2));
  ck('and offers nothing actionable', /nothing here may look like a V2 recommendation/.test(v2));

  // production separation
  ck('production appears only under an explicit comparison label',
    (v2.match(/PRODUCTION TRADER — להשוואה בלבד/g)||[]).length>=2);
  ck('the sheet labels both sources', /Source: Trader V2 v192/.test(v2) && /Source: Production Trader/.test(v2));
  ck('the V2 card shows the indicators v192 consumed', /VWAP '\+n2v\(v2\.ind\.vwap\)/.test(v2));
  ck('when v192 has no plan the card says so instead of borrowing one',
    /אין תוכנית — v192 לא מציג כניסה, סטופ או יעדים/.test(v2));
  ck('the row badge, why, meta and score all read r.v2',
    /function v2Badge/.test(v2) && /function v2Why/.test(v2) && /function v2Meta/.test(v2) && /function v2Score/.test(v2));
}


// ---- the page must present ONE status: V2's. Reading Production's here is
// what made the BUY NOW filter return unrelated symbols.
{
  const pageJs = v2.slice(v2.indexOf('function drawHead'));
  ck('a single helper defines the row status', /function v2Status\(r\)\{/.test(v2)
  && /if\(r\.v2\.warmup\)return 'WARMUP'/.test(v2) && /r\.v2\.ready \? r\.v2\.status : 'ERROR'/.test(v2));
ck('an engine failure is its own state, never shown as warming up',
  /if\(r\.v2\.error\)return 'ERROR'/.test(v2) && /שגיאת מנוע V2/.test(v2));
ck('the view model call is guarded so one bad symbol cannot look quiet',
  /catch\(e\)\{ st\.row\.v2=\{ready:false,error:/.test(v2));
ck('the error carries where it came from', /where:'runV2'/.test(v2) && /where:'v2ViewModel'/.test(v2));
  ck('the counts strip counts by the V2 status', /rows\.filter\(function\(r\)\{return v2Status\(r\)===k\}\)/.test(v2));
  ck('the filter filters by the V2 status', /list\.filter\(function\(r\)\{return v2Status\(r\)===filterStatus\}\)/.test(v2));
  ck('sorting ranks by the V2 status and V2 score, errors first so they are seen',
    /V2RANK=\{ERROR:0,READY:1,ACTIVE:2,CLOSE:3,WATCH:4,QUIET:5,AVOID:6,WARMUP:7,GAP:8\}/.test(v2)
    && /v2ScoreOf\(b\)-v2ScoreOf\(a\)/.test(v2));
  ck('the page does not call the production sortRadar', !/sortRadar\(rows/.test(v2));
  ck('the sheet header badge is the V2 status', /STATUS_TXT\[v2Status\(r\)\]/.test(v2));
  ck('warming-up, gapped and failing symbols each get their own bucket',
    /'WARMUP','GAP','ERROR'\]/.test(v2) && /WARMUP:'מתחמם'/.test(v2) && /ERROR:'שגיאה'/.test(v2));
  // no rendering path may read r.status any more
  const reads = (pageJs.match(/\br\.status\b/g) || []).length;
  ck('no render path reads the production r.status', reads === 0, reads + ' remaining');
  ck('the clipboard summary reports the V2 status', /V2 STATUS: /.test(v2) && /V2 SCORE: /.test(v2));
}


// ---- DATA-GAP INVARIANT
{
  ck('a gap check runs before the engine is asked for a verdict', /var gap=v2FindGap\(closed\);/.test(v2)
    && v2.indexOf('var gap=v2FindGap') < v2.indexOf('states=runV2(closed'));
  ck('a gap returns dataGap and no decision', /return \{ready:false,dataGap:true/.test(v2));
  ck('the row says DATA GAP and names the missing minutes', /DATA GAP · חסר/.test(v2));
  ck('a gapped symbol gets its own status, not WAIT', /if\(r\.v2\.dataGap\)return 'GAP'/.test(v2));
  ck('and its own bucket in the counts strip', /GAP:'פער נתונים'/.test(v2) && /'WARMUP','GAP','ERROR'\]/.test(v2));
  ck('a late start is short, not gapped', /if\(first<.09:30.\|\|last>.15:59.\)return null/.test(v2));
  ck('the sheet explains why no decision was made', /הדקות החסרות נמצאות בתוך החלון שהאינדיקטורים קוראים/.test(v2));
  ck('a gap blocks only inside the indicator window', /GAP_SENSITIVE_BARS=25/.test(v2)
    && /recent=gap\.missing\.filter/.test(v2) && /if\(recent\.length\)/.test(v2));
  ck('an older gap is disclosed and the decision proceeds', /staleGap=\{missing:gap\.missing/.test(v2)
    && /מחוץ לחלון האינדיקטורים/.test(v2));
  ck('the disclosure names how many minutes and how old', /staleGap\.missing\.length/.test(v2)
    && /oldestAgeMin/.test(v2));
  ck('the reasoning is recorded, with the measured impact', /moved VWAP by/.test(v2) && /noise/.test(v2));
}


// ---- a missing OPENING minute is invisible to the between-first-and-last check
ck('a series that does not start at 09:30 during RTH is flagged', /openMissing=\(!sessionEnded/.test(v2));
ck('and the card names it', /הסדרה מתחילה ב-.\+v2\.openMissing/.test(v2) || /v2\.openMissing\?/.test(v2));
ck('the card shows the exact bar span the engine consumed', /v2\.firstBar\+. → .\+v2\.lastBar/.test(v2));
ck('relative volume on the row comes from the V2 bar, not Production volx',
  /v\.ind\.relVol/.test(v2) && !/r\.volx/.test(v2.slice(v2.indexOf("function v2Meta"), v2.indexOf("function v2Score"))));


// ---- an incremental read can never recover a late-arriving minute, because
// `since` has already passed it. The store was complete (a full read reported
// missing 0) while this page held six frozen holes. So a gapped cache is
// discarded and the whole session re-read.
ck('the page detects a hole in its own rows', /function rowsHaveHole/.test(v2));
ck('and asks for the FULL session when it finds one', /var full=!have\|\|rowsHaveHole\(st\.rows\)/.test(v2));
ck('since is sent only when the cache is continuous', /\(!full&&last&&last\.unix\?.&since=.\+last\.unix:..\)/.test(v2));
ck('and the incremental merge is skipped on a full read', /d\.incremental&&st\.date===d\.date&&!full/.test(v2));


ck("Production self-check banners stay inside the Production section",
  v2.includes("var badge='';") && v2.includes('prodBadge=snap.valid')
  && v2.includes('Production: מצב המודל לא עקבי')
  && v2.includes("Source: Production Trader</b>'+prodBadge"));
ck('and never render above the V2 card', !/badge\+.*v2Html/.test(v2));


// ---- EVERY path that reads incrementally must repair a hole. I fixed
// loadSymbol and left the board path, which is the one that actually fills the
// radar, so a missing 09:42 survived while /view showed all thirty candles.
{
  const incremental = [...v2.matchAll(/'?&?since='?\+/g)].length;
  // The board is the reader that fills every row on this page. It must never
  // be incremental: a minute delivered late is undeliverable to a page that
  // has moved past it, which is how /view showed 36 candles while this page
  // judged the session on 27.
  ck('the board is always read in full, never with since', !/'since='\+have/.test(v2));
  ck('and each pass starts from empty so nothing stale survives',
    /st\.rows=\[\]; st\.seen=\{\}/.test(v2) && /every pass is a full read/.test(v2));
  ck('there is a single hole detector', (v2.match(/function rowsHaveHole/g) || []).length === 1);
  ck('the per-symbol read asks in full when its rows have a hole',
    /var full=!have\|\|rowsHaveHole\(st\.rows\)/.test(v2));
  ck('the board read repairs holed symbols after merging',
    /var holed=symbols\.filter/.test(v2) && /rowsHaveHole\(st\.rows\)/.test(v2)
    && /loadSymbol\(s\)\.catch/.test(v2));
  ck('the repair is bounded so a bad session cannot flood the worker', /holed\.slice\(0,12\)/.test(v2));
  ck('and costs nothing when every symbol is continuous', /if\(holed\.length\)\{/.test(v2));
  ck('both incremental readers are covered', incremental >= 2, incremental + ' since-based reads');
}


// ---- Live Validation: a QA export of state that already exists
{
  const lv = v2.slice(v2.indexOf('function lvBuild'), v2.indexOf('function drawDetail'));
  ck('a Live Validation tab sits beside the buy card', /id="openLive">Live Validation/.test(v2)
    && /lvOpen=true;drawLive\(\)/.test(v2));
  ck('it renders through the detail router like the buy card', /if\(lvOpen\)return drawLive\(\)/.test(v2));
  ck('opening another symbol resets it', /buyOpen=false; lvOpen=false;/.test(v2));
  ck('it makes no request of its own', !/\bj\(/.test(lv) && !/fetch\(/.test(lv));
  ck('the V2 block reads the existing view model', lv.includes('var v2 = r && r.v2') && lv.includes('plan = v2 && v2.plan'));
  ck('indicators come from the values the engine consumed', lv.includes('ind && ind.vwap') && lv.includes('ind && ind.ema9'));
  ck('market context comes from the existing object', lv.includes('marketCtxFor(sym)'));
  ck('candles come from the already-loaded array', lv.includes('var closed = rows || []') && lv.includes('closed.slice(-20)'));
  ck('the candle table carries no derived columns',
    !/body_pct|upper_wick|lower_wick|vol_x/.test(lv)
    && /symbol,date,time,open,high,low,close,volume/.test(v2));
  ['Trigger','Stop','Invalidation','T1','T2','Risk/share','Plan RR','Executable RR','Chase ATR',
   'SetupId','Setup age','Required score','Coverage %','Duplicate timestamps','Series continuous',
   'Market regime','Sector ETF'].forEach(f => ck('field present: '+f, lv.includes(f)));
  ck('a missing field shows an em dash', lv.includes("return '—'") || lv.includes('— ') || /'—'/.test(lv));
  ck('screen and clipboard render from one object', /function lvText\(b\)/.test(lv)
    && /lvText\(b\)/.test(v2));
  ck('the export uses the required headings', /=== LIVE VALIDATION · /.test(lv)
    && /=== END LIVE VALIDATION ===/.test(lv));
  ck('the one derived value is declared on screen', /חריג יחיד: ספירת חותמות כפולות/.test(v2));
  ck('copying falls back when the clipboard API is unavailable', /execCommand\('copy'\)/.test(v2));
}


// ---- global Live Validation export
{
  const g = v2.slice(v2.indexOf('var LV_LABEL'), v2.indexOf('function drawDetail'));
  ck('a global export button sits in the header', /id="lvAll"/.test(v2)
    && /הורד Live Validation — כל המניות/.test(v2) && /b\.onclick=lvAllDownload/.test(v2));
  ck('it exports every loaded symbol', g.includes('symbols.filter(function(s){return store[s]})'));
  ck('it reuses the per-symbol builder so the two cannot disagree',
    g.includes('lvBuild(sym,st,st.row,st.snap,st.rows||[])'));
  ck('it refetches nothing and re-evaluates nothing',
    !/\bj\(/.test(g) && !/fetch\(/.test(g) && !/runV2\(/.test(g) && !/loadSymbol\(/.test(g));
  ck('differing data-through stamps are preserved, not smoothed',
    /"Data through" may differ/.test(g) && /preserved deliberately/.test(g));
  ['Export time ET','Export time local','App build','Trader V2 version','Total symbols',
   'Status counts'].forEach(f => ck('header field: '+f, g.includes(f)));
  ['WARMING','DATA ISSUE','QUIET','WATCH','VERY CLOSE','BUY NOW','ACTIVE','AVOID'].forEach(s =>
    ck('status count: '+s, g.includes("'"+s+"'")));
  ck('each block carries the required sections only',
    /'TIME':1,'TRADER V2':1,'SESSION DATA':1,'DATA COVERAGE':1,'INDICATORS':1/.test(g));
  ck('the per-symbol heading matches the spec', /'SYMBOL: '\+sym/.test(g));
  ck('the filename is ET-stamped', /live-validation-.\+o\.year/.test(g) && /'-ET\.txt'/.test(g));
  ck('it downloads a plain-text file', /type:'text\/plain;charset=utf-8'/.test(g) && /a\.download=name/.test(g));
  ck('an empty page says so instead of downloading nothing', /אין מניות טעונות/.test(g));
}


ck('the toolbar wraps so a long control cannot be pushed off screen',
  /\.ctrl\{[^}]*flex-wrap:wrap/.test(v2));
ck('the global export has its own row and reads as an action',
  /class="mini-btn lvbtn" id="lvAll"/.test(v2) && /\.lvbtn\{[^}]*font-weight:700/.test(v2));
ck('and states what it does beside it', /בלי משיכה מחדש/.test(v2));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
