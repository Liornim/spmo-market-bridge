// TRADER V2 LIVE — page tests, and a parity proof against the Replay engine.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('./trader-v2-engine.cjs'), R = require('./trader-v2-replay.cjs');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const src = readFileSync('view.js', 'utf8');
const grab = k => JSON.parse(src.split('export const ' + k + ' = ')[1].split('\n')[0].trim().replace(/;$/, ''));
const live = grab('TRADER_V2_LIVE_HTML'), replay = grab('TRADER_V2_HTML');
const blocks = s => [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

// ---- 1. same engine, byte for byte
ck('the Live engine block is byte-identical to the Replay engine block', blocks(live)[0] === blocks(replay)[0],
  blocks(live)[0].length + ' vs ' + blocks(replay)[0].length + ' bytes');
ck('it contains decide() and computeBars()', /function decide\(rows, ctx, prior, config\)/.test(live) && /function computeBars\(rows\)/.test(live));
ck('and runV2, so the driver is the replay driver', /function runV2\(rows, engine, opts\)/.test(live));

// ---- 2. isolation from production
['buildTickerState', 'executionPlan', 'radarRow'].forEach(f =>
  ck('Live never calls ' + f, !new RegExp('(^|[^\\w.])' + f + '\\s*\\(').test(live)));
ck('Live bundles no production engine', !/function buildTickerState|function radarRow|function executionPlan/.test(live));

// ---- 3. closed candles only
ck('the still-forming minute is dropped before deciding', /all\.slice\(0, ?-1\)/.test(live) && /closed\[closed\.length ?- ?1\]/.test(live));
ck('a decision is skipped when no NEW closed bar arrived', /if\(closed\[closed\.length-1\]\.time===lastBarTime\)return/.test(live));
ck('it polls automatically', /setInterval\(tick, ?15000\)/.test(live));

// ---- 4. the three decisions
ck('the decision is WAIT / BUY NOW / NO TRADE', /'BUY NOW'/.test(live) && /'NO TRADE'/.test(live) && /'WAIT'/.test(live));
ck('only the traded family can produce BUY NOW', /var TRADED='RECLAIM_CONTINUATION'/.test(live) && /s\.state==='READY'&&tradable/.test(live));
ck('a shadow family reaching READY is NO TRADE and says so', /s\.state==='READY'&&!tradable\)return\{word:'NO TRADE — משפחת צל'/.test(live));

// ---- 5. WAIT states the missing condition; BUY states the true risk
ck('WAIT lists the exact missing conditions', /מה חסר כדי לקנות/.test(live) && /s\.waiting\.stillRequired\.map/.test(live));
ck('BUY shows entry, stop, T1, T2 and R:R', /T1<b>\$/.test(live) && /T2<b>\$/.test(live) && /R:R<b>/.test(live));
ck('BUY shows the TRUE risk per share, and names the stop as the risk point',
  /var risk=Math\.abs\(s\.plan\.entry-s\.plan\.stop\)/.test(live) && /R = \|ENTRY − STOP\|/.test(live) && /נקודת הסיכון, לא הביטול המבני/.test(live));

// ---- 6. lifecycle visible
ck('the setupId and its age are shown', /s\.setupId\+' · גיל '/.test(live));

// ---- 7. immutable log
ck('both logs append and never edit', /decisions\.push\(row\)/.test(live) && /transitions\.push\(row\)/.test(live)
  && !/decisions\[[^\]]+\] ?=/.test(live) && !/transitions\[[^\]]+\] ?=/.test(live) && !/\.splice\(/.test(live));
