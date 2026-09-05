// The page itself: isolated, uses the real engine, and never claims to know
// something it could not have known.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
const page = JSON.parse(src.split('export const REPLAY_HTML = ')[1].split('\n')[0].trim().replace(/;$/, ''));
const worker = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

// ---- isolation, which the spec asks for above everything
ck('the page is served on its own route', /route === 'replay'/.test(worker));
ck('nothing links TO it', !/href="\/replay"/.test(src));
ck('and it links to nothing of ours', !/href="\/(radar|scan|bars|view|db|data)/.test(page));
ck('it writes nothing', !/\/sync|\/watch\/|\/archive\/fill|\/archive\/trim|method:\s*['"]POST/.test(page));
ck('it reads only the existing day routes', /\/days\/'\+SYM/.test(page) && /\/day\/'\+SYM\+'\/'\+DATE/.test(page));

// ---- it runs the REAL scanner, not a copy
ck('the real engine is inlined, not reimplemented', /function analyze\(allRows, opts\)/.test(page)
  && /function radarRow\(symbol, A, market, freshness\)/.test(page));
ck('the page calls the engine through the adapter, INCLUDING the live path',
  /runReplay\(rows,\{analyze:analyze,radarRow:radarRow,/.test(page)
  && /buildTickerState:buildTickerState,marketContext:marketContext\}/.test(page));
ck('there is no second copy of the scoring logic in the page',
  (page.match(/function radarRow\(/g) || []).length === 1);

// ---- the no-look-ahead rule, visible in the code that implements it
ck('the adapter slices the history at the current minute', /rows\.slice\(0, i \+ 1\)/.test(page));
ck('and the source explains why that matters',
  /cannot see a candle that had not/.test(readFileSync(new URL('./replay.cjs', import.meta.url), 'utf8')));

// ---- controls the spec asks for
['start', 'pause', 'next', 'prev', 'restart', 'jump', 'speed', 'full'].forEach(id =>
  ck('control present: ' + id, new RegExp('id="' + id + '"').test(page)));
ck('speeds include 1x, 5x and 10x', /value="1"/.test(page) && /value="5"/.test(page) && /value="10"/.test(page));
ck('Analyze Full Day is a first-class button', /id="full"[^>]*class="dark"/.test(page) && /נתח יום מלא/.test(page));

// ---- what it must show
['+5','+15','+30','+60'].forEach(() => {});
ck('the alert table shows every configured window', /w\.map\(function\(m\)\{return '<th>\+'\+m\+'ד<\/th>'\}\)/.test(page));
ck('Max Up and Max Down are columns', /Max Up/.test(page) && /Max Down/.test(page));
ck('Remaining Move has its own column', /נשאר עד הסגירה/.test(page));
ck('the summary reports best and earliest useful',
  /ההתראה הטובה ביותר/.test(page) && /המוקדמת השימושית/.test(page));
ck('the weak threshold is editable in the page', /id="thr"/.test(page) && /id="win"/.test(page));
ck('an incomplete window is marked, not padded', /חלקי, '\+q\.bars/.test(page));
ck('an unmeasured alert is shown as its own outcome', /לא נמדדו/.test(page) && /לא נמדדה/.test(page));

// ---- chart
ck('the chart marks state CHANGES, not every candle', /run\.transitions\.forEach/.test(page)
  && !/run\.states\.forEach\(function\(s\)\{[\s\S]{0,80}circle/.test(page));
ck('a marker opens the detail for that moment', /class="mk"/.test(page) && /forward|אחרי ההתראה/.test(page));

// ---- the statuses are the system's own
ck('it uses the existing status names', /QUIET:'שקט',WATCH:'מעקב',CLOSE:'קרוב',READY:'מוכן',ACTIVE:'פעיל',AVOID:'להימנע'/.test(page));
ck('and invents none', !/'סורק חדש'|CUSTOM_|NEW_STATE/.test(page));

// ---- things the spec says NOT to build
['backtest', 'position sizing', 'machine learning', 'prediction'].forEach(w =>
  ck('the page does not attempt: ' + w, !new RegExp(w.replace(/[&]/g, '\\$&'), 'i').test(page)));

// scoped to the page's own code: the bundled engine carries an unrelated
// position section that this page never calls.
ck('no profit-and-loss simulation in the page itself',
  !/P&L|רווח והפסד|pnl/i.test(readFileSync(new URL('./replay.html', import.meta.url), 'utf8')));

// ---- the four badges, each earned separately
ck('the engine badge checks for the real functions at runtime',
  /typeof analyze==='function' && typeof radarRow==='function'/.test(page)
  && /typeof buildTickerState==='function'/.test(page));
ck('the code-path badge checks the adapter actually calls buildTickerState',
  /deps\\\\\.buildTickerState/.test(page) || /deps\\.buildTickerState/.test(page));
ck('the inputs badge is decided by the run ledger, not hardcoded',
  /led\.filter\(function\(x\)\{return x\.state==='MISSING'\|\|x\.state==='SIMULATED'\}\)/.test(page));
ck('PARITY VERIFIED requires all four conditions',
  /sameEngine && samePath && inputsComplete && PARITY_TEST_PASSED/.test(page));
ck('the page can show either verdict', /PARITY VERIFIED ✓/.test(page) && /PARITY NOT VERIFIED/.test(page));
ck('an incomplete run is labelled HISTORICAL PARITY INCOMPLETE', /HISTORICAL PARITY INCOMPLETE/.test(page));
ck('and says which metrics remain usable when it is', /מה שכן תקף/.test(page) && /לא תקף להערכת הרדאר/.test(page));
ck('the ledger table shows all four input states',
  /REAL HISTORICAL/.test(page) && /RECONSTRUCTED/.test(page) && /SIMULATED/.test(page) && /MISSING/.test(page));
ck('the replay feeds benchmarks for market context', /benchRows:bench/.test(page));
ck('and rebuilds multi-day context and the volume baseline from prior sessions',
  /dailyContext\(ok,\{todayDate:DATE\}\)/.test(page) && /volumeBaseline\(ok\)/.test(page));
ck('benchmarks are loaded for the SAME date', /'\/day\/'\+s\+'\/'\+DATE/.test(page));
ck('prior sessions used are strictly before the replayed date', /x\.date<DATE/.test(page));

ck('a run without full inputs is labelled NOT VALID FOR RADAR EVALUATION', /NOT VALID FOR RADAR EVALUATION/.test(page));

// ---- filtering by state
ck('there is a state filter', /id="filt"/.test(page) && /var stateFilter=/.test(page));
ck('it offers every state plus "all"',
  /\['ALL','READY','ACTIVE','CLOSE','WATCH','QUIET','AVOID'\]/.test(page));
ck('it filters on the state moved INTO, not out of', /s\.transition\.to===stateFilter/.test(page));
ck('counts come from the UNFILTERED list, so an empty state still shows zero',
  /t\.forEach\(function\(s\)\{counts\[s\.transition\.to\]/.test(page));
ck('the events table, the alert table and the chart all follow it',
  /stateFilter==='ALL'\?all:all\.filter/.test(page)
  && /stateFilter!=='ALL'&&s\.transition\.to!==stateFilter/.test(page));
ck('an empty result says so instead of showing a blank table', /אין מעברים ל/.test(page));
ck('a fresh analysis clears the filter', /stateFilter='ALL'; clear\(\)/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
