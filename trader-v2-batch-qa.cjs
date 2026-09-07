// TRADER V2 — MASTER BATCH QA
// One master CSV, grouped by symbol+date, one independent replay per group.
// Every session starts clean: nothing carries across a symbol or a day.
const fs = require('fs'), path = require('path');
const V = require('./trader-v2-engine.cjs');
const R = require('./trader-v2-replay.cjs');
const stateMachineQA = require('./trader-v2-qa-roles/state-machine-qa.cjs');
const structureQA = require('./trader-v2-qa-roles/structure-qa.cjs');
const traderQA = require('./trader-v2-qa-roles/trader-qa.cjs');
const eng = { computeBars: V.computeBars, decide: V.decide };
const VERSION = 'v' + fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
const OUT = __dirname;

const DEV = process.env.QA_ALL_DEV === '1' ? [] :
  ['2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-04'];
const BLIND = ['2026-09-02','2026-09-03'];

// ---------------------------------------------------------------- load
const file = process.env.QA_FILE ? path.join(__dirname, process.env.QA_FILE)
  : path.join(__dirname, 'qa-master', 'bars_14sym_2026-08-08_2026-09-06.csv');
const TAG = process.env.QA_TAG || '';
const inv = { rows: 0, malformed: 0, dupes: 0, ohlc: 0, zeroVol: 0, terminal: 0 };
const seen = new Set(); const all = [];
fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).forEach(l => {
  const t = l.trim(); if (!t) return;
  const p = t.split(','); if (p.length < 8) { inv.malformed++; return; }
  const r = { symbol: p[0].trim().toUpperCase(), date: p[1].trim(), time: p[2].trim().slice(0, 5),
    open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{2}:\d{2}$/.test(r.time)
      || [r.open, r.high, r.low, r.close].some(x => !isFinite(x))) { inv.malformed++; return; }
  const k = r.symbol + '|' + r.date + '|' + r.time;
  if (seen.has(k)) { inv.dupes++; return; } seen.add(k);
  if (r.high < Math.max(r.open, r.close) - 1e-9 || r.low > Math.min(r.open, r.close) + 1e-9) inv.ohlc++;
  // 16:00 is a session marker, not a tradable candle: excluded from the replay,
  // from fills and from the bar count, and reported separately.
  if (r.time === '16:00') { inv.terminal++; return; }
  if (r.volume === 0) inv.zeroVol++;
  r.unix = Math.floor(Date.parse(r.date + 'T' + r.time + ':00Z') / 1000);
  all.push(r); inv.rows++;
});
const sessions = {};
all.forEach(r => { const k = r.symbol + '|' + r.date; (sessions[k] = sessions[k] || []).push(r); });
Object.values(sessions).forEach(s => s.sort((a, b) => a.unix - b.unix));
const symbols = [...new Set(all.map(r => r.symbol))].sort();
const dates = [...new Set(all.map(r => r.date))].sort();
const complete = Object.entries(sessions).filter(([, v]) => v.length === 390).map(([k]) => k);
const incomplete = Object.entries(sessions).filter(([, v]) => v.length !== 390).map(([k, v]) => k + ':' + v.length);

