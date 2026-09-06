// TRADER V2 QA RUNNER — the whole team, in the mandated order, ending in one
// release verdict. It observes the engine and never reaches into its decisions.
const fs = require('fs'), path = require('path');
const V = require('./trader-v2-engine.cjs');
const R = require('./trader-v2-replay.cjs');
const stateMachineQA = require('./trader-v2-qa-roles/state-machine-qa.cjs');
const structureQA = require('./trader-v2-qa-roles/structure-qa.cjs');
const traderQA = require('./trader-v2-qa-roles/trader-qa.cjs');
const performanceQA = require('./trader-v2-qa-roles/performance-qa.cjs');
const adversarialQA = require('./trader-v2-qa-roles/adversarial-qa.cjs');

const eng = { computeBars: V.computeBars, decide: V.decide };
const VERSION = (() => { try { return 'v' + fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim(); } catch (e) { return 'v?'; } })();
const OUT = __dirname;

// ---------------------------------------------------------------- data
function parseCsv(text) {
  const rows = [];
  text.split(/\r?\n/).forEach(l => {
    const t = l.trim(); if (!t || /^(symbol|test_id)/i.test(t)) return;
    const p = t.split(','); if (p.length < 8) return;
    const time = p[2].trim().slice(0, 5);
    rows.push({ symbol: p[0].trim().toUpperCase(), date: p[1].trim(), time, open: +p[3], high: +p[4],
      low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1].trim() + 'T' + time + ':00Z') / 1000) });
  });
  rows.sort((a, b) => a.unix - b.unix);
  const seen = new Set(); return rows.filter(r => !seen.has(r.time) && seen.add(r.time));
}
const datasets = {};
const dataDir = path.join(__dirname, 'qa-data');
if (fs.existsSync(dataDir)) fs.readdirSync(dataDir).filter(f => /\.csv$/i.test(f) && !/golden/i.test(f)).forEach(f => {
  const rows = parseCsv(fs.readFileSync(path.join(dataDir, f), 'utf8'));
  if (rows.length) datasets[rows[0].symbol + '|' + rows[0].date] = rows;
});

// the golden source of truth is the pack's CSV, never a retyped list
const goldenPath = path.join(__dirname, 'qa-data', 'trader_v2_golden_cases.csv');
const goldenFallback = path.join(__dirname, 'qa-golden-cases.json');
let golden;
if (fs.existsSync(goldenPath)) {
  golden = fs.readFileSync(goldenPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => {
    const p = l.split(',');
    return { id: p[0], symbol: p[1], date: p[2], time: p[3], expect: p[4],
      allowed: (p[5] || '').split('|').filter(Boolean), forbidden: (p[6] || '').split('|').filter(Boolean),
      note: p.slice(7).join(','), kind: p[3].trim().toUpperCase() === 'ALL_DAY' ? 'ALL_DAY' : 'MINUTE' };
  });
} else golden = JSON.parse(fs.readFileSync(goldenFallback, 'utf8'));

const FIELDS = s => JSON.stringify([s.state, s.score, s.setupId, s.setup && s.setup.type, s.reason, s.next,
  s.quality && s.quality.label, s.plan && [s.plan.entry, s.plan.stop, s.plan.t1, s.plan.t2, s.plan.rr]]);
const blockers = [], notes = [];
const block = (why) => blockers.push(why);

