import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.QA_FILE = 'qa-corrected/master.csv'; process.env.QA_TAG = 'corrected'; process.env.QA_ALL_DEV = '1';
const B = require('./trader-v2-batch-qa.cjs');
const V = require('./trader-v2-engine.cjs'), R = require('./trader-v2-replay.cjs');
const eng = { computeBars: V.computeBars, decide: V.decide };
const rows = readFileSync('qa-corrected/master.csv', 'utf8').split('\n').slice(1).filter(Boolean).map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; });
const sess = {}; rows.forEach(r => (sess[r.symbol + '|' + r.date] = sess[r.symbol + '|' + r.date] || []).push(r));
const csv = (arr, cols) => [cols.join(',')].concat(arr.map(r => cols.map(c => JSON.stringify(r[c] == null ? '' : r[c])).join(','))).join('\n');

// ---- IDENTITY HEALTH: every Reclaim id across every session
const events = []; let vwapOnlyChanges = 0; const deep = [];
for (const [k, rs] of Object.entries(sess)) {
  const st = R.runV2(rs, eng, {});
  const ids = {};
  st.forEach(s => { if (s.setupId && /^RECLAIM_CONTINUATION\|/.test(s.setupId)) { const e = ids[s.setupId] = ids[s.setupId] || { setupId: s.setupId, symbol: k.split('|')[0], date: k.split('|')[1], first: s.time, bars: 0, maxAge: 0, states: [], vwaps: new Set(), triggers: new Set(), lastState: '' }; e.bars++; e.last = s.time; e.maxAge = Math.max(e.maxAge, s.setupAgeBars || 0); e.states.push(s.state); e.vwaps.add(s.vwap.toFixed(2)); if (s.plan) e.triggers.add(s.plan.entry); e.lastState = s.state; } });
  // a VWAP-movement-only id change: consecutive bars, both live reclaims, VWAP differs, id differs, and the level was NOT lost between them
  for (let i = 1; i < st.length; i++) { const a = st[i - 1], b = st[i];
    if (a.setupId && b.setupId && /^RECLAIM/.test(a.setupId) && /^RECLAIM/.test(b.setupId) && a.setupId !== b.setupId && a.setup && b.setup && a.setup.reclaimLevelType === b.setup.reclaimLevelType && rs[i].close > (a.setup.reclaimLevel || 0) && ['SETUP','ARMED','READY'].includes(a.state)) vwapOnlyChanges++; }
  Object.values(ids).forEach(e => { e.distinctVwap = e.vwaps.size; e.frozenTriggers = e.triggers.size; e.readyBars = e.states.filter(s => s === 'READY').length; e.outcome = e.states.includes('FAILED') ? 'FAILED' : e.lastState; events.push(e); });
}
const hist = { '1': 0, '2': 0, '3-5': 0, '6-10': 0, '>10': 0 };
events.forEach(e => { const n = e.bars; hist[n === 1 ? '1' : n === 2 ? '2' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : '>10']++; });
const ages = events.map(e => e.bars).sort((a, b) => a - b);
const identity = { total_ids: events.length, ...hist, max_age: Math.max(...ages), avg_age: +(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(2), median_age: ages[Math.floor(ages.length / 2)], vwap_movement_only_id_changes: vwapOnlyChanges, ids_with_more_than_one_trigger: events.filter(e => e.frozenTriggers > 1).length };
writeFileSync('qa-corrected-identity-health.csv', 'metric,value\n' + Object.entries(identity).map(([k, v]) => k + ',' + v).join('\n'));
writeFileSync('qa-corrected-reclaim-events.csv', csv(events, ['symbol','date','setupId','first','last','bars','maxAge','distinctVwap','frozenTriggers','readyBars','outcome']));
console.log('IDENTITY:', JSON.stringify(identity));
// 20 deep checks across symbols/dates: events with >=6 bars, one per symbol
const seen = new Set(); events.filter(e => e.bars >= 6 && e.frozenTriggers === 1).forEach(e => { if (deep.length < 20 && !seen.has(e.symbol)) { seen.add(e.symbol); deep.push(e); } });
console.log('DEEP CHECK (20): symbol date start→last bars distinctVWAP trigger outcome');
deep.forEach(e => console.log('  ' + e.symbol.padEnd(6) + e.date.slice(5) + ' ' + e.first + '→' + e.last + ' ' + String(e.bars).padStart(3) + ' bars, VWAP took ' + String(e.distinctVwap).padStart(2) + ' values, trigger ' + Array.from(e.triggers)[0] + ', ' + e.outcome));

// ---- PRIMARY
const tr = B.trades; const Rs = tr.map(t => t.R); const W = Rs.filter(x => x > 0), L = Rs.filter(x => x <= 0);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length; const srt = Rs.slice().sort((a, b) => a - b);
const boot = (arr, f, n = 3000) => { const o = []; for (let i = 0; i < n; i++) { const s = []; for (let j = 0; j < arr.length; j++) s.push(arr[Math.floor(Math.random() * arr.length)]); o.push(f(s)); } o.sort((a, b) => a - b); return [o[Math.floor(n * .025)], o[Math.floor(n * .975)]]; };
// clustered by symbol
const bySym = {}; tr.forEach(t => (bySym[t.symbol] = bySym[t.symbol] || []).push(t.R)); const syms = Object.keys(bySym);
const cboot = (n = 3000) => { const o = []; for (let i = 0; i < n; i++) { const s = []; for (let j = 0; j < syms.length; j++) s.push(...bySym[syms[Math.floor(Math.random() * syms.length)]]); o.push(mean(s)); } o.sort((a, b) => a - b); return [o[Math.floor(n * .025)], o[Math.floor(n * .975)]]; };
let cum = 0, peak = 0, dd = 0, streak = 0, worst = 0; tr.forEach(t => { cum += t.R; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); streak = t.R <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); });
const desc = Rs.slice().sort((a, b) => b - a), tot = Rs.reduce((a, b) => a + b, 0);
const P = { trades: tr.length, wins: W.length, losses: L.length, winRate: +(W.length / tr.length * 100).toFixed(1), totalR: +tot.toFixed(2), expectancy: +mean(Rs).toFixed(3), median: +srt[Math.floor(srt.length / 2)].toFixed(2), pf: +(W.reduce((a, b) => a + b, 0) / Math.abs(L.reduce((a, b) => a + b, 0))).toFixed(2), avgWin: +mean(W).toFixed(2), avgLoss: +mean(L).toFixed(2), mfe: +mean(tr.map(t => t.mfeR)).toFixed(2), mae: +mean(tr.map(t => t.maeR)).toFixed(2), hold: Math.round(mean(tr.map(t => t.minutesHeld))), maxDD: +dd.toFixed(2), longestLosingStreak: worst,
  ci95: boot(Rs, mean).map(x => +x.toFixed(3)), winRateCI: boot(Rs, a => a.filter(x => x > 0).length / a.length).map(x => +(x * 100).toFixed(1)), clusteredBySymbolCI: cboot().map(x => +x.toFixed(3)),
  top1: +desc[0].toFixed(2), top3: +desc.slice(0, 3).reduce((a, b) => a + b, 0).toFixed(2), top5: +desc.slice(0, 5).reduce((a, b) => a + b, 0).toFixed(2), exTop1: +(tot - desc[0]).toFixed(2), exTop3: +(tot - desc.slice(0, 3).reduce((a, b) => a + b, 0)).toFixed(2), exTop5: +(tot - desc.slice(0, 5).reduce((a, b) => a + b, 0)).toFixed(2),
  uniqueReclaimEvents: events.length, uniqueReady: new Set(tr.map(t => t.setupId)).size, readyObs: events.reduce((a, e) => a + e.readyBars, 0) };
