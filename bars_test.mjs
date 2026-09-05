// The saved-candles browser: a read-only page over what is stored. It must
// touch nothing else and must never write.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
const page = JSON.parse(src.split('export const BARS_HTML = ')[1].split('\n')[0].trim().replace(/;$/, ''));
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

// ---- read-only, by construction
ck('the page never calls a writing route',
  !/\/sync|\/watch\/add|\/watch\/remove|\/archive\/fill|\/archive\/trim|method:\s*['"]POST/.test(page));
ck('it reads the symbol index', /\/bars\/index/.test(page));
ck('it reads days through the existing route', /\/days\/'\+SYM/.test(page));
ck('it reads a day through the existing merged reader', /\/day\/'\+SYM\+'\/'\+DATE/.test(page));

// ---- what it shows
ck('a short day is flagged in the day strip', /short\?' ✗'/.test(page) && /n<370/.test(page));
ck('missing minutes inside a day are counted', /דקות חסרות/.test(page) && /unix-rows\[i-1\]\.unix>60/.test(page));
ck('no-trade minutes are counted separately', /דקות ללא עסקה/.test(page));
ck('a gap row is highlighted', /tr\.gap td\{background/.test(page));
ck('the summary carries OHLC and volume', /פתיחה <b>/.test(page) && /נפח <b>/.test(page));
ck('there is a search box for the symbol list', /id="find"/.test(page) && /indexOf\(q\)===0/.test(page));

// ---- export
ck('CSV has the standard header', /symbol,date,time,open,high,low,close,volume/.test(page));
ck('it can copy and download', /id="copy"/.test(page) && /id="dl"/.test(page) && /download=SYM/.test(page));

// ---- it is its own page
ck('the page is served at /bars', /route === 'bars' && !a/.test(readFileSync(new URL('./worker.js', import.meta.url), 'utf8')));
ck('the page does not overflow the screen', /overflow-x:hidden/.test(page.split('</style>')[0]));
ck('it carries the build stamp', /v\d+\s+\(/.test(page));

// ---- and nothing else moved
const radar = JSON.parse(src.split('export const RADAR_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
ck('the radar links to the page beside the scan link', /href="\/scan"[\s\S]{0,120}href="\/bars"/.test(radar));


// ---- bulk downloads must count before they fetch
ck('there is a whole-history download for one symbol', /id="dlAll"/.test(page));
ck('there is an all-symbols range download', /id="dlRange"/.test(page) && /id="rFrom"/.test(page) && /id="rTo"/.test(page));
ck('the range download COUNTS first and downloads on a second tap',
  /dataset\.ready==='1'/.test(page) && /\/bars\/count\?symbols=/.test(page));
ck('the whole-history download confirms the size before fetching', /confirm\(SYM/.test(page));
ck('the Excel row limit is named', /1048576/.test(page) && /Excel/.test(page));
ck('a heavy download is warned about separately', /HEAVY=300000/.test(page) && /כבד לטלפון/.test(page));
ck('an oversized download is allowed but labelled', /הורד בכל זאת/.test(page));
ck('symbols are fetched one at a time with progress', /מוריד '\+s\+' \('\+i\+'\/'\+syms\.length/.test(page));
ck('a failed symbol is reported, not silently dropped', /failed\.push\(s\)/.test(page) && /נכשלו:/.test(page));
ck('the header is written once, not per symbol', /lines\.slice\(1\)\.filter\(Boolean\)/.test(page));


// ---- the daily prices tab
ck('there are two tabs', /id="tabDay"/.test(page) && /id="tabDaily"/.test(page));
ck('switching tabs hides the other view, it does not reload the page',
  /function switchTab\(daily\)/.test(page) && !/location\.reload/.test(page));
ck('the daily view reads the aggregate route', /\/bars\/daily/.test(page));
// the header is now generated from the column set, so assert the set itself
ck('one row carries symbol, date, OHLC, change, volume and bar count',
  /\['symbol','date','open','high','low','close','chg','volume','bars'\]\.map\(th\)/.test(page));
ck('and every one of those columns is defined with a value accessor',
  ['symbol','date','open','high','low','close','chg','volume','bars']
    .every(k => new RegExp(k + ':\{t:').test(page)));
ck('the day change is computed from open to close', /\(r\.close-r\.open\)\/r\.open\*100/.test(page));
ck('an incompletely collected day is marked, not shown as if it were whole',
  /r\.complete===false/.test(page) && /tr\.part td\{background/.test(page));
ck('and the marking is explained', /יום חלקי/.test(page));
// The provider/minutes distinction was diagnostic jargon for me, not
// information for the reader. Only completeness is surfaced now.
ck('the source tag is gone from the table', !/srcp">ספק/.test(page));
ck('the provider comparison is gone', !/id="dCmp"/.test(page));
ck('the daily view exports plain OHLCV', /symbol,date,open,high,low,close,volume,bars/.test(page));
ck('the symbol filter is a dropdown defaulting to every symbol',
  /<select id="dSym"><option value="">כל המניות/.test(page));
ck('and it is filled from the symbol index', /qs\('#dSym'\)\.innerHTML='<option value="">כל המניות/.test(page));
// The dates are the filter and are always on screen; the quick buttons only
// fill them in, so what is visible is always what will be requested.
ck('the date fields are always visible, not behind an option',
  /<input id="dFrom" type="date">/.test(page) && !/id="dExact" hidden/.test(page));
ck('the filter reads the visible date boxes',
  /f=qs\('#dFrom'\)\.value, t=qs\('#dTo'\)\.value/.test(page));
ck('quick buttons fill the boxes rather than bypassing them',
  /function setRange\(days\)/.test(page) && /qs\('#dFrom'\)\.value=new Date/.test(page));
ck('"all days" clears the boxes so the screen matches the request',
  /if\(days===0\)\{qs\('#dFrom'\)\.value='';qs\('#dTo'\)\.value=''\}/.test(page));
ck('editing a date clears the quick selection', /b\.className=''/.test(page));
ck('an inverted range is refused rather than silently returning everything',
  /f>t\)\{toast\('מתאריך מאוחר/.test(page));


// ---- sorting
ck('daily columns are sortable', /function sortedDaily\(\)/.test(page) && /th class="s/.test(page));
ck('sorting is a view over loaded rows, never a refetch',
  /dRows\.slice\(\)\.sort/.test(page) && !/sortedDaily[\s\S]{0,200}fetch\(/.test(page));
ck('clicking the same column flips direction', /if\(dSort===k\)dDir=-dDir/.test(page));
ck('missing values sink to the bottom in either direction',
  /if\(x==null\)return 1;\s*if\(y==null\)return -1/.test(page));
ck('the sorted column shows which way it is going', /dDir<0\?'▼':'▲'/.test(page));
ck('the computed change column can be sorted, not just stored fields',
  /chg:\{t:'שינוי',v:function\(r\)\{return \(r\.open!=null/.test(page));
ck('sorting covers every visible column',
  /\['symbol','date','open','high','low','close','chg','volume','bars'\]\.map\(th\)/.test(page));
ck('the minute table is sortable as well', /var mth=function\(k\)/.test(page) && /mSort/.test(page));
ck('sorting the minute table by time reuses the existing toggle rather than fighting it',
  /if\(k==='time'\)\{ mSort='time'; newestFirst=!newestFirst;/.test(page));
ck('and the toggle button returns the table to time order', /mSort='time';\s*$/m.test(page) || /newestFirst=!newestFirst;mSort='time'/.test(page));
ck('sorting is explained to the reader', /לחיצה על כותרת ממיינת/.test(page));


// ---- the table must be reachable on a phone
ck('both tables can scroll sideways', /\.scroll\{overflow-x:auto/.test(page)
  && /class="scroll" id="dTbl"/.test(page) && /class="scroll" id="tbl"/.test(page));
ck('the table is given a width worth scrolling to', /\.scroll table\{min-width:\d+px\}/.test(page));
ck('and the reader is told it scrolls', /גוללים ימינה/.test(page));


ck('the daily view states what it actually requested', /id="dAsk"/.test(page) && /מציג: /.test(page));
ck('and flags rows that came back outside the requested range', /חזרו ימים מחוץ לטווח/.test(page));
ck('the row and day counts are shown so a filter can be checked at a glance',
  /dRows\.length\+' שורות '?\+?|dRows\.length\+. שורות/.test(page) || /' שורות · '/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