// ---------------------------------------------------------------- 1+2 integrity and state machine (synthetic + real)
const integrity = [];
{
  const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const day = (n, base, drift, noise, seed) => { const o = []; let p = base, s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < n; i++) { const q = p, c = q + drift(i) + (rnd() - 0.5) * noise;
      o.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +q.toFixed(2),
        high: +(Math.max(q, c) + rnd() * noise * 0.5).toFixed(2), low: +(Math.min(q, c) - rnd() * noise * 0.5).toFixed(2),
        close: +c.toFixed(2), volume: 5000 + Math.floor(rnd() * 8000) }); p = c; } return o; };
  const rows = day(240, 230, i => (i % 60 < 35 ? 0.02 : -0.015), 0.45, 7);
  const a = R.runV2(rows, eng, {}).map(FIELDS).join('|');
  const b = R.runV2(rows, eng, {}).map(FIELDS).join('|');
  integrity.push({ id: 'QA-001', name: 'determinism', ok: a === b });
  const base = rows.slice(0, 150);
  const up = base.concat(day(90, base[149].close, () => 0.06, 0.45, 21).map((r, i) => ({ ...r, time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 })));
  const dn = base.concat(day(90, base[149].close, () => -0.06, 0.45, 31).map((r, i) => ({ ...r, time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 })));
  const pa = R.runV2(up, eng, {}).slice(0, 150).map(FIELDS).join('|'), pb = R.runV2(dn, eng, {}).slice(0, 150).map(FIELDS).join('|');
  integrity.push({ id: 'QA-002', name: 'no future leakage (synthetic)', ok: pa === pb });
  if (pa !== pb) block('FUTURE LEAKAGE in synthetic QA-002');
  // state machine over synthetic
  stateMachineQA({ states: R.runV2(rows, eng, {}), rows, CFG: V.CFG }).forEach(r => integrity.push(Object.assign({ scope: 'synthetic' }, r)));
}
// state machine over every real dataset too
const replays = {};
Object.entries(datasets).forEach(([k, rows]) => {
  const res = R.analyseDay(rows, eng, { symbol: k.split('|')[0] });
  replays[k] = res;
  stateMachineQA({ states: res.states, rows, CFG: V.CFG }).forEach(r => integrity.push(Object.assign({ scope: k }, r)));
});
integrity.filter(r => !r.ok && /^SM-/.test(r.id)).forEach(r => block('STATE MACHINE ' + r.id + ' (' + r.scope + '): ' + r.detail));

// ---------------------------------------------------------------- 3+4 golden with leakage
const goldenResults = [], failures = [];
golden.forEach(c => {
  const rows = datasets[c.symbol + '|' + c.date];
  if (!rows) { goldenResults.push({ id: c.id, symbol: c.symbol, time: c.time, status: 'NOT RUN', why: 'no dataset' }); return; }
  if (c.kind === 'ALL_DAY') {
    const st = replays[c.symbol + '|' + c.date].states;
    const q = st[st.length - 1].quality, readyIds = new Set(st.filter(s => s.state === 'READY').map(s => s.setupId));
    const ok = (!c.allowed.length || c.allowed.map(x => x.toUpperCase()).includes((q ? q.label : '').toUpperCase())) && readyIds.size <= 3;
    goldenResults.push({ id: c.id, symbol: c.symbol, time: 'ALL_DAY', status: ok ? 'PASS' : 'FAIL',
      expected: c.allowed.join('|') + ', <=3 READY', actual: (q ? q.label : '—') + ', ' + readyIds.size + ' READY' });
    if (!ok) failures.push({ id: c.id, cls: 'A', symbol: c.symbol, time: 'ALL_DAY', expected: c.allowed, actual: { quality: q && q.label, ready: readyIds.size } });
    return;
  }
  const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(c.time.trim());
  const minutes = m ? rows.filter(r => r.time >= m[1] && r.time <= m[2]).map(r => r.time) : [c.time];
  let best = null;
  for (const T of minutes) {
    const prefix = rows.filter(r => r.time <= T); if (!prefix.length) continue;
    const st = R.runV2(prefix, eng, {}), s = st[st.length - 1];
    const ok = (!c.allowed.length || c.allowed.includes(s.state)) && !c.forbidden.includes(s.state);
    // leakage: absurd future appended
    const junk = rows.filter(r => r.time > T).map((r, i) => ({ ...r, open: 1 + i, high: 500 + i, low: 0.5, close: 250 + i, volume: 1 }));
    const j = R.runV2(prefix.concat(junk), eng, {})[prefix.length - 1];
    const leak = FIELDS(j) !== FIELDS(s);
    if (leak) block('FUTURE LEAKAGE at ' + c.id + ' ' + T);
    if (!best || (ok && !best.ok)) best = { T, s, ok, leak, prefixLen: prefix.length };
    if (ok && !leak) break;
  }
  if (!best) { goldenResults.push({ id: c.id, symbol: c.symbol, time: c.time, status: 'NOT RUN', why: 'no candles' }); return; }
  const dec = ['READY', 'ACTIVE'].includes(best.s.state) ? 'BUY' : best.s.state === 'AVOID' ? 'AVOID' : 'WAIT';
  const pass = best.ok && !best.leak;
  goldenResults.push({ id: c.id, symbol: c.symbol, time: c.time, at: best.T, status: pass ? 'PASS' : 'FAIL',
    expected: c.expect + ' [' + c.allowed.join('|') + ']', actual: dec + '/' + best.s.state + ' score ' + best.s.score,
    leak: best.leak, note: c.note });
  if (!pass) {
    const s = best.s;
    // classification is mechanical here: R:R at the boundary is C, no setup is F, else A
    let cls = 'A';
    if (s.plan && s.plan.rr < V.CFG.minRR && s.plan.rr >= V.CFG.minRR - 0.02) cls = 'C';
    else if (!s.setup || !s.setup.type) cls = 'F';
    else if (s.state === 'ARMED' && s.score === V.CFG.readyScore) cls = 'C';
    failures.push({ id: c.id, cls, symbol: c.symbol, time: best.T, expected: c.allowed, forbidden: c.forbidden,
      actual: { state: s.state, score: s.score, reason: s.reason, next: s.next, setupId: s.setupId,
        type: s.setup && s.setup.type, plan: s.plan, quality: s.quality && s.quality.label,
        age: s.setupAgeBars, candles: best.prefixLen }, leak: best.leak });
  }
});
if (goldenResults.length !== golden.length) block('GOLDEN count mismatch: ' + goldenResults.length + ' results for ' + golden.length + ' cases');

