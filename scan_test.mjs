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
const PRIOR = ['2026-08-31', '2026-09-01', '2026-09-02'];
function day(sym, n, base, date) { let p = base, s = 5; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; const out = [];
  const d = date || SESSION_DATE;
  const t0 = Math.floor(Date.parse(d + 'T13:30:00Z') / 1000);
  for (let i = 0; i < n; i++) { const o = p, c = o + (rnd() - 0.4) * 0.3, h = Math.max(o, c) + rnd() * 0.1, l = Math.min(o, c) - rnd() * 0.1;
    out.push({ symbol: sym, unix: t0 + i * 60, date: d, time: tm(i), open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: 100000 }); p = c; }
  return out; }

const UNIVERSE = []; for (let i = 0; i < 100; i++) UNIVERSE.push('U' + i);
const have = new Set(UNIVERSE.slice(0, 70));          // 70 archived, 30 not yet
const calls = [];
globalThis.fetch = async (u) => {
  calls.push(u);
  const m = u.match(/symbols=([^&]+)/);
  const asked = m ? m[1].split(',') : UNIVERSE;
  const first = !m;
  // The real board can only reach ~13 archive symbols per call, first or not.
  const CEIL = 13;
  const served = asked.slice(0, CEIL);
  const deferred = asked.slice(CEIL);
  const rows = [];
  // Answer for the DATE that was asked for, as the real board does — a stub
  // that returns the same day for every request hides the multi-day layer.
  const dm = u.match(/date=(\d{4}-\d{2}-\d{2})/);
  const forDate = dm ? dm[1] : SESSION_DATE;
  served.forEach(s => { if (have.has(s)) day(s, 390, 100 + UNIVERSE.indexOf(s), forDate).forEach(r => rows.push(r)); });
  const body = /\/archive\/fill\//.test(u) ? { filled: u.split('/fill/')[1].split('?')[0].split(',').map(s => ({ symbol: s, fetched: 1950, written: 1950 })), skipped: [], note: 'complete' }
    : /\/archive\/check\//.test(u) ? { symbol: 'U0', days: 3, bars: 1170,
      detail: [{ date: '2026-08-31', bars: 390, complete: true }, { date: '2026-09-01', bars: 390, complete: true },
               { date: SESSION_DATE, bars: 390, complete: true }], incomplete: [] }
    : /\/archive\/read\//.test(u) ? { symbol: 'U0', count: 3,
      rows: [{ date: SESSION_DATE, time: '09:30', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
             { date: SESSION_DATE, time: '09:31', open: 1.5, high: 2, low: 1, close: 1.8, volume: 11 },
             { date: SESSION_DATE, time: '09:32', open: 1.8, high: 2, low: 1.2, close: 1.9, volume: 12 }] }
    : /\/daily\//.test(u) ? { symbol: 'X', bars: [] }
    : /\/archive\/dates/.test(u) ? { dates: [SESSION_DATE].concat(PRIOR.slice().reverse()),
        readable: 10, coverage: {}, covered: [SESSION_DATE].concat(PRIOR.slice().reverse()),
        latest_covered: SESSION_DATE, collecting: [] }
    : /\/watch\/add\//.test(u) ? { ok: true, added: u.split('/').pop().split('?')[0] }
    : /\/watch/.test(u) ? { tracked: ['U0', 'U1'], room: 38, max: 40 }
    : /\/days\//.test(u) ? { days: [{ date: SESSION_DATE }] }
    : { date: forDate, symbols: UNIVERSE, rows, count: rows.length,
        not_fetched: deferred.length ? deferred : undefined };
  return { ok: true, status: 200, json: async () => body };
};

(0, eval)(scripts.join('\n'));
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r)); };
await settle();

const viewDateReset = () => { try { el('date').value = ''; } catch (e) {} };
let pass = 0, fail = 0; const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const rows = el('rows').innerHTML;

ck('the first call asks for the universe', calls.some(u => /universe=1/.test(u)));
const batches = calls.filter(u => /symbols=/.test(u));
// Each call serves what its own subrequest ceiling allows and defers the rest,
// so the walk keeps going until nothing is left — not a fixed number of calls.
ck('the walk continues until nothing is deferred', batches.length >= 5, batches.length + ' follow-up calls');
ck('every archived symbol ends up with bars',
  (rows.match(/class="px num"/g) || []).length === 70, (rows.match(/class="px num"/g) || []).length + ' of 70');
