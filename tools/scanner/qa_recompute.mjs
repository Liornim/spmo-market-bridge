#!/usr/bin/env node
// Independent QA for the Opportunity Scanner outputs.
//
// Reads scan/opportunity_scan_all.csv, scan/opportunity_candidates.csv and
// scan/latest.json from the working directory and checks them against
// docs/OPPORTUNITY_SCANNER_SPEC.md WITHOUT using the scanner's own code:
//   A. structure (header, uniqueness, candidates filter + order, blanks, summary, ranks)
//   B. per-row arithmetic (entry text, stop/entry, risk, R:R, target %, long-term action)
//   C. recomputation from raw Supabase bars for a deterministic sample of symbols
//      (skipped with a clear message when SUPABASE_URL / SUPABASE_KEY are absent)
//
// Output: report on stdout + .github/audit/qa_scanner.md (override: QA_REPORT_PATH),
// last line QA_RECOMPUTE: PASS | FAIL, exit 0 / 1.
//
// Env: SUPABASE_URL, SUPABASE_KEY, QA_SAMPLE_SIZE (default 25), QA_SEED (default 20261007),
//      QA_CONCURRENCY (default 4), QA_REPORT_PATH.

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- spec header (FILE 1)
const SPEC_HEADER = [
  'scan_time', 'symbol', 'history_start', 'history_end', 'history_days', 'last_bar_time',
  'current_price', 'data_quality_status',
  'short_term_rank', 'short_term_status', 'short_term_score', 'short_term_setup',
  'short_term_structure_5m', 'short_term_structure_15m', 'short_term_relative_strength',
  'short_term_volume_state', 'short_term_move_potential', 'short_term_entry_action',
  'short_term_entry_price', 'short_term_stop_price', 'short_term_target_1',
  'short_term_target_1_pct', 'short_term_target_2', 'short_term_target_2_pct',
  'short_term_risk_per_share', 'short_term_rr_target_1', 'short_term_rr_target_2',
  'short_term_cancel_condition', 'short_term_exit_condition', 'short_term_why',
  'short_term_why_not_ready',
  'long_term_rank', 'long_term_status', 'long_term_score', 'long_term_buy_action',
  'long_term_buy_price', 'long_term_price_percentile', 'long_term_period_high',
  'long_term_period_low', 'long_term_drawdown_from_high_pct', 'long_term_distance_from_low_pct',
  'long_term_support_price', 'long_term_falling_risk', 'long_term_target_1',
  'long_term_target_1_pct', 'long_term_target_2', 'long_term_target_2_pct',
  'long_term_invalidation_price', 'long_term_why',
];

const SHORT_STATUSES = ['READY', 'ARMED', 'WATCH', 'AVOID'];
const LONG_STATUSES = ['BUY NOW', 'BUY LOWER', 'WATCH', 'NOT INTERESTING'];
// Fields that only make sense when a short-term trade plan exists.
const SHORT_PLAN_FIELDS = [
  'short_term_entry_action', 'short_term_entry_price', 'short_term_stop_price',
  'short_term_target_1', 'short_term_target_1_pct', 'short_term_target_2',
  'short_term_target_2_pct', 'short_term_risk_per_share', 'short_term_rr_target_1',
  'short_term_rr_target_2', 'short_term_cancel_condition', 'short_term_exit_condition',
];
// Price-valued fields: a literal 0 here can only mean "missing written as 0".
const PRICE_FIELDS = [
  'current_price', 'short_term_entry_price', 'short_term_stop_price', 'short_term_target_1',
  'short_term_target_2', 'short_term_risk_per_share', 'short_term_rr_target_1',
  'short_term_rr_target_2', 'long_term_buy_price', 'long_term_period_high',
  'long_term_period_low', 'long_term_support_price', 'long_term_target_1',
  'long_term_target_2', 'long_term_invalidation_price',
];

// ---------------------------------------------------------------- check bookkeeping
const checks = new Map(); // name -> {pass, fail, skip}
const failures = [];
const notes = [];
function tally(name) {
  if (!checks.has(name)) checks.set(name, { pass: 0, fail: 0, skip: 0 });
  return checks.get(name);
}
function ok(name) { tally(name).pass++; }
function bad(name, msg) { tally(name).fail++; failures.push(`[${name}] ${msg}`); }
function skip(name) { tally(name).skip++; }
function expect(name, cond, msg) { cond ? ok(name) : bad(name, msg); return cond; }

// ---------------------------------------------------------------- helpers
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const num = (v) => (isBlank(v) ? null : Number(v));
const f2 = (x) => (x == null ? 'null' : Number(x).toFixed(2));
const near = (a, b, tol) => a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol + 1e-9;

