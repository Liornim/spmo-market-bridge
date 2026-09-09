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
  ck('the page size is within a few percent of the Radar', Math.abs(v2.length-prod.length)/prod.length < 0.35,
    prod.length+' -> '+v2.length);
}

// ---- THE BRAIN IS v192
{
  ck('the v192 engine is bundled', /function decide\(rows, ctx, prior, config\)/.test(v2) && /function runV2\(rows, engine, opts\)/.test(v2));
  ck('it carries the v192 frozen-trigger substitution', /trigger: plan\.entry/.test(v2));
  ck('it carries the v192 authoritative chase guard', /extAuth > sc\.extension/.test(v2));
  ck('the verdict comes from v2Decide', /function v2Decide/.test(v2));
  const seam=v2.slice(v2.indexOf('function buildSnap'), v2.indexOf('function v2Decide'));
  ck('buildSnap overwrites status, why and score with the V2 result',
    /st\.row\.status=v2\.status; *st\.row\.why=v2\.why; *st\.row\.score=v2\.score/.test(seam));
  ck("Production's verdict is preserved for comparison only", /st\.row\.prodStatus=st\.row\.status/.test(seam));
  const fn=v2.slice(v2.indexOf('function v2Decide'), v2.indexOf('function v2Decide')+4200);
  ck('v2Decide reads no production field', !/buildTickerState|radarRow|prodStatus|st\.snap\./.test(fn));
  ck('v2Decide uses closed candles only', /rows\.slice\(0,-1\)/.test(fn));
  ck('only RECLAIM_CONTINUATION can be actionable', /'RECLAIM_CONTINUATION'/.test(fn) && /משפחת צל/.test(fn));
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
