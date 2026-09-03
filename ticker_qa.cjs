// A panel of synthetic tickers, run against every invariant the model claims.
//
// The point is not to check one fixture that happens to work. It is to generate
// many instruments with different personalities — trending, choppy, gapping,
// thin, expensive, penny, halted mid-session, one-print days — and assert that
// nothing the screen says can contradict anything else it says, for any of them.
//
// Every failure prints the ticker and the regime so it can be reproduced.

const E = require('./engine.cjs'), L = require('./layers.cjs');

let pass = 0, fail = 0;
const failures = [];
function ck(ticker, name, ok, extra) {
  if (ok) { pass++; return; }
  fail++;
  failures.push({ ticker, name, extra: extra || '' });
}

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---- regimes. Each returns a day of bars with a distinct character.
const REGIMES = {
  trend_up:    { drift: 0.006, noise: 0.10, vol: 1.0 },
  trend_down:  { drift: -0.006, noise: 0.10, vol: 1.0 },
  chop:        { drift: 0, noise: 0.22, vol: 1.0 },
  quiet:       { drift: 0.0005, noise: 0.02, vol: 0.15 },
  volatile:    { drift: 0, noise: 0.9, vol: 3.0 },
  squeeze:     { drift: 0.0002, noise: 0.01, vol: 0.4 },
  gap_up:      { drift: 0.004, noise: 0.14, vol: 1.4, gap: 0.03 },
  gap_down:    { drift: -0.004, noise: 0.14, vol: 1.4, gap: -0.03 },
  fade:        { drift: -0.002, noise: 0.12, vol: 0.8, reverseAt: 0.45 },
  ramp:        { drift: 0.002, noise: 0.09, vol: 1.2, reverseAt: 0.6 }
};

function makeDay(date, base, regime, n, seed) {
  const R = REGIMES[regime];
  let p = base * (1 + (R.gap || 0)), s = seed || 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  n = n || 390;
  for (let i = 0; i < n; i++) {
    let d = R.drift;
    if (R.reverseAt && i > n * R.reverseAt) d = -d * 1.6;
    const scale = base * 0.001;
    const o = p, c = o + ((rnd() - 0.5) * R.noise + d) * scale * 10;
    const h = Math.max(o, c) + rnd() * R.noise * scale * 4;
    const l = Math.min(o, c) - rnd() * R.noise * scale * 4;
    const vBase = 120000 * R.vol;
    out.push({ date, time: tm(i),
      open: +o.toFixed(4), high: +h.toFixed(4), low: +l.toFixed(4), close: +c.toFixed(4),
      volume: Math.max(1, Math.floor(vBase * (1 + 3 / (1 + i * 0.08)) * (0.5 + rnd()))) });
    p = c;
  }
  return out;
}

// ---- the panel. Prices span four orders of magnitude on purpose.
const PANEL = [
  { sym: 'TRND', price: 217, regime: 'trend_up' },
  { sym: 'DOWN', price: 88, regime: 'trend_down' },
  { sym: 'CHOP', price: 145, regime: 'chop' },
  { sym: 'QUIET', price: 61, regime: 'quiet' },
  { sym: 'VOLA', price: 412, regime: 'volatile' },
  { sym: 'SQZE', price: 33, regime: 'squeeze' },
  { sym: 'GAPU', price: 505, regime: 'gap_up' },
  { sym: 'GAPD', price: 505, regime: 'gap_down' },
  { sym: 'FADE', price: 190, regime: 'fade' },
  { sym: 'RAMP', price: 190, regime: 'ramp' },
  { sym: 'PENNY', price: 1.87, regime: 'chop' },
  { sym: 'HIGH', price: 3120, regime: 'trend_up' },
  { sym: 'THIN', price: 24, regime: 'quiet' },
  { sym: 'WIDE', price: 76, regime: 'volatile' }
];

const DATES = ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01'];

