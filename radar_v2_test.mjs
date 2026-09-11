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
  // Before a BUY the grid shows the PLAN only. close-stop and an "executable"
  // R:R from a price below the trigger are gone from the main card.
  ['כניסה מתוכננת','סטופ','סיכון/מניה בתוכנית','T1','T2','R:R בתוכנית','ביטול','גיל סטאפ','setupId'].forEach(f=>
    ck('plan grid field: '+f, v2.includes(f)));
  ck('plan risk is |entry - stop|, not close - stop',
    v2.includes('planRisk:s.plan?Math.abs(s.plan.entry-s.plan.stop):null') && v2.includes('n2v(v2.planRisk)'));
  ck('executable figures appear only on a real BUY',
    v2.includes("var actionable=v2.status==='READY'||v2.status==='ACTIVE'")
    && v2.includes('if(actionable&&price!=null&&(price-p.stop))')
    && v2.includes('R:R בביצוע'));
  ck('a negative extension is distance below the trigger, not chase',
    v2.includes('מרחק לטריגר') && v2.includes("v2.ext<0"));
  ck('a positive extension is still called chase', v2.includes('ATR מעל'));
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
  ck('a warming row shows no status, score or plan, and says what it waits for',
    /ממתין לנתונים/.test(v2) && /ממתין ל-'\+v\.need\+' נרות סגורים/.test(v2)
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
  ck('the counts strip counts by the user bucket', /rows\.filter\(function\(r\)\{return v2UserBucket\(r\)===k\}\)/.test(v2));
  ck('the filter filters by the user bucket', /list\.filter\(function\(r\)\{return v2UserBucket\(r\)===filterStatus\}\)/.test(v2));
  ck('sorting ranks by the user bucket, actionable first',
    /V2RANK=\{READY:0,IN_TRADE:1,NEAR:2,WATCH:3,NOT_NOW:4,NODATA:5\}/.test(v2)
    && /v2ScoreOf\(b\)-v2ScoreOf\(a\)/.test(v2));
  ck('the page does not call the production sortRadar', !/sortRadar\(rows/.test(v2));
  ck('the sheet header badge is the V2 status', /STATUS_TXT\[v2Status\(r\)\]/.test(v2));
  // Four engine data-words became one user bucket; the distinction survives in
  // the badge text and in Live Validation.
  ck('data states collapse into one bucket, still distinguished on the card',
    /'NOT_NOW','NODATA'\]/.test(v2) && /בעיית נתונים/.test(v2) && /שגיאה/.test(v2));
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
  ck('a gap is still named on the card', /v&&v\.dataGap\?'בעיית נתונים'/.test(v2));
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
  && v2.includes("Source: Production Trader</b>'+(typeof prodBadge==='string'?prodBadge:'')"));
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
  ck('candles come from the already-loaded array', lv.includes('var closed = rows || []')
    && lv.includes('closed.slice(Math.max(0, endIdx - 19), endIdx + 1)'));
  ck('the candle table carries no derived columns',
    !/body_pct|upper_wick|lower_wick|vol_x/.test(lv)
    && /symbol,date,time,open,high,low,close,volume/.test(v2));
  // The three misleading labels are gone by design: 'Risk/share' meant
  // close-stop, 'Executable RR' was measured from a price below the trigger,
  // and 'Chase ATR' was printed for negative values.
  ['Trigger','Stop','Invalidation','T1','T2','Plan RR','plan_risk_per_share',
   'distance_current_to_stop','RR from last closed price','distance_to_trigger_ATR','chase_ATR',
   'engine_state_raw','display_state_user_facing','Freshness','Last valid V2 state',
   'Family trade status','Requirement source',
   'SetupId','Setup age','Required score','Coverage %','Duplicate timestamps','Series continuous',
   'Market regime','Sector ETF'].forEach(f => ck('field present: '+f, lv.includes(f)));
  ['Risk/share:','Executable RR','Chase ATR'].forEach(f =>
    ck('misleading label removed: '+f, !lv.includes(f)));
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


