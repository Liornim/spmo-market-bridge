// DECISION AUDIT. For each of the 18 Reclaim trades: every feature a trader
// could see at minute T, a locked Trader-QA decision made from those features
// alone, and only THEN the outcome. No code in the engine is touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('./trader-v2-engine.cjs'), R = require('./trader-v2-replay.cjs');
const eng = { computeBars: V.computeBars, decide: V.decide };
process.env.QA_FILE = 'qa-independent/master.csv'; process.env.QA_TAG = 'indep'; process.env.QA_ALL_DEV = '1';
const B = require('./trader-v2-batch-qa.cjs');
const rows = readFileSync('qa-independent/master.csv', 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
  .map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; })
  .filter(r => r.time !== '16:00');
const sess = {}; rows.forEach(r => (sess[r.symbol + '|' + r.date] = sess[r.symbol + '|' + r.date] || []).push(r));

const audit = [];
for (const t of B.trades.filter(t => t.type === 'RECLAIM_CONTINUATION')) {
  const rs = sess[t.symbol + '|' + t.date];
  const i = rs.findIndex(r => r.time === t.readyTime);
  const prefix = rs.slice(0, i + 1);
  const st = R.runV2(prefix, eng, {});
  const s = st[st.length - 1];
  const bars = V.computeBars(prefix), b = bars[bars.length - 1], atr = b.atr || 0.01;
  const sw = V.swings(bars, V.CFG.K, bars.length - 1), stx = V.structure(sw);
  const lvl = s.setup.reclaimLevel, trig = s.plan.entry;

  // ---- entry-time features, each defined explicitly
  // hold: consecutive closes above the reclaimed level up to T
  let hold = 0; for (let k = bars.length - 1; k >= 0 && bars[k].close > lvl; k--) hold++;
  // retest: after the reclaim began, did price come back to within 0.3 ATR of the level and hold (close above)?
  const since = bars.slice(bars.length - hold);
  const retest = since.some(x => x.low <= lvl + 0.3 * atr && x.close > lvl);
  // confirmed HL: latest confirmed pivot low is after the reclaim began and above the level
  const hlConfirmed = !!(stx.lastLow && stx.lastLow.i >= bars.length - hold - V.CFG.K && stx.lastLow.price > lvl - 0.1 * atr && stx.lastLow.confirmedAt <= bars.length - 1);
  // meaningful LH reclaimed: the most recent confirmed swing high before the reclaim is below the current close
  const lhBefore = sw.highs.filter(h => h.i < bars.length - hold).slice(-1)[0];
  const lhReclaimed = !!(lhBefore && b.close > lhBefore.price);
  // closed above the trigger on the READY bar, or merely touched it
  const closedAbove = b.close > trig, touchedOnly = b.high >= trig && b.close <= trig;
  // acceptance: bars since reclaim with close above level, fraction
  const acceptance = since.length ? since.filter(x => x.close > lvl).length / since.length : 0;
  // extension from trigger in ATR
  const ext = (b.close - trig) / atr;
  // relative volume on the READY bar vs the last 20
  const v20 = bars.slice(-21, -1); const relVol = v20.length ? b.volume / (v20.reduce((a, x) => a + x.volume, 0) / v20.length) : 1;
  // nearest confirmed swing high above the trigger, in ATR
  const above = sw.highs.map(h => h.price).filter(p => p > trig).sort((a, c) => a - c)[0];
  const roomAtr = above ? (above - trig) / atr : null;
  // post-failure reset: was there a FAILED state in the last 8 bars, and did a new pivot low form after it
  const recentFail = st.slice(-9, -1).findIndex(x => x.state === 'FAILED');
  const failedRecently = recentFail >= 0;
  const failBar = failedRecently ? bars.length - 9 + recentFail : -1;
  const pivotAfterFail = failedRecently && !!(stx.lastLow && stx.lastLow.i > failBar);
  const resetQuality = !failedRecently ? 'n/a' : pivotAfterFail ? 'pivot formed after failure' : 'NO structural reset';
  // local downtrend unresolved: trend DOWN at T, or a lower high within the last 15 bars not yet exceeded
  const recentLH = stx.labels.filter(x => x.kind === 'LH' && x.i >= bars.length - 15).slice(-1)[0];
  const downUnresolved = stx.trend === 'DOWN' || (recentLH && b.close < recentLH.price);
  // level significance: VWAP or a confirmed pivot low
  const levelKind = /VWAP/.test(s.setup.reclaimLevelName) ? 'VWAP' : 'pivot low';

  // ---- Trader-QA decision, from the features above ONLY. Locked here.
  const missing = [];
  if (hold < 3) missing.push('hold < 3 bars');
  if (!retest && !hlConfirmed) missing.push('no retest and no confirmed HL');
  if (!closedAbove) missing.push('did not close above trigger');
  if (ext > 0.8) missing.push('extended ' + ext.toFixed(1) + ' ATR past trigger');
  if (roomAtr != null && roomAtr < 1.0) missing.push('resistance ' + roomAtr.toFixed(1) + ' ATR above trigger');
  if (failedRecently && !pivotAfterFail) missing.push('re-armed after failure with no structural reset');
  if (downUnresolved) missing.push('local lower high not reclaimed');
  const kill = [];
  if (failedRecently && !pivotAfterFail && hold < 3) kill.push('churn at the same level');
  const decision = kill.length ? 'NO TRADE' : missing.length ? 'WAIT' : 'BUY';

  audit.push({
    symbol: t.symbol, date: t.date, ready: t.readyTime, entry: t.entryPrice, setupId: t.setupId,
    level: lvl, levelKind, trigger: trig, stop: t.stop, t1: t.t1, rr: s.plan.rr, score: s.score, quality: s.quality.label,
    trend: stx.trend, vwapAtr: +((b.close - b.vwap) / atr).toFixed(2), ema: b.ema9 >= b.ema20 ? 'EMA9>20' : 'EMA9<20',
    hold, retest, hlConfirmed, lhReclaimed, closedAbove, acceptance: +acceptance.toFixed(2),
    relVol: +relVol.toFixed(2), roomAtr: roomAtr == null ? null : +roomAtr.toFixed(1), reset: resetQuality, ext: +ext.toFixed(2),
    downUnresolved, engine: 'READY', qa: decision, qaReason: (kill.concat(missing).join('; ') || 'all confirmations present'),
    // outcome attached AFTER the decision above is fixed
    R: t.R, mfe: t.mfeR, mae: t.maeR, engineClass: (B.reclaimRows.find(x => x.setupId === t.setupId) || {}).rootCause || 'WIN'
  });
}
audit.sort((a, b) => b.R - a.R);
writeFileSync('qa-independent/decision-audit.json', JSON.stringify(audit, null, 1));
const cols = ['symbol','date','ready','entry','level','levelKind','trigger','stop','t1','rr','score','quality','trend','vwapAtr','ema','hold','retest','hlConfirmed','lhReclaimed','closedAbove','acceptance','relVol','roomAtr','reset','ext','downUnresolved','engine','qa','qaReason','R','mfe','mae','engineClass'];
writeFileSync('qa-independent/decision-audit.csv', [cols.join(',')].concat(audit.map(a => cols.map(c => JSON.stringify(a[c] == null ? '' : a[c])).join(','))).join('\n'));

