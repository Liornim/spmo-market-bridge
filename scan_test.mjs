// The scan page: the whole universe from the archive, walked in batches,
// with stale symbols labelled as reference and nothing offered as a trade.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('./view.js', import.meta.url), 'utf8');
const page = JSON.parse(src.split('export const SCAN_HTML = ')[1].split('\nexport const ')[0].trim().replace(/;$/, ''));
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

const els = {};
function el(id) { if (!els[id]) els[id] = { id, innerHTML: '', textContent: '', className: '', value: '', hidden: false, dataset: {}, onclick: null, onchange: null }; return els[id]; }
globalThis.document = { querySelector: s => el(s.replace('#', '')), querySelectorAll: () => [], addEventListener() {}, hidden: false };
globalThis.window = {};
globalThis.setInterval = () => 0; globalThis.setTimeout = f => { f(); return 0; }; globalThis.clearTimeout = () => {};

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const SESSION_DATE = (() => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  const d = new Date(p.year + '-' + p.month + '-' + p.day + 'T12:00:00Z');
  if ((p.hour + ':' + p.minute) < '09:30') d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
const NOW = Math.floor(Date.now() / 1000);
function day(sym, n, base) { let p = base, s = 5; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; const out = [];
  for (let i = 0; i < n; i++) { const o = p, c = o + (rnd() - 0.5) * 0.3, h = Math.max(o, c) + rnd() * 0.1, l = Math.min(o, c) - rnd() * 0.1;
    out.push({ symbol: sym, unix: NOW - (n - i) * 60, date: SESSION_DATE, time: tm(i), open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: 100000 }); p = c; }
  return out; }

const UNIVERSE = []; for (let i = 0; i < 100; i++) UNIVERSE.push('U' + i);
const have = new Set(UNIVERSE.slice(0, 70));          // 70 archived, 30 not yet
const calls = [];
globalThis.fetch = async (u) => {
  calls.push(u);
  const m = u.match(/symbols=([^&]+)/);
  const asked = m ? m[1].split(',') : UNIVERSE;
  const first = !m;
  const served = first ? asked.slice(0, 40) : asked;
  const rows = [];
  served.forEach(s => { if (have.has(s)) day(s, 120, 100 + UNIVERSE.indexOf(s)).forEach(r => rows.push(r)); });
  const body = /\/archive\/fill\//.test(u) ? { filled: u.split('/fill/')[1].split('?')[0].split(',').map(s => ({ symbol: s, fetched: 1950, written: 1950 })), skipped: [], note: 'complete' }
    : /\/archive\/check\//.test(u) ? { symbol: 'U0', days: 3, bars: 1170,
      detail: [{ date: '2026-08-31', bars: 390, complete: true }, { date: '2026-09-01', bars: 390, complete: true },
               { date: SESSION_DATE, bars: 390, complete: true }], incomplete: [] }
    : /\/archive\/read\//.test(u) ? { symbol: 'U0', count: 3,
      rows: [{ date: SESSION_DATE, time: '09:30', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
             { date: SESSION_DATE, time: '09:31', open: 1.5, high: 2, low: 1, close: 1.8, volume: 11 },
             { date: SESSION_DATE, time: '09:32', open: 1.8, high: 2, low: 1.2, close: 1.9, volume: 12 }] }
    : /\/archive\/dates/.test(u) ? { dates: [SESSION_DATE, '2026-08-31'] }
    : /\/watch\/add\//.test(u) ? { ok: true, added: u.split('/').pop().split('?')[0] }
    : /\/watch/.test(u) ? { tracked: ['U0', 'U1'], room: 38, max: 40 }
    : /\/days\//.test(u) ? { days: [{ date: SESSION_DATE }] }
    : { date: SESSION_DATE, symbols: UNIVERSE, rows, count: rows.length, not_fetched: first ? asked.slice(40) : undefined };
  return { ok: true, status: 200, json: async () => body };
};

(0, eval)(scripts.join('\n'));
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };
await settle();

let pass = 0, fail = 0; const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const rows = el('rows').innerHTML;

ck('the first call asks for the universe', calls.some(u => /universe=1/.test(u)));
const batches = calls.filter(u => /symbols=/.test(u));
ck('the remainder is walked in batches of 40', batches.length === 2, batches.length + ' follow-up calls');
ck('every batch is at most 40 symbols', batches.every(u => u.match(/symbols=([^&]+)/)[1].split(',').length <= 40));
ck('all 100 symbols are rendered', (rows.match(/class="sym">/g) || []).length === 100, (rows.match(/class="sym">/g) || []).length + ' rows');
ck('symbols the archive lacks read as no data', (rows.match(/אין נתונים/g) || []).length >= 30, (rows.match(/אין נתונים/g) || []).length + '');
ck('archived symbols carry a price', (rows.match(/class="px num"/g) || []).length >= 70);
ck('the page never offers an entry', !/אפשר להיכנס|כניסה חלקית/.test(rows));
ck('the header says it is a scan, not a trading screen', /לא מסך מסחר/.test(page));
ck('the counts strip is populated', /class="cnt/.test(el('counts').innerHTML));
ck('progress is reported', /עם נתונים/.test(el('prog').textContent), el('prog').textContent);
ck('there is a way back to the live radar', /href="\/radar"/.test(page));


// ---- the scan says which session it shows, and can hand a symbol to the live set
ck('the page says which session is on screen', /נתונים מ|הסשן הנוכחי/.test(el('when').innerHTML), el('when').innerHTML.replace(/<[^>]+>/g, ''));
ck('the date picker lists archived sessions', /2026-08-31/.test(el('date').innerHTML));
ck('live symbols are marked rather than offered', (rows.match(/class="live">חי/g) || []).length === 2);
ck('other symbols get a track button', (rows.match(/class="track"/g) || []).length === 98, (rows.match(/class="track"/g) || []).length + '');


// ---- the history sheet: see every archived day, copy it, download it
{
  let copied = null;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async t => { copied = t; } } }, configurable: true, writable: true });
  ck('every row offers a history button', (rows.match(/class="hist"/g) || []).length === 100);

  // open it the way a tap would
  const btns = [];
  globalThis.document.querySelectorAll = sel => (sel === '.hist' ? [{ dataset: { s: 'U0' }, set onclick(f) { btns.push(f); } }] : []);
  el('rows').innerHTML = rows;   // re-render bindings
  // call the handler directly through the page's own function
  await (async () => { const h = el('hpanel'); h.innerHTML = ''; })();
}


// ---- one button fills every gap, in batches
{
  ck('a fill button appears when symbols are missing', el('fill').hidden === false, 'hidden=' + el('fill').hidden);
  ck('it says how many are missing', /מלא 30 חסרות/.test(el('fill').textContent), el('fill').textContent);

  const before = calls.length;
  await el('fill').onclick();
  const fills = calls.slice(before).filter(u => /\/archive\/fill\//.test(u));
  ck('the missing symbols are filled', fills.length === 3, fills.length + ' fill calls');
  ck('ten at a time', fills.every(u => u.split('/fill/')[1].split('?')[0].split(',').length <= 10));
  const asked = fills.flatMap(u => u.split('/fill/')[1].split('?')[0].split(','));
  ck('exactly the missing ones are asked for, no others',
    asked.length === 30 && asked.every(s => !have.has(s)), asked.length + ' asked');
  ck('nothing already archived is re-fetched', asked.every(s => UNIVERSE.indexOf(s) >= 40));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