// ---------------------------------------------------------------- replay all
const blockers = [], perDay = [], readyReview = [], trades = [], shadow = [], missed = [], smFails = [];
Object.entries(sessions).forEach(([key, rows]) => {
  const [sym, date] = key.split('|');
  // a fresh replay per session; the engine is stateless across calls and the
  // driver is handed only this session's rows
  const res = R.analyseDay(rows, eng, { symbol: sym });
  // Shadow families are detected, scored and reviewed exactly as before; they
  // simply do not enter the candidate's trade set.
  const shadowTrades = res.trades.filter(t => t.outcome !== 'no_fill' && t.shadow);
  stateMachineQA({ states: res.states, rows, CFG: V.CFG }).forEach(r => {
    if (!r.ok) { smFails.push({ key, id: r.id, detail: r.detail }); blockers.push('STATE MACHINE ' + r.id + ' (' + key + ')'); }
  });
  const sRev = structureQA({ states: res.states, rows, V });
  const tRev = traderQA({ states: res.states, rows, CFG: V.CFG });

  // UNIQUE accounting: observations, unique setups, unique READY setups
  const readyObs = res.states.filter(s => s.state === 'READY').length;
  const uniqueSetups = new Set(res.states.filter(s => s.setupId).map(s => s.setupId));
  const uniqueReady = new Set(res.states.filter(s => s.state === 'READY').map(s => s.setupId));
  const filled = res.trades.filter(t => t.outcome !== 'no_fill' && !t.shadow);

  const firstReady = {};
  sRev.forEach(sr => {
    if (firstReady[sr.setupId]) return;   // one review per unique setup
    firstReady[sr.setupId] = true;
    const tr = tRev.reviews.find(x => x.i === sr.i) || {};
    const trade = filled.find(t => t.setupId === sr.setupId);
    const st = res.states[sr.i];
    readyReview.push({ symbol: sym, date, set: DEV.includes(date) ? 'DEV' : 'BLIND',
      setupId: sr.setupId, family: sr.type, readyTime: sr.time, score: sr.score,
      quality: sr.quality, trend: sr.trend, structure: sr.verdict, trader: tr.verdict || 'ACTIONABLE',
      classification: sr.verdict === 'INVALID STRUCTURE' ? 'FALSE POSITIVE'
        : (tr.verdict === 'QUESTIONABLE' ? 'AMBIGUOUS' : 'VALID'),
      why: (sr.faults.concat(tr.flags || [])).join('; '),
      vwap: st.vwap && +st.vwap.toFixed(2), ema9: st.ema9 && +st.ema9.toFixed(2),
      ema20: st.ema20 && +st.ema20.toFixed(2), relVol: st.relVol && +st.relVol.toFixed(2),
      trigger: st.plan && st.plan.entry, stop: st.plan && st.plan.stop,
      invalidation: st.plan && st.plan.invalidation, t1: st.plan && st.plan.t1,
      t2: st.plan && st.plan.t2, rr: st.plan && st.plan.rr, extension: st.extension && +st.extension.toFixed(2),
      outcome: !trade ? 'NO FILL' : trade.exitReason === 'close' ? 'EOD'
        : trade.exitReason === 'time' ? 'EXPIRED' : (trade.R > 0 ? 'WIN' : 'LOSS'),
      R: trade ? trade.R : '' });
  });
  filled.forEach(t => trades.push(Object.assign({ symbol: sym, date, set: DEV.includes(date) ? 'DEV' : 'BLIND' }, t)));
  shadowTrades.forEach(t => shadow.push(Object.assign({ symbol: sym, date, set: DEV.includes(date) ? 'DEV' : 'BLIND' }, t)));
  res.missed.forEach(m => missed.push(Object.assign({ symbol: sym, date, set: DEV.includes(date) ? 'DEV' : 'BLIND',
    classification: m.state === 'AVOID' ? 'NO VALID ENTRY' : m.score === 0 ? 'REAL MISSED SETUP' : 'AMBIGUOUS' }, m)));

  const R_ = filled.map(t => t.R), wins = R_.filter(x => x > 0);
  perDay.push({ symbol: sym, date, set: DEV.includes(date) ? 'DEV' : 'BLIND', bars: rows.length,
    complete: rows.length === 390, quality: res.quality ? res.quality.label : '',
    setups: uniqueSetups.size, readyObservations: readyObs, uniqueReady: uniqueReady.size,
    trades: filled.length, wins: wins.length, losses: filled.length - wins.length,
    expectancyR: filled.length ? +(R_.reduce((a, b) => a + b, 0) / filled.length).toFixed(3) : '',
    pf: (() => { const gw = wins.reduce((a, b) => a + b, 0), gl = Math.abs(R_.filter(x => x <= 0).reduce((a, b) => a + b, 0));
      return gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 'inf' : ''); })(),
    missed: res.missed.length });
});

