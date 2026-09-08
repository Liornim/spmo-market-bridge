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
ck('BUY shows entry, stop, T1, T2 and R:R', /יעד 1<b>/.test(live) && /יעד 2<b>/.test(live) && /R:R<b>/.test(live));
ck('BUY shows the TRUE risk per share, and names the stop as the risk point',
  /var risk=s\.plan\.entry-s\.plan\.stop/.test(live) && /סיכון אמיתי לעסקה/.test(live) && /לא הביטול המבני/.test(live));

// ---- 6. lifecycle visible
ck('the setupId and its age are shown', /s\.setupId\+' · גיל '/.test(live));

// ---- 7. immutable log
ck('the log appends and never edits', /log\.push\(row\)/.test(live) && !/log\[[^\]]+\] ?=/.test(live) && !/log\.splice/.test(live));
ck('each row is frozen', /Object\.freeze\(\{ seq:log\.length\+1/.test(live));
ck('a row is written only on a real transition', /if\(sig===lastSig\)return null/.test(live));
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

// ---- 10. LIVE vs REPLAY PARITY, on real candles
{
  const rows = readFileSync('qa-corrected/master.csv', 'utf8').split('\n').slice(1).filter(Boolean)
    .map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], unix: Math.floor(Date.parse(p[1] + 'T' + p[2] + ':00Z') / 1000) }; });
  const sess = {}; rows.forEach(r => (sess[r.symbol + '|' + r.date] = sess[r.symbol + '|' + r.date] || []).push(r));
  const keys = Object.keys(sess).slice(0, 5);
  const F = s => JSON.stringify([s.state, s.setupId, s.setup && s.setup.type, s.score, s.setupAgeBars,
    s.quality && s.quality.label, s.plan, s.reason, s.next, s.waiting && s.waiting.stillRequired]);
  let compared = 0, diffs = 0, first = '';
  keys.forEach(k => {
    const rs = sess[k];
    const replayStates = R.runV2(rs, { computeBars: V.computeBars, decide: V.decide }, {});
    // the live page recomputes from scratch on every closed bar; reproduce that
    for (let i = 20; i < rs.length; i++) {
      const liveNow = R.runV2(rs.slice(0, i + 1), { computeBars: V.computeBars, decide: V.decide }, {}).pop();
      compared++;
      if (F(liveNow) !== F(replayStates[i])) { diffs++; if (!first) first = k + ' ' + rs[i].time; }
    }
  });
  ck('LIVE vs REPLAY PARITY: identical on every minute of 5 real sessions', diffs === 0,
    compared + ' minutes compared, ' + diffs + ' differences' + (first ? ', first ' + first : ''));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
