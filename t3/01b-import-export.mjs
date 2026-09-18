// TRADER 3 — IMPORT FROM THE APPLICATION'S OWN EXPORT
//
// The app exports from D1 first and the archive second (worker.js:1818-1830).
// D1 holds the deep history — back to 2026-08-26 for the tracked symbols — and
// this sandbox cannot read D1 or Supabase at all: both answer 403, and the only
// channel that answers is GitHub, where publishShard writes just the last
// PUBLISH_DAYS = 7 sessions per symbol (worker.js:764). That is the entire
// reason my inventory was shallower than the app's, and it is not something I
// can work around from here.
//
// So the export file IS the dataset. This imports it deterministically:
// content hash, schema check, dedupe, and a per-session quality verdict — the
// same classification report 1 applies, so imported and published data are
// judged identically and can be pooled without a hidden difference in standard.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = 't3/reports';
mkdirSync(OUT, { recursive: true });
mkdirSync('t3/imported', { recursive: true });

const RTH_FIRST = 9 * 60 + 30, RTH_LAST = 15 * 60 + 59, EXPECTED = 390;
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

const HEADER = 'symbol,date,time,open,high,low,close,volume';

function importFile(path) {
  const raw = readFileSync(path);
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const lines = raw.toString('utf8').split('\n').filter(Boolean);
  const head = lines[0].trim();
  if (head !== HEADER) return { path, error: 'unexpected header: ' + head.slice(0, 80) };
  const bars = [];
  const bad = [];
  lines.slice(1).forEach((l, i) => {
    const p = l.split(',');
    if (p.length !== 8) { bad.push('line ' + (i + 2) + ': ' + p.length + ' fields'); return; }
    const b = { symbol: p[0], date: p[1], time: p[2],
      open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7] };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.time)) {
      bad.push('line ' + (i + 2) + ': bad date/time'); return; }
    if (![b.open, b.high, b.low, b.close, b.volume].every(isFinite)) {
      bad.push('line ' + (i + 2) + ': non-numeric'); return; }
    bars.push(b);
  });
  return { path: path.split('/').pop(), hash, bytes: raw.length, rows: bars.length, bars,
    malformed: bad.length, malformedSample: bad.slice(0, 3) };
}

// ---- merge every export, newest file wins on a conflict
const files = readdirSync('/mnt/user-data/uploads')
  .filter(f => /^bars_.*\.csv$/.test(f))
  .map(f => ({ f, mtime: statSync('/mnt/user-data/uploads/' + f).mtimeMs }))
  .sort((a, b) => a.mtime - b.mtime)
  .map(x => '/mnt/user-data/uploads/' + x.f);

const imports = files.map(importFile);
const store = new Map();                       // symbol|date|time -> bar
let collisions = 0, differing = 0;
imports.forEach(im => {
  if (im.error) return;
  im.bars.forEach(b => {
    const k = b.symbol + '|' + b.date + '|' + b.time;
    if (store.has(k)) {
      collisions++;
      const o = store.get(k);
      // A genuine disagreement between two exports of the same minute is a
      // data-integrity finding, not something to average away.
      if (o.open !== b.open || o.high !== b.high || o.low !== b.low ||
          o.close !== b.close || o.volume !== b.volume) differing++;
    }
    store.set(k, b);
  });
});

// ---- per-session quality, identical rules to report 1
const byKey = {};
for (const b of store.values()) {
  if (b.time < '09:30' || b.time > '15:59') continue;
  (byKey[b.symbol + '|' + b.date] = byKey[b.symbol + '|' + b.date] || []).push(b);
}
const sessions = [];
for (const key of Object.keys(byKey).sort()) {
  const [symbol, date] = key.split('|');
  const bars = byKey[key];
  const seen = {}; bars.forEach(b => seen[b.time] = b);
  const times = Object.keys(seen).sort();
  const missing = [];
  for (let m = RTH_FIRST; m <= RTH_LAST; m++) if (!seen[hm(m)]) missing.push(hm(m));
  const viol = bars.filter(b => !(b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close) || b.volume < 0);
  const unique = times.length;
  let status, reason;
  if (viol.length) { status = 'INVALID'; reason = viol.length + ' OHLC violations'; }
  else if (unique < 60) { status = 'INVALID'; reason = 'only ' + unique + ' bars'; }
  else if (missing.length) { status = 'PARTIAL'; reason = missing.length + ' missing minutes'; }
  else { status = 'FULL'; reason = ''; }
  sessions.push({ symbol, date, status, reason, unique, expected: EXPECTED,
    coverage: +(unique / EXPECTED * 100).toFixed(2), missing: missing.length,
    first: times[0], last: times[times.length - 1],
    missingSample: missing.slice(0, 10).join(' ') });
}