// ---- the invariants. Each takes a built state and returns null or a reason.
const INVARIANTS = [
  ['the state validates or explains itself', st =>
    st.valid || (st.violations && st.violations.length) ? null : 'invalid with no violations listed'],

  ['a target is never below the entry', st => {
    const lv = st.levels;
    if (lv.entry == null || lv.target1 == null) return null;
    return lv.target1 > lv.entry ? null : 'target1 ' + lv.target1 + ' <= entry ' + lv.entry;
  }],

  ['target2 is never below target1', st => {
    const lv = st.levels;
    if (lv.target1 == null || lv.target2 == null) return null;
    return lv.target2 >= lv.target1 ? null : 'target2 ' + lv.target2 + ' < target1 ' + lv.target1;
  }],

  ['the stop is never above the entry', st => {
    const lv = st.levels;
    if (lv.entry == null || lv.hardStop == null) return null;
    return lv.hardStop < lv.entry ? null : 'stop ' + lv.hardStop + ' >= entry ' + lv.entry;
  }],

  ['no level plays two roles at once', st => {
    const lv = st.levels;
    const named = [['watch', lv.watch], ['entry', lv.entry], ['t1', lv.target1], ['t2', lv.target2], ['stop', lv.hardStop]]
      .filter(x => x[1] != null);
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
      if (Math.abs(named[i][1] - named[j][1]) < 1e-9) return named[i][0] + ' and ' + named[j][0] + ' are the same price';
    }
    return null;
  }],

  ['an actionable headline implies an entry, and vice versa', st => {
    const actionable = ['ENTRY_AVAILABLE', 'HOLD', 'TAKE_PARTIAL'].indexOf(st.action) >= 0;
    if (actionable && st.levels.entry == null) return st.action + ' with no entry level';
    const passive = ['DO_NOT_BUY', 'WATCH_ONLY', 'SESSION_CLOSED', 'SETUP_CANCELLED', 'DATA_STALE'].indexOf(st.action) >= 0;
    if (passive && st.levels.entry != null) return st.action + ' but an entry of ' + st.levels.entry + ' is shown';
    return null;
  }],

  ['a cancelled setup is never still active', st => {
    const cancelAt = st.levels.tacticalStop != null ? st.levels.tacticalStop
      : (st.plan && st.plan.invalidation != null ? st.plan.invalidation : null);
    if (cancelAt == null || st.price == null || st.sessionEnded) return null;
    const live = ['START_WATCHING', 'WAIT_FOR_CONFIRMATION', 'ENTRY_AVAILABLE', 'HOLD', 'TAKE_PARTIAL'];
    if (st.price < cancelAt && live.indexOf(st.action) >= 0)
      return 'price ' + st.price + ' below cancel ' + cancelAt + ' but action is ' + st.action;
    return null;
  }],

  ['buyers and sellers always sum to 100', st => {
    const p = st.pressure;
    if (!p || p.buyPct == null) return null;
    return p.buyPct + p.sellPct === 100 ? null : p.buyPct + '+' + p.sellPct;
  }],

  ['the pressure conclusion agrees with its own trend labels', st => {
    const p = st.pressure;
    if (!p || !p.conclusion) return null;
    const bothFading = p.buyersTrend === 'נחלשים' && p.sellersTrend === 'נחלשים';
    if (bothFading && /מתחזק/.test(p.conclusion))
      return 'both sides fading but conclusion says strengthening: ' + p.conclusion;
    return null;
  }],

  ['an extreme probability never rides on low confidence', st => {
    const pr = st.probability;
    if (!pr || pr.up == null) return null;
    if (pr.confidence < 50 && (pr.up >= 80 || pr.up <= 20))
      return pr.up + '% at confidence ' + pr.confidence;
    return null;
  }],

  ['probabilities sum to 100', st => {
    const pr = st.probability;
    if (!pr || pr.up == null) return null;
    return pr.up + pr.down === 100 ? null : pr.up + '+' + pr.down;
  }],

  ['a probability is never computed across a meaningless band', st => {
    const pr = st.probability;
    if (!pr || pr.up == null || pr.upper == null || pr.lower == null) return null;
    const atr = st.atr || 0;
    if (atr > 0 && Math.abs(pr.upper - pr.lower) < 0.25 * atr)
      return 'band ' + (pr.upper - pr.lower).toFixed(4) + ' vs atr ' + atr.toFixed(4);
    return null;
  }],

  ['the narrative quotes the levels block', st => {
    const lv = st.levels, up = (st.whatNow && st.whatNow.up) || [];
    const txt = up.join(' ');
    const m1 = txt.match(/יעד ראשון ([\d.]+)/), m2 = txt.match(/יעד שני ([\d.]+)/);
    if (m1 && lv.target1 != null && Math.abs(Number(m1[1]) - lv.target1) >= 0.005)
      return 'text t1 ' + m1[1] + ' vs level ' + lv.target1;
    if (m2 && lv.target2 != null && Math.abs(Number(m2[1]) - lv.target2) >= 0.005)
      return 'text t2 ' + m2[1] + ' vs level ' + lv.target2;
    if (m1 && m2 && Math.abs(Number(m1[1]) - Number(m2[1])) < 0.005)
      return 'both targets quoted as the same number ' + m1[1];
    return null;
  }],

  ['only one entry scenario is narrated', st => {
    const up = (st.whatNow && st.whatNow.up) || [];
    const entries = up.filter(x => /אפשר להיכנס|כניסה חלקית/.test(x));
    return entries.length <= 1 ? null : entries.length + ' entry sentences';
  }],

  ['nothing suggests adding to a position the system cannot see', st => {
    const up = (st.whatNow && st.whatNow.up) || [];
    const bad = up.filter(x => /אפשר להוסיף/.test(x));
    return bad.length === 0 ? null : bad[0];
  }],

  ['the score is inside its scale', st =>
    st.score >= 0 && st.score <= 10 ? null : 'score ' + st.score],

  ['the row and the detail are the same object', st =>
    st.row && st.row.state === st && st.row.score === st.score ? null : 'row drifted from state'],

  ['prices are finite numbers', st => {
    const vals = [st.price, st.atr].concat(Object.values(st.levels || {}));
    const bad = vals.filter(v => v != null && (!isFinite(v) || isNaN(v)));
    return bad.length === 0 ? null : 'non-finite: ' + bad.join(',');
  }]
];