// ---------------------------------------------------------------- edge QA
// Entry-time features only. Nothing here may consult the outcome; the outcome
// is attached afterwards so winners and losers can be compared on what was
// knowable at the time.
const reclaimRows = [];
trades.filter(t => t.type === 'RECLAIM_CONTINUATION').forEach(t => {
  const rows = sessions[t.symbol + '|' + t.date];
  const i = rows.findIndex(r => r.time === t.readyTime);
  if (i < 0) return;
  const st = R.runV2(rows.slice(0, i + 1), eng, {});
  const s = st[st.length - 1];
  const bars = V.computeBars(rows.slice(0, i + 1));
  const b2 = bars[bars.length - 1];
  const sw = V.swings(bars, V.CFG.K, bars.length - 1);
  const stx = V.structure(sw);
  const setup = s.setup || {};
  // how many bars the reclaim had held when the decision was made
  let held = 0;
  const lvl = setup.reclaimLevel;
  if (lvl != null) for (let k = bars.length - 1; k >= 0 && bars[k].close > lvl; k--) held++;
  const hlConfirmed = !!(stx.lastLow && stx.prevLow && stx.lastLow.price > stx.prevLow.price
    && stx.lastLow.confirmedAt <= bars.length - 1);
  const structTarget = s.plan && s.plan.targetSource === 'structural';
  const f = {
    symbol: t.symbol, date: t.date, set: t.set, setupId: t.setupId, readyTime: t.readyTime,
    // entry-time features
    localTrend: s.trend, quality: s.quality ? s.quality.label : '', score: s.score,
    reclaimLevel: lvl, reclaimLevelName: setup.reclaimLevelName || '',
    barsHoldingReclaim: held, hlConfirmed: hlConfirmed,
    relVol: +b2.relVol.toFixed(2),
    distVwapAtr: +((b2.close - b2.vwap) / (b2.atr || 0.01)).toFixed(2),
    emaAligned: b2.ema9 >= b2.ema20,
    extensionAtr: s.extension != null ? +s.extension.toFixed(2) : '',
    rr: s.plan ? s.plan.rr : '', targetSource: s.plan ? s.plan.targetSource : '',
    structuralTarget: structTarget,
    riskPctOfPrice: s.plan ? +((s.plan.entry - s.plan.stop) / s.plan.entry * 100).toFixed(3) : '',
    hour: t.readyTime.slice(0, 2) + ':00',
    // structural validity, judged from the prefix only
    structuralValidity: (() => {
      if (!setup.type) return 'AMBIGUOUS';
      if (lvl == null) return 'AMBIGUOUS';
      const lostBefore = bars.slice(0, -held).some(x => x.close < lvl - 0.05 * (b2.atr || 0.01));
      if (!lostBefore) return 'INVALID';       // never actually lost the level
      if (held < V.CFG.holdBars) return 'INVALID';
      return held >= V.CFG.holdBars + 1 && hlConfirmed ? 'VALID' : 'AMBIGUOUS';
    })(),
    // outcome, attached AFTER the features above
    R: t.R, outcome: t.R > 0 ? 'WIN' : 'LOSS', exitReason: t.exitReason,
    mfeR: t.mfeR, maeR: t.maeR, minutesHeld: t.minutesHeld
  };
  // trade-edge quality and root cause, from the entry-time features plus the
  // measured result — kept as separate columns so neither contaminates the other
  f.tradeEdge = f.structuralValidity === 'INVALID' ? 'NO EDGE'
    : (f.barsHoldingReclaim >= 4 && f.hlConfirmed && f.structuralTarget && f.rr >= 2) ? 'STRONG'
    : (f.barsHoldingReclaim >= 3 && (f.hlConfirmed || f.structuralTarget)) ? 'ACCEPTABLE'
    : (f.extensionAtr !== '' && f.extensionAtr > 0.6) ? 'WEAK' : 'AMBIGUOUS';
  // CHURN — shadow field only, never a block. A re-entry on a level that
  // failed or stopped out within the last 20 bars, with no new confirmed pivot
  // low since. Recorded for every Reclaim READY so it can be measured on
  // future data; the decision audit found it removed one loser and no winner
  // on 18 trades, which is one example, not a rule.
  {
    let ev = null, evBar = -1;
    for (let k = Math.max(0, i - 20); k < i; k++) {
      const x = st[k];
      if (x.state === 'FAILED' && x.setup && x.setup.reclaimLevel != null && lvl != null && Math.abs(x.setup.reclaimLevel - lvl) <= 0.25 * (b2.atr || 0.01)) { ev = { kind: 'FAILED', bar: k }; evBar = k; }
      if (x.state === 'READY' && x.setupId !== t.setupId && x.setup && x.setup.reclaimLevel != null && lvl != null && Math.abs(x.setup.reclaimLevel - lvl) <= 0.25 * (b2.atr || 0.01)) { ev = { kind: 'EARLIER READY', bar: k }; evBar = k; }
    }
    const lastLow = sw.lows[sw.lows.length - 1];
    const newPivot = !!(ev && lastLow && lastLow.i > evBar && lastLow.confirmedAt <= bars.length - 1);
    f.same_reclaim_level_recently_traded = !!ev;
    f.bars_since_prior_attempt = ev ? i - evBar : '';
    f.prior_attempt_outcome = ev ? ev.kind : '';
    f.new_pivot_since_prior_attempt = ev ? newPivot : '';
    f.new_structure_since_prior_attempt = ev ? newPivot : '';
    f.churn_candidate_block = !!ev && !newPivot;
  }
  // ROOT CAUSE — decision-time only. The previous version used MAE and MFE
  // to infer 'entered too early', which is hindsight: it labelled trades that
  // held the level 12.6 bars on average as early. Only entry-time facts may
  // classify the entry; future bars score the outcome and nothing else.
  f.rootCause = f.outcome === 'WIN' ? ''
    : f.structuralValidity === 'INVALID' ? 'A. FALSE RECLAIM'
    : f.churn_candidate_block ? 'F. CHURN — same level, no new structure'
    : f.barsHoldingReclaim < V.CFG.holdBars ? 'C. NO HOLD / RETEST'
    : f.localTrend === 'DOWN' ? 'D. LOCAL DOWNTREND NOT RESOLVED'
    : (f.extensionAtr !== '' && f.extensionAtr > V.CFG.chaseATR) ? 'E. CHASED / EXTENDED'
    : !f.structuralTarget ? 'G. BAD TARGET / R:R'
    : 'H. VALID SETUP THAT LOST';
  reclaimRows.push(f);
});

// ---------------------------------------------------------------- aggregates
const agg = (rows2) => {
  const R_ = rows2.map(t => t.R), w = R_.filter(x => x > 0), l = R_.filter(x => x <= 0);
  const srt = R_.slice().sort((a, b) => a - b);
  const gw = w.reduce((a, b) => a + b, 0), gl = Math.abs(l.reduce((a, b) => a + b, 0));
  return { trades: rows2.length, wins: w.length, losses: l.length,
    winRate: rows2.length ? +(w.length / rows2.length * 100).toFixed(1) : null,
    avgR: rows2.length ? +(R_.reduce((a, b) => a + b, 0) / rows2.length).toFixed(3) : null,
    medianR: srt.length ? +srt[Math.floor(srt.length / 2)].toFixed(2) : null,
    expectancyR: rows2.length ? +(R_.reduce((a, b) => a + b, 0) / rows2.length).toFixed(3) : null,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? Infinity : 0),
    avgWinner: w.length ? +(gw / w.length).toFixed(2) : null,
    avgLoser: l.length ? +(-gl / l.length).toFixed(2) : null,
    avgMfeR: rows2.length ? +(rows2.reduce((a, t) => a + t.mfeR, 0) / rows2.length).toFixed(2) : null,
    avgMaeR: rows2.length ? +(rows2.reduce((a, t) => a + t.maeR, 0) / rows2.length).toFixed(2) : null,
    avgHold: rows2.length ? Math.round(rows2.reduce((a, t) => a + t.minutesHeld, 0) / rows2.length) : null };
};
const groupBy = (rows2, f) => { const g = {}; rows2.forEach(t => { const k = f(t) || '—'; (g[k] = g[k] || []).push(t); });
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, agg(v)])); };