function loadCsv(rel) {
  const p = path.resolve(rel);
  if (!fs.existsSync(p)) { bad('files_present', `${rel} missing`); return null; }
  ok('files_present');
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const header = rows.shift() || [];
  const recs = [];
  rows.forEach((r, idx) => {
    if (!expect('csv_field_count', r.length === header.length,
      `${rel} line ${idx + 2}: ${r.length} fields, header has ${header.length}`)) return;
    const o = {};
    header.forEach((h, j) => { o[h] = r[j]; });
    o.__line = idx + 2;
    recs.push(o);
  });
  return { header, recs };
}

// ---------------------------------------------------------------- A. structure
function structuralChecks(all, cand, latest) {
  for (const [name, f] of [['opportunity_scan_all.csv', all], ['opportunity_candidates.csv', cand]]) {
    if (!f) continue;
    const same = f.header.length === SPEC_HEADER.length && f.header.every((h, i) => h === SPEC_HEADER[i]);
    if (!same) {
      const diffs = [];
      for (let i = 0; i < Math.max(f.header.length, SPEC_HEADER.length); i++) {
        if (f.header[i] !== SPEC_HEADER[i]) diffs.push(`#${i + 1} got=${f.header[i] ?? '<none>'} spec=${SPEC_HEADER[i] ?? '<none>'}`);
      }
      bad('header_matches_spec', `${name}: ${diffs.slice(0, 10).join('; ')}`);
    } else ok('header_matches_spec');
  }
  if (!all) return;

  // one row per symbol
  const seen = new Map();
  for (const r of all.recs) {
    if (seen.has(r.symbol)) bad('one_row_per_symbol', `symbol ${r.symbol} repeated (lines ${seen.get(r.symbol)} and ${r.__line})`);
    else { seen.set(r.symbol, r.__line); ok('one_row_per_symbol'); }
    expect('symbol_not_blank', !isBlank(r.symbol), `line ${r.__line}: blank symbol`);
  }

  // enum values
  for (const r of all.recs) {
    expect('short_status_enum', SHORT_STATUSES.includes(r.short_term_status), `${r.symbol}: short_term_status='${r.short_term_status}' not in ${SHORT_STATUSES.join('/')}`);
    expect('long_status_enum', LONG_STATUSES.includes(r.long_term_status), `${r.symbol}: long_term_status='${r.long_term_status}' not in ${LONG_STATUSES.join('/')}`);
    expect('data_quality_enum', ['OK', 'WARNING'].includes(r.data_quality_status), `${r.symbol}: data_quality_status='${r.data_quality_status}'`);
    if (!isBlank(r.long_term_falling_risk)) expect('falling_risk_enum', ['LOW', 'MEDIUM', 'HIGH'].includes(r.long_term_falling_risk), `${r.symbol}: long_term_falling_risk='${r.long_term_falling_risk}'`);
    const ss = num(r.short_term_score), ls = num(r.long_term_score);
    expect('score_range_0_100', ss != null && ss >= 0 && ss <= 100, `${r.symbol}: short_term_score='${r.short_term_score}'`);
    expect('score_range_0_100', ls != null && ls >= 0 && ls <= 100, `${r.symbol}: long_term_score='${r.long_term_score}'`);
  }

  // blank-vs-0 rules
  for (const r of all.recs) {
    for (const k of PRICE_FIELDS) {
      if (!isBlank(r[k])) expect('no_zero_for_missing', Number(r[k]) !== 0, `${r.symbol}: ${k}='${r[k]}' (0 written in a price field; spec says blank)`);
    }
    if (r.short_term_status === 'AVOID') {
      for (const k of SHORT_PLAN_FIELDS) expect('avoid_rows_plan_blank', isBlank(r[k]), `${r.symbol}: AVOID row has ${k}='${r[k]}' (spec: blank when not applicable)`);
    }
    if (r.short_term_status === 'READY' || r.short_term_status === 'ARMED') {
      for (const k of SHORT_PLAN_FIELDS) expect('ready_armed_plan_present', !isBlank(r[k]), `${r.symbol}: ${r.short_term_status} row has blank ${k}`);
    }
    if (r.short_term_status === 'READY') {
      expect('ready_why_not_ready_blank', isBlank(r.short_term_why_not_ready), `${r.symbol}: READY but short_term_why_not_ready='${r.short_term_why_not_ready}'`);
    } else {
      expect('non_ready_has_why_not_ready', !isBlank(r.short_term_why_not_ready), `${r.symbol}: ${r.short_term_status} with blank short_term_why_not_ready`);
    }
    // entry block is all-or-nothing
    const present = SHORT_PLAN_FIELDS.filter((k) => !isBlank(r[k]));
    // aligned with the spec review: a FAILED_SETUP row carries only its EXIT
    // instruction (short_term_exit_condition), no fresh entry plan
    const failedOnlyExit = /^FAILED_SETUP/.test(r.short_term_setup || '') && present.length === 1 && present[0] === 'short_term_exit_condition' && /^EXIT/.test(r.short_term_exit_condition || '');
    expect('short_plan_all_or_nothing', failedOnlyExit || present.length === 0 || present.length === SHORT_PLAN_FIELDS.length,
      `${r.symbol}: short plan partially filled (${present.length}/${SHORT_PLAN_FIELDS.length}); blank: ${SHORT_PLAN_FIELDS.filter((k) => isBlank(r[k])).join(',')}`);
    const buy = r.long_term_status === 'BUY NOW' || r.long_term_status === 'BUY LOWER';
    if (buy) {
      for (const k of ['long_term_buy_action', 'long_term_buy_price', 'long_term_target_1', 'long_term_target_1_pct', 'long_term_invalidation_price', 'long_term_why']) {
        expect('buy_rows_fields_present', !isBlank(r[k]), `${r.symbol}: ${r.long_term_status} row has blank ${k}`);
      }
    } else {
      for (const k of ['long_term_buy_action', 'long_term_buy_price']) {
        expect('nonbuy_rows_buy_blank', isBlank(r[k]), `${r.symbol}: ${r.long_term_status} row has ${k}='${r[k]}' (should be blank)`);
      }
    }
    for (const k of ['history_start', 'history_end', 'history_days', 'last_bar_time', 'current_price', 'short_term_why', 'long_term_why']) {
      expect('core_fields_present', !isBlank(r[k]), `${r.symbol}: blank ${k}`);
    }
  }

  // ranks are permutations 1..N
  const N = all.recs.length;
  for (const k of ['short_term_rank', 'long_term_rank']) {
    const vals = all.recs.map((r) => num(r[k]));
    const set = new Set(vals);
    const okPerm = vals.every((v) => Number.isInteger(v) && v >= 1 && v <= N) && set.size === N;
    if (okPerm) ok('rank_permutation');
    else {
      const missing = []; for (let i = 1; i <= N; i++) if (!set.has(i)) missing.push(i);
      const cnt = new Map(); vals.forEach((v) => cnt.set(v, (cnt.get(v) || 0) + 1));
      const dups = [...cnt].filter(([, c]) => c > 1).map(([v]) => v);
      bad('rank_permutation', `${k}: not a permutation of 1..${N}; missing=[${missing.slice(0, 20)}] duplicated=[${dups.slice(0, 20)}] invalid=[${vals.filter((v) => !Number.isInteger(v) || v < 1 || v > N).slice(0, 10)}]`);
    }
  }

  // candidates
  if (cand) {
    const qual = (r) => r.short_term_status === 'READY' || r.short_term_status === 'ARMED' || r.long_term_status === 'BUY NOW' || r.long_term_status === 'BUY LOWER';
    const allBySym = new Map(all.recs.map((r) => [r.symbol, r]));
    const candSyms = new Set();
    for (const c of cand.recs) {
      expect('candidates_filter', qual(c), `${c.symbol}: in candidates with short=${c.short_term_status} long=${c.long_term_status}`);
      expect('candidates_unique', !candSyms.has(c.symbol), `${c.symbol}: repeated in candidates`);
      candSyms.add(c.symbol);
      const a = allBySym.get(c.symbol);
      if (!a) { bad('candidates_rows_equal_all', `${c.symbol}: in candidates but not in scan_all`); continue; }
      const diff = SPEC_HEADER.filter((h) => c[h] !== a[h]);
      expect('candidates_rows_equal_all', diff.length === 0, `${c.symbol}: candidates row differs from scan_all in ${diff.slice(0, 6).join(',')}`);
    }
    for (const r of all.recs) if (qual(r)) expect('candidates_complete', candSyms.has(r.symbol), `${r.symbol}: qualifies (short=${r.short_term_status} long=${r.long_term_status}) but missing from candidates`);
    // sort: READY first, then short score desc, then long score desc
    const key = (r) => [r.short_term_status === 'READY' ? 0 : 1, -num(r.short_term_score), -num(r.long_term_score)];
    for (let i = 1; i < cand.recs.length; i++) {
      const p = key(cand.recs[i - 1]), q = key(cand.recs[i]);
      let cmp = 0; for (let j = 0; j < 3 && cmp === 0; j++) cmp = p[j] - q[j];
      const a = cand.recs[i - 1], b = cand.recs[i];
      expect('candidates_sort_order', cmp <= 0,
        `rows ${i}/${i + 1}: ${a.symbol}(${a.short_term_status},${a.short_term_score},${a.long_term_score}) before ${b.symbol}(${b.short_term_status},${b.short_term_score},${b.long_term_score})`);
    }
  }

  // latest.json summary vs CSV
  if (latest) {
    const s = latest.summary || {};
    const cnt = (f) => all.recs.filter(f).length;
    const pairs = [
      ['scanned', N],
      ['short_ready', cnt((r) => r.short_term_status === 'READY')],
      ['short_armed', cnt((r) => r.short_term_status === 'ARMED')],
      ['short_watch', cnt((r) => r.short_term_status === 'WATCH')],
      ['long_buy_now', cnt((r) => r.long_term_status === 'BUY NOW')],
      ['long_buy_lower', cnt((r) => r.long_term_status === 'BUY LOWER')],
      ['data_warnings', cnt((r) => r.data_quality_status === 'WARNING')],
    ];
    if ('long_watch' in s) pairs.push(['long_watch', cnt((r) => r.long_term_status === 'WATCH')]);
    if ('short_avoid' in s) pairs.push(['short_avoid', cnt((r) => r.short_term_status === 'AVOID')]);
    for (const [k, v] of pairs) expect('summary_counts', s[k] === v, `latest.json summary.${k}=${JSON.stringify(s[k])}, CSV count=${v}`);
    const avoid = cnt((r) => r.short_term_status === 'AVOID');
    if (avoid > 0 && !('short_avoid' in s)) notes.push(`CSV has ${avoid} AVOID rows but summary has no short_avoid key`);
    const top = (k, field) => [...all.recs].sort((a, b) => num(a[k]) - num(b[k])).slice(0, 5).map((r) => r.symbol);
    if (Array.isArray(s.top_short)) {
      const exp = top('short_term_rank');
      expect('summary_top5', JSON.stringify(s.top_short) === JSON.stringify(exp), `summary.top_short=${JSON.stringify(s.top_short)}, CSV ranks 1-5=${JSON.stringify(exp)}`);
    }
    if (Array.isArray(s.top_long)) {
      // Spec: "do not fill Top 10 just to fill it" -> allow top_long to be a prefix of rank order.
      const exp = top('long_term_rank');
      expect('summary_top5', JSON.stringify(s.top_long) === JSON.stringify(exp.slice(0, s.top_long.length)), `summary.top_long=${JSON.stringify(s.top_long)}, CSV long ranks 1-5=${JSON.stringify(exp)}`);
    }
    if (s.scan_time) for (const r of all.recs) expect('scan_time_consistent', r.scan_time === s.scan_time, `${r.symbol}: scan_time=${r.scan_time} vs summary ${s.scan_time}`);
    // rows mirror CSV
    const rows = Array.isArray(latest.rows) ? latest.rows : [];
    expect('json_rows_count', rows.length === N, `latest.json rows=${rows.length}, CSV rows=${N}`);
    const csvBy = new Map(all.recs.map((r) => [r.symbol, r]));
    for (const jr of rows) {
      const cr = csvBy.get(jr.symbol);
      if (!cr) { bad('json_rows_match_csv', `${jr.symbol}: in latest.json rows but not in CSV`); continue; }
      const diffs = [];
      for (const h of SPEC_HEADER) {
        const jv = jr[h], cv = cr[h];
        const jb = jv === null || jv === undefined || jv === '';
        if (jb || isBlank(cv)) { if (jb !== isBlank(cv)) diffs.push(`${h}: json=${JSON.stringify(jv)} csv='${cv}'`); continue; }
        if (typeof jv === 'number') { if (!(Number(cv) === jv)) diffs.push(`${h}: json=${jv} csv='${cv}'`); }
        else if (String(jv) !== cv) diffs.push(`${h}: json=${JSON.stringify(jv)} csv='${cv}'`);
      }
      expect('json_rows_match_csv', diffs.length === 0, `${jr.symbol}: ${diffs.slice(0, 4).join(' | ')}`);
    }
  }
}

