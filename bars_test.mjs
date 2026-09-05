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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