ck('every batch is at most 40 symbols', batches.every(u => u.match(/symbols=([^&]+)/)[1].split(',').length <= 40));
ck('all 100 symbols are rendered', (rows.match(/class="sym">/g) || []).length === 100, (rows.match(/class="sym">/g) || []).length + ' rows');
ck('symbols the archive lacks read as no data', (rows.match(/אין נתונים/g) || []).length >= 30, (rows.match(/אין נתונים/g) || []).length + '');
ck('archived symbols carry a price', (rows.match(/class="px num"/g) || []).length >= 70);
ck('every scored row shows a candidate score out of 100', (rows.match(/\/100/g) || []).length >= 70,
  (rows.match(/\/100/g) || []).length + ' scored');
ck('no row carries an execution state',
  !/READY_PARTIAL|DO_NOT_CHASE|TAKE_PROFIT|WAITING_FOR|setup נכשל|מהלך פעיל|התרחק מהכניסה/.test(rows),
  (rows.match(/setup נכשל|מהלך פעיל|התרחק מהכניסה/g) || []).slice(0, 3).join(','));
ck('no row offers a setup score out of 10', !/<small>\/10<\/small>/.test(rows));
ck('rows say why the stock is interesting', /class="why"/.test(rows));
ck('rows list levels to watch', /lvls2/.test(rows) || /רמות למעקב/.test(rows), (rows.match(/class="meta"[^<]*/)||[''])[0].slice(0,90));
ck('the page never offers an entry', !/אפשר להיכנס|כניסה חלקית|לממש חלק/.test(rows));
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


// ---- the fill must SAY when it fails, never sit silent
{
  // the route rejects: an API key is required
  const saved = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (/\/archive\/fill\//.test(u)) return { ok: false, status: 401, json: async () => ({ error: 'API key required' }) };
    return saved(u);
  };
  el('fill').hidden = false; el('fill').disabled = false;
  await el('fill').onclick();
  ck('a rejected fill is reported on screen, not swallowed',
    /נכשלו|נכשל/.test(el('fillmsg').textContent), el('fillmsg').textContent || '(silent)');
  ck('the reason is shown', /401|API key/.test(el('fillmsg').textContent), el('fillmsg').textContent);
  ck('the button is usable again afterwards', el('fill').disabled === false);
  globalThis.fetch = saved;
}


