// The six cases, resolved through the SAME derivation the page uses.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('./trader-v2-engine.cjs'), R = require('./trader-v2-replay.cjs');
const eng = { computeBars: V.computeBars, decide: V.decide };
const U = { NOT_NOW:'לא עכשיו', WATCH:'מעקב', NEAR:'קרוב לכניסה', READY:'מוכן לכניסה', IN_TRADE:'בעסקה' };

function derive(sym, rows, upto, pos) {
  const i = rows.findIndex(r => r.time === upto);
  const closed = rows.slice(0, i + 1);
  const s = R.runV2(closed, eng, {}).pop();
  const b = V.computeBars(closed).pop();
  const tradable = s.setup && s.setup.type === 'RECLAIM_CONTINUATION';
  const need = (s.waiting && s.waiting.stillRequired) || [];
  const ext = s.plan ? (b.close - s.plan.entry) / (b.atr || 0.01) : null;
  const onlyTrig = need.length === 1 && /פריצה|סגירה קרוב/.test(need[0]);
  const nearPct = s.plan ? (s.plan.entry - b.close) / s.plan.entry * 100 : null;
  let status;
  if (pos) status = 'ACTIVE';
  else if (s.state === 'READY' && tradable) status = 'READY';
  else if (s.state === 'FAILED' || s.state === 'AVOID') status = 'AVOID';
  else if (s.state === 'READY' && !tradable) status = 'AVOID';
  else if (tradable && ext != null && ext > V.CFG.chaseATR) status = 'AVOID';
  else if (tradable && onlyTrig && nearPct >= 0 && nearPct <= 0.15) status = 'CLOSE';
  else if (need.length) status = 'WATCH';
  else if (s.setup && (s.next || '').trim()) status = 'WATCH';
  else status = 'QUIET';
  const userStatus = status === 'ACTIVE' ? 'IN_TRADE' : !tradable ? 'NOT_NOW'
    : status === 'READY' ? 'READY' : status === 'CLOSE' ? 'NEAR'
    : status === 'WATCH' ? 'WATCH' : 'NOT_NOW';
  const requirement = need.length ? need : ((s.next || '').trim() ? [s.next] : []);
  return { sym, time: upto, old: status, u: userStatus, uTxt: U[userStatus],
    family: s.setup ? s.setup.type : '—', engine: s.state, score: s.score,
    tradable: !!tradable, why: s.reason || s.next || '', requirement, plan: s.plan };
}
const load = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(1)
  .map(l => { const p = l.split(','); return { symbol:p[0],date:p[1],time:p[2],open:+p[3],high:+p[4],low:+p[5],close:+p[6],volume:+p[7],unix:Math.floor(Date.parse(p[1]+'T'+p[2]+':00Z')/1000) }; })
  .filter(r => r.time <= '15:59');

const pick = [];
for (const [f, sym] of [['fixtures/live/g2/AMD.csv','AMD'], ['fixtures/live/g2/MSFT.csv','MSFT'],
                        ['fixtures/live/2026-09-08/TSLA.csv','TSLA'], ['fixtures/live/g2/SMCI.csv','SMCI']]) {
  const rows = load(f);
  for (let i = 30; i < rows.length; i += 1) {
    const d = derive(sym, rows, rows[i].time, false);
    pick.push(d);
  }
}
const show = (label, d) => {
  if (!d) { console.log(label.padEnd(26) + '  (no example in the fixtures)'); return; }
  console.log('\n' + label);
  console.log('  ' + d.sym + ' ' + d.time + '   internal: ' + d.old + ' / ' + d.engine + ' / ' + d.family);
  console.log('  BEFORE: ' + d.old + '  ·  ציון ' + d.score + '/10  ·  משפחה ' + d.family +
    (d.tradable ? '  ·  TRADE ENABLED' : d.family !== '—' ? '  ·  SHADOW' : ''));
  console.log('  AFTER : ' + d.uTxt + (d.tradable && d.u !== 'NOT_NOW' ? '  ·  ציון ' + d.score + '/10' : ''));
  console.log('          למה: ' + (d.why || '—').slice(0, 74));
  if (d.u !== 'READY' && d.requirement.length) console.log('          צריך לקרות: ' + d.requirement.join(' · ').slice(0, 74));
  if (d.plan && d.tradable && d.u !== 'NOT_NOW')
    console.log('          תוכנית: כניסה ' + d.plan.entry + ' · סטופ ' + d.plan.stop + ' · T1 ' + d.plan.t1 + ' · R:R ' + d.plan.rr);
};
show('1 · NO SETUP / AVOID',        pick.find(d => d.family === '—' && !d.requirement.length));
show('2 · TRADE-ENABLED WATCH',     pick.find(d => d.tradable && d.u === 'WATCH'));
show('3 · TRADE-ENABLED VERY CLOSE',pick.find(d => d.u === 'NEAR'));
show('4 · TRADE-ENABLED READY',     pick.find(d => d.u === 'READY'));
show('5 · SHADOW-ONLY SETUP',       pick.find(d => !d.tradable && d.family !== '—' && d.old === 'WATCH'));
