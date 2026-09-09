// TRADER V2 RADAR — the Radar GUI, the v192 brain. Asserts both halves.
import { readFileSync } from 'node:fs';
let pass=0, fail=0;
const ck=(n,ok,x='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${x?'   ['+x+']':''}`)};
const src=readFileSync('view.js','utf8');
const grab=k=>JSON.parse(src.split('export const '+k+' = ')[1].split('\n')[0].trim().replace(/;$/,''));
const radar=grab('TRADER_V2_RADAR_HTML'), live=grab('TRADER_V2_LIVE_HTML'), prod=grab('RADAR_HTML');
const blocks=s=>[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const page=blocks(radar)[1];

// ---- the brain is v192 and only v192
ck('the engine block is byte-identical to the Live page', blocks(radar)[0]===blocks(live)[0]);
ck('it carries the v192 frozen-trigger substitution', /trigger: plan\.entry/.test(radar));
ck('it carries the v192 authoritative chase guard', /extAuth > sc\.extension/.test(radar));
['buildTickerState','executionPlan','radarRow'].forEach(f=>
  ck('no production engine: '+f+' is absent', !new RegExp('function\\s+'+f).test(radar)));
ck('Production status never feeds a V2 decision', /\.prod=/.test(page)
  && /Production status never enters this function/.test(page)
  && !/prod/.test(page.slice(page.indexOf('function evaluate'), page.indexOf('// ---- the Radar'))));

// ---- the GUI is the familiar one
ck('same shell: sticky header, counts strip, control bar', /class="counts"/.test(radar) && /class="ctrl"/.test(radar) && /position:sticky/.test(radar));
// the stylesheet is the production Radar's, copied rather than reimplemented
const prodCss = prod.slice(prod.indexOf('<style>')+7, prod.indexOf('</style>'));
ck('the production Radar stylesheet is present verbatim', radar.includes(prodCss.trim().slice(0, 4000)), prodCss.length + ' bytes of Radar CSS');
ck('rows use the Radar row grid', /\.row\{display:grid;grid-template-columns:60px 1fr 74px/.test(radar));
ck('badges use the Radar status colours', /\.bg-READY\{background:var\(--s-ready\)\}/.test(radar));
ck('same design tokens as the production Radar', ['--paper:#F2F4F7','--ink:#1B2430','--rule:#D6DBE2','--well:#FFFFFF'].every(t=>radar.includes(t)&&prod.includes(t)));
ck('many symbols at once, in the Radar\'s own row markup',
  /class="row '\+r\.status/.test(page) && /class="sym"/.test(page) && /class="mid"/.test(page) && /class="rt"/.test(page));
ck('auto refresh with the familiar interval control', /id="every"/.test(radar) && /setInterval\(pull/.test(page));
ck('sorting, using the Radar\'s sortRadar shape', /id="sort"/.test(radar) && /function sortRadar/.test(page));
ck('filters by state, from the counts strip', /b\.dataset\.k/.test(page) && /filterStatus/.test(page));
ck('the counts strip uses the Radar button markup, colour on the bg- class',
  /class="cnt bg-'\+k/.test(page) && /data-on=/.test(page));
ck('an empty list always explains itself', /function emptyWhy/.test(page)
  && /השוק עוד לא נפתח/.test(page) && /הסשן הסתיים/.test(page) && /סוף שבוע/.test(page));
ck('and it counts the minutes to the open', /open-t\.mins/.test(page));
ck('alert bell', /id="alertsBtn"/.test(radar));
ck('mini intraday chart per row', /function spark/.test(page) && /<svg width="64" height="26"/.test(page));
ck('price per row in the Radar\'s px slot', /class="px num"/.test(page));

// ---- V2 states in the familiar cards
// the Radar's own six status slots, with V2 meanings
[['READY','BUY NOW'],['ACTIVE','פעיל'],['CLOSE','קרוב מאוד'],['WATCH','מעקב'],['QUIET','שקט'],['AVOID','לא נכנסים']].forEach(([k,txt])=>
  ck('status slot '+k+' reads "'+txt+'"', radar.includes("'"+txt+"'") || radar.includes(txt)));
ck('trader ordering READY(BUY) > ACTIVE > CLOSE > WATCH > QUIET > AVOID',
  /RANK=\{READY:0,ACTIVE:1,CLOSE:2,WATCH:3,QUIET:4,AVOID:5\}/.test(page));

// ---- each card answers the four questions
ck('WAIT states the exact remaining condition from the engine',
  /need=\(s\.waiting&&s\.waiting\.stillRequired\)/.test(page) && /need\.join\(' · '\)/.test(page));
ck('VERY CLOSE gives the distance to the frozen trigger',
  /% מתחת לטריגר/.test(page) && /nearPct/.test(page));
ck('NO TRADE names the chase distance when extended',
  /מורחב '\+ext\.toFixed\(2\)\+' ATR מעל הטריגר/.test(page));
ck('a cancelled setup says so, and plans show the invalidation',
  /הסטאפ בוטל/.test(page) && /plan\.invalidation/.test(page));

// ---- BUY expands in place
['טריגר','ביצוע','סטופ','סיכון/מניה','T1','T2','R:R תוכנית','R:R בפועל','מרדף','ביטול','גיל'].forEach(f=>
  ck('BUY row field: '+f, page.includes(f)));
ck('the BUY row expands in place, no second page needed', /takeBtn/.test(page) && /class="plan"/.test(page));

// ---- ACTIVE
['R חי','לסטופ','ל-T1'].forEach(f=>ck('ACTIVE row field: '+f, page.includes(f)));
ck('an active setup can never show another actionable BUY',
  /if\(pos&&s\.setupId===pos\.setupId\)\{status='ACTIVE'/.test(page));
ck('a consumed setup can never show BUY again', /else if\(spent\)\{status='AVOID'/.test(page));

// ---- live behaviour
ck('closed candles only', /all\.slice\(0, ?-1\)/.test(page));
ck('immutable per-minute decision log', /decisions\.push\(row\)/.test(page) && /Object\.freeze/.test(page));
ck('separate transition log', /if\(changed\)transitions\.push\(row\)/.test(page));
ck('rows record what was waited for', /waiting_for:d\.waiting\.join/.test(page));

// ---- provenance and safety
ck('the page states the frozen engine version', /Trader V2 v192 · engine FROZEN/.test(radar));
ck('labelled TRADER V2 — EXPERIMENTAL', /TRADER V2 — EXPERIMENTAL/.test(radar));
ck('clicking a row opens the single-symbol V2 page', /\/trader-v2\/live\?symbol=/.test(page));
ck('Production comparison badge is optional and display-only', /id="cmpOn"/.test(radar) && /Production: /.test(page));
['submitOrder','broker','ibkr','alpaca','placeTrade'].forEach(w=>
  ck('no execution path: '+w, !new RegExp('\\b'+w+'\\b','i').test(page)));
ck('no POST/PUT/PATCH/DELETE anywhere', !/method: *.(POST|PUT|PATCH|DELETE)./.test(radar));

ck('outside the session it falls back to the last completed one', /function resolveDate/.test(page) && /bars\|\|0\) *> *200|x\.bars\|\|0\)>200/.test(page));
ck('and says plainly that it is not live', /לא חי — מוצג הסשן האחרון/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
