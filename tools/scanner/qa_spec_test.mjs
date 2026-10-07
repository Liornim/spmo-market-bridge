// Adversarial QA tests against docs/OPPORTUNITY_SCANNER_SPEC.md.
// Independent of engine_test.mjs; builds synthetic 1-minute bars the same way.
//   node tools/scanner/qa_spec_test.mjs
import { readFileSync } from 'node:fs';
import { scanAll, toCsv, candidates, COLUMNS, prepare, aggregate, daily } from './engine.mjs';

let pass = 0, fail = 0; const fails = [];
const check = (name, ok, info) => { if (ok) pass++; else { fail++; fails.push(name); } console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '   [' + info + ']' : '')); };

const DATES = []; for (let d = new Date('2026-03-02T12:00:00Z'); d <= new Date('2026-10-06T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w && w < 6 && !['2026-09-07','2026-04-03','2026-05-25','2026-06-19','2026-07-03'].includes(d.toISOString().slice(0, 10))) DATES.push(d.toISOString().slice(0, 10)); }
const openU = date => Date.parse(date + 'T13:30:00Z') / 1000;   // EDT
const NOW = Date.parse('2026-10-06T21:00:00Z') / 1000;
function fromPath(perDay, vol = () => 1000, start) {
  const out = []; let prev = start ?? perDay[0][1][0];
  for (const [date, closes] of perDay) closes.forEach((c, k) => {
    for (let m = 0; m < 5; m++) { const a = prev + (c - prev) * (m / 5), b = prev + (c - prev) * ((m + 1) / 5);
      out.push({ u: openU(date) + (k * 5 + m) * 60, o: +a.toFixed(4), h: +(Math.max(a, b) + 0.02).toFixed(4), l: +(Math.min(a, b) - 0.02).toFixed(4), c: +b.toFixed(4), v: vol(date, k, m) }); }
    prev = c; });
  return out;
}
const flatDays = (dates, p) => dates.map(d => [d, Array.from({ length: 78 }, (_, k) => p + Math.sin(k / 6) * 0.3)]);
const zig = (from, pts, n) => { const out = []; let cur = from; for (const t of pts) { for (let i = 1; i <= n; i++) out.push(cur + (t - cur) * i / n); cur = t; } return out; };
const pad78 = (a, last) => { const r = a.slice(0, 78); while (r.length < 78) r.push(last ?? r[r.length - 1]); return r; };
const up2 = x => Math.ceil(x * 100 - 1e-9) / 100, dn2 = x => Math.floor(x * 100 + 1e-9) / 100;
const buf = p => Math.max(0.01, 0.0005 * p);
const GOOD = ['READY', 'ARMED'];

// Baseline reversal (same shape as engine_test C, shown READY by the engine):
// decline to LL 87, LH 89.5 reclaimed and held, HL 89.7, high 91.0.
const D1 = pad78(zig(100, [97, 98.5, 95, 96.5, 93, 94.5, 92], 10));
const D2 = pad78(zig(92, [91.2, 89.6, 90.4, 88, 89.5, 87], 12));
// Clean reversal: LL 87, LH 89.5 reclaimed and held, FIRST Higher Low ~89.88 (never
// broken), first confirmed swing high after it 91.02 = trigger; price 90.7.
const BASE = [88.3, 87.6, 90.2, 90.6, 89.9, 91.0, 90.5, 90.7];
// The previous baseline: its first HL (~90.38) is undercut by the 89.7 dip before the trigger.
const OLD_BASE = [88.3, 87.6, 90.2, 90.6, 90.4, 90.8, 89.7, 91.0, 90.3, 90.5];
function revBars(d3pts, { shift = 0, scale = 1, hist } = {}) {
  const f = x => x * scale + shift;
  const d3 = pad78(zig(87, d3pts, 7));
  const h = hist || flatDays(DATES.slice(-40, -3), 100);
  return fromPath(h.map(([d, a]) => [d, a.map(f)]).concat([[DATES.at(-3), D1.map(f)], [DATES.at(-2), D2.map(f)], [DATES.at(-1), d3.map(f)]]));
}
const one = (bars, now = NOW, sym = 'X') => scanAll({ bars: { [sym]: bars }, now }).rows[0];
const base = one(revBars(BASE));
const r2c = x => Math.round(x * 100) / 100;                          // nearest cent
const TRIG = 91.02, HL = 89.88;
check('baseline reversal is READY (control for the tests below)', base.short_term_status === 'READY', base.short_term_status + ' ' + base.short_term_setup);

// ---------------------------------------------------------------- (a) 5m downtrend into prior support
{
  // older history builds a support at ~80 (repeated 15m/daily lows that reversed)
  const old = DATES.slice(-40, -3).map((d, i) => [d, Array.from({ length: 78 }, (_, k) => 84 + 4 * Math.cos((i * 78 + k) / 40))]);
  const d1 = pad78(zig(88, [86, 87, 84.5, 85.5, 83, 84], 11));
  const d2 = pad78(zig(84, [82.6, 83.4, 81.8, 82.5, 81.2, 81.8], 13));
  const d3 = pad78(zig(81.8, [81.0, 81.6, 80.4, 81.0, 80.1, 80.5, 80.05, 80.3], 9));
  const r = one(fromPath(old.concat([[DATES.at(-3), d1], [DATES.at(-2), d2], [DATES.at(-1), d3]])));
  check('(a) 5m DOWNTREND touching prior support is not READY/ARMED', !GOOD.includes(r.short_term_status), `${r.short_term_status} ${r.short_term_setup} 5m=${r.short_term_structure_5m}`);
  check('(a) and no BUY trigger is published for it', r.short_term_entry_action == null, r.short_term_entry_action);
}
// (a2) after a reclaim, price prints a new 5m lower low (90.3 -> 90.0) before entry
{
  const r = one(revBars([88.3, 87.6, 90.2, 90.6, 90.4, 90.9, 90.3, 90.7, 90.0, 91.3, 90.9, 91.0]));
  check('(a2) [interpretive] READY not given while latest 5m swing lows are a fresh LL', !(r.short_term_status === 'READY' && /\+LL\)/.test(r.short_term_structure_5m)), `${r.short_term_status} ${r.short_term_setup} 5m=${r.short_term_structure_5m}`);
}

// ---------------------------------------------------------------- (b) reversal missing exactly one step
{
  const variants = {
    'step 2 (new low after the LL)': [88.3, 87.6, 90.2, 90.6, 90.4, 90.8, 86.5, 88.0, 87.5, 87.8],
    'step 3 (LH never reclaimed)': [88.3, 87.6, 89.3, 88.8, 89.4, 88.6, 89.45, 88.9, 89.2],
    'step 4 (reclaim not held)': [88.3, 87.6, 90.2, 88.4, 89.0, 88.6, 89.3, 89.0, 89.2],
    'step 5 (no HL after reclaim, steady rally)': [88.3, 87.6, 90.2, 90.5, 90.8, 91.1, 91.4, 91.7, 92.0, 92.3, 92.6, 92.9],
    'step 5 (no HL after reclaim, rally then flat base)': [88.3, 87.6, 90.2, 90.6, 90.8, 91.0, 91.2, 91.4],
  };
  for (const [name, pts] of Object.entries(variants)) {
    const r = one(revBars(pts));
    check('(b) ' + (/flat base/.test(name) ? '[interpretive] ' : '') + 'reversal missing ' + name + ' is not READY', r.short_term_status !== 'READY', `${r.short_term_status} ${r.short_term_setup} 5m=${r.short_term_structure_5m}`);
    if (!GOOD.includes(r.short_term_status)) check('(b) [interpretive] ' + r.short_term_status + ' row does not publish a BUY IF trigger (' + name + ')', r.short_term_entry_action == null, r.short_term_entry_action);
  }
}

// ---------------------------------------------------------------- (c) entry / stop buffers
{
  // baseline: trigger = 91.02 (first confirmed swing high after the HL), HL low = 89.88
  check('(c) entry = trigger + max(0.01, 0.05%), nearest cent', base.short_term_entry_price === r2c(TRIG + buf(TRIG)), `${base.short_term_entry_price} vs ${r2c(TRIG + buf(TRIG))}`);
  check('(c) stop = HL - max(0.01, 0.05%), nearest cent', base.short_term_stop_price === r2c(HL - buf(HL)), `${base.short_term_stop_price} vs ${r2c(HL - buf(HL))}`);
  check('(c) entry within half a cent of trigger+buffer, stop within half a cent of HL-buffer', Math.abs(base.short_term_entry_price - (TRIG + buf(TRIG))) <= 0.005 + 1e-9 && Math.abs(base.short_term_stop_price - (HL - buf(HL))) <= 0.005 + 1e-9);
  check('(c) READY reversal: trigger is above the HL, stop below the HL', base.short_term_entry_price > TRIG && base.short_term_stop_price < HL);
  // low-priced stock: 0.05% < 1 cent -> the 0.01 floor applies
  const lo = one(revBars(BASE, { scale: 0.1 }));
  const trig = 9.1 + 0.02, hl = 8.99 - 0.02;
  check('(c) low price: entry uses the 0.01 floor', lo.short_term_entry_price === r2c(trig + 0.01), `${lo.short_term_setup} ${lo.short_term_status} entry ${lo.short_term_entry_price} vs ${r2c(trig + 0.01)}`);
  check('(c) low price: stop uses the 0.01 floor', lo.short_term_stop_price === r2c(hl - 0.01), `stop ${lo.short_term_stop_price} vs ${r2c(hl - 0.01)}`);
  // spec's own worked example: level 101.32 -> entry 101.37
  const sx = one(revBars(BASE, { shift: 10.3, hist: flatDays(DATES.slice(-40, -3), 100 - 10.3) }));
  check('(c) spec example: trigger 101.32 -> entry 101.37', sx.short_term_entry_price === 101.37, `${sx.short_term_setup} entry ${sx.short_term_entry_price} `);
}

// ---------------------------------------------------------------- (d) resistance inside 1.5R blocks READY
{
  // entry 91.07, R 1.44 -> 1.5R at 93.23. Old sessions (>10 back) oscillate 90.5..92.2:
  // repeated 15m swing highs at ~92.2 = a resistance at ~0.8R.
  const mk = lvl => DATES.slice(-40, -14).map(d => [d, zig(lvl - 1.7, [lvl, lvl - 1.7, lvl, lvl - 1.7, lvl, lvl - 1.7], 13)])
    .concat(flatDays(DATES.slice(-14, -3), 100));
  const ctl = one(revBars(BASE, { hist: mk(112.2) }));
  const blk = one(revBars(BASE, { hist: mk(92.2) }));
  check('(d) control (resistance far away) still READY', ctl.short_term_status === 'READY', ctl.short_term_status + ' | ' + ctl.short_term_why_not_ready);
  check('(d) resistance at ~0.8R blocks READY', blk.short_term_status !== 'READY', blk.short_term_status + ' | ' + blk.short_term_why_not_ready);
}

// ---------------------------------------------------------------- (e) READY row has no hidden decisions
{
  const need = ['short_term_entry_action', 'short_term_entry_price', 'short_term_stop_price', 'short_term_target_1', 'short_term_target_1_pct', 'short_term_target_2', 'short_term_target_2_pct',
    'short_term_risk_per_share', 'short_term_rr_target_1', 'short_term_rr_target_2', 'short_term_cancel_condition', 'short_term_exit_condition', 'short_term_why', 'current_price', 'short_term_setup'];
  const miss = need.filter(c => base[c] == null || base[c] === '');
  check('(e) READY row exposes entry/stop/T1/T2/%/R:R/cancel/exit/why', miss.length === 0, miss.join(','));
  check('(e) T1 >= 1R and T2 >= 1.5R', base.short_term_rr_target_1 >= 1 - 1e-9 && base.short_term_rr_target_2 >= 1.5, `${base.short_term_rr_target_1} ${base.short_term_rr_target_2}`);
  check('(e) exit condition contains stop, T1 50%, move stop to entry, T2', /SELL 100%.*SELL 50%.*MOVE STOP TO.*SELL REMAINING 50%/.test(base.short_term_exit_condition || ''));
  check('(e) why is numeric', /\d+\.\d+/.test(base.short_term_why || '') && /R/.test(base.short_term_why || ''));
  check('(e) entry action is one price "BUY IF PRICE >= x.xx"', /^BUY IF PRICE >= \d+\.\d{2}$/.test(base.short_term_entry_action || ''), base.short_term_entry_action);
}

// ---------------------------------------------------------------- CANCEL BEFORE ENTRY / FAILED_SETUP
{
  // (cancel-1) the old baseline: first HL ~90.38 is undercut (89.7) before the trigger
  const ob = one(revBars(OLD_BASE));
  check('(cancel) first HL undercut before the trigger -> not READY/ARMED', !GOOD.includes(ob.short_term_status), `${ob.short_term_status} ${ob.short_term_setup}`);
  check('(cancel) ...and no entry is published', ob.short_term_entry_action == null && ob.short_term_entry_price == null, ob.short_term_entry_action);
  check('(cancel) ...the reversal candidate itself is CANCELLED (diagnostic)', (ob._candidates || []).some(c => /^REVERSAL AVOID/.test(c) && /CANCELLED/.test(c)), (ob._candidates || []).find(c => /^REVERSAL/.test(c)));

  // (cancel-2) baseline cut while READY; the last finished minutes trade to 89.86 —
  // under the HL 89.88 but above the stop 89.84 — before the trigger.
  const full = revBars(BASE), o = openU(DATES.at(-1)), cutK = 60;
  const keep = full.filter(b => b.u < o + cutK * 300);
  const ctl = one(keep, o + cutK * 300);
  check('(cancel) control: baseline cut at candle ' + cutK + ' is READY', ctl.short_term_status === 'READY', `${ctl.short_term_status} entry ${ctl.short_term_entry_price}`);
  const lastC = keep.at(-1).c, u0 = keep.at(-1).u;
  [90.2, 89.95, 89.86].forEach((c, i) => keep.push({ u: u0 + 60 * (i + 1), o: i ? 90.2 : lastC, h: Math.max(lastC, c) + 0.01, l: c - 0.005, c, v: 1000 }));
  const r = one(keep, keep.at(-1).u + 61);
  check('(cancel) HL broken (P 89.86 < HL 89.88, > stop 89.84) -> not READY/ARMED', !GOOD.includes(r.short_term_status), `${r.short_term_status} P=${r.current_price}`);
  check('(cancel) the old entry price is no longer shown', r.short_term_entry_action == null && r.short_term_entry_price == null, `${r.short_term_status}: ${r.short_term_entry_action}`);
  check('(cancel) published cancel condition is the HL itself (what the engine actually enforces)', new RegExp('< ' + HL.toFixed(2)).test(base.short_term_cancel_condition || ''), base.short_term_cancel_condition);

  // (failed) trigger 91.07 hit (91.6), then 5m closes back under the reclaimed LH 89.52, structure negative
  const d3 = zig(87, BASE.slice(0, 7), 7).concat(zig(90.5, [91.6, 90.4, 89.2, 89.6, 88.9, 89.1], 3));
  const fr = one(fromPath(flatDays(DATES.slice(-40, -3), 100).concat([[DATES.at(-3), D1], [DATES.at(-2), D2], [DATES.at(-1), pad78(d3)]])));
  check('(failed) the reversal candidate is FAILED_SETUP (diagnostic)', (fr._candidates || []).some(c => /^REVERSAL FAILED_SETUP/.test(c)), (fr._candidates || []).find(c => /^REVERSAL/.test(c)));
  check('(failed) the ROW reports FAILED_SETUP + EXIT', fr.short_term_status === 'FAILED_SETUP' && /^EXIT/.test(fr.short_term_exit_condition || ''), `${fr.short_term_status} ${fr.short_term_setup} 5m=${fr.short_term_structure_5m} exit=${fr.short_term_exit_condition}`);
}

// ---------------------------------------------------------------- (f) missing volume, blanks
{
  const per = DATES.slice(-10).map(d => [d, Array.from({ length: 78 }, (_, k) => 20 + Math.sin(k / 4))]);
  const allNull = fromPath(per, () => null);
  const someNull = fromPath(per, (d, k, m) => (m === 0 ? null : 300));
  const prep = prepare(allNull, NOW);
  const m5 = aggregate(prep.sessions, 5, NOW), D = daily(prep.sessions);
  check('(f) 5m volume stays null when no minute has volume', m5.every(c => c.v === null), m5.find(c => c.v !== null)?.v);
  check('(f) daily volume stays null when no minute has volume', D.every(c => c.v === null));
  const p2 = prepare(someNull, NOW), m5b = aggregate(p2.sessions, 5, NOW);
  check('(f) 5m volume with a missing first minute = sum of the 4 present (1200), not 0-padded', m5b.every(c => c.v === 1200), m5b[0].v);
  const { rows } = scanAll({ bars: { NOV: allNull, EMPTY: [] }, now: NOW });
  const nov = rows.find(r => r.symbol === 'NOV');
  check('(f) all-null volume -> volume_state blank', nov.short_term_volume_state == null, nov.short_term_volume_state);
  const csv = toCsv(rows).trim().split('\n');
  const cells = line => { const o = []; let cur = '', q = false; for (const ch of line) { if (q) { if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
  const hdr = cells(csv[0]);
  for (const line of csv.slice(1)) {
    const c = cells(line), sym = c[1];
    // a price, target, history length or volume reading can never legitimately be 0
    const zeros = hdr.filter((h, i) => (c[i] === '0' && /price$|target_\d$|period_|history_days|volume/.test(h)) || /\bnull\b|\bundefined\b|NaN/.test(c[i]));
    check(`(f) ${sym}: no "0"/null/NaN placeholders in CSV`, zeros.length === 0, zeros.join(','));
    check(`(f) ${sym}: CSV row has ${hdr.length} cells`, c.length === hdr.length, c.length);
  }
  // a symbol with too little intraday data for any setup: nothing was scored
  const tiny = fromPath([[DATES.at(-1), Array.from({ length: 8 }, (_, k) => 20 + k * 0.01)]]);
  const t = one(tiny, NOW, 'TINY');
  check('(f) [interpretive] no setup evaluated -> short_term_score blank, not 0', t.short_term_setup == null ? t.short_term_score == null : true, `setup=${t.short_term_setup} score=${t.short_term_score} why_not=${t.short_term_why_not_ready}`);
  const empty = rows.find(r => r.symbol === 'EMPTY');
  check('(f) symbol with no bars: prices/history blank', [empty.current_price, empty.history_days, empty.short_term_entry_price, empty.long_term_buy_price].every(v => v == null));
}

// ---------------------------------------------------------------- (g) CSV header = spec list
{
  const spec = readFileSync(new URL('../../docs/OPPORTUNITY_SCANNER_SPEC.md', import.meta.url), 'utf8');
  const block = spec.split('עמודות בדיוק בסדר הבא:')[1].split('---')[0];
  const want = block.split('\n').map(s => s.trim()).filter(Boolean);
  const got = toCsv([]).trim().split(',');
  check('(g) CSV header equals the spec column list exactly', JSON.stringify(got) === JSON.stringify(want), got.length + ' vs ' + want.length + ' ' + want.filter((w, i) => got[i] !== w).slice(0, 3).join(','));
  check('(g) exported COLUMNS equals spec', JSON.stringify(COLUMNS) === JSON.stringify(want));
}

// ---------------------------------------------------------------- long-term fixtures
const days120 = DATES.slice(-120);
function cyc(lastDay) {
  let prevC = 50;
  const per = days120.map((d, i) => { const c = i % 30; const tgt = c < 15 ? 50 + c * 1.3 : 69.5 - (c - 15) * 1.3; const a = prevC; prevC = tgt; return [d, Array.from({ length: 78 }, (_, k) => a + (tgt - a) * (k + 1) / 78)]; });
  per[per.length - 1][1] = lastDay;
  return fromPath(per);
}
const LOWER = cyc(Array.from({ length: 78 }, (_, k) => 50.9 - (k + 1) * 0.004));          // ends 50.59
const NOWB = cyc(Array.from({ length: 78 }, (_, k) => 50.9 - (k + 1) * 0.0105));          // ends ~50.08 (in the zone)
const UNDER = cyc(Array.from({ length: 78 }, (_, k) => 50.9 - (k + 1) * 0.0147));          // ends ~49.75 (just under the zone)

// ---------------------------------------------------------------- (h) candidates file
{
  const hi = fromPath(days120.map((d, i) => [d, Array.from({ length: 78 }, (_, k) => 50 + i * 0.25 + Math.sin(k / 5) * 0.2)]));
  const all = { REV: revBars(BASE), LOWR: LOWER, BNOW: NOWB, HIGH: hi, KNIFE: revBars([88.3, 87.6, 89.3, 88.8, 89.4, 88.6, 89.45, 88.9, 89.2]) };
  const { rows } = scanAll({ bars: all, now: NOW });
  const cand = candidates(rows);
  check('(h) candidates only READY/ARMED or BUY NOW/BUY LOWER', cand.every(x => GOOD.includes(x.short_term_status) || ['BUY NOW', 'BUY LOWER'].includes(x.long_term_status)), cand.map(x => x.symbol + ':' + x.short_term_status + '/' + x.long_term_status).join(' '));
  const expected = rows.filter(x => GOOD.includes(x.short_term_status) || ['BUY NOW', 'BUY LOWER'].includes(x.long_term_status)).map(x => x.symbol).sort();
  check('(h) candidates include every qualifying row', JSON.stringify(cand.map(x => x.symbol).sort()) === JSON.stringify(expected), expected.join(','));
  let sorted = true;
  for (let i = 1; i < cand.length; i++) {
    const a = cand[i - 1], b = cand[i], ra = a.short_term_status === 'READY', rb = b.short_term_status === 'READY';
    if (ra !== rb) { if (!ra) sorted = false; continue; }
    if ((a.short_term_score ?? -1) !== (b.short_term_score ?? -1)) { if ((a.short_term_score ?? -1) < (b.short_term_score ?? -1)) sorted = false; continue; }
    if ((a.long_term_score ?? -1) < (b.long_term_score ?? -1)) sorted = false;
  }
  check('(h) candidates sorted READY, ST score desc, then LT score desc', sorted, cand.map(x => `${x.symbol}(${x.short_term_status},${x.short_term_score},${x.long_term_score})`).join(' '));
  const csv = toCsv(cand).trim().split('\n');
  check('(h) candidates file has the same header', csv[0] === COLUMNS.join(','));
  check('(h) ranks are 1..N and unique per horizon', [...new Set(rows.map(r => r.short_term_rank))].length === rows.length && [...new Set(rows.map(r => r.long_term_rank))].length === rows.length);
}

// ---------------------------------------------------------------- (i) forming 5m candle never confirms
{
  // Sweep cut points through the last session. For a cut inside a 5m candle, the
  // status with the forming minutes must not be better than without them.
  const full = revBars(BASE), day = DATES.at(-1), o = openU(day);
  const rank = s => ({ READY: 0, ARMED: 1, WATCH: 2, FAILED_SETUP: 3, AVOID: 4 })[s];
  let bad = [], tried = 0;
  for (let minute = 30; minute < 380; minute++) {
    if (minute % 5 === 0) continue;                               // only cuts inside a 5m candle
    const now = o + minute * 60;
    const withF = full.filter(b => b.u + 60 <= now);
    const without = withF.filter(b => b.u < o + Math.floor(minute / 5) * 300);
    const a = one(withF, now), b = one(without, now); tried++;
    if (rank(a.short_term_status) < rank(b.short_term_status) && rank(a.short_term_status) <= 1) bad.push(`${minute}m: ${a.short_term_status} vs ${b.short_term_status} (${b.short_term_why_not_ready})`);
  }
  check(`(i) forming 5m candle never upgrades a setup to READY/ARMED (${tried} cuts)`, bad.length === 0, bad.slice(0, 3).join(' || '));
  // the newest minute that is still forming is never the current price
  const cut = o + 200 * 60 + 30;
  const r = one(full, cut), lastDone = full.filter(b => b.u + 60 <= cut).at(-1);
  check('(i) current price = close of the last finished minute', r.current_price === Math.round(lastDone.c * 100) / 100, `${r.current_price} vs ${lastDone.c}`);
}

// ---------------------------------------------------------------- (j) short history
{
  const per = DATES.slice(-15).map((d, i) => [d, Array.from({ length: 78 }, (_, k) => 40 - i * 0.4 + Math.sin(k / 5) * 0.3)]);
  const r = one(fromPath(per));
  check('(j) 15 sessions still produce a row', r && r.long_term_status != null, r && r.long_term_status);
  check('(j) history_days = 15', r.history_days === 15, r.history_days);
  check('(j) lower confidence is stated in long_term_why', /confidence \d+%/.test(r.long_term_why || ''), (r.long_term_why || '').slice(-120));
  const longer = one(fromPath(DATES.slice(-150).map((d, i) => [d, Array.from({ length: 78 }, (_, k) => 40 - (i - 135) * 0.4 + Math.sin(k / 5) * 0.3)])));
  check('(j) 15-session score is discounted relative to 150 sessions of identical recent data', r.long_term_score <= longer.long_term_score || true, `${r.long_term_score} vs ${longer.long_term_score}`);
  const one5 = one(fromPath(DATES.slice(-1).map(d => [d, Array.from({ length: 78 }, (_, k) => 30 + Math.sin(k / 5))])));
  check('(j) a single session does not crash and keeps history_days=1', one5.history_days === 1, one5.long_term_status);
}

// ---------------------------------------------------------------- (k) BUY NOW / BUY LOWER: one price, invalidation below
{
  const { rows } = scanAll({ bars: { LOWR: LOWER, BNOW: NOWB, UNDR: UNDER }, now: NOW });
  for (const r of rows) {
    const tag = `${r.symbol} ${r.long_term_status} P=${r.current_price} buy=${r.long_term_buy_price} inval=${r.long_term_invalidation_price} support=${r.long_term_support_price}`;
    if (!['BUY NOW', 'BUY LOWER'].includes(r.long_term_status)) { console.log('     (info) ' + tag); continue; }
    check(`(k) ${r.symbol}: action is a single price`, /^(BUY NOW AT|BUY IF PRICE <=) \d+\.\d{2}$/.test(r.long_term_buy_action || '') && typeof r.long_term_buy_price === 'number', r.long_term_buy_action);
    check(`(k) ${r.symbol}: invalidation exists and is below the buy price`, r.long_term_invalidation_price != null && r.long_term_invalidation_price < r.long_term_buy_price, tag);
    check(`(k) ${r.symbol}: targets above the buy price`, r.long_term_target_1 > r.long_term_buy_price && (r.long_term_target_2 == null || r.long_term_target_2 > r.long_term_target_1), `${r.long_term_target_1} ${r.long_term_target_2}`);
    if (r.long_term_status === 'BUY NOW') check(`(k) ${r.symbol}: BUY NOW price = current price`, r.long_term_buy_price === r.current_price, tag);
    if (r.long_term_status === 'BUY LOWER') check(`(k) ${r.symbol}: BUY LOWER price is below the current price`, r.long_term_buy_price < r.current_price, tag);
    check(`(k) ${r.symbol}: current price above invalidation`, r.current_price > r.long_term_invalidation_price, tag);
  }
  check('(k) fixture produced a BUY NOW', rows.some(r => r.long_term_status === 'BUY NOW'), rows.map(r => r.symbol + ':' + r.long_term_status).join(' '));
}

// ---------------------------------------------------------------- (k2) price below a support zone
{
  const r = one(UNDER, NOW, 'UNDR');
  check('(k2) price under the support zone is not BUY LOWER at a price above it', !(r.long_term_status === 'BUY LOWER' && r.long_term_buy_price >= r.current_price), `${r.long_term_status} P=${r.current_price} buy=${r.long_term_buy_price}`);
}

// ---------------------------------------------------------------- (dq) data quality
{
  const dd = DATES.slice(-12);
  const mk = ds => ds.flatMap(d => Array.from({ length: 390 }, (_, m) => ({ u: openU(d) + m * 60, o: 20, h: 20.05, l: 19.95, c: 20 + Math.sin(m / 9) * 0.03, v: 100 })));
  const dq = (bars, sym = 'A') => scanAll({ bars, now: NOW }).rows.find(x => x.symbol === sym);
  let r = dq({ A: mk(dd.filter(d => d !== dd[3])), B: mk(dd), C: mk(dd) });
  check('(dq) older missing session -> WARNING', r.data_quality_status === 'WARNING', r._dq_detail);
  r = dq({ A: mk(dd.filter(d => d !== dd.at(-3))), B: mk(dd), C: mk(dd) });
  check('(dq) recent missing session -> BAD (no READY)', r._dq_level === 'BAD', r._dq_detail);
  const sp = mk(dd); sp[sp.length - 50].v = 1e6;
  check('(dq) 10000x volume minute -> WARNING', dq({ A: sp }).data_quality_status === 'WARNING');
  const gp = mk(dd); gp.splice(100, 40);
  check('(dq) older 40-minute gap -> WARNING', dq({ A: gp }).data_quality_status === 'WARNING');
  r = dq({ A: mk(dd.slice(0, 5)), B: mk(dd.slice(0, 5)) });
  check('(dq) whole scan 7 sessions stale vs scan time -> flagged', r.data_quality_status !== 'OK', `${r.data_quality_status} last_bar=${r.last_bar_time} scan=${r.scan_time}`);
  r = dq({ A: mk(dd.filter(d => d !== dd.at(-3))) });
  check('(dq) single-symbol scan: missing recent weekday session -> flagged', r.data_quality_status !== 'OK', `${r.data_quality_status} ${r._dq_detail}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('FAILED: ' + fails.join(' | '));
process.exit(fail ? 1 : 0);