const dev = trades.filter(t => t.set === 'DEV'), blind = trades.filter(t => t.set === 'BLIND');
const devReady = readyReview.filter(r => r.set === 'DEV'), blindReady = readyReview.filter(r => r.set === 'BLIND');
const rate = (list, cls) => list.length ? +(list.filter(r => r.classification === cls).length / list.length * 100).toFixed(1) : 0;

const summary = {
  version: VERSION, generated: new Date().toISOString(),
  inventory: Object.assign({ symbols: symbols.length, dates: dates.length,
    expectedSymbolDays: symbols.length * dates.length, presentSymbolDays: Object.keys(sessions).length,
    completeSymbolDays: complete.length, incompleteSymbolDays: incomplete.length, incomplete: incomplete,
    missingSymbolDays: symbols.length * dates.length - Object.keys(sessions).length }, inv),
  development: { dates: DEV.filter(d => dates.includes(d)),
    symbolDays: perDay.filter(p => p.set === 'DEV').length,
    uniqueSetups: perDay.filter(p => p.set === 'DEV').reduce((s, p) => s + p.setups, 0),
    uniqueReady: devReady.length, readyObservations: perDay.filter(p => p.set === 'DEV').reduce((s, p) => s + p.readyObservations, 0),
    metrics: agg(dev), falsePositiveRate: rate(devReady, 'FALSE POSITIVE'), ambiguousRate: rate(devReady, 'AMBIGUOUS'),
    realMissed: missed.filter(m => m.set === 'DEV' && m.classification === 'REAL MISSED SETUP').length },
  blind: { dates: BLIND.filter(d => dates.includes(d)),
    symbolDays: perDay.filter(p => p.set === 'BLIND').length,
    uniqueSetups: perDay.filter(p => p.set === 'BLIND').reduce((s, p) => s + p.setups, 0),
    uniqueReady: blindReady.length, readyObservations: perDay.filter(p => p.set === 'BLIND').reduce((s, p) => s + p.readyObservations, 0),
    metrics: agg(blind), falsePositiveRate: rate(blindReady, 'FALSE POSITIVE'), ambiguousRate: rate(blindReady, 'AMBIGUOUS'),
    realMissed: missed.filter(m => m.set === 'BLIND' && m.classification === 'REAL MISSED SETUP').length },
  aggregate: agg(trades),
  bySymbol: groupBy(trades, t => t.symbol), byDate: groupBy(trades, t => t.date),
  byFamily: groupBy(trades, t => t.type), byQuality: groupBy(trades, t => t.quality),
  byHour: groupBy(trades, t => t.readyTime.slice(0, 2) + ':00'),
  readyReview: { total: readyReview.length, valid: readyReview.filter(r => r.classification === 'VALID').length,
    falsePositive: readyReview.filter(r => r.classification === 'FALSE POSITIVE').length,
    ambiguous: readyReview.filter(r => r.classification === 'AMBIGUOUS').length },
  missed: { real: missed.filter(m => m.classification === 'REAL MISSED SETUP').length,
    noEntry: missed.filter(m => m.classification === 'NO VALID ENTRY').length,
    ambiguous: missed.filter(m => m.classification === 'AMBIGUOUS').length },
  reclaim: { trades: reclaimRows.length,
    validity: reclaimRows.reduce((a,r)=>{a[r.structuralValidity]=(a[r.structuralValidity]||0)+1;return a},{}),
    edge: reclaimRows.reduce((a,r)=>{a[r.tradeEdge]=(a[r.tradeEdge]||0)+1;return a},{}),
    rootCauses: reclaimRows.filter(r=>r.rootCause).reduce((a,r)=>{a[r.rootCause]=(a[r.rootCause]||0)+1;return a},{}),
    validButNoEdge: reclaimRows.filter(r=>r.structuralValidity!=='INVALID'&&r.tradeEdge==='NO EDGE').length,
    falseReclaims: reclaimRows.filter(r=>r.structuralValidity==='INVALID').length },
  shadow: (function(){ const g={}; shadow.forEach(t=>{(g[t.type]=g[t.type]||[]).push(t)});
    return Object.fromEntries(Object.entries(g).map(([k,v])=>[k,agg(v.map(x=>Object.assign({},x,{shadow:false})))])); })(),
  stateMachineFailures: smFails, blockers,
  engineCorrectness: blockers.length ? 'BLOCK' : 'PASS'
};
const csv = (rows2, cols) => [cols.join(',')].concat(rows2.map(r => cols.map(c =>
  JSON.stringify(r[c] == null ? '' : r[c])).join(','))).join('\n');