// ---------------------------------------------------------------- 5-8 per-day reviews
const readyReview = [], missed = [], trades = [], perf = {};
Object.entries(replays).forEach(([k, res]) => {
  const rows = datasets[k], sym = k.split('|')[0];
  const sReviews = structureQA({ states: res.states, rows, V });
  const tReviews = traderQA({ states: res.states, rows, CFG: V.CFG });
  sReviews.forEach(sr => {
    const tr = tReviews.reviews.find(t => t.i === sr.i) || {};
    const trade = res.trades.find(t => t.readyTime === sr.time && t.setupId === sr.setupId);
    const outcome = !trade ? 'NO TRADE' : trade.outcome === 'no_fill' ? 'NO FILL'
      : trade.exitReason === 'close' ? 'EOD' : trade.exitReason === 'time' ? 'EXPIRED' : (trade.R > 0 ? 'WIN' : 'LOSS');
    const cls = sr.verdict === 'INVALID STRUCTURE' ? 'B. FALSE POSITIVE'
      : (tr.verdict === 'QUESTIONABLE' ? 'C. AMBIGUOUS' : 'A. VALID SETUP');
    readyReview.push({ symbol: sym, date: k.split('|')[1], time: sr.time, setupId: sr.setupId, type: sr.type,
      score: sr.score, quality: sr.quality, trend: sr.trend, structure: sr.verdict, trader: tr.verdict,
      flags: (sr.faults.concat(tr.flags || [])).join('; '), classification: cls, outcome, R: trade ? trade.R : '' ,
      before: rows.slice(Math.max(0, sr.i - 15), sr.i).map(r => r.time + ':' + r.close).join(' '),
      after: rows.slice(sr.i + 1, sr.i + 11).map(r => r.time + ':' + r.close).join(' ') });
  });
  const p = performanceQA({ result: res, structureReviews: sReviews });
  perf[k] = p;
  p.trades.forEach(t => trades.push(Object.assign({ symbol: sym, date: k.split('|')[1] }, t)));
  res.missed.forEach(mm => {
    const cls = mm.state === 'AVOID' && /מבנה יורד/.test(mm.why) ? 'NO VALID ENTRY'
      : mm.score === 0 ? 'REAL MISSED SETUP' : 'AMBIGUOUS';
    missed.push(Object.assign({ symbol: sym, date: k.split('|')[1], classification: cls }, mm));
  });
  if (tReviews.repeatedReady.length) notes.push(sym + ': repeated READY on ' + tReviews.repeatedReady.length + ' setup ids');
});

