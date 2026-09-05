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
ck('the radar has no link injected into it', !/\/bars/.test(radar.split('<body>')[1].split('<script>')[0]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