// ---------------------------------------------------------------- B. arithmetic
function arithmeticChecks(all) {
  for (const r of all.recs) {
    const S = r.symbol;
    const entry = num(r.short_term_entry_price), stop = num(r.short_term_stop_price);
    const t1 = num(r.short_term_target_1), t2 = num(r.short_term_target_2);
    const risk = num(r.short_term_risk_per_share);
    const rr1 = num(r.short_term_rr_target_1), rr2 = num(r.short_term_rr_target_2);
    const p1 = num(r.short_term_target_1_pct), p2 = num(r.short_term_target_2_pct);

    if (entry != null) {
      const want = `BUY IF PRICE >= ${entry.toFixed(2)}`;
      expect('st_entry_action_text', r.short_term_entry_action === want, `${S}: entry_action='${r.short_term_entry_action}' expected '${want}'`);
    } else if (!isBlank(r.short_term_entry_action)) bad('st_entry_action_text', `${S}: entry_action='${r.short_term_entry_action}' but entry_price blank`);
    if (entry != null && stop != null) {
      expect('st_stop_below_entry', stop < entry, `${S}: stop ${stop} >= entry ${entry}`);
      if (risk != null) expect('st_risk_eq_entry_minus_stop', near(risk, entry - stop, 0.01), `${S}: risk_per_share ${risk} vs entry-stop ${f2(entry - stop)}`);
    } else if (entry != null || stop != null) bad('st_stop_below_entry', `${S}: only one of entry(${entry})/stop(${stop}) present`);
    const R = entry != null && stop != null ? entry - stop : null;
    if (R != null && R > 0) {
      if (t1 != null && rr1 != null) expect('st_rr1', near(rr1, (t1 - entry) / R, 0.02), `${S}: rr_target_1 ${rr1} vs (T1-entry)/risk ${((t1 - entry) / R).toFixed(3)} [T1 ${t1}, entry ${entry}, stop ${stop}]`);
      if (t2 != null && rr2 != null) expect('st_rr2', near(rr2, (t2 - entry) / R, 0.02), `${S}: rr_target_2 ${rr2} vs (T2-entry)/risk ${((t2 - entry) / R).toFixed(3)} [T2 ${t2}, entry ${entry}, stop ${stop}]`);
      if (t1 != null) expect('st_t1_at_least_1R', t1 >= entry + R - 0.01, `${S}: T1 ${t1} < entry+risk ${f2(entry + R)}`);
      if (t1 != null && t2 != null) expect('st_t2_ge_t1', t2 >= t1, `${S}: T2 ${t2} < T1 ${t1}`);
    }
    if (entry != null && t1 != null && p1 != null) expect('st_target_pct', near(p1, (t1 / entry - 1) * 100, 0.02), `${S}: target_1_pct ${p1} vs ${((t1 / entry - 1) * 100).toFixed(3)}`);
    if (entry != null && t2 != null && p2 != null) expect('st_target_pct', near(p2, (t2 / entry - 1) * 100, 0.02), `${S}: target_2_pct ${p2} vs ${((t2 / entry - 1) * 100).toFixed(3)}`);
    if (r.short_term_status === 'READY') {
      expect('ready_rr2_ge_1_5', rr2 != null && rr2 >= 1.5, `${S}: READY with rr_target_2=${r.short_term_rr_target_2}`);
      if (R != null && t2 != null) expect('ready_rr2_ge_1_5_from_prices', (t2 - entry) / R >= 1.5 - 0.02, `${S}: READY but (T2-entry)/risk from printed prices = ${((t2 - entry) / R).toFixed(3)}`);
    }
    // sell / cancel text reflects the printed numbers ("no hidden decisions")
    if (entry != null && stop != null && t1 != null && t2 != null && !isBlank(r.short_term_exit_condition)) {
      const m = r.short_term_exit_condition.match(/SELL 100% IF PRICE <= ([\d.]+); SELL 50% AT ([\d.]+) AND MOVE STOP TO ([\d.]+); SELL REMAINING 50% AT ([\d.]+)/);
      if (!m) bad('st_exit_text_numbers', `${S}: exit_condition not in expected form: '${r.short_term_exit_condition.slice(0, 120)}'`);
      else expect('st_exit_text_numbers', near(+m[1], stop, 0.005) && near(+m[2], t1, 0.005) && near(+m[3], entry, 0.005) && near(+m[4], t2, 0.005),
        `${S}: exit text stop/T1/entry/T2 = ${m[1]}/${m[2]}/${m[3]}/${m[4]} vs columns ${stop}/${t1}/${entry}/${t2}`);
    }
    if (stop != null && !isBlank(r.short_term_cancel_condition)) {
      const m = r.short_term_cancel_condition.match(/CANCEL IF PRICE < ([\d.]+)/);
      if (!m) bad('st_cancel_text_numbers', `${S}: cancel_condition not in expected form: '${r.short_term_cancel_condition.slice(0, 120)}'`);
      // aligned with the spec review: the setup is cancelled when the structure
      // low itself breaks, which sits between the stop (low - buffer) and the entry
      else expect('st_cancel_text_numbers', +m[1] >= stop - 0.005 && +m[1] < entry, `${S}: cancel level ${m[1]} not within [stop ${stop}, entry ${entry})`);
    }

    // long term
    const cur = num(r.current_price), buy = num(r.long_term_buy_price);
    const act = r.long_term_buy_action;
    if (!isBlank(act)) {
      let m;
      if ((m = act.match(/^BUY NOW AT (\d+(?:\.\d+)?)$/))) {
        expect('lt_action_status_agree', r.long_term_status === 'BUY NOW', `${S}: action '${act}' with status ${r.long_term_status}`);
        expect('lt_buy_now_eq_current', near(+m[1], cur, 0.005), `${S}: '${act}' but current_price ${cur}`);
        expect('lt_action_eq_buy_price', near(+m[1], buy, 0.005), `${S}: '${act}' but long_term_buy_price ${buy}`);
      } else if ((m = act.match(/^BUY IF PRICE <= (\d+(?:\.\d+)?)$/))) {
        expect('lt_action_status_agree', r.long_term_status === 'BUY LOWER', `${S}: action '${act}' with status ${r.long_term_status}`);
        expect('lt_buy_lower_below_current', +m[1] < cur, `${S}: '${act}' but current_price ${cur} (not below)`);
        expect('lt_action_eq_buy_price', near(+m[1], buy, 0.005), `${S}: '${act}' but long_term_buy_price ${buy}`);
      } else bad('lt_action_text', `${S}: long_term_buy_action '${act}' matches neither 'BUY NOW AT x' nor 'BUY IF PRICE <= x'`);
    }
    const inv = num(r.long_term_invalidation_price);
    if (buy != null && inv != null) expect('lt_invalidation_below_buy', inv < buy, `${S}: invalidation ${inv} >= buy ${buy}`);
    // target % base: buy price when there is one, otherwise current price (non-buy rows)
    const base = buy != null ? buy : cur;
    const baseName = buy != null ? 'buy' : 'current';
    for (const n of [1, 2]) {
      const T = num(r[`long_term_target_${n}`]), P = num(r[`long_term_target_${n}_pct`]);
      if (T != null && P != null && base) expect('lt_target_pct', near(P, (T / base - 1) * 100, 0.05), `${S}: long target_${n}_pct ${P} vs (T/${baseName}-1)*100 ${((T / base - 1) * 100).toFixed(3)} [T ${T}, ${baseName} ${base}]`);
      else if ((T == null) !== (P == null)) bad('lt_target_pct', `${S}: long target_${n}=${r[`long_term_target_${n}`]} but pct=${r[`long_term_target_${n}_pct`]}`);
      if (T != null && base) expect('lt_target_above_base', T > base, `${S}: long target_${n} ${T} not above ${baseName} ${base}`);
    }
    const lt1 = num(r.long_term_target_1), lt2 = num(r.long_term_target_2);
    if (lt1 != null && lt2 != null) expect('lt_t2_gt_t1', lt2 > lt1, `${S}: long T2 ${lt2} <= T1 ${lt1}`);
    // CSV-internal consistency of the price-position fields
    const hi = num(r.long_term_period_high), lo = num(r.long_term_period_low);
    const dd = num(r.long_term_drawdown_from_high_pct), dl = num(r.long_term_distance_from_low_pct);
    if (cur != null && hi != null && dd != null) expect('lt_drawdown_internal', near(dd, (cur / hi - 1) * 100, 0.02), `${S}: drawdown ${dd} vs (cur/high-1)*100 ${((cur / hi - 1) * 100).toFixed(3)}`);
    if (cur != null && lo != null && dl != null) expect('lt_distance_low_internal', near(dl, (cur / lo - 1) * 100, 0.02), `${S}: distance_from_low ${dl} vs (cur/low-1)*100 ${((cur / lo - 1) * 100).toFixed(3)}`);
    if (cur != null && hi != null && lo != null) expect('lt_low_le_cur_le_high', lo <= cur + 1e-9 && cur <= hi + 1e-9, `${S}: current ${cur} outside [low ${lo}, high ${hi}]`);
    const pct = num(r.long_term_price_percentile);
    if (pct != null) expect('lt_percentile_range', pct >= 0 && pct <= 100, `${S}: percentile ${pct}`);
  }
}