// ---------------------------------------------------------------- 9 adversarial
const adversarial = adversarialQA({ V, R });
adversarial.filter(a => !a.ok).forEach(a => block('ADVERSARIAL "' + a.name + '": ' + a.expectation));

// ---------------------------------------------------------------- 10 regression vs frozen baseline
const basePath = path.join(OUT, 'qa-baseline.json');
let regression = null;
const snapshot = {
  version: VERSION, golden: Object.fromEntries(goldenResults.map(g => [g.id, g.status])),
  ready: Object.fromEntries(Object.entries(replays).map(([k, r]) => [k, r.states.filter(s => s.state === 'READY').map(s => s.time + '|' + s.setupId)])),
  trades: trades.map(t => t.symbol + '|' + t.readyTime + '|' + t.setupId + '|' + t.R),
  fp: readyReview.filter(r => r.classification === 'B. FALSE POSITIVE').map(r => r.symbol + '|' + r.time),
  missed: missed.map(m => m.symbol + '|' + m.time),
  expectancy: Object.fromEntries(Object.entries(perf).map(([k, p]) => [k, p.metrics.expectancyR])),
  pf: Object.fromEntries(Object.entries(perf).map(([k, p]) => [k, p.metrics.profitFactor]))
};
if (fs.existsSync(basePath)) {
  const B = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const diff = (a, b) => ({ added: a.filter(x => !b.includes(x)), removed: b.filter(x => !a.includes(x)) });
  const gFixed = Object.keys(snapshot.golden).filter(id => B.golden[id] === 'FAIL' && snapshot.golden[id] === 'PASS');
  const gBroken = Object.keys(snapshot.golden).filter(id => B.golden[id] === 'PASS' && snapshot.golden[id] === 'FAIL');
  const readyNow = [].concat(...Object.values(snapshot.ready)), readyThen = [].concat(...Object.values(B.ready || {}));
  regression = { baseline: B.version, goldenFixed: gFixed, goldenBroken: gBroken,
    ready: diff(readyNow, readyThen), trades: diff(snapshot.trades, B.trades || []),
    falsePositives: diff(snapshot.fp, B.fp || []), missed: diff(snapshot.missed, B.missed || []),
    expectancy: Object.fromEntries(Object.keys(snapshot.expectancy).map(k => [k, { before: (B.expectancy || {})[k], after: snapshot.expectancy[k] }])),
    pf: Object.fromEntries(Object.keys(snapshot.pf).map(k => [k, { before: (B.pf || {})[k], after: snapshot.pf[k] }])) };
  if (regression.falsePositives.added.length >= 3) block('MAJOR FALSE-POSITIVE REGRESSION: +' + regression.falsePositives.added.length);
}
fs.writeFileSync(path.join(OUT, 'qa-baseline-candidate.json'), JSON.stringify(snapshot, null, 2));