// ---- run the panel
console.log('ticker panel: ' + PANEL.length + ' symbols x ' + Object.keys(REGIMES).length + ' regimes\n');

let states = 0;
const byRegime = {};

for (const item of PANEL) {
  for (const regime of Object.keys(REGIMES)) {
    for (const freshness of ['LIVE', 'STALE', 'SESSION ENDED']) {
      const hist = DATES.slice(0, 4).map((d, i) => makeDay(d, item.price, regime, 390, 11 + i * 7));
      const today = makeDay('2026-09-01', item.price, regime, 240, 3);
      const all = hist.reduce((a, d) => a.concat(d), []).concat(today);
      let A;
      try { A = E.analyze(all, { K: 3 }); }
      catch (e) { ck(item.sym + '/' + regime, 'analysis does not throw', false, String(e.message)); continue; }

      let st;
      try {
        st = L.buildTickerState(item.sym, A, { market: 'Neutral', freshness: freshness,
          sessionEnded: freshness === 'SESSION ENDED',
          staleSeconds: freshness === 'STALE' ? 4 * 3600 : 45, date: '2026-09-01' });
      } catch (e) {
        ck(item.sym + '/' + regime, 'state builds without throwing', false, String(e.message));
        continue;
      }
      states++;
      byRegime[regime] = (byRegime[regime] || 0) + 1;

      const tag = item.sym + '/' + regime + '/' + freshness;
      for (const [name, check] of INVARIANTS) {
        let reason = null;
        try { reason = check(st); }
        catch (e) { reason = 'check threw: ' + e.message; }
        ck(tag, name, reason == null, reason || '');
      }

      // freshness-specific gates
      if (freshness === 'STALE') {
        ck(tag, 'stale forces the do-not-trade action', st.action === 'DATA_STALE', st.action);
        ck(tag, 'stale strips the probability', st.probability == null);
        ck(tag, 'stale strips the entry', st.levels.entry == null);
        ck(tag, 'stale narrates in the past tense',
          ((st.whatNow && st.whatNow.up) || []).every(x => !/אפשר להיכנס/.test(x)));
      }
      if (freshness === 'SESSION ENDED') {
        ck(tag, 'a closed session is not actionable', st.action === 'SESSION_CLOSED', st.action);
        ck(tag, 'a closed session shows no entry', st.levels.entry == null);
      }
    }
  }
}