// ---------------------------------------------------------------- C. recomputation
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const offCache = new Map(); // hour bucket -> ET offset seconds
function etParts(unix) {
  const bucket = Math.floor(unix / 3600);
  let off = offCache.get(bucket);
  if (off === undefined) {
    const p = Object.fromEntries(ET_FMT.formatToParts(new Date(bucket * 3600 * 1000)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 1000;
    off = asUtc - bucket * 3600; // negative (e.g. -14400)
    offCache.set(bucket, off);
  }
  const d = new Date((unix + off) * 1000);
  const date = d.toISOString().slice(0, 10);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { date, mins, hhmm: d.toISOString().slice(11, 16) };
}

async function pgGetAll(baseUrl, key, pathAndQuery) {
  // keyset pagination on unix
  const out = [];
  let last = null;
  for (let page = 0; page < 100000; page++) {
    const url = `${baseUrl}/rest/v1/${pathAndQuery}&order=unix.asc&limit=1000${last == null ? '' : `&unix=gt.${last}`}`;
    const rows = await pgGet(url, key);
    out.push(...rows);
    if (rows.length < 1000) break;
    const nl = rows[rows.length - 1].unix;
    if (last != null && nl <= last) throw new Error(`pagination did not advance at unix=${nl}`);
    last = nl;
  }
  return out;
}
async function pgGet(url, key) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 4) throw new Error(`GET ${url.replace(/apikey=[^&]+/, '')} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
    }
  }
}

export function recomputeFromBars(minuteMap, scanEpoch) {
  // minuteMap: Map(unix -> {h,l,c}) in dollars, already merged (main wins)
  const keys = [...minuteMap.keys()].filter((u) => u % 60 === 0 && (scanEpoch == null || u + 60 <= scanEpoch)).sort((a, b) => a - b);
  const days = new Map(); // date -> {high, low, close, lastUnix}
  let lastUnix = null;
  for (const u of keys) {
    const { date, mins } = etParts(u);
    if (mins < 570 || mins >= 960) continue; // 09:30 <= t < 16:00
    const b = minuteMap.get(u);
    let d = days.get(date);
    if (!d) { d = { high: -Infinity, low: Infinity, close: null }; days.set(date, d); }
    if (b.h > d.high) d.high = b.h;
    if (b.l < d.low) d.low = b.l;
    d.close = b.c; // keys ascending -> last minute wins
    lastUnix = u;
  }
  if (lastUnix == null) return null;
  const dates = [...days.keys()].sort();
  const lp = etParts(lastUnix);
  // the percentile compares raw closes with the RAW last close: comparing with the
  // 2-dp display value counted today's own close (24.425 < 24.43) as "below"
  const rawCurrent = minuteMap.get(lastUnix).c;
  const current = Math.round(rawCurrent * 100) / 100;
  let high = -Infinity, low = Infinity, below = 0;
  for (const dt of dates) {
    const d = days.get(dt);
    if (d.high > high) high = d.high;
    if (d.low < low) low = d.low;
    if (d.close < rawCurrent) below++;
  }
  return {
    last_bar_time: `${lp.date} ${lp.hhmm}`,
    current_price: current,
    history_start: dates[0],
    history_end: dates[dates.length - 1],
    history_days: dates.length,
    period_high: high,
    period_low: low,
    percentile: (100 * below) / dates.length,
    drawdown: (current / high - 1) * 100,
    dist_low: (current / low - 1) * 100,
  };
}

async function fetchSymbolMinutes(baseUrl, key, symbol, archiveId) {
  const m = new Map();
  let archiveRows = 0;
  if (archiveId != null) {
    const ar = await pgGetAll(baseUrl, key, `archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${archiveId}`);
    archiveRows = ar.length;
    for (const b of ar) m.set(Number(b.unix), { h: Number(b.h) / 10000, l: Number(b.l) / 10000, c: Number(b.c) / 10000, src: 'archive' });
  }
  const mainRows = await pgGetAll(baseUrl, key, `bars?select=unix,high,low,close&symbol=eq.${encodeURIComponent(symbol)}`);
  let overrides = 0;
  for (const b of mainRows) {
    const u = Number(b.unix);
    if (m.has(u)) overrides++;
    m.set(u, { h: Number(b.high), l: Number(b.low), c: Number(b.close), src: 'main' });
  }
  return { map: m, archiveRows, mainRows: mainRows.length, overrides };
}

async function recomputeChecks(all, latest) {
  const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_KEY || '';
  if (!baseUrl || !key) {
    notes.push('PART C (recomputation from raw bars) SKIPPED: SUPABASE_URL and/or SUPABASE_KEY not set.');
    skip('recompute_skipped_no_credentials');
    return;
  }
  const scanTime = latest?.summary?.scan_time || all.recs[0]?.scan_time;
  const scanEpoch = scanTime ? Math.floor(Date.parse(scanTime) / 1000) : null;
  if (scanEpoch == null || !Number.isFinite(scanEpoch)) notes.push('scan_time unknown: recomputation uses all bars available now (no cutoff).');

  const size = Number(process.env.QA_SAMPLE_SIZE || 25);
  const seed = Number(process.env.QA_SEED || 20261007);
  const syms = all.recs.map((r) => r.symbol).sort();
  const must = syms.filter((s) => {
    const r = all.recs.find((x) => x.symbol === s);
    return r.short_term_status === 'READY' || r.long_term_status === 'BUY NOW' || r.long_term_status === 'BUY LOWER';
  });
  const others = syms.filter((s) => !must.includes(s));
  const rnd = mulberry32(seed);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const sample = [...must, ...others.slice(0, Math.max(0, size - must.length))];
  notes.push(`PART C sample: ${sample.length} symbols (${must.length} READY/BUY NOW/BUY LOWER, all included even if > ${size}; ${sample.length - must.length} seeded-random others, seed ${seed}); cutoff = bars with unix+60 <= scan_time ${scanTime}.`);

  // symbol -> archive id
  const idRows = await pgGetAllPlain(baseUrl, key, 'archive_symbols?select=id,symbol&order=id.asc');
  const idOf = new Map(idRows.map((r) => [r.symbol, r.id]));

  const bySym = new Map(all.recs.map((r) => [r.symbol, r]));
  const conc = Math.max(1, Number(process.env.QA_CONCURRENCY || 4));
  let next = 0;
  const work = async () => {
    while (next < sample.length) {
      const sym = sample[next++];
      const row = bySym.get(sym);
      try {
        if (!idOf.has(sym)) notes.push(`${sym}: no archive_symbols entry; using main table only`);
        const { map, archiveRows, mainRows, overrides } = await fetchSymbolMinutes(baseUrl, key, sym, idOf.get(sym));
        const rc = recomputeFromBars(map, scanEpoch);
        if (!rc) { bad('recompute_has_data', `${sym}: no session minutes found in archive (${archiveRows}) + bars (${mainRows})`); continue; }
        ok('recompute_has_data');
        compareRow(sym, row, rc);
        notes.push(`${sym}: archive ${archiveRows} + main ${mainRows} rows (${overrides} overlapping minutes, main wins) -> ${rc.history_days} sessions, last ${rc.last_bar_time} @ ${rc.current_price}`);
      } catch (e) {
        bad('recompute_fetch', `${sym}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, work));
}
async function pgGetAllPlain(baseUrl, key, q) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await pgGet(`${baseUrl}/rest/v1/${q}&limit=1000&offset=${off}`, key);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function compareRow(sym, r, rc) {
  const cmpStr = (name, csv, mine) => expect(`rc_${name}`, csv === String(mine), `${sym}: ${name} CSV='${csv}' recomputed='${mine}'`);
  const cmpNum = (name, csv, mine, tol) => {
    const c = num(csv);
    expect(`rc_${name}`, near(c, mine, tol), `${sym}: ${name} CSV=${csv === '' ? '<blank>' : csv} recomputed=${Number(mine).toFixed(4)} (tol ${tol})`);
  };
  cmpStr('last_bar_time', r.last_bar_time, rc.last_bar_time);
  cmpNum('current_price', r.current_price, rc.current_price, 0.005);
  cmpStr('history_start', r.history_start, rc.history_start);
  cmpStr('history_end', r.history_end, rc.history_end);
  cmpStr('history_days', r.history_days, rc.history_days);
  cmpNum('period_high', r.long_term_period_high, rc.period_high, 0.006);
  cmpNum('period_low', r.long_term_period_low, rc.period_low, 0.006);
  cmpNum('price_percentile', r.long_term_price_percentile, rc.percentile, 0.1);
  cmpNum('drawdown_from_high_pct', r.long_term_drawdown_from_high_pct, rc.drawdown, 0.02);
  cmpNum('distance_from_low_pct', r.long_term_distance_from_low_pct, rc.dist_low, 0.02);
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const all = loadCsv('scan/opportunity_scan_all.csv');
  const cand = loadCsv('scan/opportunity_candidates.csv');
  let latest = null;
  try { latest = JSON.parse(fs.readFileSync(path.resolve('scan/latest.json'), 'utf8')); ok('files_present'); }
  catch (e) { bad('files_present', `scan/latest.json unreadable: ${e.message}`); }

  structuralChecks(all, cand, latest);
  if (all) arithmeticChecks(all);
  if (all) {
    try { await recomputeChecks(all, latest); }
    catch (e) { bad('recompute_fetch', `aborted: ${e.message}`); }
  }

  const fail = failures.length > 0;
  const lines = [];
  lines.push('# Opportunity Scanner — independent QA (qa_recompute.mjs)', '');
  lines.push(`Run: ${new Date().toISOString()}  scan_time: ${latest?.summary?.scan_time ?? all?.recs[0]?.scan_time ?? '?'}  rows: ${all?.recs.length ?? 0}  candidates: ${cand?.recs.length ?? 0}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`, '');
  lines.push('## Checks', '', '| check | pass | fail | skip |', '|---|---:|---:|---:|');
  for (const [k, v] of checks) lines.push(`| ${k} | ${v.pass} | ${v.fail} | ${v.skip} |`);
  lines.push('', `## Failures (${failures.length}${failures.length > 200 ? ', first 200 shown' : ''})`, '');
  if (!failures.length) lines.push('none');
  for (const f of failures.slice(0, 200)) lines.push(`- ${f}`);
  lines.push('', '## Notes', '');
  for (const n of notes.slice(0, 200)) lines.push(`- ${n}`);
  lines.push('', `QA_RECOMPUTE: ${fail ? 'FAIL' : 'PASS'}`);
  const text = lines.join('\n') + '\n';
  process.stdout.write(text);
  const out = process.env.QA_REPORT_PATH || '.github/audit/qa_scanner.md';
  try { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(path.resolve(out), text); }
  catch (e) { console.error(`could not write ${out}: ${e.message}`); }
  process.exitCode = fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('qa_recompute.mjs')) {
  main().catch((e) => { console.error(e); console.log('QA_RECOMPUTE: FAIL'); process.exit(1); });
}