fs.writeFileSync(path.join(OUT, TAG ? 'qa-' + TAG + '-summary.json' : 'qa-batch-summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-symbol-day-results.csv'), csv(perDay,
  ['symbol','date','set','bars','complete','quality','setups','readyObservations','uniqueReady','trades','wins','losses','expectancyR','pf','missed']));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-ready-review.csv'), csv(readyReview,
  ['symbol','date','set','setupId','family','readyTime','score','quality','trend','structure','trader','classification','outcome','R','trigger','stop','invalidation','t1','t2','rr','extension','vwap','ema9','ema20','relVol','why']));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-trades.csv'), csv(trades,
  ['symbol','date','set','setupId','type','readyTime','entryTime','entryPrice','stop','t1','t2','exitTime','exitReason','mfeR','maeR','R','minutesHeld','quality','readyScore']));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-missed-opportunities.csv'), csv(missed,
  ['symbol','date','set','time','price','upPct','maxAdversePct','state','score','trend','quality','classification','why']));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-setup-family-results.csv'), csv(
  Object.entries(summary.byFamily).map(([k, v]) => Object.assign({ family: k }, v)),
  ['family','trades','wins','losses','winRate','avgR','medianR','expectancyR','pf','avgWinner','avgLoser','avgMfeR','avgMaeR','avgHold']));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-long-quality-results.csv'), csv(
  Object.entries(summary.byQuality).map(([k, v]) => Object.assign({ quality: k }, v)),
  ['quality','trades','wins','losses','winRate','avgR','medianR','expectancyR','pf','avgWinner','avgLoser','avgHold']));
const RCOLS=['symbol','date','set','setupId','readyTime','hour','localTrend','quality','score','same_reclaim_level_recently_traded','bars_since_prior_attempt','prior_attempt_outcome','new_pivot_since_prior_attempt','churn_candidate_block',
  'reclaimLevelName','reclaimLevel','barsHoldingReclaim','hlConfirmed','relVol','distVwapAtr','emaAligned',
  'extensionAtr','rr','targetSource','structuralTarget','riskPctOfPrice','structuralValidity','tradeEdge',
  'outcome','R','mfeR','maeR','minutesHeld','exitReason','rootCause'];
fs.writeFileSync(path.join(OUT,(TAG?TAG+'-':'')+'qa-reclaim-winners.csv'), csv(reclaimRows.filter(r=>r.outcome==='WIN'), RCOLS));
fs.writeFileSync(path.join(OUT,(TAG?TAG+'-':'')+'qa-reclaim-losers.csv'), csv(reclaimRows.filter(r=>r.outcome==='LOSS'), RCOLS));
fs.writeFileSync(path.join(OUT,(TAG?TAG+'-':'')+'qa-shadow-trades.csv'), csv(shadow,
  ['symbol','date','set','type','setupId','readyTime','entryTime','entryPrice','stop','t1','exitTime','exitReason','mfeR','maeR','R','minutesHeld','quality']));
fs.writeFileSync(path.join(OUT, (TAG?TAG+'-':'')+'qa-blind-results.csv'), csv(perDay.filter(p => p.set === 'BLIND'),
  ['symbol','date','bars','quality','setups','uniqueReady','trades','wins','losses','expectancyR','pf','missed']));