// ---------------------------------------------------------------- isolation
{
  const src = ['trader-v2-engine.cjs', 'trader-v2-replay.cjs'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  if (/(^|[^\w.])(buildTickerState|executionPlan|radarRow)\s*\(/.test(src)) block('PRODUCTION ISOLATION VIOLATION');
}

// ---------------------------------------------------------------- self-review
const gCount = { PASS: 0, FAIL: 0, 'NOT RUN': 0 };
goldenResults.forEach(g => gCount[g.status]++);
const selfReview = [
  ['golden count matches the source', goldenResults.length === golden.length],
  ['PASS + FAIL + NOT RUN = total', gCount.PASS + gCount.FAIL + gCount['NOT RUN'] === golden.length],
  ['every golden FAIL is classified', failures.every(f => /^[A-F]$/.test(f.cls))],
  ['trade rows equal the trade count', trades.length === Object.values(replays).reduce((s, r) => s + r.trades.filter(t => t.outcome !== 'no_fill').length, 0)],
  ['no duplicate trade records', new Set(trades.map(t => t.symbol + t.readyTime + t.setupId)).size === trades.length],
  ['every regression has before/after', !regression || Object.values(regression.expectancy).every(x => 'before' in x && 'after' in x)],
  ['decision-time reviews used no future', readyReview.every(r => !/outcome|WIN|LOSS/.test(r.flags))]
];
selfReview.filter(([, ok]) => !ok).forEach(([n]) => block('QA SELF-CHECK FAILED: ' + n));

// ---------------------------------------------------------------- exports
const summary = {
  version: VERSION, generated: new Date().toISOString(),
  integrity: { pass: integrity.filter(r => r.ok).length, total: integrity.length, items: integrity },
  golden: Object.assign({ total: golden.length }, gCount),
  leakage: blockers.filter(b => /LEAKAGE/.test(b)).length,
  readyReview: { valid: readyReview.filter(r => r.classification.startsWith('A')).length,
    falsePositive: readyReview.filter(r => r.classification.startsWith('B')).length,
    ambiguous: readyReview.filter(r => r.classification.startsWith('C')).length },
  missed: { realMissed: missed.filter(m => m.classification === 'REAL MISSED SETUP').length,
    noValidEntry: missed.filter(m => m.classification === 'NO VALID ENTRY').length,
    ambiguous: missed.filter(m => m.classification === 'AMBIGUOUS').length },
  performance: Object.fromEntries(Object.entries(perf).map(([k, p]) => [k, Object.assign({}, p.metrics, p.classification)])),
  adversarial: { pass: adversarial.filter(a => a.ok).length, total: adversarial.length, items: adversarial },
  regression, notes, blockers, selfReview: selfReview.map(([n, ok]) => ({ check: n, ok })),
  release: blockers.length ? 'BLOCK RELEASE' : 'PASS FOR HUMAN REVIEW',
  // Two gates, kept apart. Correctness is what the invariants prove.
  // Strategy quality needs a sample this data set cannot give.
  engineCorrectness: blockers.length ? 'BLOCK' : 'PASS',
  strategyQuality: (() => {
    const days = Object.keys(datasets).length, tr = trades.length;
    if (days < 10 || tr < 30) return 'NOT PROVEN — insufficient sample (' + days + ' days, ' + tr + ' trades)';
    const exp = tr ? trades.reduce((s2, t) => s2 + t.R, 0) / tr : 0;
    return exp > 0 ? 'PASS' : 'FAIL';
  })(),
  blindSet: 'INSUFFICIENT OUT-OF-SAMPLE DATA — ' + Object.keys(datasets).length + ' real days in the project; no holdout possible',
  byFamily: (() => { const g = {}; trades.forEach(t => { const k = t.type; (g[k] = g[k] || []).push(t.R); });
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { trades: v.length,
      wins: v.filter(x => x > 0).length, avgR: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) }])); })(),
  byQualityBucket: (() => { const g = {}; Object.entries(replays).forEach(([k, res]) => {
      const q = res.quality ? res.quality.label : '—';
      g[q] = g[q] || { days: 0, ready: 0, trades: 0, R: 0 };
      g[q].days++; g[q].ready += res.counts.ready; g[q].trades += res.counts.entered;
      g[q].R += res.trades.filter(t => t.outcome !== 'no_fill').reduce((s2, t) => s2 + t.R, 0); });
    return g; })()
};
const csv = (rows, cols) => [cols.join(',')].concat(rows.map(r => cols.map(c => JSON.stringify(r[c] == null ? '' : r[c])).join(','))).join('\n');
fs.writeFileSync(path.join(OUT, 'qa-summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT, 'qa-failures.json'), JSON.stringify(failures, null, 2));
fs.writeFileSync(path.join(OUT, 'qa-golden-results.csv'), csv(goldenResults, ['id', 'symbol', 'time', 'at', 'status', 'expected', 'actual', 'leak', 'note']));
fs.writeFileSync(path.join(OUT, 'qa-ready-review.csv'), csv(readyReview, ['symbol', 'date', 'time', 'setupId', 'type', 'score', 'quality', 'trend', 'structure', 'trader', 'classification', 'outcome', 'R', 'flags', 'before', 'after']));
fs.writeFileSync(path.join(OUT, 'qa-missed-opportunities.csv'), csv(missed, ['symbol', 'date', 'time', 'price', 'upPct', 'maxAdversePct', 'state', 'score', 'trend', 'quality', 'classification', 'why']));
fs.writeFileSync(path.join(OUT, 'qa-trades.csv'), csv(trades, ['symbol', 'date', 'setupId', 'type', 'readyTime', 'entryTime', 'entryPrice', 'stop', 't1', 't2', 'exitTime', 'exitReason', 'mfe', 'mae', 'R', 'minutesHeld', 'quality', 'readyScore', 'structureVerdict', 'classification']));
fs.writeFileSync(path.join(OUT, 'qa-regressions.csv'), regression
  ? csv([].concat(regression.goldenFixed.map(id => ({ kind: 'golden fixed', item: id })), regression.goldenBroken.map(id => ({ kind: 'golden broken', item: id })),
      regression.ready.added.map(x => ({ kind: 'READY added', item: x })), regression.ready.removed.map(x => ({ kind: 'READY removed', item: x })),
      regression.trades.added.map(x => ({ kind: 'trade added', item: x })), regression.trades.removed.map(x => ({ kind: 'trade removed', item: x })),
      regression.falsePositives.added.map(x => ({ kind: 'false positive added', item: x })), regression.falsePositives.removed.map(x => ({ kind: 'false positive removed', item: x }))), ['kind', 'item'])
  : 'kind,item\n"no baseline",""');

// ---------------------------------------------------------------- HTML report
{
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = (sym, date, time) => '/trader-v2#' + sym + '|' + date + '|' + (String(time).split('-')[0] || '');
  const row = cells => '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
  const table = (heads, rows) => '<table><tr>' + heads.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>' + rows.join('') + '</table>';
  const perfAll = Object.values(perf).map(p => p.metrics).filter(m => m.trades);
  const T = perfAll.reduce((s, m) => s + m.trades, 0), W = perfAll.reduce((s, m) => s + (m.wins || 0), 0);
  const expR = trades.length ? (trades.reduce((s, t) => s + t.R, 0) / trades.length).toFixed(2) : '—';
  const gw = trades.filter(t => t.R > 0).reduce((s, t) => s + t.R, 0), gl = Math.abs(trades.filter(t => t.R <= 0).reduce((s, t) => s + t.R, 0));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Trader V2 QA Team ${esc(VERSION)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1100px;margin:20px auto;padding:0 16px;color:#1B2430;background:#F2F4F7}
h1{font-size:22px}h2{font-size:15px;margin-top:26px;color:#5B6673;letter-spacing:.03em}
.top{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.box{background:#fff;border:1px solid #D6DBE2;border-radius:10px;padding:10px 12px}
.box small{display:block;color:#5B6673;font-size:11px}.box b{font-size:20px}
.rel{font-size:22px;font-weight:800;padding:14px;border-radius:10px;text-align:center;margin:14px 0}
.block{background:#F6DAD6;color:#B42318}.pass{background:#D7EFEC;color:#0F766E}
table{width:100%;border-collapse:collapse;background:#fff;font-size:12.5px}th,td{padding:6px 8px;border-bottom:1px solid #D6DBE2;text-align:left;vertical-align:top}
th{background:#F2F4F7;color:#5B6673;font-size:11px}tr.fail td{background:#FCEFED}tr.pass td{background:#EAF7F5}
a{color:#1D4ED8}code{background:#F2F4F7;padding:1px 4px;border-radius:4px}</style>
<h1>TRADER V2 QA TEAM <small style="color:#5B6673">${esc(VERSION)} · ${esc(summary.generated)}</small></h1>
<div class="rel ${blockers.length ? 'block' : 'pass'}">ENGINE CORRECTNESS: ${esc(summary.engineCorrectness)}</div>
<div class="rel" style="background:#FBEED0;color:#8A5B12">STRATEGY QUALITY: ${esc(summary.strategyQuality)}</div>
<div class="box"><small>BLIND / HOLDOUT</small>${esc(summary.blindSet)}</div>
<div class="box"><small>BY SETUP FAMILY</small>${Object.entries(summary.byFamily).map(([k, v]) => '<b style="font-size:13px">' + esc(k) + '</b> ' + v.trades + ' trades, ' + v.wins + ' wins, avg ' + v.avgR + 'R<br>').join('')}</div>
<div class="box"><small>STOCK QUALITY BUCKETS</small>${Object.entries(summary.byQualityBucket).map(([k, v]) => '<b style="font-size:13px">' + esc(k) + '</b> ' + v.days + ' day(s), ' + v.ready + ' READY, ' + v.trades + ' trades, ' + v.R.toFixed(2) + 'R total<br>').join('')}</div>
${blockers.length ? '<div class="box"><b style="font-size:14px">Blockers</b><ol>' + blockers.map(b => '<li>' + esc(b) + '</li>').join('') + '</ol></div>' : ''}
<div class="top">
<div class="box"><small>ENGINE INTEGRITY + STATE MACHINE</small><b>${summary.integrity.pass}/${summary.integrity.total}</b></div>
<div class="box"><small>GOLDEN</small><b>${gCount.PASS}/${golden.length - gCount['NOT RUN']}</b><small>${gCount.FAIL} FAIL · ${gCount['NOT RUN']} NOT RUN</small></div>
<div class="box"><small>FUTURE LEAKAGE</small><b>${summary.leakage}</b><small>failures</small></div>
<div class="box"><small>READY REVIEW</small><b>${summary.readyReview.valid} / ${summary.readyReview.falsePositive} / ${summary.readyReview.ambiguous}</b><small>valid / false positive / ambiguous</small></div>
<div class="box"><small>MISSED OPPORTUNITIES</small><b>${summary.missed.realMissed}</b><small>real missed · ${summary.missed.noValidEntry} no valid entry · ${summary.missed.ambiguous} ambiguous</small></div>
<div class="box"><small>PERFORMANCE</small><b>${T} trades</b><small>win ${T ? (W / T * 100).toFixed(1) : '—'}% · expectancy ${expR}R · PF ${gl > 0 ? (gw / gl).toFixed(2) : '—'}</small></div>
<div class="box"><small>ADVERSARIAL</small><b>${summary.adversarial.pass}/${summary.adversarial.total}</b></div>
<div class="box"><small>REGRESSIONS vs baseline</small><b>${regression ? regression.goldenFixed.length + ' fixed / ' + regression.goldenBroken.length + ' new' : 'no baseline'}</b></div>
</div>
<h2>GOLDEN CASES — click a row to open the Replay Lab at that minute</h2>
${table(['ID', 'symbol', 'time', 'status', 'expected', 'actual', 'class', 'note'], goldenResults.map(g => {
  const f = failures.find(x => x.id === g.id);
  return '<tr class="' + g.status.toLowerCase().replace(' ', '') + '">' + [
    '<a href="' + link(g.symbol, '2026-09-04', g.at || g.time) + '">' + esc(g.id) + '</a>', esc(g.symbol), esc(g.at || g.time), esc(g.status),
    esc(g.expected), esc(g.actual), f ? esc(f.cls) : '', esc(g.note)].map(c => '<td>' + c + '</td>').join('') + '</tr>'; }))}
<h2>GOLDEN FAILURES — detail and classification</h2>
${table(['ID', 'class', 'state', 'score', 'setup', 'plan', 'reason', 'next'], failures.map(f => row([
  esc(f.id), esc(f.cls), esc(f.actual.state), esc(f.actual.score), esc(f.actual.type || '—') + ' ' + esc(f.actual.setupId || ''),
  f.actual.plan ? 'entry ' + f.actual.plan.entry + ' stop ' + f.actual.plan.stop + ' T1 ' + f.actual.plan.t1 + ' RR ' + f.actual.plan.rr : '—',
  esc(f.actual.reason), esc(f.actual.next)])))}
<h2>STATE MACHINE + INTEGRITY</h2>
${table(['ID', 'scope', 'check', 'result', 'detail'], integrity.map(r => '<tr class="' + (r.ok ? 'pass' : 'fail') + '">' + [esc(r.id), esc(r.scope || 'synthetic'), esc(r.name), r.ok ? 'PASS' : 'FAIL', esc(r.detail)].map(c => '<td>' + c + '</td>').join('') + '</tr>'))}
<h2>EVERY READY — Trader QA + Structure QA</h2>
${table(['when', 'setup', 'score', 'quality', 'structure', 'trader', 'class', 'outcome', 'R', 'flags'], readyReview.map(r => '<tr class="' + (r.classification.startsWith('B') ? 'fail' : '') + '">' + [
  '<a href="' + link(r.symbol, r.date, r.time) + '">' + esc(r.symbol + ' ' + r.time) + '</a>', esc(r.type + ' ' + r.setupId), esc(r.score), esc(r.quality), esc(r.structure), esc(r.trader),
  esc(r.classification), esc(r.outcome), esc(r.R), esc(r.flags)].map(c => '<td>' + c + '</td>').join('') + '</tr>'))}
<h2>TRADES</h2>
${table(['when', 'setup', 'entry', 'stop', 'T1', 'exit', 'reason', 'R', 'MFE/MAE', 'held', 'class'], trades.map(t => '<tr class="' + (t.R > 0 ? 'pass' : 'fail') + '">' + [
  '<a href="' + link(t.symbol, t.date, t.readyTime) + '">' + esc(t.symbol + ' ' + t.readyTime) + '</a>', esc(t.type), esc(t.entryPrice), esc(t.stop), esc(t.t1), esc(t.exitTime), esc(t.exitReason),
  esc(t.R), esc(t.mfeR + ' / ' + t.maeR), esc(t.minutesHeld), esc(t.classification)].map(c => '<td>' + c + '</td>').join('') + '</tr>'))}
<h2>MISSED OPPORTUNITIES</h2>
${table(['when', 'price', 'move', 'adverse', 'state', 'score', 'quality', 'class', 'why'], missed.map(m => row([
  '<a href="' + link(m.symbol, m.date, m.time) + '">' + esc(m.symbol + ' ' + m.time) + '</a>', esc(m.price), '+' + esc(m.upPct) + '%', '-' + esc(m.maxAdversePct) + '%', esc(m.state), esc(m.score), esc(m.quality), esc(m.classification), esc(m.why)])))}
<h2>ADVERSARIAL</h2>
${table(['scenario', 'expectation', 'result', 'setups/ids', 'READY', 'trades', 'states'], adversarial.map(a => '<tr class="' + (a.ok ? 'pass' : 'fail') + '">' + [esc(a.name), esc(a.expectation), a.ok ? 'PASS' : 'FAIL', a.setups + '/' + a.ids, a.ready, a.trades, esc(a.states)].map(c => '<td>' + c + '</td>').join('') + '</tr>'))}
<h2>QA SELF-REVIEW</h2>
${table(['check', 'ok'], selfReview.map(([n, ok]) => '<tr class="' + (ok ? 'pass' : 'fail') + '"><td>' + esc(n) + '</td><td>' + (ok ? 'PASS' : 'FAIL') + '</td></tr>'))}
</html>`;
  fs.writeFileSync(path.join(OUT, 'trader-v2-qa-report.html'), html);
}

module.exports = { summary, goldenResults, failures, readyReview, missed, trades, adversarial, regression, integrity };
if (require.main === module) {
  console.log('TRADER V2 QA TEAM  ' + VERSION);
  console.log('  integrity   ' + summary.integrity.pass + '/' + summary.integrity.total);
  console.log('  golden      ' + gCount.PASS + ' PASS / ' + gCount.FAIL + ' FAIL / ' + gCount['NOT RUN'] + ' NOT RUN  of ' + golden.length);
  console.log('  leakage     ' + summary.leakage + ' failures');
  console.log('  READY       valid ' + summary.readyReview.valid + ', false positive ' + summary.readyReview.falsePositive + ', ambiguous ' + summary.readyReview.ambiguous);
  console.log('  missed      real ' + summary.missed.realMissed + ', no valid entry ' + summary.missed.noValidEntry + ', ambiguous ' + summary.missed.ambiguous);
  console.log('  adversarial ' + summary.adversarial.pass + '/' + summary.adversarial.total);
  console.log('  RELEASE     ' + summary.release);
  blockers.forEach(b => console.log('    BLOCKER  ' + b));
  process.exit(blockers.length ? 1 : 0);
}