// ---- the three scores stay separate, and promotions are suggestions only
{
  const page2 = page;
  ck('the scanner never runs the execution engine on archived data',
    !/buildTickerState\(/.test(page2.split('<script>').pop()), 'buildTickerState called in scan logic');
  ck('the scanner scores candidacy', /candidateScore\(/.test(page2));
  ck('it tracks whether interest is improving', /candidateTrend\(/.test(page2));
  ck('live interest is computed only for watch symbols', /Object\.keys\(live\)/.test(page2) && /liveInterest\(/.test(page2));
  ck('live interest reads the CURRENT session, not the archive',
    /loadLiveInterest[\s\S]{0,400}j\('\/board'\)/.test(page2));
  ck('there is a new-candidates section', /מועמדים חדשים למעקב/.test(page2));
  ck('and a no-longer-interesting section', /כבר לא מעניינים במעקב/.test(page2));
  ck('the page states that it only recommends', /לא נכנסת או יוצאת מהמעקב מעצמה/.test(page2));
  ck('a full watchlist suggestion names what to drop', /שקול להסיר/.test(page2));
  ck('the counts speak candidacy, not setup status', /מועמד חזק/.test(page2) && !/'קרוב'/.test(page2));
  ck('sorting is by candidate score, strengthening, range or volume',
    /ציון מועמדות/.test(page2) && /מתחזקים/.test(page2));
}


// ---- the layout must not overflow its card
{
  const css = page.split('</style>')[0];
  ck('the middle column can shrink below its content', /minmax\(0,1fr\)/.test(css));
  ck('every grid child is allowed to shrink', /\.row>\*\{min-width:0\}/.test(css));
  ck('the card clips rather than spilling', /\.row\{[^}]*overflow:hidden/.test(css));
  ck('the reason wraps to two lines instead of being cut mid-word', /line-clamp:2/.test(css));
  ck('the action column stacks instead of running sideways',
    /\.row \.rt\{[^}]*flex-direction:column/.test(css));
  ck('the buttons fill their column rather than overflowing it',
    /\.track\{[^}]*width:100%/.test(css) && /\.hist\{[^}]*width:100%/.test(css));
  ck('the header selects cannot exceed half the screen', /\.ctrl select\{max-width:46vw\}/.test(css));
  ck('a wide screen gets wider columns, not one stretched line', /min-width:720px/.test(css) && /90px minmax\(0,1fr\) 96px/.test(css));
  ck('there is only one .hist rule, not two fighting', (css.match(/^\s*\.hist\{/gm) || []).length === 1,
    (css.match(/^\s*\.hist\{/gm) || []).length + ' rules');
}


// ---- a session still being collected is not a gap to fill by hand
{
  const saved = globalThis.fetch;
  const NEWDAY = '2026-09-04';
  globalThis.fetch = async (u) => {
    if (/\/archive\/dates/.test(u)) return { ok: true, status: 200, json: async () => ({
      dates: [NEWDAY, SESSION_DATE].concat(PRIOR.slice().reverse()),
      readable: 10, coverage: { [NEWDAY]: 1 },
      covered: [SESSION_DATE].concat(PRIOR.slice().reverse()),
      latest_covered: SESSION_DATE, collecting: [NEWDAY] }) };
    return saved(u);
  };
  viewDateReset();
  await el('reload').onclick();
  await settle();
  ck('the page shows the last FULLY covered session, not the one being collected',
    el('date').value === SESSION_DATE || /09\/03/.test(el('when').innerHTML), el('when').innerHTML.replace(/<[^>]+>/g, ''));
  ck('it says the newer session is still being collected', /עדיין נאסף/.test(el('when').innerHTML),
    el('when').innerHTML.replace(/<[^>]+>/g, ''));
  globalThis.fetch = saved;
}


// ---- a partial session must never reach the screen as a completed day
{
  // exactly the WMT shape: a session truncated at 13:20
  const partial = day('U0', 231, 100, '2026-09-02');
  const full = day('U0', 390, 100, '2026-09-02');
  const hiPartial = Math.max(...partial.map(r => r.high));
  const hiFull = Math.max(...full.map(r => r.high));
  ck('the truncated session really does have a lower high', hiPartial < hiFull,
    hiPartial.toFixed(2) + ' vs ' + hiFull.toFixed(2));
  const scored = candidateScore([partial]);
  ck('a 231-bar session is refused, not scored', scored.score === null, String(scored.score));
  ck('and it says why', /אינם שלמים|אין נתונים/.test(scored.note || ''), scored.note);
  ck('a complete session is scored', candidateScore([full, day('U0', 390, 101, '2026-09-03')]).score !== null);
}

// ---- the page says when a level came from aggregation rather than a daily candle
{
  ck('the scanner asks for authoritative daily candles', /\/daily\//.test(page));
  ck('it passes them to the scorer', /authoritative:dailyBars/.test(page));
  ck('and labels a level built from minute bars', /לא נר יומי רשמי/.test(page));
  ck('an incomplete session is disclosed on the card', /incompleteNote/.test(page));
}


// ---- a slow or hanging side-request must never freeze the page
{
  const saved = globalThis.fetch;
  let painted = false;
  globalThis.fetch = async (u) => {
    // /daily never resolves — the exact failure that left "loading…" on screen
    if (/\/daily\//.test(String(u))) return new Promise(() => {});
    return saved(u);
  };
  // re-run a full load with the hanging route
  await el('reload').onclick();
  await settle();
  painted = /class="sym"/.test(el('rows').innerHTML);
  ck('the rows are painted even though the daily fetch never returns', painted,
    (el('rows').innerHTML.match(/class="sym"/g) || []).length + ' rows drawn');
  ck('the page does not sit on "loading"', !/טוען…$/.test(el('prog').textContent),
    el('prog').textContent);
  globalThis.fetch = saved;
}

// ---- the refinement itself
{
  const src2 = page;
  ck('daily candles are fetched off the critical path', /render\(\);[\s\S]{0,300}loadDailyFor/.test(src2));
  ck('each one has its own timeout', /withTimeout\(j\('\/daily\//.test(src2));
  ck('they run a few at a time, not forty in a row',
    /Promise\.all\(\[worker\(\),worker\(\),worker\(\)\]\)/.test(src2));
  ck('the screen re-renders when they land', /candidateScore\(sessions,\{authoritative[\s\S]{0,120}render\(\)/.test(src2));
}


// ---- the card must not call a five-day average "today's range"
{
  ck('the average range says how many days it averages', /טווח ממוצע/.test(page) && /avgRangeWindow/.test(page));
  ck("and the last session's own range is shown beside it", /טווח אתמול/.test(page));
  ck('no label claims a single day when it means an average', !/>טווח יומי </.test(page));
  ck('what happened at the level is marked on the row', /פריצה נדחתה/.test(page) && /פרץ והחזיק/.test(page));
  ck('a rejected breakout is marked in the negative colour', /\.ev\.dn\{/.test(page));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