// ---- THE SEVEN NAMED REGRESSION CASES ------------------------------------
{
  // v2PlanGrid is defined BEFORE the view model in the bundle, so slicing
  // between them by index gave an empty string. Bound the function by brace
  // matching instead.
  const vmStart2 = v2.indexOf('function v2ViewModel');
  let d2 = 0, vmEnd2 = vmStart2;
  for (let i = v2.indexOf('{', vmStart2); i < v2.length; i++) {
    if (v2[i] === '{') d2++; else if (v2[i] === '}') { d2--; if (!d2) { vmEnd2 = i + 1; break; } } }
  const vm = v2.slice(vmStart2, vmEnd2);

  // 1 — same-snapshot consistency
  ck('1 · the model pins price and indicators to one closed bar',
    /price:b\.close/.test(vm) && /barTime:b\.time/.test(vm)
    && /ind:\{vwap:b\.vwap,ema9:b\.ema9,ema20:b\.ema20,atr:b\.atr/.test(vm));
  ck('1 · the export resolves its bar by that same barTime, not by taking the newest row',
    /closed\[q\]\.time === v2\.barTime/.test(v2));
  ck('1 · the plan grid is fed v2.price, never a separate lookup',
    (v2.match(/v2PlanGrid\(v2,\s*v2\.price\)/g) || []).length >= 1
    && !/v2PlanGrid\(v2,\s*lastC/.test(v2));

  // 2 — stale with an underlying READY
  ck('2 · staleness blocks actionability without touching the verdict',
    /var fresh=st\.fresh\|\|''/.test(vm)
    && /if\(fresh==='STALE'&&\(status==='READY'\|\|status==='CLOSE'\|\|status==='ACTIVE'\)\)/.test(vm)
    && /status='STALE'/.test(vm));
  ck('2 · the engine verdict is preserved as diagnostic context',
    /engineStatus:engineStatus,engineWhy:engineWhy/.test(vm));
  ck('2 · the card names the last valid state', /מצב V2 אחרון:/.test(v2));
  ck('2 · a stale card cannot be BUY NOW', /if\(r\.v2\.staleBlocked\)return 'STALE'/.test(v2));
  // The radar itself has no BUY alert path — alerts live on the single-symbol
  // page. What the radar must guarantee is that nothing downstream can read an
  // actionable status off a stale card, and v2Status is the single source of
  // that status.
  ck('2 · the radar has no BUY alert path of its own to leak through',
    !/function alertIf/.test(v2));
  ck('2 · every consumer reads the gated status through one helper',
    /function v2Status\(r\)\{/.test(v2) && /if\(r\.v2\.staleBlocked\)return 'STALE'/.test(v2));

  // 3 — REVERSAL waiting for its higher low
  ck('3 · an early-return requirement is carried into the user-facing field',
    /requirement:\(function\(\)\{/.test(vm) && /if\(need\.length\)return need;/.test(vm)
    && /return \[nx\];/.test(vm));
  ck('3 · an R:R failure is named as a requirement, not left blank',
    /Plan R:R ≥ '\+CFG\.minRR/.test(vm));
  ck('3 · an unresolved condition can never render QUIET',
    /else if\(s\.setup&&\(s\.next\|\|''\)\.trim\(\)\)\{status='WATCH'/.test(vm));
  ck('3 · the requirement is shown on the row', /צריך לקרות:<\/b> '\+v2\.requirement\.join/.test(v2));

  // 4 — a shadow family
  ck('4 · shadow is a stated flag on the model', /tradeEnabled:tradable, shadow:!!\(s\.setup&&!tradable\)/.test(vm));
  ck('4 · a shadow setup reads לא עכשיו on the card',
    /!tradable\s*\?\s*'NOT_NOW'/.test(v2));
  // Trade eligibility is stated whenever a setup exists, so "no badge" never
  // has to be interpreted. Three states, not two.
  // Superseded by the five-word status: the card no longer badges eligibility
  // at all, because a shadow setup now simply reads לא עכשיו.
  ck('4 · eligibility is stated in the technical details, not on the card',
    /משפחה ניתנת למסחר/.test(v2) && /SHADOW — משפחת מחקר/.test(v2));
  ck('4 · with no setup the card says לא עכשיו and explains, rather than badging',
    /if\(!v2\|\|!v2\.family\)return '';/.test(v2) && /NOT_NOW:'לא עכשיו'/.test(v2));
  ck('4 · the badge is driven by the model flag, not by naming the families in the UI',
    !/v2ShadowTag[\s\S]{0,400}RECLAIM_CONTINUATION/.test(v2));
  ck('4 · the five statuses are styled distinctly',
    /\.u-READY\{[^}]*var\(--up\)/.test(v2) && /\.u-NEAR\{/.test(v2)
    && /\.u-WATCH\{/.test(v2) && /\.u-NOT_NOW\{/.test(v2) && /\.u-IN_TRADE\{/.test(v2));
  ck('4 · the detail sheet states it in the same words',
    (v2.match(/v2ShadowTag\(v2\)/g) || []).length >= 2);
  ck('4 · shadow READY still cannot become BUY NOW',
    /else if\(s\.state==='READY'&&!tradable\)\{status='AVOID'/.test(vm));

  // 5 — price below the trigger
  ck('5 · no executable figure before an actionable state',
    /var actionable=v2\.status==='READY'\|\|v2\.status==='ACTIVE'/.test(v2)
    && /if\(actionable&&price!=null&&\(price-p\.stop\)\)/.test(v2));
  ck('5 · a negative extension reads as distance below the trigger',
    /מרחק לטריגר<b>'\+n2v\(Math\.abs\(v2\.ext\)\)\+' ATR מתחת/.test(v2));

  // 6 — plan risk
  ck('6 · plan risk is |entry - stop| and sits beside plan R:R',
    /planRisk:s\.plan\?Math\.abs\(s\.plan\.entry-s\.plan\.stop\):null/.test(vm)
    && /סיכון\/מניה בתוכנית<b>'\+n2v\(v2\.planRisk\)/.test(v2));

  // 7 — RECLAIM unchanged
  ck('7 · a fresh RECLAIM READY is still BUY NOW',
    /else if\(s\.state==='READY'&&tradable\)\{status='READY'/.test(vm));
  ck('7 · the freshness gate runs after the verdict and only on actionability',
    vm.indexOf("else if(s.state==='READY'&&tradable)") < vm.indexOf("if(fresh==='STALE'"));
  ck('7 · the traded family is unchanged', /'RECLAIM_CONTINUATION'/.test(vm));
}


// ---- the all-symbols export carries each symbol's candle window
{
  const g2 = v2.slice(v2.indexOf('var LV_LABEL'), v2.indexOf('function drawDetail'));
  ck('every symbol block ends with the candle table',
    g2.includes("L.push('LAST 20 CLOSED 1M CANDLES')")
    && g2.includes("L.push('symbol,date,time,open,high,low,close,volume')"));
  ck('rows are emitted from the snapshot window, not re-derived',
    /b\.last20\.forEach\(function\(x\)\{/.test(g2)
    && /\[sym,x\.date,x\.time,x\.open,x\.high,x\.low,x\.close,x\.volume\]\.join\(','\)/.test(g2));
  ck('a symbol with no closed candles says so rather than emitting a bare header',
    g2.includes("'(no closed candles)'"));
  ck('the global export still makes no request', !/\bj\(/.test(g2) && !/fetch\(/.test(g2));

  // the window itself
  ck('the window ENDS at the snapshot bar, so the last row equals Last closed candle time',
    /if \(closed\[z\] === lastC\) \{ endIdx = z; break; \}/.test(v2)
    && /closed\.slice\(Math\.max\(0, endIdx - 19\), endIdx \+ 1\)/.test(v2));
  ck('it is not a plain tail slice that could include a newer row',
    !/var last20 = closed\.slice\(-20\)/.test(v2));
  ck('duplicates inside the window are preserved deliberately', /a duplicate is a finding/.test(v2));
}


// ---- THE FIVE USER-FACING STATUSES -------------------------------------
{
  const vmS = v2.indexOf('function v2ViewModel');
  let d3 = 0, vmE = vmS;
  for (let i = v2.indexOf('{', vmS); i < v2.length; i++) {
    if (v2[i] === '{') d3++; else if (v2[i] === '}') { d3--; if (!d3) { vmE = i + 1; break; } } }
  const vm2 = v2.slice(vmS, vmE);

  ck('exactly five user statuses exist',
    /U_TXT=\{NOT_NOW:'לא עכשיו',WATCH:'מעקב',NEAR:'קרוב לכניסה',READY:'מוכן לכניסה',IN_TRADE:'בעסקה'\}/.test(v2));
  ck('they are derived from the internal result, not recomputed',
    /var userStatus =/.test(vm2) && /status==='ACTIVE'\s*\?\s*'IN_TRADE'/.test(vm2));
  ck('a shadow-only setup can never read מעקב or קרוב לכניסה',
    /!tradable\s*\?\s*'NOT_NOW'/.test(vm2)
    && vm2.indexOf('!tradable') < vm2.indexOf("status==='CLOSE'"));
  ck('stale is not a sixth trading status; it reads לא עכשיו with a data warning',
    /status==='STALE'\s*\?\s*'NOT_NOW'/.test(vm2) && /class="freshwarn"/.test(v2));

  // engine jargon off the decision surface
  // The spec KEEPS these in Live Validation; what must be clean is the card.
  const cardZone = v2.slice(v2.indexOf('function v2Badge'), v2.indexOf('function lvNum'));
  ['SHADOW — NOT TRADE ENABLED','TRADE ENABLED — ניתן למסחר','ARMED','SETUP'].forEach(w =>
    ck('jargon absent from the card surface: '+w, !cardZone.includes(w)));
  ck('family, engine state, setupId and shadow live in a collapsed section',
    /<details class="tech"><summary>פרטים טכניים<\/summary>/.test(v2)
    && /משפחה <b>/.test(v2) && /מצב מנוע <b>/.test(v2) && /v\.setupId\?/.test(v2));

  // score
  ck('the score is shown only for a real tradable setup that is not לא עכשיו',
    /if\(v2\.tradeEnabled&&v2\.family&&u!=='NOT_NOW'\)/.test(v2));
  ck('0\/10 is never printed beside no setup', !/'ציון 0\/10'/.test(v2));

  // the three questions, in order
  const row = v2.slice(v2.indexOf('function v2RowExtra'), v2.indexOf('function v2Decide') > 0
    ? v2.indexOf('function v2Decide') : v2.indexOf('function v2RowExtra') + 2200);
  ck('the card answers why before what-must-happen', row.indexOf('למה:') < row.indexOf('צריך לקרות:'));
  ck('and the plan comes last', row.indexOf('צריך לקרות:') < row.indexOf('v2PlanGrid'));
  ck('a shadow plan is not shown on the decision surface',
    /if\(v2\.plan&&v2\.tradeEnabled&&u!=='NOT_NOW'\)/.test(v2));

  // colour
  // WATCH and NOT_NOW were darkened for contrast, so they are literals now.
  // What must hold is that green belongs to מוכן לכניסה alone.
  ck('green is reserved for מוכן לכניסה', /\.u-READY\{background:var\(--up\)/.test(v2)
    && !/\.u-(WATCH|NEAR|NOT_NOW|IN_TRADE)\{background:var\(--up\)/.test(v2));
  ck('בעסקה has its own treatment', /\.u-IN_TRADE\{background:#1D4ED8/.test(v2));

  // counts, filters and ordering speak the same five words
  ck('the counts strip uses the user buckets',
    /order=\['READY','NEAR','WATCH','IN_TRADE','NOT_NOW','NODATA'\]/.test(v2)
    && /v2UserBucket\(r\)===k/.test(v2));
  ck('the filter and the sort use them too', /v2UserBucket\(r\)===filterStatus/.test(v2)
    && /V2RANK=\{READY:0,IN_TRADE:1,NEAR:2,WATCH:3,NOT_NOW:4,NODATA:5\}/.test(v2));

  // Live Validation keeps everything
  const lv2 = v2.slice(v2.indexOf('function lvBuild'));
  ['engine_state_raw','display_state_user_facing','Family trade status','SetupId','VWAP','EMA9','ATR',
   'plan_risk_per_share','Requirement source'].forEach(f =>
    ck('Live Validation still carries: '+f, lv2.includes(f)));
}


// ---- the status chips must actually be readable
{
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // Read the colours out of the stylesheet rather than restating them here, so
  // the check cannot drift from what ships.
  // Some chips use a design token; resolve it from :root so the check measures
  // what actually renders rather than only literal colours.
  const token = n => { const m = v2.match(new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})')); return m && m[1]; };
  const bad = [];
  ['NOT_NOW', 'WATCH', 'NEAR', 'READY', 'IN_TRADE'].forEach(k => {
    const m = v2.match(new RegExp('\\.u-' + k + '\\{background:(var\\(--[a-z-]+\\)|#[0-9A-Fa-f]{6})'));
    if (!m) { bad.push(k + ' (rule not found)'); return; }
    const hex = m[1].startsWith('var(') ? token(m[1].slice(6, -1)) : m[1];
    if (!hex) { bad.push(k + ' (token unresolved)'); return; }
    const r = ratio('#ffffff', hex);
    if (r < 4.5) bad.push(k + ' ' + hex + ' ' + r.toFixed(2) + ':1');
  });
  ck('every status chip clears 4.5:1 against its white text', bad.length === 0, bad.join(' · ') || 'all pass');
  // Opacity fades the white text toward the white page, so the ratio collapses
  // to ~2.5:1 regardless of the base colour. An empty chip drops the fill and
  // uses muted text instead.
  ck('an empty chip is outlined, not faded',
    /\.cnt\[data-on="0"\]\{background:transparent!important;color:var\(--muted\)!important/.test(v2));
  // The production stylesheet is copied verbatim and carries opacity:.35 on
  // this selector; the override must cancel it explicitly or the chip stays
  // faded no matter what colours we set. That is exactly what went wrong.
  ck('the inherited opacity is explicitly cancelled', /opacity:1!important/.test(v2));
  ck('the counts strip wraps so no chip sits off the edge', /\.counts\{flex-wrap:wrap/.test(v2));
  ck('the no-data chip is readable too', /\.bg-NODATA\{background:#5B6673/.test(v2));
}


// ---- the sheet can be closed from the top
ck('the sheet header carries a close control', /id="closeTop" class="closex"/.test(v2)
  && /\.closex\{/.test(v2));
// A flex row with no wrap pushes a late child past the edge — the same trap
// that hid the export button. The control is pinned, not queued for space.
ck('the close control is pinned to the corner, not competing for row space',
  /\.closex\{position:absolute;inset-inline-end:12px/.test(v2));
ck('and the header reserves room for it', /\.phead\{position:relative;padding-inline-end:46px!important/.test(v2));
ck('it is bound to the same close path as the bottom button',
  /var ct=qs\('#closeTop'\); if\(ct\)ct\.onclick=closeDetail;/.test(v2));
ck('the bottom close button is still there', /id="close">סגור/.test(v2));
// and the concatenation that printed "undefined" after the source line
ck('an unassigned production badge cannot print undefined',
  /\(typeof prodBadge==='string'\?prodBadge:''\)/.test(v2)
  && !/Trader<\/b>'\+prodBadge/.test(v2));


// ---- every class the counts strip can EMIT must resolve to a real,
// readable background. The previous checks measured the .u- rules I had
// written, while the strip was emitting bg-<k> names — of which only two
// happened to exist in the copied stylesheet. The colours were correct and
// nothing was wearing them. This checks the emitted names.
{
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const token = n => { const m = v2.match(new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})')); return m && m[1]; };
  // the LAST definition wins in CSS, so read them all and take the final one
  const lastBg = sel => {
    const re = new RegExp('\\.' + sel + '\\{background:(var\\(--[a-z-]+\\)|#[0-9A-Fa-f]{6})', 'g');
    let m, last = null; while ((m = re.exec(v2))) last = m[1];
    if (!last) return null;
    return last.startsWith('var(') ? token(last.slice(6, -1)) : last;
  };
  const order = v2.match(/var order=\[([^\]]+)\]/);
  ck('the counts order is readable from the source', !!order);
  const keys = order ? order[1].split(',').map(s => s.trim().replace(/'/g, '')) : [];
  const emitted = keys.map(k => k === 'NODATA' ? 'bg-NODATA' : 'u-' + k);
  const broken = [];
  emitted.forEach(sel => {
    const hex = lastBg(sel);
    if (!hex) { broken.push(sel + ' has no background rule'); return; }
    const r = ratio('#ffffff', hex);
    if (r < 4.5) broken.push(sel + ' ' + hex + ' ' + r.toFixed(2) + ':1');
  });
  ck('every emitted chip class resolves to a readable background',
    broken.length === 0, broken.join(' · ') || emitted.join(' ') + ' all pass');
}


// ---- FULL CARD VALIDATION — a second, separate export --------------------
{
  const fv = v2.slice(v2.indexOf('function fvSide'), v2.indexOf('function drawDetail'));

  ck('a second button exists beside the first',
    /id="fvAll"[^>]*>⤓ הורד Full Card Validation — כל המניות/.test(v2)
    && /b=qs\('#fvAll'\); if\(b\)b\.onclick=fvAllDownload/.test(v2));
  ck('the filename is distinct and ET-stamped',
    fv.includes("'full-card-validation-' + o.year") && fv.includes("'-ET.txt'"));

  // 15 — the old export must be untouched
  ck('15 · the old export keeps its own builder and text function',
    /function lvBuild/.test(v2) && /function lvText/.test(v2) && /function lvAllText/.test(v2));
  ck('15 · the old button, label and filename are unchanged',
    /id="lvAll"[^>]*>⤓ הורד Live Validation — כל המניות/.test(v2)
    && /'live-validation-'\+o\.year/.test(v2));
  ck('15 · the old export still emits exactly its five sections',
    /'TIME':1,'TRADER V2':1,'SESSION DATA':1,'DATA COVERAGE':1,'INDICATORS':1/.test(v2));
  ck('15 · the new export never calls the old download path',
    !/lvAllDownload/.test(fv) && !/lvAllText/.test(fv));
  ck('15 · the new export reuses lvBuild read-only, without mutating it',
    /var lb = lvBuild\(sym, st, f\.r, snap/.test(fv) && !/lb\.sections\s*=/.test(fv) && !/lb\.last20\s*=/.test(fv));

  // read-only
  ck('the new export refetches and re-evaluates nothing',
    !/\bj\(/.test(fv) && !/fetch\(/.test(fv) && !/runV2\(/.test(fv) && !/loadSymbol\(/.test(fv)
    && !/buildTickerState\(/.test(fv));

  // 1-5 — the probability question and level provenance
  ck('4 · the probability question is exported verbatim with its raw fields',
    /Will price reach '/.test(fv) && /kv\('bracketed'/.test(fv)
    && /kv\('sameSideOrdering'/.test(fv) && /kv\('probabilitySuppressed'/.test(fv)
    && /kv\('suppressionReason'/.test(fv));
  ck('1-4 · each level names the BRANCH that produced it, not a guess from the number',
    /function fvLevelSource/.test(fv)
    && /field: 'T\.resistance\.price'/.test(fv) && /field: 'P\.zone\[1\]'/.test(fv)
    && /field: 'T\.support\.price'/.test(fv) && /field: 'P\.invalidation'/.test(fv));
  ck('3 · a missing tactical support records the fallback reason',
    /fallbackReason: 'T\.support was null'/.test(fv));
  ck('4 · a missing tactical resistance records the fallback reason',
    /fallbackReason: 'T\.resistance was null'/.test(fv));
  ck('2 · each level reports its side relative to price',
    /function fvSide/.test(fv) && /upper_side_vs_price/.test(fv) && /lower_side_vs_price/.test(fv));

  // 5 — consistency
  ck('5 · the inconsistency section names the validator and the full reason array',
    /triggeredBy/.test(fv) && /probability-bracket-validator/.test(fv) && /why\[\]:/.test(fv));

  // diagnostic flags
  ['PRODUCTION_LEVELS_SAME_SIDE','PRODUCTION_NOT_BRACKETED','PRODUCTION_UPPER_BELOW_PRICE',
   'PRODUCTION_LOWER_ABOVE_PRICE','PRODUCTION_PROBABILITY_SUPPRESSED',
   'V2_PRODUCTION_SNAPSHOT_TIME_MISMATCH','DUPLICATE_1M_ROWS','MISSING_1M_ROWS',
   'DISPLAY_INTERNAL_STATE_MISMATCH'].forEach(f =>
    ck('diagnostic flag present: '+f, fv.includes(f)));
  ck('the flags are export-only and change no decision',
    !/store\[[^\]]*\]\.row\.v2\s*=/.test(fv) && !/status\s*=\s*'/.test(fv));

  // 6-10, 13, 14
  ck('6-10 · V2 statuses are carried through the reused builder',
    /if \(s2\[0\] !== 'TRADER V2'\) return;/.test(fv));
  ck('13 · differing snapshot bars are flagged in the symbol block',
    /V2 and Production evaluated DIFFERENT bars/.test(fv));
  ck('14 · a missing probability says so instead of printing blanks',
    /no probabilityRaw on the stored snapshot/.test(fv));
  ck('11 · duplicates are shown, never cleaned',
    /DUPLICATE ROWS PRESENT — not cleaned for this export/.test(fv)
    && /kv\('RAW ROW COUNT'/.test(fv) && /kv\('UNIQUE MINUTE COUNT'/.test(fv));
  ck('12 · stale and delayed data raise a flag', /DATA_' \+ st\.fresh/.test(fv));

  // 8, 12 — comparison and visible text
  ck('8 · a source comparison shows both systems side by side without asserting equality',
    /allowed to calculate differently/.test(fv) && /cmp\('VWAP'/.test(fv) && /cmp\('EMA9'/.test(fv));
  ck('12 · the visible card text is captured for both systems',
    /Trader V2 headline\/status/.test(fv) && /Production inconsistency message/.test(fv));

  // all twelve sections
  ['1. TIME / DATA SNAPSHOT','2. TRADER V2 — FULL','3. PRODUCTION TRADER — FULL',
   '4. PRODUCTION PROBABILITY QUESTION','5. PRODUCTION TACTICAL LEVELS',
   '6. PRODUCTION EXECUTION PLAN','7. PRODUCTION CONSISTENCY / VALIDATION',
   '8. SOURCE COMPARISON','9. SESSION DATA','10. DATA COVERAGE',
   '11. LAST 20 CLOSED 1M CANDLES','12. CARD TEXT — EXACT VISIBLE COPY'].forEach(s =>
    ck('section present: '+s.split('.')[0], fv.includes(s)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
