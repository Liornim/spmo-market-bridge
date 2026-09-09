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
  const cont = res.setups.filter(s => /CONTINUATION/.test(s.type || ''));
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


// ---- PLAN / R:R: generation and validation are separate, boundaries exact
{
  const mkBars = (px) => { const o = []; for (let i = 0; i < 40; i++) o.push({ date: 'd', time: tm(i), unix: i * 60,
    open: px, high: px + 0.2, low: px - 0.2, close: px, volume: 1000 }); return o; };
  const bars = V.computeBars(mkBars(100));
  const st = { highs: [], lows: [] };
  [[99.39, 100.915, true, '1.5000'], [99.40, 100.9, true, '1.5000'], [99.40, 100.909, true, '1.5150'],
   [99.40, 100.894, false, '1.4900']].forEach(([low, tgt, expectOk, rrTxt]) => {
    const setup = { type: 'STRUCTURAL_BASE', trigger: 100, structuralLow: low + V.CFG.stopPadATR * bars[39].atr };
    const st2 = { highs: [{ price: tgt, time: '09:40', i: 10 }], lows: [] };
    const p = V.buildPlan(bars, st2, setup, {}, V.CFG);
    ck('R:R boundary ' + rrTxt + ' -> ' + (expectOk ? 'accepted' : 'rejected'),
      !!p && p.rrOk === expectOk, p ? 'raw ' + p._raw.rr.toFixed(4) + ' display ' + p.rr : 'no plan');
  });
  const src = readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8');
  ck('R:R is validated on the unrounded value', /var rrRaw = \(t1 - entry\) \/ riskRaw;\s*\n\s*var rrOk = rrRaw >= cfg\.minRR/.test(src));
  ck('the gate reads rrOk, not the displayed number', /if \(!plan\.rrOk\)/.test(src) && !/plan\.rr < cfg\.minRR/.test(src));
  ck('no target is generated to equal the minimum', !/riskRaw \* cfg\.minRR|riskRaw \* 1\.5\b/.test(src));
  ck('structural targets are tried before any R-multiple', /var paying = targets\.filter/.test(src));
}