// ---- write the merged dataset, one file per symbol, sorted and deduped
const bySym = {};
for (const b of store.values()) (bySym[b.symbol] = bySym[b.symbol] || []).push(b);
Object.keys(bySym).forEach(s => {
  const rows = bySym[s].sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
  writeFileSync('t3/imported/' + s + '.csv', HEADER + '\n' +
    rows.map(b => [b.symbol, b.date, b.time, b.open, b.high, b.low, b.close, b.volume].join(',')).join('\n'));
});

const c = ['symbol','date','status','reason','unique','expected','coverage','missing','first','last','missingSample'];
writeFileSync(OUT + '/01b-imported-quality.csv',
  [c.join(',')].concat(sessions.map(r => c.map(k => JSON.stringify(r[k] == null ? '' : r[k])).join(','))).join('\n'));

// ---- report
console.log('=== TRADER 3 · IMPORT FROM APP EXPORT ===\n');
console.log('files imported:');
imports.forEach(im => {
  if (im.error) { console.log('  ' + im.path + '  ERROR ' + im.error); return; }
  console.log('  ' + im.path.padEnd(38) + 'sha ' + im.hash + '  ' + String(im.rows).padStart(7) + ' rows' +
    (im.malformed ? '  MALFORMED ' + im.malformed : ''));
});
console.log('\noverlapping minutes across files: ' + collisions +
  '   of which the values DISAGREE: ' + differing);

const full = sessions.filter(s => s.status === 'FULL');
const part = sessions.filter(s => s.status === 'PARTIAL');
const inval = sessions.filter(s => s.status === 'INVALID');
const dates = [...new Set(sessions.map(s => s.date))].sort();
const syms = [...new Set(sessions.map(s => s.symbol))];

console.log('\nMERGED DATASET');
console.log('  symbols      ' + syms.length);
console.log('  sessions     ' + dates.length + '   ' + dates[0] + ' → ' + dates[dates.length - 1]);
console.log('  symbol-days  ' + sessions.length);
console.log('    FULL       ' + full.length);
console.log('    PARTIAL    ' + part.length);
console.log('    INVALID    ' + inval.length);
console.log('  total bars   ' + store.size);

console.log('\nFULL symbol-days per date:');
const per = {}; full.forEach(s => per[s.date] = (per[s.date] || 0) + 1);
dates.forEach(d => console.log('  ' + d + '   ' + (per[d] || 0)));

if (part.length) {
  console.log('\nPARTIAL, worst 8:');
  part.slice().sort((a, b) => a.coverage - b.coverage).slice(0, 8)
    .forEach(s => console.log('  ' + s.symbol.padEnd(6) + s.date + '  ' + String(s.coverage).padStart(6) + '%  ' + s.reason));
}
writeFileSync(OUT + '/01b-import-summary.json', JSON.stringify({
  files: imports.map(i => ({ file: i.path, sha256_16: i.hash, rows: i.rows, malformed: i.malformed })),
  overlappingMinutes: collisions, disagreeing: differing,
  symbols: syms.length, sessions: dates.length, dateFrom: dates[0], dateTo: dates[dates.length - 1],
  symbolDays: sessions.length, full: full.length, partial: part.length, invalid: inval.length,
  bars: store.size }, null, 1));
console.log('\nwrote t3/imported/<SYM>.csv, t3/reports/01b-imported-quality.csv, 01b-import-summary.json');
