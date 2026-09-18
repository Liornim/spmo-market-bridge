// TRADER 3 — REPORT 1: DATA QUALITY
//
// Every later report depends on this one being honest. A session that is 97%
// complete is not a full session: a missing minute can hide the swing a
// candidate is built on, and averaging it in silently would put fabricated
// precision into every study that follows.
//
// Classification, decided before any analysis:
//   FULL     every regular-session minute from 09:30 to 15:59 present, no dupes
//   PARTIAL  continuous but short, or has holes
//   INVALID  OHLC violations, or fewer than 60 bars to work with at all
//
// Read-only. This reads the published archive and writes reports; it touches
// no engine and no live system.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

const DIR = 't3/data', OUT = 't3/reports';
mkdirSync(OUT, { recursive: true });

const RTH_FIRST = 9 * 60 + 30, RTH_LAST = 15 * 60 + 59;
const EXPECTED = RTH_LAST - RTH_FIRST + 1;             // 390
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const tm = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);

function loadSymbol(file) {
  const txt = readFileSync(DIR + '/' + file, 'utf8').split('\n').filter(Boolean);
  if (txt.length < 2) return [];
  return txt.slice(1).map(l => {
    const p = l.split(',');
    return { symbol: p[0], date: p[1], time: p[2],
      open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7] };
  });
}

const rows = [];
const files = readdirSync(DIR).filter(f => f.endsWith('.csv'));

for (const file of files) {
  const all = loadSymbol(file);
  if (!all.length) { rows.push({ symbol: file.replace('.csv', ''), date: '—', status: 'INVALID',
    reason: 'empty file', expected: 0, unique: 0, coverage: 0, missing: 0, dupes: 0,
    first: '—', last: '—' }); continue; }
  const sym = all[0].symbol;
  const byDate = {};
  all.forEach(r => { if (r.time >= '09:30' && r.time <= '15:59') (byDate[r.date] = byDate[r.date] || []).push(r); });

  for (const date of Object.keys(byDate).sort()) {
    const bars = byDate[date];
    const seen = {}, dupes = [];
    bars.forEach(r => { if (seen[r.time]) dupes.push(r.time); seen[r.time] = r; });
    const times = Object.keys(seen).sort();
    const first = times[0], last = times[times.length - 1];

    // OHLC sanity, per bar. A violation means the row cannot be trusted at all.
    const bad = bars.filter(r =>
      !(r.high >= r.low) || !(r.high >= r.open) || !(r.high >= r.close) ||
      !(r.low <= r.open) || !(r.low <= r.close) ||
      !isFinite(r.open) || !isFinite(r.close) || r.volume < 0);

    // Missing minutes measured against the FULL regular session, not against
    // whatever this file happens to contain — a session that starts at 09:47 is
    // missing its open, and that matters for VWAP and for the opening range.
    const missing = [];
    for (let m = RTH_FIRST; m <= RTH_LAST; m++) if (!seen[hm(m)]) missing.push(hm(m));

    const unique = times.length;
    const coverage = +(unique / EXPECTED * 100).toFixed(2);
    let status, reason;
    if (bad.length) { status = 'INVALID'; reason = bad.length + ' OHLC violations'; }
    else if (unique < 60) { status = 'INVALID'; reason = 'only ' + unique + ' bars'; }
    else if (dupes.length) { status = 'PARTIAL'; reason = dupes.length + ' duplicate timestamps'; }
    else if (missing.length) { status = 'PARTIAL'; reason = missing.length + ' missing minutes'; }
    else { status = 'FULL'; reason = ''; }

    rows.push({ symbol: sym, date, status, reason, expected: EXPECTED, unique, coverage,
      missing: missing.length, dupes: dupes.length, first, last,
      missingList: missing.slice(0, 12).join(' '), dupeList: [...new Set(dupes)].slice(0, 8).join(' ') });
  }
}

// ---- report
const c = ['symbol','date','status','reason','expected','unique','coverage','missing','dupes','first','last','missingList','dupeList'];
writeFileSync(OUT + '/01-data-quality.csv',
  [c.join(',')].concat(rows.map(r => c.map(k => JSON.stringify(r[k] == null ? '' : r[k])).join(','))).join('\n'));

const full = rows.filter(r => r.status === 'FULL');
const part = rows.filter(r => r.status === 'PARTIAL');
const inval = rows.filter(r => r.status === 'INVALID');
const dates = [...new Set(rows.map(r => r.date))].filter(d => d !== '—').sort();
const symsFull = [...new Set(full.map(r => r.symbol))];

console.log('=== TRADER 3 · REPORT 1 — DATA QUALITY ===\n');
console.log('source     published archive (the only store this sandbox can reach)');
console.log('symbols    ' + files.length);
console.log('sessions   ' + dates.length + '   ' + dates[0] + ' → ' + dates[dates.length - 1]);
console.log('');
console.log('symbol-days   ' + rows.length);
console.log('  FULL        ' + full.length + '  (' + (full.length / rows.length * 100).toFixed(1) + '%)');
console.log('  PARTIAL     ' + part.length);
console.log('  INVALID     ' + inval.length);
console.log('');
console.log('symbols with at least one FULL session: ' + symsFull.length);
console.log('FULL symbol-days available for training: ' + full.length);

const perDate = {};
full.forEach(r => perDate[r.date] = (perDate[r.date] || 0) + 1);
console.log('\nFULL sessions per date:');
dates.forEach(d => console.log('  ' + d + '   ' + (perDate[d] || 0) + ' symbols'));

if (part.length) {
  console.log('\nPARTIAL, worst 10 by coverage:');
  part.slice().sort((a, b) => a.coverage - b.coverage).slice(0, 10)
    .forEach(r => console.log('  ' + r.symbol.padEnd(6) + r.date + '  ' + String(r.coverage).padStart(6) + '%  ' + r.reason));
}
if (inval.length) {
  console.log('\nINVALID:');
  inval.slice(0, 10).forEach(r => console.log('  ' + r.symbol.padEnd(6) + r.date + '  ' + r.reason));
}
writeFileSync(OUT + '/01-summary.json', JSON.stringify({
  source: 'published archive', symbols: files.length, sessions: dates.length,
  dateFrom: dates[0], dateTo: dates[dates.length - 1],
  symbolDays: rows.length, full: full.length, partial: part.length, invalid: inval.length,
  symbolsWithFull: symsFull.length }, null, 1));
console.log('\nwrote t3/reports/01-data-quality.csv and 01-summary.json');