ck('each row is frozen', /Object\.freeze\(\{ seq:decisions\.length\+1/.test(live));
ck('the transition flag is computed from the signature, not assumed', /var sig=signature\(s\), changed=sig!==lastSig/.test(live));
ck('the row carries the previous signature, so the chain is auditable', /prev_signature:prevSig/.test(live));
ck('the log exports as Excel-ready CSV', /String\.fromCharCode\(0xFEFF\)/.test(live) && /String\.fromCharCode\(13\)\+String\.fromCharCode\(10\)/.test(live));

// ---- 8. alerts
ck('alerts fire on BUY NOW, FAILED and ARMED', /word==='BUY NOW'/.test(live) && /s\.state==='FAILED'/.test(live) && /s\.state==='ARMED'&&s\.setup&&s\.setup\.type===TRADED/.test(live));
ck('alerts can be turned off', /qs\('#alerts'\)\.checked/.test(live));

// ---- 9. no execution path
// word boundaries: 'border-radius' is CSS, not an order path
// Scoped to the PAGE's own script: the shared engine contains an 'order'
// local variable and the English word 'in order', and that engine is the
// same one Replay runs. What must contain no order path is the page.
const pageScript = blocks(live)[1];
['order', 'submitOrder', 'broker', 'ibkr', 'alpaca', 'placeTrade', 'execute'].forEach(w =>
  ck('no execution: the page script has no "' + w + '" as a whole word', !new RegExp('\\b' + w + '\\b', 'i').test(pageScript)));
ck('no execution: no POST or PUT anywhere on the page', !/method: *.(POST|PUT|PATCH|DELETE)./.test(live));

// ---- 10. PARITY AT BOTH LEVELS, on real candles
{
  const rows = readFileSync('qa-corrected/master.csv', 'utf8').split('\n').slice(1).filter(Boolean)
    .map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; });
  const sess = {}; rows.forEach(r => (sess[r.symbol + '|' + r.date] = sess[r.symbol + '|' + r.date] || []).push(r));
  const keys = Object.keys(sess).slice(0, 5);

  // The page's inputSnapshot, reimplemented here from the SAME engine exports
  // the page uses. Live builds it from the growing prefix; Replay builds it
  // from the same prefix taken out of the full session. Equal hashes mean the
  // engine is fed identical inputs, not merely running identical code.
  const snap = (prefix, prevState) => {
    const bars = V.computeBars(prefix), b = bars[bars.length - 1];
    const sw = V.swings(bars, V.CFG.K, bars.length - 1), stx = V.structure(sw);
    const o = { symbol: prefix[0].symbol, date: prefix[0].date, minute: b.time, barsThrough: prefix.length,
      lastClosed: [b.time, b.open, b.high, b.low, b.close, b.volume],
      vwap: +b.vwap.toFixed(4), ema9: +b.ema9.toFixed(4), ema20: +b.ema20.toFixed(4),
      atr: +b.atr.toFixed(4), relVol: +b.relVol.toFixed(4),
      pivotHighs: sw.highs.map(x => [x.i, x.time, +x.price.toFixed(4), x.confirmedAt]),
      pivotLows: sw.lows.map(x => [x.i, x.time, +x.price.toFixed(4), x.confirmedAt]),
      trend: stx.trend, lastHigh: stx.lastHigh ? [stx.lastHigh.time, +stx.lastHigh.price.toFixed(4)] : null,
      lastLow: stx.lastLow ? [stx.lastLow.time, +stx.lastLow.price.toFixed(4)] : null,
      prevLow: stx.prevLow ? [stx.prevLow.time, +stx.prevLow.price.toFixed(4)] : null,
      barRange: +b.range.toFixed(4), barIndex: b.i,
      priorState: prevState ? prevState.state : null, priorSetupId: prevState ? prevState.setupId : null,
      priorAges: prevState && prevState.setupAges ? prevState.setupAges : {},
      priorPlans: prevState && prevState.setupPlans ? Object.keys(prevState.setupPlans).sort().map(k => [k, prevState.setupPlans[k].entry, prevState.setupPlans[k].stop]) : [],
      priorRetired: prevState && prevState.retiredSetups ? Object.keys(prevState.retiredSetups).sort() : [],
      priorCooldown: prevState ? prevState.cooldownUntil || null : null };
    return JSON.stringify(o);
  };
  const F = s => JSON.stringify([s.state, s.setupId, s.setup && s.setup.type, s.score, s.setupAgeBars,
    s.quality && s.quality.label, s.plan, s.reason, s.next, s.waiting && s.waiting.stillRequired]);

  let inTotal = 0, inSame = 0, outTotal = 0, outSame = 0, firstIn = '', firstOut = '';
  keys.forEach(k => {
    const rs = sess[k];
    const replayStates = R.runV2(rs, { computeBars: V.computeBars, decide: V.decide }, {});
    for (let i = 20; i < rs.length; i++) {
      // LIVE: recompute from the prefix, exactly as the page does each minute
      const liveStates = R.runV2(rs.slice(0, i + 1), { computeBars: V.computeBars, decide: V.decide }, {});
      const liveNow = liveStates[liveStates.length - 1];
      const liveIn = snap(rs.slice(0, i + 1), liveStates.length > 1 ? liveStates[liveStates.length - 2] : null);
      const replayIn = snap(rs.slice(0, i + 1), i > 0 ? replayStates[i - 1] : null);
      inTotal++; if (liveIn === replayIn) inSame++; else if (!firstIn) firstIn = k + ' ' + rs[i].time;
      outTotal++; if (F(liveNow) === F(replayStates[i])) outSame++; else if (!firstOut) firstOut = k + ' ' + rs[i].time;
    }
  });
  ck('INPUT SNAPSHOT PARITY: every V2-consumed input identical before the engine runs',
    inSame === inTotal, inSame + '/' + inTotal + (firstIn ? ', first diff ' + firstIn : ''));
  ck('ENGINE OUTPUT PARITY: every decision field identical',
    outSame === outTotal, outSame + '/' + outTotal + (firstOut ? ', first diff ' + firstOut : ''));
}

// ---- 11. the decision log covers every evaluated candle
ck('a row is written for EVERY evaluated closed candle', /decisions\.push\(row\);/.test(live) && !/if\(sig===lastSig\)return null/.test(live));
ck('transitions are a separate log, not the only log', /if\(changed\)transitions\.push\(row\)/.test(live));
ck('every row records whether it was a transition', /is_transition:changed/.test(live));
ck('every row records the input-snapshot hash', /input_hash:inputs&&inputs\.hash/.test(live));
ck('WAIT rows record what was still missing', /waiting_for:\(s\.waiting&&s\.waiting\.stillRequired/.test(live));
ck('both logs are downloadable', /logView==='decisions'\?decisions:transitions/.test(live));
ck('alerts still fire only on transitions', /return changed\?row:null/.test(live));

// ---- 12. US-native risk
ck('ENTRY, STOP and RISK/SHARE are shown in USD first', /ENTRY<b>\$/.test(live) && /STOP<b>\$/.test(live) && /RISK\/SHARE<b>\$/.test(live));
ck('R is |entry - stop|', /Math\.abs\(s\.plan\.entry-s\.plan\.stop\)/.test(live));
ck('the ILS line appears only when a rate was retrieved', /fx\.rate\?/.test(live));
ck('and it carries the rate, source and date', /USD\/ILS.*fx\.source.*fx\.at|fx\.source\+' · '\+fx\.at/.test(live));
ck('ILS never replaces the USD risk', /R = \|ENTRY − STOP\| = \$/.test(live));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