console.log('sym  date  READY  lvl      kind   hold ret HL  LH  close acc  rv   room ext   reset                     QA        R      class');
audit.forEach(a => console.log(a.symbol.padEnd(5) + a.date.slice(5) + ' ' + a.ready + ' ' + String(a.level).padStart(7) + '  ' + a.levelKind.padEnd(6) + ' ' + String(a.hold).padStart(3) + '  ' + (a.retest ? 'Y' : '-') + '   ' + (a.hlConfirmed ? 'Y' : '-') + '   ' + (a.lhReclaimed ? 'Y' : '-') + '   ' + (a.closedAbove ? 'Y' : '-') + '   ' + a.acceptance.toFixed(1) + ' ' + String(a.relVol).padStart(4) + ' ' + String(a.roomAtr ?? '—').padStart(4) + ' ' + String(a.ext).padStart(5) + ' ' + a.reset.padEnd(25) + ' ' + a.qa.padEnd(9) + ' ' + String(a.R).padStart(5) + '  ' + a.engineClass.slice(0, 12)));
const tally = (f) => { const g = {}; audit.forEach(a => { const k = f(a); g[k] = g[k] || { n: 0, R: 0, w: 0 }; g[k].n++; g[k].R += a.R; if (a.R > 0) g[k].w++; }); return Object.entries(g).map(([k, v]) => k + ' n=' + v.n + ' win ' + (v.w / v.n * 100).toFixed(0) + '% exp ' + (v.R / v.n).toFixed(2) + 'R').join('  |  '); };
console.log('\nQA decision vs outcome:  ' + tally(a => a.qa));
