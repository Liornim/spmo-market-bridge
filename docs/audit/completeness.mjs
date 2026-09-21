// Reusable day-completeness validator for the project's candle convention:
// one row per regular-session minute, labelled by its START in America/New_York,
// 09:30 .. 15:59 inclusive = 390 minutes (half days: 09:30 .. 12:59 = 210).
// Input rows: { date, time, open, high, low, close, volume } (unix optional).
// Verdicts: COMPLETE | PARTIAL | STALE | MISSING | DUPLICATE | CORRUPT
export const FULL = 390, HALF = 210;
// NYSE early closes (13:00 ET). Only dates confirmed from the published NYSE calendar; extend as needed.
const HALF_DAYS = new Set(['2026-11-27', '2026-12-24']);
export function expectedMinutes(date) {
  const n = HALF_DAYS.has(date) ? HALF : FULL, out = [];
  for (let i = 0; i < n; i++) { const m = 570 + i; out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')); }
  return out;
}
export function validateDay(date, rows, opts = {}) {
  const exp = expectedMinutes(date), expSet = new Set(exp);
  const seen = new Map(), dup = [], unexpected = [], corrupt = [], misaligned = [], outOfOrder = [];
  let zeroVol = 0, flatZero = 0, prev = '';
  for (const r of rows) {
    if (r.time <= prev) outOfOrder.push(r.time);
    prev = r.time;
    if (r.unix != null && r.unix % 60 !== 0) misaligned.push(r.time + ' (' + r.unix + ')');
    if (!expSet.has(r.time)) { unexpected.push(r.time); continue; }
    if (seen.has(r.time)) dup.push(r.time); else seen.set(r.time, r);
    const o = +r.open, h = +r.high, l = +r.low, c = +r.close, v = +r.volume;
    if (![o, h, l, c, v].every(Number.isFinite) || h < Math.max(o, c, l) || l > Math.min(o, c, h) || v < 0) corrupt.push(r.time);
    if (v === 0) { zeroVol++; if (o === h && h === l && l === c) flatZero++; }
  }
  const missing = exp.filter(t => !seen.has(t));
  const last = rows.length ? rows[rows.length - 1].time : null;
  let verdict;
  if (!rows.length) verdict = 'MISSING';
  else if (corrupt.length || misaligned.length || unexpected.length || outOfOrder.length) verdict = 'CORRUPT';
  else if (dup.length) verdict = 'DUPLICATE';
  else if (!missing.length) verdict = 'COMPLETE';
  else if (opts.today && opts.nowTime && last && missing.every(t => t > last) && opts.nowTime > last) {
    // a session in progress: only the tail is missing
    const lag = (h => h[0] * 60 + h[1])(opts.nowTime.split(':').map(Number)) - (h => h[0] * 60 + h[1])(last.split(':').map(Number));
    verdict = lag > (opts.staleAfterMin || 6) ? 'STALE' : 'PARTIAL';
  } else verdict = 'PARTIAL';
  return { date, verdict, expected: exp.length, present: seen.size, missing: missing.length,
    missing_sample: missing.slice(0, 6), duplicates: dup.length, unexpected: unexpected.length,
    misaligned: misaligned.length, out_of_order: outOfOrder.length, corrupt: corrupt.length,
    zero_volume: zeroVol, flat_zero_volume: flatZero, first: rows[0]?.time || null, last };
}
export function parseCsv(text) {
  const [head, ...lines] = text.trim().split('\n'); const k = head.split(',');
  return lines.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v])));
}
// CLI: node docs/audit/completeness.mjs file.csv [...]
if (import.meta.url === 'file://' + process.argv[1]) {
  const { readFileSync } = await import('node:fs');
  for (const f of process.argv.slice(2)) {
    const rows = parseCsv(readFileSync(f, 'utf8')), byDay = {};
    rows.forEach(r => (byDay[r.date] ||= []).push(r));
    const tally = {};
    for (const [d, rs] of Object.entries(byDay)) {
      const v = validateDay(d, rs); tally[v.verdict] = (tally[v.verdict] || 0) + 1;
      if (v.verdict !== 'COMPLETE') console.log(f.split('/').pop(), d, v.verdict, 'present', v.present + '/' + v.expected,
        'missing', v.missing, v.missing_sample.join(' '), 'dup', v.duplicates, 'unexp', v.unexpected, 'order', v.out_of_order, 'zeroVol', v.zero_volume, 'flat0', v.flat_zero_volume);
    }
    console.log('==', f.split('/').pop(), JSON.stringify(tally));
  }
}
