// The buy card must never say BUY on data it cannot stand behind, and must
// never phrase a decision as a limit order.
const B = require('./buycard.cjs');
const L = require('./layers.cjs');
const E = require('./engine.cjs');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function session(n, base, shape) {
  const out = []; let p = base, s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const d = shape === 'up' ? 0.01 : shape === 'down' ? -0.01 : 0;
    const o = p, c = o + (rnd() - 0.5) * 0.08 + d;
    out.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60,
      open: +o.toFixed(3), high: +(Math.max(o, c) + 0.03).toFixed(3),
      low: +(Math.min(o, c) - 0.03).toFixed(3), close: +c.toFixed(3), volume: 5000 });
    p = c;
  }
  return out;
}
const mk = (rows, over) => L.buildTickerState('TEST', E.analyze(rows, { K: 3 }),
  Object.assign({ market: 'Neutral', freshness: 'LIVE', staleSeconds: 30 }, over || {}));

// ---- data safety: nothing unusable may ever produce BUY
{
  const partial = session(23, 500).map((r, i) => Object.assign(r, { time: tm(92 + i) }));
  const cPart = B.buyCard(mk(partial), E.analyze(partial, { K: 3 }), {});
  ck('a partial session never says BUY', cPart.decision !== 'BUY', cPart.decision);
  ck('it says RECHECK, not a refusal to buy', cPart.decision === 'RECHECK', cPart.decision);
  ck('and names the data problem', /סשן חלקי|ישן|נרות/.test(cPart.blocked || ''), cPart.blocked);

  const full = session(340, 500);
  const cStale = B.buyCard(mk(full, { freshness: 'STALE', staleSeconds: 9000 }), E.analyze(full, { K: 3 }), {});
  ck('stale data never says BUY', cStale.decision !== 'BUY', cStale.decision);
  ck('stale data says why', /ישנים/.test(cStale.blocked || ''), cStale.blocked);

  const cNone = B.buyCard(null, null, {});
  ck('no analysis at all is handled', cNone.decision === 'NO SETUP' && !!cNone.blocked, cNone.blocked);
}

// ---- the four states, and only those four
{
  const rows = session(340, 500);
  const c = B.buyCard(mk(rows), E.analyze(rows, { K: 3 }), {});
  const ALLOWED = ['BUY', 'WAIT', 'RECHECK', 'NO SETUP'];
  ck('the decision is one of the four allowed states', ALLOWED.indexOf(c.decision) >= 0, c.decision);
  ck('every map row is one of the four', (c.map || []).every(r => ALLOWED.indexOf(r.decision) >= 0),
    (c.map || []).map(r => r.decision).join(','));
}

// ---- it must not become a limit-order system
{
  const rows = session(340, 500, 'up');
  const c = B.buyCard(mk(rows), E.analyze(rows, { K: 3 }), {});
  const text = JSON.stringify(c);
  ['אם יגיע', 'כשיגיע', 'if price reaches', 'reaches'].forEach(phrase =>
    ck('no limit-order phrasing: "' + phrase + '"', text.indexOf(phrase) < 0));
  ck('the map is expressed as ranges of the price being seen',
    (c.map || []).every(r => r.from != null || r.above != null || r.below != null));
}

// ---- buy-only: nothing about exiting
{
  const rows = session(340, 500, 'up');
  const c = B.buyCard(mk(rows), E.analyze(rows, { K: 3 }), {});
  const text = JSON.stringify(c);
  ['מימוש', 'יעד', 'stop', 'target', 'exit', 'לממש', 'חלקית', 'הוספה'].forEach(w =>
    ck('the card says nothing about "' + w + '"', text.indexOf(w) < 0, text.indexOf(w) >= 0 ? 'found' : ''));
}

// ---- outside validity is RECHECK, never a refusal
{
  const rows = session(340, 500);
  const c = B.buyCard(mk(rows), E.analyze(rows, { K: 3 }), {});
  // A map only exists where a setup does. Where there is one, everything
  // outside its validity must be RECHECK and never a refusal.
  if (c.hasMap) {
    const above = (c.map || []).find(r => r.above != null);
    const below = (c.map || []).find(r => r.below != null);
    ck('above the validity range is RECHECK', above && above.decision === 'RECHECK', above && above.decision);
    ck('below the validity range is RECHECK', below && below.decision === 'RECHECK', below && below.decision);
    ck('the validity range is present and ordered', c.validity && c.validity.high > c.validity.low,
      c.validity.low + '–' + c.validity.high);
  } else {
    ck('without a setup there is no map at all', c.map.length === 0 && c.validity === null);
    ck('and the decision is NO SETUP, not RECHECK', c.decision === 'NO SETUP', c.decision);
  }
}

// ---- the probability of an unrelated event is not shown
{
  const rows = session(340, 500);
  const c = B.buyCard(mk(rows), E.analyze(rows, { K: 3 }), {});
  ck('no probability is carried over from the path model', c.probability === null);
  ck('and it says why', /מודד אירוע אחר/.test(c.probabilityNote || ''), c.probabilityNote);
}

// ---- required fields
{
  const rows = session(340, 500);
  const c = B.buyCard(mk(rows), E.analyze(rows, { K: 3 }), { symbol: 'TEST', market: 'Neutral' });
  ['symbol', 'lastBarTime', 'lastClose', 'coverage', 'decision', 'quality', 'confidence',
   'structure', 'momentum', 'vwap', 'ema9', 'ema20', 'market', 'validity', 'map'].forEach(f =>
    ck('the card carries ' + f, c[f] !== undefined, String(c[f])));
  ck('nothing is hardcoded to the example symbol', c.symbol !== 'MSFT');
}


