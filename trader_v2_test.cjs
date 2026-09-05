// Trader V2: the rules the spec makes non-negotiable, tested as behaviour.
const V = require('./trader-v2-engine.cjs');
const R = require('./trader-v2-replay.cjs');
const { readFileSync } = require('fs');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

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
const eng = { computeBars: V.computeBars, decide: V.decide };
const run = rows => R.analyseDay(rows, eng, {});

// ---- ISOLATION: this engine must not touch production ----------------------
{
  const e = readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8');
  const r = readFileSync(__dirname + '/trader-v2-replay.cjs', 'utf8');
  const page = readFileSync(__dirname + '/trader-v2-replay.html', 'utf8');
  // A CALL, not a mention: the page's own note names these functions to say it
  // does not use them, and a test that cannot tell those apart is worthless.
  [['engine', e], ['replay', r], ['page', page]].forEach(([n2, src]) => {
    ['buildTickerState', 'executionPlan', 'radarRow'].forEach(bad =>
      ck(n2 + ' never calls ' + bad, !new RegExp('(^|[^\\w.])' + bad + '\\s*\\(').test(src)));
    ["require('./engine", "require('./layers", "require('./candidate"].forEach(bad =>
      ck(n2 + ' does not import ' + bad.slice(9), src.indexOf(bad) < 0));
  });
  const bundle = readFileSync(__dirname + '/view.js', 'utf8');
  const v2 = JSON.parse(bundle.split('export const TRADER_V2_HTML = ')[1].split('\n')[0].trim().replace(/;$/, ''));
  ck('the shipped page carries the V2 engine', /function decide\(rows, ctx, prior, config\)/.test(v2));
  ck('and NOT the production engine',
    !/function buildTickerState/.test(v2) && !/function radarRow/.test(v2) && !/function executionPlan/.test(v2));
}