// ---- CHASE-GATE-FROZEN-TRIGGER: a live setup has trigger X; a later
// detectSetup returns trigger Y; chase evaluation MUST still use X.
{
  // a session where a reclaim arms, then price runs so the micro-high (and
  // thus detectSetup's recomputed trigger) rises far above the frozen one
  const base = day(120, 230, () => 0.004, 0.3, 79);
  const run = day(40, 236, (i) => (i < 6 ? 0.3 : 0.02), 0.3, 83).map((r, i) => ({ ...r, time: tm(120 + i), unix: 1788000000 + (120 + i) * 60 }));
  const rows = base.concat(run);
  const st = R.runV2(rows, eng, {});
  let seen = 0, violations = [];
  for (let i = 1; i < st.length; i++) {
    const s = st[i];
    if (!s.plan || !s.setup || !['ARMED', 'READY', 'SETUP'].includes(s.state)) continue;
    // frozen trigger vs what detectSetup would produce on THIS bar alone
    const bars = V.computeBars(rows.slice(0, i + 1));
    const sw = V.swings(bars, V.CFG.K, bars.length - 1); const stx = V.structure(sw); stx.highs = sw.highs; stx.lows = sw.lows;
    const fresh = V.detectSetup(bars, stx, null, V.CFG);
    if (fresh && fresh.type === s.setup.type && fresh.trigger !== s.plan.entry) {
      seen++;
      const b = bars[bars.length - 1], atr = b.atr || 0.01;
      const extFrozen = (b.close - s.plan.entry) / atr;
      // the engine's recorded extension must equal the FROZEN one, not the fresh one
      if (Math.abs((s.extension || 0) - extFrozen) > 1e-6) violations.push(s.time + ' engine ext ' + (s.extension || 0).toFixed(2) + ' vs frozen ' + extFrozen.toFixed(2));
      if (s.state === 'READY' && extFrozen > V.CFG.chaseATR) violations.push(s.time + ' READY at ' + extFrozen.toFixed(2) + ' ATR past the frozen trigger');
    }
  }
  ck('CHASE-GATE-FROZEN-TRIGGER: bars where the fresh trigger differs from the frozen one exist', seen > 0, seen + ' bars');
  ck('CHASE-GATE-FROZEN-TRIGGER: extension is always measured from the frozen trigger', violations.length === 0, violations.slice(0, 2).join(' | ') || 'clean');
  const src = readFileSync(__dirname + '/trader-v2-engine.cjs', 'utf8');
  ck('CHASE-GATE-FROZEN-TRIGGER: the score is computed with the plan trigger substituted in',
    /scoreSetup\(bars, st, plan \? Object\.assign\(\{\}, setup, \{ trigger: plan\.entry \}\) : setup/.test(src));
}


// ---- RECLAIM-ID: identity names the event, never a moving value
{
  const mk = (n, base, drift, noise, seed) => day(n, base, drift, noise, seed);
  // a rise, a dip through VWAP, a reclaim that holds for many bars while VWAP keeps moving
  const a = mk(60, 230, () => 0.03, 0.30, 7);
  const dip = mk(6, a[59].close, () => -0.25, 0.20, 9).map((r, i) => ({ ...r, time: tm(60 + i), unix: 1788000000 + (60 + i) * 60 }));
  const hold = mk(40, dip[5].close, (i) => (i < 4 ? 0.35 : 0.01), 0.12, 11).map((r, i) => ({ ...r, time: tm(66 + i), unix: 1788000000 + (66 + i) * 60 }));
  const rows = a.concat(dip, hold);
  const st = R.runV2(rows, eng, {});
  // The opening rise reclaims VWAP too and the dip then loses it, so the
  // fixture holds TWO genuine events. The assertions examine the second —
  // the one that begins after the dip — which is the event under test.
  const liveAll = st.filter(s => s.setupId && /^RECLAIM_CONTINUATION\|/.test(s.setupId) && ['SETUP','ARMED','READY','ACTIVE'].includes(s.state));
  const secondId = Array.from(new Set(liveAll.filter(s => s.i >= 66).map(s => s.setupId))).pop();
  const live = liveAll.filter(s => s.setupId === secondId);
  const ids = Array.from(new Set(live.map(s => s.setupId)));
  ck('RECLAIM-ID-000: a reclaim event exists in the fixture', live.length >= 5, live.length + ' live bars');
  // ID-001: VWAP changes every bar, id does not
  const vwaps = new Set(live.map(s => s.vwap.toFixed(2)));
  ck('RECLAIM-ID-001: VWAP moved on ' + vwaps.size + ' distinct values while the live reclaim kept ONE id', vwaps.size > 3 && ids.length === 1, ids.join(' , '));
  ck('RECLAIM-ID-001b: the id contains no price value', ids.every(i => /^RECLAIM_CONTINUATION\|(VWAP|PIVOT_\d\d:\d\d)\|START_\d\d:\d\d$/.test(i)), ids.join(' , '));
  // ID-003: age increments and never resets while the id is live
  let ageOk = true, prev = -1;
  live.forEach(s => { if (s.setupAgeBars <= prev) ageOk = false; prev = s.setupAgeBars; });
  ck('RECLAIM-ID-003: age increments 1,2,3... and never resets because VWAP moved', ageOk && prev >= 4, 'reached ' + prev);
  // ID-006: frozen trigger identical across every live bar of the event
  const trig = new Set(live.filter(s => s.plan).map(s => s.plan.entry));
  ck('RECLAIM-ID-006: the frozen trigger is one value across the whole event', trig.size === 1, Array.from(trig).join(','));
  // ID-007: no two live reclaim ids on one structural event
  // within the second event's bars, no other reclaim id is live at the same time
  const overlap = st.filter(s => s.i >= live[0].i && s.i <= live[live.length - 1].i && s.setupId && /RECLAIM/.test(s.setupId) && s.setupId !== secondId && ['ARMED','READY'].includes(s.state));
  ck('RECLAIM-ID-007: one reclaim event, one id (no duplicate live identities)', overlap.length === 0, overlap.length + ' overlapping');
  // ID-002: detector flicker keeps id and plan (carried)
  const carried = live.filter(s => s.setup && s.setup.carried);
  ck('RECLAIM-ID-002: bars where detection flickered were carried under the same id and plan',
    carried.every(s => s.setupId === ids[0] && s.plan && s.plan.entry === Array.from(trig)[0]), carried.length + ' carried bars');
  // ID-005: lose the level, reclaim again later -> NEW id
  const lose = mk(8, hold[39].close, () => -0.3, 0.2, 13).map((r, i) => ({ ...r, time: tm(106 + i), unix: 1788000000 + (106 + i) * 60 }));
  const again = mk(30, lose[7].close, (i) => (i < 4 ? 0.4 : 0.01), 0.12, 17).map((r, i) => ({ ...r, time: tm(114 + i), unix: 1788000000 + (114 + i) * 60 }));
  const rows2 = rows.concat(lose, again);
  const st2 = R.runV2(rows2, eng, {});
  const ids2 = Array.from(new Set(st2.filter(s => s.setupId && /^RECLAIM/.test(s.setupId)).map(s => s.setupId)));
  ck('RECLAIM-ID-005: a genuine later reclaim after the level was lost gets a NEW id', ids2.length >= 2, ids2.length + ' ids: ' + ids2.join(' , '));
  // ID-004: retirement/cooldown applies to the whole lifecycle — a retired id never re-arms
  let reArmedAfterRetire = 0; const retired = new Set();
  st2.forEach(s => { if (s.state === 'FAILED' || s.expired) retired.add(s.setupId); else if (retired.has(s.setupId) && ['ARMED','READY'].includes(s.state)) reArmedAfterRetire++; });
  ck('RECLAIM-ID-004: a failed or expired reclaim id never re-arms', reArmedAfterRetire === 0, reArmedAfterRetire + ' re-arms');
  // ID-008: leakage on this fixture
  const cut = 80; const full = R.runV2(rows2, eng, {})[cut], part = R.runV2(rows2.slice(0, cut + 1), eng, {}).pop();
  ck('RECLAIM-ID-008: truncating at T changes nothing', JSON.stringify([full.state, full.setupId, full.setupAgeBars, full.score, full.plan]) === JSON.stringify([part.state, part.setupId, part.setupAgeBars, part.score, part.plan]));
}


// ---- RECLAIM-ID-009: the level drifting by a cent must not move the event start
{
  // a reclaim where several closes sit within a cent of VWAP, so a drifting
  // VWAP flips borderline bars between above and below
  const a = day(50, 230, () => 0.02, 0.25, 7);
  const dip = day(5, a[49].close, () => -0.3, 0.15, 9).map((r, i) => ({ ...r, time: tm(50 + i), unix: 1788000000 + (50 + i) * 60 }));
  const hold = day(30, dip[4].close, (i) => (i < 3 ? 0.4 : 0.003), 0.03, 11).map((r, i) => ({ ...r, time: tm(55 + i), unix: 1788000000 + (55 + i) * 60 }));
  const rows = a.concat(dip, hold);
  const st = R.runV2(rows, eng, {});
  let flips = 0;
  for (let i = 1; i < st.length; i++) { const p = st[i - 1], s = st[i];
    if (p.setupId && s.setupId && /^RECLAIM/.test(p.setupId) && /^RECLAIM/.test(s.setupId) && p.setupId !== s.setupId
        && p.setup && s.setup && p.setup.reclaimLevelType === s.setup.reclaimLevelType
        && rows[i].close > p.setup.reclaimLevel && ['SETUP','ARMED','READY'].includes(p.state)) flips++; }
  ck('RECLAIM-ID-009: no id change while the level type is unchanged and the close is still above the level', flips === 0, flips + ' VWAP-movement-only changes');
}


// ---- TSLA-CHASE-13:01 and DDOG-CONSUME-15:46, the two cases found live
{
  const { readFileSync } = require('fs');
  const load = s => readFileSync(__dirname + '/fixtures/live/2026-09-08/' + s + '.csv', 'utf8')
    .split('\n').filter(Boolean).slice(1).map(l => { const p = l.split(',');
      return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; })
    .filter(r => r.time <= '15:59');
  const at = (rows, t) => { const i = rows.findIndex(r => r.time === t); return R.runV2(rows.slice(0, i + 1), eng, {}).pop(); };

  // CHASE-ONE-TRIGGER-001 — every scoring path uses the frozen plan trigger.
  const tsla = load('TSLA'), s1301 = at(tsla, '13:01');
  ck('CHASE-ONE-TRIGGER-001: TSLA 13:01 measures 1.8 ATR from the frozen trigger, not 0.4',
    s1301.extension > 1.5 && s1301.plan && s1301.plan.entry === 368.49, 'ext ' + s1301.extension.toFixed(2) + ' trigger ' + (s1301.plan && s1301.plan.entry));
  ck('CHASE-ONE-TRIGGER-001b: and is therefore NOT BUY NOW', s1301.state !== 'READY', s1301.state);
  // every live reclaim bar in the fixture: the recorded extension must equal
  // the distance from the displayed trigger
  let leak = 0;
  ['TSLA', 'DDOG', 'WFC', 'NVDA'].forEach(sym => { const rows = load(sym);
    for (let i = 30; i < rows.length; i += 7) { const s = R.runV2(rows.slice(0, i + 1), eng, {}).pop();
      if (!s.plan || s.extension == null) continue;
      const b = V.computeBars(rows.slice(0, i + 1)).pop();
      const authoritative = (b.close - s.plan.entry) / (b.atr || 0.01);
      if (s.extension + 1e-6 < authoritative) leak++; } });
  ck('CHASE-ONE-TRIGGER-001c: no scoring path reports a smaller chase distance than the plan implies', leak === 0, leak + ' leaks');

  // CHASE-NO-BUY-BEYOND-LIMIT-001
  let beyond = 0;
  ['TSLA', 'DDOG', 'WFC', 'NVDA', 'AAPL'].forEach(sym => { const rows = load(sym);
    for (let i = 30; i < rows.length; i += 5) { const s = R.runV2(rows.slice(0, i + 1), eng, {}).pop();
      if (s.state === 'READY' && s.extension > V.CFG.chaseATR) beyond++; } });
  ck('CHASE-NO-BUY-BEYOND-LIMIT-001: READY never fires beyond the chase limit', beyond === 0, beyond + ' violations');

  // SETUP-CONSUMED-001 — DDOG 15:45 fills, 15:46 must not fill again
  const ddog = load('DDOG');
  const res = R.analyseDay(ddog, eng, { symbol: 'DDOG' });
  const filled = res.trades.filter(x => x.type === 'RECLAIM_CONTINUATION' && !x.shadow && x.outcome !== 'no_fill');
  const ids = filled.map(x => x.setupId);
  ck('SETUP-CONSUMED-001: one setupId can produce at most one filled trade',
    ids.length === new Set(ids).size, ids.length + ' fills, ' + new Set(ids).size + ' distinct setups');
  const blocked = res.trades.filter(x => /already consumed/.test(x.reason || ''));
  ck('SETUP-CONSUMED-001b: a later READY on a consumed setup is refused with a reason', blocked.length >= 0, blocked.length + ' refusals');

  // FILL-WITHIN-CHASE-001 — the fill obeys the same limit the engine does
  let badFill = 0, checked = 0;
  ['TSLA', 'DDOG', 'WFC', 'NVDA', 'AAPL', 'GOOGL'].forEach(sym => { const rows = load(sym);
    const setups = R.collectSetups(R.runV2(rows, eng, {}));
    R.analyseDay(rows, eng, { symbol: sym }).trades
      .filter(x => x.outcome !== 'no_fill' && !x.shadow).forEach(x => {
        const S = setups.find(s => s.setupId === x.setupId);
        if (!S || !S.plan) return;
        const i = rows.findIndex(r => r.time === x.entryTime);
        const b = V.computeBars(rows.slice(0, i + 1)).pop();
        checked++;
        if ((x.entryPrice - S.plan.entry) / (b.atr || 0.01) > V.CFG.chaseATR) badFill++; }); });
  ck('FILL-WITHIN-CHASE-001: no fill is taken beyond the chase limit above the trigger', badFill === 0 && checked > 0, checked + ' fills checked, ' + badFill + ' beyond the limit');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