// ---- NO SETUP is its own answer, not a weak one
{
  const flat = [];
  let p = 616.7;
  for (let i = 0; i < 390; i++) { const o = p, c = o + Math.sin(i / 30) * 0.02;
    flat.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +o.toFixed(3),
      high: +(Math.max(o, c) + 0.03).toFixed(3), low: +(Math.min(o, c) - 0.03).toFixed(3),
      close: +c.toFixed(3), volume: 5000 }); p = c; }
  const A2 = E.analyze(flat, { K: 3 });
  const c = B.buyCard(L.buildTickerState('META', A2, { market: 'Unavailable', freshness: 'LIVE', staleSeconds: 30 }), A2, { symbol: 'META' });

  if (c.decision === 'NO SETUP') {
    ck('NO SETUP has no price map', c.map.length === 0 && c.hasMap === false, c.map.length + ' rows');
    ck('NO SETUP has no validity range', c.validity === null);
    ck('NO SETUP has no confidence', c.confidence === '—', c.confidence);
    ck('NO SETUP quality is "none", not "weak"', c.quality === 'אין', c.quality);
    ck('NO SETUP is not dressed up as RECHECK', c.decision !== 'RECHECK');
    ck('but it still explains itself', c.reasons.length > 0, c.reasons.join(' | '));
    ck('and still carries the technical readings',
      c.structure && c.momentum && c.vwap != null && c.market);
  } else ck('the flat fixture produced NO SETUP', false, c.decision);
}

// ---- validity must come from structure, never symmetry
{
  const rows = session(340, 500, 'up');
  const st2 = L.buildTickerState('TEST', E.analyze(rows, { K: 3 }),
    { market: 'Neutral', freshness: 'LIVE', staleSeconds: 30 });
  const c = B.buyCard(st2, E.analyze(rows, { K: 3 }), {});
  if (c.validity) {
    const px = c.lastClose;
    const lowGap = px - c.validity.low, highGap = c.validity.high - px;
    ck('the validity range is not symmetric around the last price',
      Math.abs(lowGap - highGap) > 0.001, lowGap.toFixed(3) + ' vs ' + highGap.toFixed(3));
    ck('each boundary names the structure it came from',
      !!c.validity.lowWhy && !!c.validity.highWhy, c.validity.lowWhy + ' / ' + c.validity.highWhy);
  } else {
    ck('no validity range is invented when structure gives none', c.map.length === 0);
  }
}


// ---- the copied text must match the card that was decided
{
  const rows = session(340, 500, 'up');
  const A3 = E.analyze(rows, { K: 3 });
  const card = B.buyCard(mk(rows), A3, { symbol: 'TEST', snapshotTime: '15:59' });
  const txt = B.buyCardText(card, { live: true });

  ck('the text names the symbol and snapshot', txt.indexOf('TEST') >= 0 && /תמונת מצב 15:59/.test(txt));
  ck('it states the decision', txt.indexOf(card.decision) >= 0, card.decision);
  ck('it carries the coverage', /\d+\/\d+ נרות/.test(txt));
  ck('VWAP says which side the price is on', /מחיר (מעל|מתחת) VWAP/.test(txt));
  ck('no exit language leaks into the text',
    !/לממש|יעד|stop|target|exit|חלקית/i.test(txt));
  ck('no limit-order phrasing', !/אם יגיע|כשיגיע/.test(txt));

  // the map appears only when the card has one
  if (card.hasMap) {
    ck('the map is in the text with its ranges', /->\s+(BUY|WAIT|RECHECK)/.test(txt));
    ck('validity is stated with its structural source', /תקפות הכרטיס: .*\(.*\/.*\)/.test(txt));
  } else {
    ck('no map section when there is no setup', !/מפת מחיר|מחיר Trading שלך עכשיו/.test(txt));
    ck('and no validity line', !/תקפות הכרטיס/.test(txt));
  }

  // the label follows the session, exactly as the screen does
  const closed = B.buyCardText(card, { live: false });
  if (card.hasMap) {
    ck('the live label is used during the session', /מחיר Trading שלך עכשיו/.test(txt));
    ck('and the snapshot label after the close', /מפת מחיר/.test(closed));
  }

  // NO SETUP text must not carry a confidence
  const flat = [];
  let p2 = 616.7;
  for (let i = 0; i < 390; i++) { const o = p2, c2 = o + Math.sin(i / 30) * 0.02;
    flat.push({ date: '2026-09-04', time: tm(i), unix: 1788000000 + i * 60, open: +o.toFixed(3),
      high: +(Math.max(o, c2) + 0.03).toFixed(3), low: +(Math.min(o, c2) - 0.03).toFixed(3),
      close: +c2.toFixed(3), volume: 5000 }); p2 = c2; }
  const A4 = E.analyze(flat, { K: 3 });
  const nsTxt = B.buyCardText(B.buyCard(mk(flat), A4, { symbol: 'META' }), { live: false });
  ck('NO SETUP text shows no confidence value', /ביטחון: —/.test(nsTxt),
    (nsTxt.split('\n').find(l => /ביטחון/.test(l)) || ''));
  ck('NO SETUP text has no map', !/מפת מחיר/.test(nsTxt));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