// ---- NO FUTURE LEAKAGE -----------------------------------------------------
{
  const base = day(150, 230, () => 0.01, 0.45, 7);
  const up = base.concat(day(80, base[149].close, () => 0.05, 0.45, 21).map((r, i) =>
    Object.assign({}, r, { time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 })));
  const dn = base.concat(day(80, base[149].close, () => -0.05, 0.45, 31).map((r, i) =>
    Object.assign({}, r, { time: tm(150 + i), unix: 1788000000 + (150 + i) * 60 })));
  const a = R.runV2(up, eng, {}).slice(0, 150);
  const b = R.runV2(dn, eng, {}).slice(0, 150);
  const diff = a.filter((s, i) => s.state !== b[i].state || s.score !== b[i].score
    || JSON.stringify(s.plan) !== JSON.stringify(b[i].plan));
  ck('NO LEAKAGE: two opposite futures leave the first 150 minutes identical',
    diff.length === 0, diff.length ? 'first differs at ' + diff[0].time : 'identical');
  const trunc = R.runV2(base, eng, {});
  ck('NO LEAKAGE: a truncated day equals the prefix of the full day',
    trunc.length === a.length && trunc.every((s, i) => s.state === a[i].state && s.score === a[i].score));
  ck('a pivot is never used before it could be confirmed',
    /confirmedAt: i \+ K/.test(readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8')));
}

// ---- RULE 1: declared downtrend blocks READY --------------------------------
{
  const dn = day(300, 230, () => -0.02, 0.45, 11);
  const res = run(dn);
  const readyInDowntrend = res.states.filter(s => s.state === 'READY' && s.trend === 'DOWN');
  ck('RULE 1: no READY while the structure is a declared downtrend',
    readyInDowntrend.length === 0, readyInDowntrend.length + ' found');
  const avoided = res.states.filter(s => s.state === 'AVOID' && /מבנה יורד/.test(s.reason || ''));
  ck('RULE 1: a downtrend is stated as the reason, not left blank', avoided.length > 0, avoided.length + ' bars');
  ck('RULE 1: and it says what would change its mind',
    avoided.length > 0 && /צריך|נדרש/.test(avoided[0].next || ''), avoided.length ? avoided[0].next : '');
}

// ---- RULE 2: shallow retest is allowed --------------------------------------
{
  const src = readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8');
  ck('RULE 2: the continuation trigger is the micro-high, not the breakout level',
    /var microHigh = Math\.max/.test(src) && /trigger: \+\(microHigh \+ 0\.01\)/.test(src));
  ck('RULE 2: and a shallow retest is accepted rather than demanding a full return',
    /pullDepth <= cfg\.retestMaxATR/.test(src));
  const up = day(300, 230, () => 0.015, 0.45, 7);
  const res = run(up);
  const cont = res.setups.filter(s => s.type === 'CONTINUATION');
  ck('RULE 2: continuation setups are found on an uptrend day', cont.length > 0, cont.length + ' setups');
}

// ---- RULE 3: a failure needs a NEW setup, not a minute -----------------------
{
  const src = readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8');
  ck('RULE 3: setups carry an id derived from their structural anchor',
    /function setupKey/.test(src) && /setup\.type \+ '@' \+ anchor/.test(src));
  const chop = day(300, 230, i => (i % 40 < 20 ? 0.05 : -0.05), 0.45, 13);
  const res = run(chop);
  let bad = 0;
  for (let i = 1; i < res.states.length; i++) {
    if (res.states[i - 1].state === 'FAILED' && res.states[i].state === 'READY'
        && res.states[i].setupId === res.states[i - 1].setupId) bad++;
  }
  ck('RULE 3: FAILED never becomes READY on the next minute for the same setup', bad === 0, bad + ' violations');
}

// ---- RULE 4: do not chase ---------------------------------------------------
{
  const spike = day(120, 230, () => 0.005, 0.4, 7)
    .concat(day(30, 236, () => 0.5, 0.4, 9).map((r, i) => Object.assign({}, r, { time: tm(120 + i), unix: 1788000000 + (120 + i) * 60 })));
  const res = run(spike);
  const chasing = res.states.filter(s => s.state === 'READY' && s.extension > V.CFG.chaseATR);
  ck('RULE 4: never READY while extended beyond the chase limit', chasing.length === 0, chasing.length + ' found');
  const warned = res.states.filter(s => /לא רודפים/.test(s.next || ''));
  ck('RULE 4: an extended price is told to wait for a pullback, with the level',
    warned.length === 0 || /נסיגה צפויה/.test(warned[0].next), warned.length + ' warnings');
}

// ---- RULE 5: READY must have a real score -----------------------------------
{
  [day(300, 230, () => 0.015, 0.45, 7), day(300, 230, () => 0, 0.45, 13),
   day(300, 230, () => -0.015, 0.45, 11)].forEach((rows, i) => {
    const res = run(rows);
    const weak = res.states.filter(s => s.state === 'READY' && s.score < V.CFG.readyScore);
    ck('RULE 5: fixture ' + i + ' has no READY below the score threshold', weak.length === 0,
      weak.length ? 'score ' + weak[0].score : 'none');
    const noPlan = res.states.filter(s => s.state === 'READY' && (!s.plan || s.plan.rr < V.CFG.minRR));
    ck('RULE 5: fixture ' + i + ' has no READY without an acceptable R:R', noPlan.length === 0);
    const noParts = res.states.filter(s => s.state === 'READY' && (!s.scoreParts || !s.scoreParts.length));
    ck('RULE 5: fixture ' + i + ' shows the score components for every READY', noParts.length === 0);
  });
}

// ---- RULE 6: stock/day quality ----------------------------------------------
{
  const strong = run(day(300, 230, () => 0.02, 0.45, 7));
  const weak = run(day(300, 230, () => -0.02, 0.45, 11));
  ck('RULE 6: a rising day scores better for long than a falling one',
    strong.quality.pct > weak.quality.pct,
    strong.quality.label + ' (' + strong.quality.score + ') vs ' + weak.quality.label + ' (' + weak.quality.score + ')');
  ck('RULE 6: quality carries its components', strong.quality.parts.length >= 5);
  ck('RULE 6: a weak day does not manufacture many entries',
    weak.counts.ready <= strong.counts.ready, weak.counts.ready + ' vs ' + strong.counts.ready);
}

// ---- state machine ----------------------------------------------------------
{
  const res = run(day(300, 230, () => 0.015, 0.45, 7));
  const ALLOWED = ['AVOID', 'WATCH', 'SETUP', 'ARMED', 'READY', 'ACTIVE', 'FAILED'];
  ck('every state is one of the seven', res.states.every(s => ALLOWED.indexOf(s.state) >= 0),
    Array.from(new Set(res.states.map(s => s.state))).join(','));
  let jumps = 0;
  for (let i = 1; i < res.states.length; i++)
    if (res.states[i - 1].state === 'AVOID' && res.states[i].state === 'READY') jumps++;
  ck('never jumps straight from AVOID to READY', jumps === 0, jumps + ' jumps');
  ck('every state carries a reason', res.states.every(s => !!s.reason));
  ck('EVERY state says what must happen next, including during warmup',
    res.states.every(s => !!s.next),
    (res.states.filter(s => !s.next)[0] || {}).state || 'all have next');
}

// ---- the trade simulator ----------------------------------------------------
{
  const res = run(day(300, 230, () => 0.015, 0.45, 7));
  res.trades.filter(t => t.outcome !== 'no_fill').forEach(t => {
    if (t.exitReason === 'stop') ck('a stopped trade loses about 1R', t.R <= -0.7 && t.R >= -1.3, String(t.R));
  });
  ck('MFE is never negative', res.trades.every(t => t.mfe == null || t.mfe >= 0));
  ck('MAE is never positive', res.trades.every(t => t.mae == null || t.mae <= 0));
  ck('a trade is entered AFTER the ready bar, never on it',
    res.trades.every(t => !t.entryTime || t.entryTime > t.readyTime));
  const src = readFileSync(__dirname + '/trader-v2-replay.cjs', 'utf8');
  ck('a bar touching both stop and target is scored as the loss',
    /if \(hitStop\) \{[\s\S]{0,80}break; \}\s*\n\s*if \(hitT1\)/.test(src));
  ck('the metrics are computed only from filled trades', /outcome !== 'no_fill'/.test(src));
}

// ---- missed-move analysis is evaluation, not decision ------------------------
{
  const src = readFileSync(__dirname + '/trader-v2-replay.cjs', 'utf8');
  ck('missed moves are computed after the states, from the finished day',
    /function missedMoves\(rows, states, trades/.test(src));
  ck('and nothing feeds them back into the engine',
    !/decide\([^)]*missed/.test(src) && !/prior = .*missed/.test(src));
  const res = run(day(300, 230, () => 0.015, 0.45, 7));
  ck('a missed move records what the engine was thinking at the time',
    res.missed.every(m => m.state != null), res.missed.length + ' missed');
}

// ---- no overfitting ----------------------------------------------------------
{
  const e = readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8');
  ['NVDA', 'MSFT', 'TSLA', 'AMD', '15:30', '14:06', '472.25', '230.31'].forEach(lit =>
    ck('the engine contains no special case for ' + lit, e.indexOf(lit) < 0));
  ck('every threshold is configurable', /var CFG = \{/.test(e) && /Object\.assign\(\{\}, CFG, config/.test(e));
}


// ---- CSV ingestion and the golden runner in the page
{
  const bundle = readFileSync(__dirname + '/view.js', 'utf8');
  const v2 = JSON.parse(bundle.split('export const TRADER_V2_HTML = ')[1].split('\n')[0].trim().replace(/;$/, ''));
  ck('the page accepts a CSV file', /id="csvFile"[^>]*accept=/.test(v2) && /readAsText/.test(v2));
  ck('and pasted CSV text', /id="csvText"/.test(v2) && /function ingest/.test(v2));
  ck('it needs no worker route for that path', /function parseCsv/.test(v2));
  ck('rows are sorted by time', /p\.rows\.sort\(function\(a,b\)\{return a\.unix-b\.unix\}\)/.test(v2));
  ck('duplicate timestamps are dropped and counted', /if\(seen\[r\.time\]\)\{dupes\+\+;return\}/.test(v2));
  ck('malformed rows are rejected and counted', /\{bad\+\+;return\}/.test(v2));
  ck('the dataset panel reports count and first/last time', /DATASETS LOADED/.test(v2));
  ck('multiple files can be loaded', /id="csvFile"[^>]*multiple/.test(v2));
  ck('the golden cases travel with the page', /"NVDA-G01"/.test(v2) && /"AMD-G10"/.test(v2));
  ck('each golden case runs on a PREFIX, never the full day',
    /var prefix=d\.rows\.filter\(function\(r\)\{return r\.time<=c\.time\}\)/.test(v2));
  ck('each golden case is also re-run with an absurd future appended',
    /open:1\+i,high:500\+i,low:0\.5,close:250\+i/.test(v2));
  ck('a difference under that future is reported as leakage', /leak=fp\(j\)!==fp\(s\)/.test(v2));
  ck('results can be exported as the required CSV',
    /test_id,symbol,time,expected_decision,expected_allowed_states,actual_decision/.test(v2));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
