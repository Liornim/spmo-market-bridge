// Scenario tests for the scanner engine: each builds 1-minute bars whose right
// answer is known, and checks the engine reaches it. node tools/scanner/engine_test.mjs
import { scanAll, toCsv, candidates, COLUMNS, buffer, et } from './engine.mjs';

let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '   [' + info + ']' : '')); };

// trading dates (weekdays) ending 2026-10-06
const DATES = []; for (let d = new Date('2026-03-02T12:00:00Z'); d <= new Date('2026-10-06T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w && w < 6 && !['2026-09-07','2026-04-03','2026-05-25','2026-06-19','2026-07-03'].includes(d.toISOString().slice(0, 10))) DATES.push(d.toISOString().slice(0, 10)); }
const openU = date => Date.parse(date + 'T13:30:00Z') / 1000;          // EDT
const NOW = Date.parse('2026-10-06T21:00:00Z') / 1000;                  // after the close

// Build 1m bars from a list of 5m closes per session; each 5m candle goes linearly from prev close to its close.
function fromPath(perDay, vol = () => 1000) {
  const out = []; let prev = perDay[0][1][0];
  for (const [date, closes] of perDay) {
    closes.forEach((c, k) => {
      for (let m = 0; m < 5; m++) {
        const a = prev + (c - prev) * (m / 5), b = prev + (c - prev) * ((m + 1) / 5);
        out.push({ u: openU(date) + (k * 5 + m) * 60, o: +a.toFixed(4), h: +(Math.max(a, b) + 0.02).toFixed(4), l: +(Math.min(a, b) - 0.02).toFixed(4), c: +b.toFixed(4), v: vol(date, k, m) });
      }
      prev = c;
    });
  }
  return out;
}
const flatDays = (dates, p) => dates.map(d => [d, Array.from({ length: 78 }, (_, k) => p + Math.sin(k / 6) * 0.3)]);
const zig = (from, pts, n) => { const out = []; let cur = from; for (const target of pts) { for (let i = 1; i <= n; i++) out.push(cur + (target - cur) * i / n); cur = target; } return out; };
function pad78(a, last) { const r = a.slice(0, 78); while (r.length < 78) r.push(last ?? r[r.length - 1]); return r; }

// ---------------------------------------------------------------- A. breakout
{
  const hist = flatDays(DATES.slice(-40, -3), 90);
  const d1 = pad78(zig(90, [92, 91, 93, 92, 94, 93, 95], 10));
  const d2 = pad78(zig(95, [96.5, 95.8, 97.2, 96.4, 98], 12));
  // final day: uptrend leg then a tight base under 98.6
  const d3 = pad78(zig(98, [97.4, 98.6, 98.0, 98.55, 98.1, 98.58, 98.2], 9).concat(Array.from({ length: 20 }, (_, i) => 98.3 + (i % 2) * 0.2)));
  const bars = fromPath(hist.concat([[DATES.at(-3), d1], [DATES.at(-2), d2], [DATES.at(-1), d3]]));
  const { rows } = scanAll({ bars: { AAA: bars }, now: NOW });
  const r = rows[0];
  check('A breakout detected', /BREAKOUT/.test(r.short_term_setup || ''), r.short_term_setup + ' ' + r.short_term_status + ' | ' + r.short_term_why_not_ready);
  check('A entry is above the base high by the buffer', r.short_term_entry_price > 98.6 && r.short_term_entry_price <= +(98.62 + buffer(98.62) + 0.011).toFixed(2), r.short_term_entry_price);
  check('A entry action is a single price', /^BUY IF PRICE >= \d+\.\d{2}$/.test(r.short_term_entry_action || ''), r.short_term_entry_action);
  check('A stop below entry, R>0', r.short_term_stop_price < r.short_term_entry_price && r.short_term_risk_per_share > 0, r.short_term_stop_price);
  check('A target1 >= 1R', r.short_term_rr_target_1 >= 0.99, r.short_term_rr_target_1);
}

// ---------------------------------------------------------------- B. falling knife: downtrend into support, no reversal
{
  const hist = flatDays(DATES.slice(-40, -3), 100);
  const d1 = pad78(zig(100, [98, 99, 96, 97, 94, 95, 92], 10));
  const d2 = pad78(zig(92, [93, 90, 91, 88, 89, 86], 12));
  const d3 = pad78(zig(86, [87, 84, 85, 82, 83, 80.5], 12));
  const bars = fromPath(hist.concat([[DATES.at(-3), d1], [DATES.at(-2), d2], [DATES.at(-1), d3]]));
  const r = scanAll({ bars: { BBB: bars }, now: NOW }).rows[0];
  check('B 5m structure is DOWNTREND', /^DOWNTREND/.test(r.short_term_structure_5m), r.short_term_structure_5m);
  check('B downtrend never READY/ARMED', !['READY', 'ARMED'].includes(r.short_term_status), r.short_term_status + ' ' + r.short_term_setup);
}

// ---------------------------------------------------------------- C. reversal
{
  const hist = flatDays(DATES.slice(-40, -3), 100);
  const d1 = pad78(zig(100, [97, 98.5, 95, 96.5, 93, 94.5, 92], 10));
  const d2 = pad78(zig(92, [91.2, 89.6, 90.4, 88, 89.5, 87], 12));
  // LL 87; LH 89.5 reclaimed at ~90.2 and held; HL 89.7; high 91; prior highs 94.5+ are far away
  const d3 = pad78(zig(87, [88.3, 87.6, 90.2, 90.6, 90.4, 90.8, 89.7, 91.0, 90.3, 90.5], 7));
  const bars = fromPath(hist.concat([[DATES.at(-3), d1], [DATES.at(-2), d2], [DATES.at(-1), d3]]));
  const r = scanAll({ bars: { CCC: bars }, now: NOW }).rows[0];
  check('C reversal identified', /REVERSAL/.test(r.short_term_setup || ''), r.short_term_setup + ' ' + r.short_term_status + ' | ' + r.short_term_why_not_ready);
  check('C reversal stop is under the higher low', r.short_term_stop_price != null && r.short_term_stop_price < 90 && r.short_term_stop_price > 87, r.short_term_stop_price);
}

// ---------------------------------------------------------------- D. long term
{
  // 120 sessions: rallies from a 50 support four times, highs ~70, now back at 50.6
  const days = DATES.slice(-120);
  // each session drifts in a straight line to its target, so the only turning
  // points are the real ones: rallies off ~50 and tops near ~69.5
  let prevC = 50;
  const per = days.map((d, i) => { const cyc = i % 30; const tgt = cyc < 15 ? 50 + cyc * 1.3 : 69.5 - (cyc - 15) * 1.3;
    const a = prevC; prevC = tgt; return [d, Array.from({ length: 78 }, (_, k) => a + (tgt - a) * (k + 1) / 78)]; });
  per[per.length - 1][1] = Array.from({ length: 78 }, (_, k) => 50.9 - (k + 1) * 0.004);
  const lowBars = fromPath(per);
  const hiPer = days.map((d, i) => [d, Array.from({ length: 78 }, (_, k) => 50 + i * 0.25 + Math.sin(k / 5) * 0.2)]);
  const hiBars = fromPath(hiPer);
  const { rows } = scanAll({ bars: { LOWW: lowBars, HIGH: hiBars }, now: NOW });
  const lw = rows.find(r => r.symbol === 'LOWW'), hg = rows.find(r => r.symbol === 'HIGH');
  check('D low-percentile stock near tested support -> BUY NOW or BUY LOWER', ['BUY NOW', 'BUY LOWER'].includes(lw.long_term_status), lw.long_term_status + ' pct ' + lw.long_term_price_percentile + ' | ' + lw.long_term_why);
  check('D buy action is a single price', /^(BUY NOW AT|BUY IF PRICE <=) \d+\.\d{2}$/.test(lw.long_term_buy_action || ''), lw.long_term_buy_action);
  check('D invalidation below buy price', lw.long_term_invalidation_price < lw.long_term_buy_price, lw.long_term_invalidation_price + ' < ' + lw.long_term_buy_price);
  check('D stock at its highs -> NOT INTERESTING', hg.long_term_status === 'NOT INTERESTING', hg.long_term_status + ' pct ' + hg.long_term_price_percentile);
  check('D history_days = all sessions supplied', lw.history_days === 120, lw.history_days);
  check('D long rank ordering puts LOWW first', lw.long_term_rank === 1, lw.long_term_rank);
}

// ---------------------------------------------------------------- E. data rules
{
  const per = DATES.slice(-10).map(d => [d, Array.from({ length: 78 }, (_, k) => 20 + Math.sin(k / 4))]);
  const bars = fromPath(per, (d, k) => (k === 10 ? null : 500));
  bars.push({ ...bars[bars.length - 1] });                  // a duplicate
  bars.splice(200, 30);                                     // a gap
  const { rows } = scanAll({ bars: { DDD: bars }, now: NOW });
  const r = rows[0];
  check('E data warning raised', r.data_quality_status === 'WARNING', r.data_quality_status + ' ' + r._dq_detail);
  check('E duplicates and missing volume reported', /duplicate/.test(r._dq_detail) && /missing volume/.test(r._dq_detail), r._dq_detail);
  const csv = toCsv(rows);
  check('E CSV header is exactly the spec columns in order', csv.split('\n')[0] === COLUMNS.join(','));
  check('E CSV has 49 columns', COLUMNS.length === 49, COLUMNS.length);
  const vals = csv.split('\n')[1];
  check('E irrelevant values are blank, not 0', !/,0,0,0,/.test(vals));
  check('E candidates only READY/ARMED or BUY NOW/LOWER', candidates(rows).every(x => ['READY', 'ARMED'].includes(x.short_term_status) || ['BUY NOW', 'BUY LOWER'].includes(x.long_term_status)));
}

// ---------------------------------------------------------------- F. forming candle excluded
{
  const per = DATES.slice(-5).map(d => [d, Array.from({ length: 78 }, (_, k) => 30 + k * 0.01)]);
  const bars = fromPath(per);
  const lastU = bars[bars.length - 1].u;
  const r = scanAll({ bars: { EEE: bars }, now: lastU + 30 }).rows[0];  // last minute still forming
  const prev = bars[bars.length - 2];
  check('F current price = close of the last finished minute', r.current_price === Math.round(prev.c * 100) / 100, r.current_price + ' vs ' + prev.c);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
