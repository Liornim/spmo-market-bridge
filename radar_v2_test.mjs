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
ck('Production status never feeds a V2 decision', /d\.prod/.test(page) && !/evaluate\([^)]*prod/.test(page)
  && /never consulted by evaluate/.test(page));

// ---- the GUI is the familiar one
ck('same shell: sticky header, counts strip, control bar', /class="counts"/.test(radar) && /class="ctrl"/.test(radar) && /position:sticky/.test(radar));
ck('same design tokens as the production Radar', ['--paper:#F2F4F7','--ink:#1B2430','--rule:#D6DBE2','--well:#FFFFFF'].every(t=>radar.includes(t)&&prod.includes(t)));
ck('many symbols at once, compact rows', /class="tick/.test(radar) && /SYMS\.map/.test(page));
ck('auto refresh with the familiar interval control', /id="every"/.test(radar) && /setInterval\(pull/.test(page));
ck('sorting', /id="sort"/.test(radar) && /function order/.test(page));
ck('filters by state', /c\.dataset\.f/.test(page));
ck('alert bell', /id="alertsBtn"/.test(radar));
ck('mini intraday chart per row', /function spark/.test(page) && /<svg class="spark"/.test(page));
ck('price and percent change per row', /chg\.toFixed\(2\)/.test(page));

// ---- V2 states in the familiar cards
['BUY NOW','ACTIVE','VERY CLOSE','WAIT','NO TRADE','FAILED'].forEach(s=>
  ck('card state present: '+s, radar.includes(s)));
ck('trader ordering BUY > ACTIVE > CLOSE > WAIT > NO TRADE',
  /RANK=\{BUY:0,ACTIVE:1,CLOSE:2,WAIT:3,NOTRADE:4/.test(page));

// ---- each card answers the four questions
ck('WAIT states the exact remaining condition from the engine',
  /need=\(s\.waiting&&s\.waiting\.stillRequired\)/.test(page) && /need\.join\(' · '\)/.test(page));
ck('VERY CLOSE gives the distance to the frozen trigger',
  /% מתחת לטריגר/.test(page) && /nearPct/.test(page));
ck('NO TRADE names the chase distance when extended',
  /מורחב '\+ext\.toFixed\(2\)\+' ATR מעל הטריגר/.test(page));
ck('FAILED names the invalidation', /d\.plan\.invalidation/.test(page));

// ---- BUY expands in place
['טריגר קפוא','מחיר ביצוע','סטופ','סיכון/מניה','T1','T2','R:R בתוכנית','R:R בפועל','מרדף','ביטול','גיל סטאפ'].forEach(f=>
  ck('BUY card field: '+f, page.includes(f)));
ck('the BUY card does not require another page', /takeBtn/.test(page) && /class="lv"/.test(page));

// ---- ACTIVE
['R חי','מרחק לסטופ','מרחק ל-T1'].forEach(f=>ck('ACTIVE card field: '+f, page.includes(f)));
ck('an active setup can never show another actionable BUY',
  /if\(pos&&s\.setupId===pos\.setupId\)\{state='ACTIVE'/.test(page));
ck('a consumed setup can never show BUY again', /else if\(spent\)\{state='NOTRADE'/.test(page));

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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