// ---- degenerate inputs: the shapes that usually crash a model
const EDGE = [
  ['empty', []],
  ['one bar', makeDay('2026-09-01', 100, 'chop', 1, 5)],
  ['two bars', makeDay('2026-09-01', 100, 'chop', 2, 5)],
  ['seven bars', makeDay('2026-09-01', 100, 'chop', 7, 5)],
  ['flat line', Array.from({ length: 200 }, (_, i) => ({ date: '2026-09-01', time: tm(i),
    open: 50, high: 50, low: 50, close: 50, volume: 1000 }))],
  ['zero volume', Array.from({ length: 200 }, (_, i) => ({ date: '2026-09-01', time: tm(i),
    open: 50 + i * 0.01, high: 50 + i * 0.01, low: 50 + i * 0.01, close: 50 + i * 0.01, volume: 0 }))],
  ['one huge spike', makeDay('2026-09-01', 100, 'quiet', 200, 9).map((b, i) =>
    i === 150 ? Object.assign({}, b, { high: b.high * 1.4, close: b.close * 1.3, volume: 90000000 }) : b)],
  ['sub-penny', makeDay('2026-09-01', 0.004, 'chop', 200, 9)]
];

for (const [name, bars] of EDGE) {
  let A = null, st = null, threw = null;
  try { A = E.analyze(bars, { K: 3 }); } catch (e) { threw = e; }
  ck('edge:' + name, 'analysis survives', !threw, threw ? threw.message : '');
  if (threw || !A) continue;
  try { st = L.buildTickerState('EDGE', A, { market: 'Neutral', freshness: 'LIVE', staleSeconds: 30 }); }
  catch (e) { ck('edge:' + name, 'state survives', false, e.message); continue; }
  ck('edge:' + name, 'state survives', true);
  if (!st) continue;
  states++;
  for (const [iname, check] of INVARIANTS) {
    let reason = null;
    try { reason = check(st); } catch (e) { reason = 'check threw: ' + e.message; }
    ck('edge:' + name, iname, reason == null, reason || '');
  }
}

console.log('states built: ' + states);
console.log('regimes covered: ' + Object.keys(byRegime).join(', '));
console.log('\n' + pass + ' checks passed, ' + fail + ' failed');

if (failures.length) {
  // group so one broken invariant does not print a thousand times
  const grouped = {};
  failures.forEach(f => {
    const k = f.name;
    grouped[k] = grouped[k] || { n: 0, examples: [] };
    grouped[k].n++;
    if (grouped[k].examples.length < 3) grouped[k].examples.push(f.ticker + (f.extra ? ' — ' + f.extra : ''));
  });
  console.log('\n--- failures by invariant ---');
  Object.keys(grouped).sort((a, b) => grouped[b].n - grouped[a].n).forEach(k => {
    console.log('\n' + grouped[k].n + 'x  ' + k);
    grouped[k].examples.forEach(e => console.log('      ' + e));
  });
}

process.exit(fail ? 1 : 0);