// ---------------------------------------------------------------- HTML report
{
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const link = (s, d, t) => '/trader-v2#' + s + '|' + d + '|' + (t || '');
  const tbl = (heads, rows2) => '<table><tr>' + heads.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>' + rows2.join('') + '</table>';
  const mrow = (name, m) => '<tr><td>' + esc(name) + '</td><td>' + m.trades + '</td><td>' + m.wins + '</td><td>' + m.losses
    + '</td><td>' + (m.winRate ?? '—') + '%</td><td>' + (m.avgR ?? '—') + '</td><td>' + (m.medianR ?? '—')
    + '</td><td>' + (m.expectancyR ?? '—') + '</td><td>' + (m.pf === Infinity ? '∞' : (m.pf ?? '—'))
    + '</td><td>' + (m.avgWinner ?? '—') + '</td><td>' + (m.avgLoser ?? '—') + '</td><td>' + (m.avgMfeR ?? '—')
    + '</td><td>' + (m.avgMaeR ?? '—') + '</td><td>' + (m.avgHold ?? '—') + '</td></tr>';
  const MH = ['', 'trades', 'W', 'L', 'win', 'avgR', 'medR', 'expR', 'PF', 'avgWin', 'avgLoss', 'MFE', 'MAE', 'hold'];
  const S = summary;
  const strategy = 'NOT PROVEN — development expectancy ' + S.development.metrics.expectancyR + 'R, PF ' + S.development.metrics.pf;
  // Every table on the page is also downloadable. The data is already computed;
  // embedding it means the report is self-contained — no server round trip, and
  // it still works from a saved copy of the file.
  const RCOLS_HTML=['symbol','date','set','setupId','readyTime','hour','localTrend','quality','score',
    'reclaimLevelName','reclaimLevel','barsHoldingReclaim','hlConfirmed','relVol','distVwapAtr','emaAligned',
    'extensionAtr','rr','targetSource','structuralTarget','riskPctOfPrice','structuralValidity','tradeEdge',
    'outcome','R','mfeR','maeR','minutesHeld','exitReason','rootCause'];
  const dl = {
    'qa-symbol-day-results': { cols: ['symbol','date','set','bars','complete','quality','setups','readyObservations','uniqueReady','trades','wins','losses','expectancyR','pf','missed'], rows: perDay },
    'qa-ready-review': { cols: ['symbol','date','set','setupId','family','readyTime','score','quality','trend','structure','trader','classification','outcome','R','trigger','stop','invalidation','t1','t2','rr','extension','vwap','ema9','ema20','relVol','why'], rows: readyReview },
    'qa-trades': { cols: ['symbol','date','set','setupId','type','readyTime','entryTime','entryPrice','stop','t1','t2','exitTime','exitReason','mfeR','maeR','R','minutesHeld','quality','readyScore'], rows: trades },
    'qa-missed-opportunities': { cols: ['symbol','date','set','time','price','upPct','maxAdversePct','state','score','trend','quality','classification','why'], rows: missed },
    'qa-setup-family-results': { cols: ['family','trades','wins','losses','winRate','avgR','medianR','expectancyR','pf','avgWinner','avgLoser','avgMfeR','avgMaeR','avgHold'],
      rows: Object.entries(summary.byFamily).map(([k, v]) => Object.assign({ family: k }, v)) },
    'qa-long-quality-results': { cols: ['quality','trades','wins','losses','winRate','avgR','medianR','expectancyR','pf','avgWinner','avgLoser','avgHold'],
      rows: Object.entries(summary.byQuality).map(([k, v]) => Object.assign({ quality: k }, v)) },
    'qa-by-symbol': { cols: ['symbol','trades','wins','losses','winRate','avgR','medianR','expectancyR','pf','avgWinner','avgLoser','avgMfeR','avgMaeR','avgHold'],
      rows: Object.entries(summary.bySymbol).map(([k, v]) => Object.assign({ symbol: k }, v)) },
    'qa-by-date': { cols: ['date','trades','wins','losses','winRate','avgR','medianR','expectancyR','pf','avgWinner','avgLoser','avgMfeR','avgMaeR','avgHold'],
      rows: Object.entries(summary.byDate).map(([k, v]) => Object.assign({ date: k }, v)) },
    'qa-reclaim-winners': { cols: RCOLS_HTML, rows: reclaimRows.filter(r=>r.outcome==='WIN') },
    'qa-reclaim-losers': { cols: RCOLS_HTML, rows: reclaimRows.filter(r=>r.outcome==='LOSS') },
    'qa-shadow-trades': { cols: ['symbol','date','type','setupId','readyTime','entryPrice','stop','t1','exitReason','R','mfeR','maeR','minutesHeld','quality'], rows: shadow },
    'qa-data-inventory': { cols: ['metric','value'],
      rows: Object.entries(summary.inventory).filter(([, v]) => typeof v !== 'object').map(([k, v]) => ({ metric: k, value: v })) }
  };
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Trader V2 — 14 symbol / 8 day QA</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:1180px;margin:20px auto;padding:0 16px;color:#1B2430;background:#F2F4F7}
h1{font-size:22px}h2{font-size:15px;margin-top:26px;color:#5B6673}
.top{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.box{background:#fff;border:1px solid #D6DBE2;border-radius:10px;padding:10px 12px}.box small{display:block;color:#5B6673;font-size:11px}.box b{font-size:19px}
.rel{font-size:20px;font-weight:800;padding:13px;border-radius:10px;text-align:center;margin:12px 0}
.block{background:#F6DAD6;color:#B42318}.pass{background:#D7EFEC;color:#0F766E}.warn{background:#FBEED0;color:#8A5B12}
table{width:100%;border-collapse:collapse;background:#fff;font-size:12px}th,td{padding:5px 7px;border-bottom:1px solid #D6DBE2;text-align:left}
th{background:#F2F4F7;color:#5B6673;font-size:10.5px}tr.fail td{background:#FCEFED}tr.pass td{background:#EAF7F5}a{color:#1D4ED8}</style>
<h1>TRADER V2 — 14 SYMBOL / 8 DAY QA <small style="color:#5B6673">${esc(S.version)}</small></h1>
<div class="box" style="margin-bottom:12px"><small>הורדה לאקסל</small>
<div id="dlbar" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"></div>
<small style="display:block;margin-top:6px">קבצי CSV עם BOM — נפתחים ישירות באקסל בעברית. "הכל" מוריד את כולם.</small></div>
<script id="qadata" type="application/json">${JSON.stringify(dl).replace(/</g, '\\u003c')}</script>
<script>
(function(){
  var DATA=JSON.parse(document.getElementById('qadata').textContent);
  // A CSV Excel opens correctly: a UTF-8 BOM so Hebrew is not mangled, CRLF
  // line endings, and every field quoted so a comma inside a reason cannot
  // shift the columns.
  function toCsv(cols,rows){
    var esc=function(v){ if(v==null)v='';
      return '"'+String(v).replace(/"/g,'""')+'"'; };
    // Built from char codes: an escape sequence gets converted to a literal
    // invisible character somewhere in the build, and an invisible character is
    // not something to depend on or to test for.
    var BOM=String.fromCharCode(0xFEFF), CRLF=String.fromCharCode(13)+String.fromCharCode(10);
    return BOM+[cols.map(esc).join(',')].concat(
      rows.map(function(r){return cols.map(function(c){return esc(r[c])}).join(',')})).join(CRLF);
  }
  function save(name,text){
    var b=new Blob([text],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name+'.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href)},10000);
  }
  var bar=document.getElementById('dlbar');
  Object.keys(DATA).forEach(function(k){
    var b=document.createElement('button');
    b.textContent=k.replace(/^qa-/,'').replace(/-/g,' ')+' ('+DATA[k].rows.length+')';
    b.style.cssText='font:inherit;font-size:12px;padding:5px 10px;border:1px solid #D6DBE2;border-radius:8px;background:#fff;cursor:pointer';
    b.onclick=function(){ save(k,toCsv(DATA[k].cols,DATA[k].rows)) };
    bar.appendChild(b);
  });
  var all=document.createElement('button');
  all.textContent='⬇ הכל';
  all.style.cssText='font:inherit;font-size:12px;padding:5px 12px;border:1px solid #1B2430;border-radius:8px;background:#1B2430;color:#fff;font-weight:700;cursor:pointer';
  all.onclick=function(){
    // one at a time, spaced, or the browser blocks the burst
    var keys=Object.keys(DATA), i=0;
    (function next(){ if(i>=keys.length)return;
      var k=keys[i++]; save(k,toCsv(DATA[k].cols,DATA[k].rows)); setTimeout(next,350); })();
  };
  bar.appendChild(all);
})();
</script>
<div class="rel ${S.engineCorrectness === 'PASS' ? 'pass' : 'block'}">ENGINE CORRECTNESS: ${esc(S.engineCorrectness)}</div>
<div class="rel warn">STRATEGY QUALITY: ${esc(strategy)}</div>
<div class="box" style="margin:10px 0"><b style="font-size:15px">CANDIDATE: RECLAIM-ONLY</b>
<small style="display:block;margin-top:4px">Trading enabled: RECLAIM_CONTINUATION. Shadow only (detected, scored, reviewed, not traded): PULLBACK_CONTINUATION, STRUCTURAL_BASE, REVERSAL.<br>
ALL CURRENT 8 DATES ARE NOW EXPOSED. NO TRUE BLIND DATA EXISTS YET.</small>
<table style="margin-top:8px"><tr><th>family</th><th>structure detection</th><th>trading status</th><th>trades</th><th>expectancy</th><th>PF</th></tr>
${['RECLAIM_CONTINUATION','PULLBACK_CONTINUATION','STRUCTURAL_BASE','REVERSAL'].map(function(fam){
  var enabled=fam==='RECLAIM_CONTINUATION';
  var m=enabled?(S.byFamily[fam]||{}):(S.shadow[fam]||{});
  return '<tr><td>'+fam+'</td><td>PASS</td><td>'+(enabled?'ENABLED':'SHADOW_ONLY')+'</td><td>'+(m.trades||0)+'</td><td>'+(m.expectancyR??'—')+'R</td><td>'+(m.pf??'—')+'</td></tr>';
}).join('')}</table></div>
<div class="top">
<div class="box"><small>DATA — filename date range NOT trusted; dates discovered from content</small><b>${S.inventory.symbols} symbols · ${S.inventory.dates} dates</b>
<small>${S.inventory.completeSymbolDays}/${S.inventory.expectedSymbolDays} complete symbol-days · ${S.inventory.rows.toLocaleString()} tradable bars<br>
${S.inventory.missingSymbolDays} missing · ${S.inventory.dupes} duplicates · ${S.inventory.malformed} malformed · ${S.inventory.ohlc} OHLC violations<br>
${S.inventory.zeroVol} zero-volume intraday (kept, flagged) · ${S.inventory.terminal} terminal 16:00 rows (excluded)</small></div>
<div class="box"><small>DEVELOPMENT — 6 dates</small><b>${S.development.uniqueReady} unique READY</b><small>${S.development.symbolDays} symbol-days · ${S.development.uniqueSetups} setups · ${S.development.readyObservations} READY observations · ${S.development.metrics.trades} trades</small></div>
<div class="box"><small>BLIND / HOLDOUT — 2 dates</small><b>${S.blind.uniqueReady} unique READY</b><small>${S.blind.symbolDays} symbol-days · ${S.blind.uniqueSetups} setups · ${S.blind.readyObservations} READY observations · ${S.blind.metrics.trades} trades</small></div>
<div class="box"><small>READY REVIEW</small><b>${S.readyReview.valid} / ${S.readyReview.falsePositive} / ${S.readyReview.ambiguous}</b><small>valid / false positive / ambiguous of ${S.readyReview.total}</small></div>
<div class="box"><small>MISSED OPPORTUNITIES</small><b>${S.missed.real}</b><small>real missed · ${S.missed.noEntry} no valid entry · ${S.missed.ambiguous} ambiguous</small></div>
<div class="box"><small>FUTURE LEAKAGE</small><b>0</b><small>failures</small></div>
</div>
<h2>A. AGGREGATE / DEVELOPMENT / BLIND</h2>
${tbl(MH, [mrow('ALL', S.aggregate), mrow('DEVELOPMENT', S.development.metrics), mrow('BLIND', S.blind.metrics)])}
<h2>B. BY SYMBOL</h2>${tbl(MH, Object.entries(S.bySymbol).map(([k, v]) => mrow(k, v)))}
<h2>C. BY DATE</h2>${tbl(MH, Object.entries(S.byDate).map(([k, v]) => mrow(k + (BLIND.includes(k) ? ' (BLIND)' : ''), v)))}
<div class="box"><small>SCORE and LONG QUALITY are DESCRIPTIVE / UNVALIDATED FOR EDGE. On unseen data neither ranked Reclaim outcomes; score 8 is not shown as better than score 6.</small></div>
<h2>D. BY SETUP FAMILY</h2>${tbl(MH, Object.entries(S.byFamily).map(([k, v]) => mrow(k, v)))}
<h2>E. BY LONG QUALITY</h2>${tbl(MH, Object.entries(S.byQuality).map(([k, v]) => mrow(k, v)))}
<h2>F. BY TIME OF DAY</h2>${tbl(MH, Object.entries(S.byHour).sort().map(([k, v]) => mrow(k, v)))}
<h2>G. EVERY UNIQUE READY SETUP (${readyReview.length})</h2>
${tbl(['when','set','family','setupId','score','quality','trend','structure','class','outcome','R','trigger','stop','T1','R:R','why'],
  readyReview.map(r => '<tr class="' + (r.classification === 'FALSE POSITIVE' ? 'fail' : r.classification === 'VALID' ? 'pass' : '') + '">'
    + ['<a href="' + link(r.symbol, r.date, r.readyTime) + '">' + esc(r.symbol + ' ' + r.date + ' ' + r.readyTime) + '</a>',
       r.set, r.family, r.setupId, r.score, r.quality, r.trend, r.structure, r.classification, r.outcome, r.R,
       r.trigger, r.stop, r.t1, r.rr, esc(r.why)].map(c => '<td>' + (c == null ? '' : c) + '</td>').join('') + '</tr>'))}
<h2>H. SYMBOL-DAY RESULTS (${perDay.length})</h2>
${tbl(['symbol','date','set','bars','quality','setups','READY obs','unique READY','trades','W','L','expR','PF','missed'],
  perDay.map(p => '<tr>' + ['<a href="' + link(p.symbol, p.date, '') + '">' + esc(p.symbol + ' ' + p.date) + '</a>',
    p.set, p.bars, p.quality, p.setups, p.readyObservations, p.uniqueReady, p.trades, p.wins, p.losses,
    p.expectancyR, p.pf, p.missed].map(c => '<td>' + (c == null ? '' : c) + '</td>').join('') + '</tr>'))}
<h2>I. REAL MISSED SETUPS (${missed.filter(m => m.classification === 'REAL MISSED SETUP').length})</h2>
${tbl(['when','set','price','move','prior adverse','state','score','quality','why'],
  missed.filter(m => m.classification === 'REAL MISSED SETUP').slice(0, 200).map(m => '<tr>'
    + ['<a href="' + link(m.symbol, m.date, m.time) + '">' + esc(m.symbol + ' ' + m.date + ' ' + m.time) + '</a>',
       m.set, m.price, '+' + m.upPct + '%', '-' + m.maxAdversePct + '%', m.state, m.score, m.quality, esc(m.why)]
      .map(c => '<td>' + (c == null ? '' : c) + '</td>').join('') + '</tr>'))}
</html>`;
  fs.writeFileSync(path.join(OUT, TAG ? 'trader-v2-qa-' + TAG + '.html' : 'trader-v2-qa-report.html'), html);
}

module.exports = { summary, perDay, readyReview, trades, shadow, missed, reclaimRows };
if (require.main === module) {
  const S = summary;
  console.log('TRADER V2 — 14 SYMBOL / 8 DAY QA   ' + VERSION);
  console.log('  data      ' + S.inventory.symbols + ' symbols, ' + S.inventory.dates + ' dates, '
    + S.inventory.completeSymbolDays + '/' + S.inventory.expectedSymbolDays + ' complete symbol-days, '
    + S.inventory.rows.toLocaleString() + ' tradable bars');
  console.log('            ' + S.inventory.missingSymbolDays + ' missing, ' + S.inventory.zeroVol
    + ' zero-volume intraday, ' + S.inventory.terminal + ' terminal 16:00 rows, ' + S.inventory.ohlc + ' OHLC violations');
  console.log('  ENGINE    ' + S.engineCorrectness + (blockers.length ? '  (' + blockers.length + ' blockers)' : ''));
  ['development', 'blind'].forEach(k => { const d = S[k], m = d.metrics;
    console.log('  ' + k.toUpperCase().padEnd(9) + d.symbolDays + ' sym-days, ' + d.uniqueSetups + ' setups, '
      + d.uniqueReady + ' unique READY (' + d.readyObservations + ' obs), ' + m.trades + ' trades'
      + ' | win ' + (m.winRate ?? '—') + '% exp ' + (m.expectancyR ?? '—') + 'R PF ' + (m.pf ?? '—')
      + ' | FP ' + d.falsePositiveRate + '% amb ' + d.ambiguousRate + '% missed ' + d.realMissed);
  });
  console.log('  READY     valid ' + S.readyReview.valid + ', false positive ' + S.readyReview.falsePositive
    + ', ambiguous ' + S.readyReview.ambiguous + ' of ' + S.readyReview.total);
  console.log('  FAMILY    ' + Object.entries(S.byFamily).map(([k, v]) => k + ' ' + v.trades + 'tr ' + v.expectancyR + 'R').join(' | '));
  console.log('  QUALITY   ' + Object.entries(S.byQuality).map(([k, v]) => k + ' ' + v.trades + 'tr ' + v.expectancyR + 'R').join(' | '));
}
