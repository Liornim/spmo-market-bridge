// TRADER V2 — QA / GOLDEN TEST HARNESS
//
// Four layers, per the plan. Layers 1 and 3 run on synthetic fixtures and are
// unconditional. Layer 2 (golden minutes) and layer 4 (cross-day) need the real
// 2026-09-04 candles; when those are absent this reports NOT RUN rather than
// passing vacuously, because a green tick on a test that never executed is
// worse than a red one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as V from './trader-v2-engine.cjs';
import * as R from './trader-v2-replay.cjs';

const eng = { computeBars: V.computeBars, decide: V.decide };
const results = [];
let pass = 0, fail = 0, notRun = 0;
const ck = (id, name, ok, actual = '', expected = '') => {
  ok ? pass++ : fail++;
  results.push({ id, name, status: ok ? 'PASS' : 'FAIL', actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${actual ? '   [' + actual + ']' : ''}`);
};
const skip = (id, name, why) => {
  notRun++;
  results.push({ id, name, status: 'NOT RUN', actual: why, expected: '' });
  console.log(`SKIP  ${id}  ${name}   [${why}]`);
};

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function day(n, base, drift, noise, seed) {
  const o = []; let p = base, s = seed || 5;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const q = p, c = q + drift(i) + (rnd() - 0.5) * noise;
    o.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +q.toFixed(2),
      high: +(Math.max(q, c) + rnd() * noise * 0.5).toFixed(2),
      low: +(Math.min(q, c) - rnd() * noise * 0.5).toFixed(2),
      close: +c.toFixed(2), volume: 5000 + Math.floor(rnd() * 8000) });
    p = c;
  }
  return o;
}
const FIELDS = s => JSON.stringify([s.state, s.score, s.setupId, s.reason, s.next,
  s.plan && [s.plan.entry, s.plan.zone, s.plan.invalidation, s.plan.stop, s.plan.t1, s.plan.t2, s.plan.rr]]);

console.log('=== 1. ENGINE INTEGRITY ===');

// QA-001 determinism
{
  const rows = day(200, 230, () => 0.012, 0.45, 7);
  const runs = [];
  for (let k = 0; k < 10; k++) runs.push(R.runV2(rows, eng, {}).map(FIELDS).join('|'));
  ck('QA-001', 'ten identical runs give identical output',
    runs.every(x => x === runs[0]), runs.every(x => x === runs[0]) ? '10/10 identical' : 'differ');
}

// QA-002 the future cannot change the past
{
  const base = day(150, 230, () => 0.012, 0.45, 7);
  const futures = [
    base.concat(day(80, base[149].close, () => 0.06, 0.45, 21).map((r, i) => ({ ...r, time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 }))),
    base.concat(day(80, base[149].close, () => -0.06, 0.45, 31).map((r, i) => ({ ...r, time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 }))),
    base   // future deleted entirely
  ];
  const outs = futures.map(f => R.runV2(f, eng, {}).slice(0, 150).map(FIELDS).join('|'));
  const same = outs.every(x => x === outs[0]);
  let firstDiff = '';
  if (!same) {
    const a = outs[0].split('|'), b = outs[1].split('|');
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { firstDiff = 'minute ' + tm(i); break; }
  }
  ck('QA-002', 'randomised, reversed and deleted futures leave minute T identical',
    same, same ? '3 futures, 150 minutes, all identical' : 'first divergence ' + firstDiff);
}

// QA-003 prefix consistency: a fresh engine on the same prefix
{
  const rows = day(200, 230, () => 0.012, 0.45, 7);
  const full = R.runV2(rows, eng, {});
  let bad = 0, firstBad = '';
  [40, 80, 120, 160, 199].forEach(T => {
    const fresh = R.runV2(rows.slice(0, T + 1), eng, {});
    if (FIELDS(fresh[fresh.length - 1]) !== FIELDS(full[T])) { bad++; if (!firstBad) firstBad = tm(T); }
  });
  ck('QA-003', 'a fresh engine on the same prefix reaches the same state',
    bad === 0, bad ? 'differs at ' + firstBad : '5 checkpoints identical');
}

// QA-004 a failed setup cannot resurrect
{
  let violations = 0, sample = '';
  [7, 11, 13, 19, 23].forEach(seed => {
    const rows = day(300, 230, i => (i % 40 < 20 ? 0.05 : -0.05), 0.45, seed);
    const st = R.runV2(rows, eng, {});
    for (let i = 1; i < st.length; i++) {
      if (st[i].state === 'READY' && st[i].setupId) {
        // was this exact setup id ever FAILED before now?
        const failedBefore = st.slice(0, i).some(x => x.state === 'FAILED' && x.setupId === st[i].setupId);
        if (failedBefore) { violations++; if (!sample) sample = st[i].time + ' ' + st[i].setupId; }
      }
    }
  });
  ck('QA-004', 'a FAILED setupId never returns to READY', violations === 0,
    violations ? violations + ' violations, first ' + sample : '5 fixtures clean');
}

// QA-005 READY must be actionable
{
  let missing = 0, vague = 0, sample = '';
  [7, 11, 13].forEach(seed => {
    const rows = day(300, 230, () => 0.015, 0.45, seed);
    R.runV2(rows, eng, {}).filter(s => s.state === 'READY').forEach(s => {
      const p = s.plan;
      const complete = s.setup && s.setup.type && p && p.entry != null && p.zone && p.invalidation != null
        && p.stop != null && p.t1 != null && p.t2 != null && p.rr != null && s.score != null && s.reason;
      if (!complete) { missing++; if (!sample) sample = s.time; }
      if (/ממתין לאישור|wait for confirmation/i.test(s.next || '')) vague++;
    });
  });
  ck('QA-005', 'every READY carries type, trigger, zone, invalidation, stop, T1, T2, R:R, score and reason',
    missing === 0, missing ? missing + ' incomplete, first ' + sample : 'all complete');
  ck('QA-005b', 'no READY says "wait for confirmation"', vague === 0, vague + ' vague');
}

// QA-006 score invariant, at the CONFIGURED threshold
{
  let bad = 0;
  [{ readyScore: 6 }, { readyScore: 8 }, { readyScore: 4 }].forEach(cfg => {
    const rows = day(300, 230, () => 0.015, 0.45, 7);
    R.runV2(rows, eng, { config: cfg }).filter(s => s.state === 'READY')
      .forEach(s => { if (s.score < cfg.readyScore) bad++; });
  });
  ck('QA-006', 'no READY below the configured score threshold, at three thresholds', bad === 0, bad + ' violations');
}

// QA-007 downtrend gate
{
  let readyInDown = 0, reasons = 0;
  [11, 17, 29].forEach(seed => {
    const rows = day(300, 230, () => -0.02, 0.45, seed);
    const st = R.runV2(rows, eng, {});
    st.forEach(s => {
      if (s.state === 'READY' && s.trend === 'DOWN') readyInDown++;
      if (s.state === 'AVOID' && /מבנה יורד/.test(s.reason || '')) reasons++;
    });
  });
  ck('QA-007', 'no READY while the structure is a declared downtrend', readyInDown === 0, readyInDown + ' found');
  ck('QA-007b', 'the downtrend block is stated as the reason', reasons > 0, reasons + ' bars');
}

// QA-008 no chase
{
  const spike = day(120, 230, () => 0.005, 0.4, 7)
    .concat(day(30, 236, () => 0.6, 0.4, 9).map((r, i) => ({ ...r, time: tm(120 + i), unix: 1788000000 + (120 + i) * 60 })));
  const st = R.runV2(spike, eng, {});
  const chasing = st.filter(s => s.state === 'READY' && s.extension > V.CFG.chaseATR);
  ck('QA-008', 'never READY while extended past the chase limit', chasing.length === 0, chasing.length + ' found');
  const warned = st.filter(s => /לא רודפים/.test(s.next || ''));
  ck('QA-008b', 'an extended price is told the expected pullback area',
    warned.length === 0 || /נסיגה צפויה/.test(warned[0].next), warned.length + ' warnings');
}

// QA-009 confirmation must advance, not regress  --- the new one
{
  let regressions = 0, sample = '';
  [7, 11, 13, 19, 23, 31].forEach(seed => {
    const rows = day(320, 230, i => (i % 60 < 35 ? 0.02 : -0.015), 0.45, seed);
    const st = R.runV2(rows, eng, {});
    for (let i = 1; i < st.length; i++) {
      const prev = st[i - 1], now = st[i];
      if (prev.state !== 'ARMED' || !prev.plan) continue;
      // the trigger the ARMED state named was satisfied on this bar
      const satisfied = rows[i].high >= prev.plan.entry;
      // and nothing actually invalidated
      const invalidated = rows[i].low < prev.plan.invalidation;
      if (satisfied && !invalidated && (now.state === 'AVOID' || now.state === 'WATCH')) {
        regressions++;
        if (!sample) sample = now.time + ': ARMED trigger ' + prev.plan.entry + ' met, went ' + now.state + ' — ' + now.reason;
      }
    }
  });
  ck('QA-009', 'a satisfied confirmation never regresses to AVOID or WATCH without invalidation',
    regressions === 0, regressions ? regressions + ' regressions, first ' + sample : '6 fixtures clean');
}


console.log('\n=== 1b. v145 REGRESSION (persistent live setups) ===');

// QA-010 a setup must not stay ARMED forever
{
  // arm a setup on a rising open, then feed a long flat stretch that neither
  // confirms nor invalidates it
  const rise = day(60, 230, () => 0.04, 0.45, 7);
  const flat = day(200, rise[59].close, () => 0, 0.06, 13)
    .map((r, i) => ({ ...r, time: tm(60 + i), unix: 1788000000 + (60 + i) * 60 }));
  const st = R.runV2(rise.concat(flat), eng, {});
  const armedRun = [];
  st.forEach(s => { if (s.state === 'ARMED' || s.state === 'SETUP') armedRun.push(s); });
  // the question: is the SAME setupId still armed far beyond the configured age?
  let worst = 0, worstId = '', worstAt = '';
  const firstSeen = {};
  st.forEach((s, i) => {
    if (!s.setupId) return;
    if (firstSeen[s.setupId] == null) firstSeen[s.setupId] = i;
    if (['SETUP', 'ARMED'].indexOf(s.state) >= 0) {
      const age = i - firstSeen[s.setupId];
      if (age > worst) { worst = age; worstId = s.setupId; worstAt = s.time; }
    }
  });
  ck('QA-010', 'a setup expires rather than staying ARMED indefinitely',
    worst <= V.CFG.maxSetupAgeBars,
    'oldest live setup ' + worst + ' bars (limit ' + V.CFG.maxSetupAgeBars + ') — ' + worstId + ' still live at ' + worstAt);
}

// QA-011 newer structure must be able to supersede an older setup
{
  const rows = day(80, 230, () => 0.03, 0.45, 7)
    .concat(day(80, 232.4, () => 0.05, 0.45, 21).map((r, i) => ({ ...r, time: tm(80 + i), unix: 1788000000 + (80 + i) * 60 })));
  const st = R.runV2(rows, eng, {});
  const ids = [];
  st.forEach(s => { if (s.setupId && ids[ids.length - 1] !== s.setupId) ids.push(s.setupId); });
  ck('QA-011', 'a materially newer structure produces a new setupId rather than reusing the old trigger',
    ids.length > 1, ids.length + ' distinct setups: ' + ids.slice(0, 4).join(' -> '));
  // and the trigger must move with it
  const triggers = Array.from(new Set(st.filter(s => s.plan).map(s => s.plan.entry)));
  ck('QA-011b', 'the trigger is not frozen at the first structure for the whole day',
    triggers.length > 1, triggers.length + ' distinct triggers');
}

// QA-012 score drop while armed, in all three directions
{
  const rows = day(320, 230, i => (i % 60 < 35 ? 0.02 : -0.02), 0.45, 7);
  const st = R.runV2(rows, eng, {});
  let lowScoreReady = 0, armedOnLowScore = 0, failedIgnoringScore = 0;
  st.forEach(s => {
    if (s.state === 'READY' && s.score < V.CFG.readyScore) lowScoreReady++;
    if (s.state === 'ARMED' && s.score < V.CFG.readyScore) armedOnLowScore++;
    if (s.state === 'FAILED') failedIgnoringScore++;
  });
  ck('QA-012a', 'structure valid + score low stays ARMED', armedOnLowScore > 0, armedOnLowScore + ' bars');
  ck('QA-012b', 'a low score never reaches READY', lowScoreReady === 0, lowScoreReady + ' violations');
  // structure invalid must fail regardless of a previously high score
  let badFail = 0;
  for (let i = 1; i < st.length; i++) {
    const p = st[i - 1];
    if (!p.plan || ['ARMED', 'READY', 'ACTIVE'].indexOf(p.state) < 0) continue;
    if (rows[i].low < p.plan.invalidation && st[i].state !== 'FAILED' && st[i].setupId === p.setupId) badFail++;
  }
  ck('QA-012c', 'a broken invalidation fails the setup whatever the score was', badFail === 0, badFail + ' survived invalidation');
}

console.log('\n=== 3. TRADE SIMULATOR ===');
{
  const rows = day(320, 230, i => (i % 60 < 35 ? 0.02 : -0.015), 0.45, 7);
  const res = R.analyseDay(rows, eng, {});
  const filled = res.trades.filter(t => t.outcome !== 'no_fill');

  // SIM-001 one setup, one trade
  const ids = filled.map(t => t.setupId);
  ck('SIM-001', 'one setupId produces at most one trade (pyramiding off)',
    new Set(ids).size === ids.length, ids.length + ' trades, ' + new Set(ids).size + ' ids');

  // SIM-002 stop hit
  const stopped = filled.filter(t => t.exitReason === 'stop');
  ck('SIM-002', 'a stopped trade records R <= 0 and exits at the stop',
    stopped.every(t => t.R <= 0 && t.exitPrice === t.stop), stopped.length + ' stopped');

  // SIM-003 exit model must be declared
  ck('SIM-003', 'the exit model is stated: single exit at T1 or stop, partials OFF',
    /hitT1\) \{ exit = \{ i: i, price: p\.t1, reason: 'target1' \}/.test(readFileSync(new URL('./trader-v2-replay.cjs', import.meta.url), 'utf8')),
    'T1 full exit, no partials, T2 recorded but not traded');

  // SIM-004 ambiguous candle
  const src = readFileSync(new URL('./trader-v2-replay.cjs', import.meta.url), 'utf8');
  ck('SIM-004', 'a candle touching both stop and target is resolved STOP FIRST',
    /if \(hitStop\)[\s\S]{0,90}break; \}\s*\n\s*if \(hitT1\)/.test(src), 'policy: STOP FIRST, deterministic');

  // SIM-005 end of day
  const eod = filled.filter(t => t.exitReason === 'close');
  ck('SIM-005', 'an open position at session end exits at the last session close',
    eod.every(t => t.exitTime === rows[rows.length - 1].time), eod.length + ' held to the close');
  ck('SIM-005b', 'MFE never negative and MAE never positive',
    filled.every(t => t.mfe >= 0 && t.mae <= 0));
}

console.log('\n=== 2. GOLDEN CASES ===');
const failures = [];
const goldenRows = [];
{
  // CSV, not JSON, and no worker: symbol,date,time,open,high,low,close,volume
  const parseCsv = (text) => {
    const out = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || /^symbol/i.test(t)) return;
      const p = t.split(',');
      if (p.length < 8) return;
      out.push({ symbol: p[0].trim().toUpperCase(), date: p[1].trim(), time: p[2].trim().slice(0, 5),
        open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7],
        unix: Math.floor(Date.parse(p[1].trim() + 'T' + p[2].trim().slice(0, 5) + ':00Z') / 1000) });
    });
    return out;
  };
  const cases = JSON.parse(readFileSync(new URL('./qa-golden-cases.json', import.meta.url), 'utf8'));

  // Look for any CSV in qa-data/. Nothing is fabricated when none is present.
  const datasets = {};
  let files = [];
  try { files = (await import('node:fs')).readdirSync(new URL('./qa-data/', import.meta.url))
    .filter(f => /\.csv$/i.test(f)); } catch (e) { files = []; }
  files.forEach(f => {
    const rows = parseCsv(readFileSync(new URL('./qa-data/' + f, import.meta.url), 'utf8'));
    if (!rows.length) return;
    const key = rows[0].symbol + '|' + rows[0].date;
    rows.sort((a, b) => a.unix - b.unix);
    const seen = new Set(), clean = [];
    let dupes = 0;
    rows.forEach(r => { if (seen.has(r.time)) { dupes++; return; } seen.add(r.time); clean.push(r); });
    datasets[key] = { rows: clean, file: f, dupes: dupes };
    console.log('  DATASET  ' + key.replace('|', ' ') + ' — ' + clean.length + ' candles, '
      + clean[0].time + '–' + clean[clean.length - 1].time + (dupes ? ', ' + dupes + ' duplicates dropped' : ''));
  });

  if (!Object.keys(datasets).length) {
    cases.forEach(c => skip(c.id, c.symbol + ' ' + c.time + ' — ' + c.note, 'no CSV in qa-data/'));
    skip('LEAKAGE-GOLDEN', 'per-case future-leakage check', 'no CSV in qa-data/');
    console.log('\n  Drop CSVs into qa-data/ (symbol,date,time,open,high,low,close,volume).');
    console.log('  All ' + cases.length + ' cases then run with no further change.');
  } else {
    console.log('  golden cases defined: ' + cases.length
      + ' | with a loaded dataset: ' + cases.filter(c => datasets[c.symbol + '|' + c.date]).length);
    cases.forEach(c => {
      const ds = datasets[c.symbol + '|' + c.date];
      if (!ds) { skip(c.id, c.symbol + ' ' + c.time, 'no dataset for ' + c.symbol + ' ' + c.date); return; }

      // A whole-day assertion, not a minute. Silently dropping it because it
      // carries no timestamp is how the count came to be 22 instead of 23.
      if (c.kind === 'ALL_DAY') {
        const st = R.runV2(ds.rows, eng, {});
        const q2 = st[st.length - 1].quality;
        const readyIds = Array.from(new Set(st.filter(x => x.state === 'READY').map(x => x.setupId)));
        const qualityOk = !c.allowed.length
          || c.allowed.map(x => x.toUpperCase()).indexOf((q2 ? q2.label : '').toUpperCase()) >= 0;
        const countOk = readyIds.length <= 3;
        ck(c.id, c.symbol + ' ALL_DAY — ' + c.note, qualityOk && countOk,
          'quality ' + (q2 ? q2.label : '—') + ', ' + readyIds.length + ' distinct READY setups',
          c.allowed.join('|') + ', at most 3 distinct READY');
        goldenRows.push([c.id, c.symbol, c.date, 'ALL_DAY', c.expect, c.allowed.join('|'),
          q2 ? q2.label : '', readyIds.length + ' READY setups', '', '', '', '', '', '', '',
          qualityOk && countOk ? 'PASS' : 'FAIL', '', JSON.stringify(c.note)]);
        if (!(qualityOk && countOk)) failures.push({ testId: c.id, symbol: c.symbol, kind: 'ALL_DAY',
          expected: { quality: c.allowed, maxDistinctReady: 3 },
          actual: { quality: q2 ? q2.label : null, distinctReady: readyIds.length, readyIds: readyIds } });
        return;
      }
      // Some cases name a WINDOW ('10:51-10:53'), not a minute. Comparing that
      // string lexically silently truncated the prefix at the first bound, which
      // is how a passing case appeared to regress. A window means: the
      // expectation must hold at SOME minute inside it.
      const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(c.time.trim());
      const minutes = m
        ? ds.rows.filter(r => r.time >= m[1] && r.time <= m[2]).map(r => r.time)
        : [c.time];
      if (!minutes.length) { skip(c.id, c.symbol + ' ' + c.time, 'no candles in that window'); return; }

      let s = null, chosen = null;
      for (const T of minutes) {
        // PREFIX ONLY: candles up to and including T, never past.
        const prefix2 = ds.rows.filter(r => r.time <= T);
        if (!prefix2.length) continue;
        const st2 = R.runV2(prefix2, eng, {});
        const cand = st2[st2.length - 1];
        const okHere = (!c.allowed.length || c.allowed.indexOf(cand.state) >= 0)
          && c.forbidden.indexOf(cand.state) < 0;
        if (!s) { s = cand; chosen = T; }
        if (okHere) { s = cand; chosen = T; break; }
      }
      if (!s) { skip(c.id, c.symbol + ' ' + c.time, 'no evaluable minute'); return; }
      const prefix = ds.rows.filter(r => r.time <= chosen);
      const states = R.runV2(prefix, eng, {});
      const decision = s.state === 'READY' || s.state === 'ACTIVE' ? 'BUY'
        : s.state === 'AVOID' ? 'AVOID' : 'WAIT';
      const allowedOk = !c.allowed.length || c.allowed.indexOf(s.state) >= 0;
      const forbiddenHit = c.forbidden.indexOf(s.state) >= 0;
      const ok = allowedOk && !forbiddenHit;

      // FUTURE LEAKAGE: same prefix, absurd randomised future appended.
      const junk = ds.rows.filter(r => r.time > chosen).map((r, i) => ({ ...r,
        open: 1 + i, high: 500 + i, low: 0.5, close: 250 + i, volume: 1 }));
      const withJunk = R.runV2(prefix.concat(junk), eng, {}).filter(x => x.i < prefix.length);
      const leak = FIELDS(withJunk[withJunk.length - 1]) !== FIELDS(s);
      if (leak) ck(c.id + '-LEAK', c.symbol + ' ' + c.time + ' future leakage', false, 'output changed');

      ck(c.id, c.symbol + ' ' + c.time + (chosen !== c.time ? ' (at ' + chosen + ')' : '') + ' — ' + c.note, ok && !leak,
        decision + '/' + s.state + ' score ' + s.score, c.expect + ' in [' + c.allowed.join('|') + ']');

      goldenRows.push([c.id, c.symbol, c.date, c.time, c.expect, c.allowed.join('|'),
        decision, s.state, s.score, s.setupId || '', s.plan ? s.plan.entry : '', s.plan ? s.plan.stop : '',
        s.plan ? s.plan.t1 : '', s.plan ? s.plan.t2 : '', s.plan ? s.plan.rr : '',
        ok && !leak ? 'PASS' : 'FAIL', '', JSON.stringify(c.note)]);

      if (!ok || leak) {
        const b = V.computeBars(prefix);
        const last = b[b.length - 1];
        const sw = V.swings(b, V.CFG.K, b.length - 1);
        const stx = V.structure(sw);
        failures.push({
          testId: c.id, symbol: c.symbol, date: c.date, time: c.time,
          expected: { decision: c.expect, allowed: c.allowed, forbidden: c.forbidden },
          actual: { decision: decision, state: s.state, score: s.score, reason: s.reason, next: s.next },
          leakage: leak,
          candlesAvailable: prefix.length,
          structure: { trend: stx.trend, labels: stx.recent.map(x => x.kind + '@' + x.price),
            lastHigh: stx.lastHigh && stx.lastHigh.price, lastLow: stx.lastLow && stx.lastLow.price,
            lastLH: stx.lastLH && stx.lastLH.price, pivotsHigh: sw.highs.length, pivotsLow: sw.lows.length },
          indicators: { vwap: +last.vwap.toFixed(3), ema9: +last.ema9.toFixed(3),
            ema20: +last.ema20.toFixed(3), atr: +last.atr.toFixed(3), relVol: +last.relVol.toFixed(2) },
          longQuality: s.quality ? { label: s.quality.label, score: s.quality.score, max: s.quality.max,
            parts: s.quality.parts } : null,
          scoreParts: s.scoreParts || null,
          setup: s.setup ? { type: s.setup.type, carried: !!s.setup.carried, what: s.setup.what } : null,
          setupId: s.setupId, setupCreatedBar: s.setupDetectedBar,
          setupAgeBars: s.setupDetectedBar != null ? prefix.length - s.setupDetectedBar : null,
          maxAgeBars: V.CFG.maxSetupAgeBars,
          plan: s.plan, noChase: !!s.noChase, planCarried: !!s.planCarried,
          ruleThatDecided: s.reason
        });
      }
    });
  }
}
// ---- reports
const summary = {
  generated: new Date().toISOString(),
  engine: 'trader-v2', pass: pass, fail: fail, notRun: notRun,
  total: pass + fail + notRun,
  config: V.CFG, simulator: R.RCFG,
  exitModel: 'single exit at T1 or stop; partials off; ambiguous candle resolved STOP FIRST',
  results: results
};
writeFileSync(new URL('./qa-summary.json', import.meta.url), JSON.stringify(summary, null, 2));
writeFileSync(new URL('./qa-failures.json', import.meta.url), JSON.stringify(failures, null, 2));
if (goldenRows.length) writeFileSync(new URL('./qa-golden-results.csv', import.meta.url),
  ['test_id,symbol,date,time,expected_decision,expected_allowed_states,actual_decision,actual_state,score,setup_id,entry,stop,t1,t2,rr,pass,failure_class,notes']
    .concat(goldenRows.map(r => r.join(','))).join('\n'));
const csv = ['test_id,name,status,actual,expected'].concat(results.map(r =>
  [r.id, JSON.stringify(r.name), r.status, JSON.stringify(String(r.actual)), JSON.stringify(String(r.expected))].join(',')));
writeFileSync(new URL('./qa-integrity-results.csv', import.meta.url), csv.join('\n'));

console.log(`\n${pass} passed, ${fail} failed, ${notRun} not run`);
console.log('wrote qa-summary.json and qa-golden-results.csv');
process.exit(fail ? 1 : 0);