const sumBy = f => { const g = {}; tr.forEach(t => { const k = f(t); (g[k] = g[k] || []).push(t.R); }); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { trades: v.length, wins: v.filter(x => x > 0).length, losses: v.filter(x => x <= 0).length, winRate: +(v.filter(x => x > 0).length / v.length * 100).toFixed(1), expectancyR: +mean(v).toFixed(3), totalR: +v.reduce((a, b) => a + b, 0).toFixed(2), pf: (() => { const w = v.filter(x => x > 0).reduce((a, b) => a + b, 0), l = Math.abs(v.filter(x => x <= 0).reduce((a, b) => a + b, 0)); return l ? +(w / l).toFixed(2) : (w ? 'inf' : 0); })() }])); };
const bySymbol = sumBy(t => t.symbol), byDate = sumBy(t => t.date), byQuality = sumBy(t => t.quality), byScore = sumBy(t => 'score ' + t.readyScore);
const bucket = t => { const h = t.readyTime; return h < '10:30' ? '09:30-10:29' : h < '12:00' ? '10:30-11:59' : h < '14:00' ? '12:00-13:59' : h < '15:00' ? '14:00-14:59' : '15:00-15:59'; };
const byTime = sumBy(bucket);
P.profitableSymbols = Object.values(bySymbol).filter(v => v.totalR > 0.05).length; P.losingSymbols = Object.values(bySymbol).filter(v => v.totalR < -0.05).length; P.flatSymbols = syms.length - P.profitableSymbols - P.losingSymbols;
P.profitableDates = Object.values(byDate).filter(v => v.totalR > 0).length; P.losingDates = Object.values(byDate).filter(v => v.totalR <= 0).length;
const w = (n, o, first) => writeFileSync(n, csv(Object.entries(o).map(([k, v]) => ({ [first]: k, ...v })), [first, 'trades', 'wins', 'losses', 'winRate', 'expectancyR', 'totalR', 'pf']));
w('qa-corrected-by-symbol.csv', bySymbol, 'symbol'); w('qa-corrected-by-date.csv', byDate, 'date'); w('qa-corrected-by-time.csv', byTime, 'bucket'); w('qa-corrected-by-score.csv', byScore, 'score'); w('qa-corrected-by-long-quality.csv', byQuality, 'quality');
// reclaim-ready rows, churn shadow, shadow families
const rr = B.reclaimRows; writeFileSync('qa-corrected-reclaim-ready.csv', csv(rr, Object.keys(rr[0] || {})));
const churn = rr.filter(x => x.churn_candidate_block); const keep = rr.filter(x => !x.churn_candidate_block);
const churnRep = { candidates: churn.length, winners: churn.filter(x => x.R > 0).length, losers: churn.filter(x => x.R <= 0).length, expectancyIfBlocked: keep.length ? +mean(keep.map(x => x.R)).toFixed(3) : null, expectancyPrimary: P.expectancy };
writeFileSync('qa-corrected-churn-shadow.csv', csv(churn, ['symbol','date','readyTime','setupId','bars_since_prior_attempt','prior_attempt_outcome','new_pivot_since_prior_attempt','R']) + '\n\nsummary,' + JSON.stringify(churnRep).replace(/,/g, ';'));
const shadow = B.summary.shadow; const shadowCI = {}; Object.entries(shadow).forEach(([k, v]) => { const trs = B.shadow.filter(t => t.type === k).map(t => t.R); shadowCI[k] = { ...v, ci95: trs.length >= 20 ? boot(trs, mean).map(x => +x.toFixed(3)) : 'n<20' }; });
writeFileSync('qa-corrected-shadow-families.csv', csv(Object.entries(shadowCI).map(([k, v]) => ({ family: k, trades: v.trades, winRate: v.winRate, expectancyR: v.expectancyR, pf: v.pf, ci95: JSON.stringify(v.ci95) })), ['family','trades','winRate','expectancyR','pf','ci95']));
writeFileSync('qa-corrected-trades.csv', csv(tr, ['symbol','date','setupId','type','readyTime','entryTime','entryPrice','stop','t1','t2','exitTime','exitReason','mfeR','maeR','R','minutesHeld','quality','readyScore']));
// H/I/J diagnostics
const ageAt = sumBy(t => { const a = (rr.find(x => x.setupId === t.setupId) || {}).barsHoldingReclaim; return a == null ? '?' : a <= 2 ? 'hold 2' : a <= 4 ? 'hold 3-4' : a <= 8 ? 'hold 5-8' : 'hold 9+'; });
const attempt = sumBy(t => (rr.find(x => x.setupId === t.setupId) || {}).same_reclaim_level_recently_traded ? 'repeat attempt' : 'first attempt');
const trend = sumBy(t => (rr.find(x => x.setupId === t.setupId) || {}).localTrend || '?');
const lvl = sumBy(t => /\|VWAP\|/.test(t.setupId) ? 'VWAP' : 'pivot');
writeFileSync('qa-corrected-summary.json', JSON.stringify({ version: 'v189-reclaim-stable-id', primary: P, identity, bySymbol, byDate, byTime, byScore, byQuality, byTrend: trend, byLevelType: lvl, byHold: ageAt, byAttempt: attempt, churn: churnRep, shadow: shadowCI, engine: B.summary.engineCorrectness, inventory: B.summary.inventory }, null, 1));
console.log('\nPRIMARY', JSON.stringify(P));
console.log('BY DATE', JSON.stringify(Object.fromEntries(Object.entries(byDate).map(([k, v]) => [k.slice(5), v.trades + 'tr ' + v.expectancyR + 'R']))));
console.log('BY TIME', JSON.stringify(Object.fromEntries(Object.entries(byTime).map(([k, v]) => [k, v.trades + 'tr ' + v.expectancyR + 'R']))));
console.log('BY SCORE', JSON.stringify(Object.fromEntries(Object.entries(byScore).map(([k, v]) => [k, v.trades + 'tr ' + v.expectancyR + 'R']))));
console.log('BY QUALITY', JSON.stringify(Object.fromEntries(Object.entries(byQuality).map(([k, v]) => [k, v.trades + 'tr ' + v.expectancyR + 'R']))));
console.log('BY TREND', JSON.stringify(trend), '\nBY LEVEL', JSON.stringify(lvl), '\nBY HOLD', JSON.stringify(ageAt), '\nBY ATTEMPT', JSON.stringify(attempt));
console.log('CHURN', JSON.stringify(churnRep)); console.log('SHADOW', JSON.stringify(shadowCI));
