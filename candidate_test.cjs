// Candidate scoring must answer a different question from the setup engine, and
// must never leak a live decision out of closed-session data.
const C = require('./candidate.cjs');
const E = require('./engine.cjs');
let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
// one session: open at `o`, drift to `c`, with a given high/low and volume
function sess(date, o, c, hi, lo, vol, n) {
  n = n || 390; const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), px = o + (c - o) * t;
    const h = i === Math.floor(n * 0.4) ? hi : px + 0.02;
    const l = i === Math.floor(n * 0.6) ? lo : px - 0.02;
    out.push({ symbol: 'X', date, time: tm(i), unix: Math.floor(Date.parse(date + 'T13:30:00Z') / 1000) + i * 60,
      open: +px.toFixed(2), high: +Math.max(h, px).toFixed(2), low: +Math.min(l, px).toFixed(2),
      close: +px.toFixed(2), volume: Math.round(vol / n) });
  }
  out[n - 1].close = c; out[n - 1].high = Math.max(out[n - 1].high, c); out[n - 1].low = Math.min(out[n - 1].low, c);
  return out;
}

// ---- a stock coiling under a multi-day high with rising volume
const strong = [
  sess('2026-08-26', 100, 103, 103.5, 99.5, 5e6),
  sess('2026-08-27', 103, 105, 105.5, 102.5, 6e6),
  sess('2026-08-28', 105, 107, 107.8, 104.5, 7e6),
  sess('2026-08-31', 107, 107.6, 107.9, 106.8, 8e6),
  sess('2026-09-01', 107.6, 107.8, 107.95, 107.2, 9e6)
];
const s = C.candidateScore(strong);
ck('a coiled leader under its high scores high', s.score >= 60, s.score + '/100');
ck('the score is explained', s.reasons.length >= 4, s.reasons.length + ' reasons');
ck('the reasons are ordered by weight', s.reasons.every((r, i, a) => i === 0 || a[i - 1].points >= r.points));
ck('it names the multi-day trend', s.structure === 'UP', s.structure);
ck('it notices the contraction', s.coiled === true);
ck('it lists levels to watch', s.levels.length >= 3, s.levels.map(l => l.name).join(', '));
ck('the levels carry prices', s.levels.every(l => typeof l.price === 'number' && isFinite(l.price)));

// ---- a dead, rangebound, thin stock
const dull = [
  sess('2026-08-26', 50, 50.1, 50.15, 49.95, 1e5),
  sess('2026-08-27', 50.1, 50.05, 50.12, 49.98, 9e4),
  sess('2026-08-28', 50.05, 50.08, 50.13, 50.0, 8e4),
  sess('2026-08-31', 50.08, 50.04, 50.11, 49.99, 7e4),
  sess('2026-09-01', 50.04, 50.06, 50.1, 50.0, 6e4)
];
const d = C.candidateScore(dull);
ck('a dead rangebound name scores low', d.score < 45, d.score + '/100');
ck('and says the range is too narrow', d.reasons.some(r => /צר/.test(r.text)), (d.reasons[0] || {}).text);
ck('a strong candidate outranks a dull one', s.score > d.score, s.score + ' vs ' + d.score);

// ---- the score is NOT the setup score
{
  const A = E.analyze(strong[strong.length - 1], { K: 3 });
  const row = E.radarRow('X', A, { label: 'Neutral' }, 'SESSION ENDED');
  ck('candidate score and setup score are different numbers on different scales',
    s.score > 10 && row.score <= 10, 'candidate ' + s.score + '/100, setup ' + row.score + '/10');
  ck('a stock can be a strong candidate with no live setup',
    s.score >= 60 && (!row.plan || row.plan.state === 'NO_SETUP' || row.score <= 5),
    'candidate ' + s.score + ', plan ' + (row.plan ? row.plan.state : 'none'));
}

// ---- nothing here may be a live instruction
{
  const text = JSON.stringify(s);
  const banned = ['READY', 'ACTIVE', 'DO_NOT_CHASE', 'FAILED', 'WAITING_FOR_ZONE', 'TAKE_PROFIT',
    'להיכנס', 'כניסה חלקית', 'לממש'];
  const hit = banned.filter(w => text.indexOf(w) >= 0);
  ck('a candidate carries no execution state and no instruction', hit.length === 0, hit.join(','));
}

// ---- improving vs fading
{
  const improving = C.candidateTrend(strong);
  ck('a strengthening name is reported as improving or steady',
    ['improving', 'steady'].indexOf(improving.direction) >= 0, improving.direction + ' ' + improving.delta);

  const fading = [
    sess('2026-08-26', 100, 106, 106.5, 99.5, 9e6),
    sess('2026-08-27', 106, 105, 106.2, 104.5, 7e6),
    sess('2026-08-28', 105, 103, 105.1, 102.8, 4e6),
    sess('2026-08-31', 103, 102.9, 103.1, 102.7, 2e6),
    sess('2026-09-01', 102.9, 102.85, 102.95, 102.8, 1e6)
  ];
  const f = C.candidateTrend(fading);
  ck('a name losing volume and range is not called improving', f.direction !== 'improving', f.direction + ' ' + f.delta);
  ck('too little history says so rather than guessing',
    C.candidateTrend([strong[0]]).direction === 'unknown');
}

// ---- live interest is its own question
{
  const busy = E.analyze(sess('2026-09-01', 100, 104, 104.5, 99.5, 9e6), { K: 3 });
  const quiet = E.analyze(sess('2026-09-01', 100, 100.02, 100.05, 99.98, 5e4), { K: 3 });
  const lb = C.liveInterest(busy), lq = C.liveInterest(quiet);
  ck('a moving symbol reads as worth live attention', lb.score > lq.score, lb.score + ' vs ' + lq.score);
  ck('a dead symbol is flagged as no longer interesting', lq.quiet === true, lq.verdict);
  ck('live interest explains itself', lb.reasons.length >= 3, lb.reasons.join(' · '));
  ck('live interest is 0-100, like the candidate score and unlike the setup score',
    lb.score >= 0 && lb.score <= 100);
}

// ---- suggestions recommend, never act
{
  const watch = [
    { symbol: 'DEAD', live: { score: 12, reasons: ['כמעט ללא תנועה'], verdict: 'כבר לא מעניין' } },
    { symbol: 'ALIVE', live: { score: 80, reasons: ['תנועה חזקה'], verdict: 'שווה תשומת לב חיה' } }
  ];
  const scan = [
    { symbol: 'HOT', candidate: s, trend: { direction: 'improving', delta: 12, text: 'העניין מתחזק (+12)' } },
    { symbol: 'MEH', candidate: d, trend: { direction: 'steady', delta: 0, text: 'ללא שינוי' } }
  ];
  const g = C.suggestions(watch, scan, { max: 40 });
  ck('a strong improving candidate is proposed', g.promote.some(p => p.symbol === 'HOT'), g.promote.map(p => p.symbol).join(','));
  ck('a weak one is not', !g.promote.some(p => p.symbol === 'MEH'));
  ck('the proposal says why', (g.promote[0].why || []).length >= 1, (g.promote[0].why || []).join(' · '));
  ck('the proposal says whether interest is improving', g.promote[0].direction === 'improving');
  ck('a dead watch symbol is proposed for removal', g.demote.some(x => x.symbol === 'DEAD'));
  ck('a live one is not', !g.demote.some(x => x.symbol === 'ALIVE'));
  ck('with room, a promotion is not tied to a removal', g.promote[0].insteadOf === null, String(g.promote[0].insteadOf));

  const full = [];
  for (let i = 0; i < 40; i++) full.push({ symbol: 'W' + i, live: { score: 10, reasons: ['שקט'], verdict: 'כבר לא מעניין' } });
  const gf = C.suggestions(full, scan, { max: 40 });
  ck('with a full list, a promotion names what to drop', !!gf.promote[0].insteadOf, gf.promote[0].insteadOf);
  ck('and says why that one', !!gf.promote[0].insteadOfWhy, gf.promote[0].insteadOfWhy);
  ck('the note states whether there is room', /מקום|מלא/.test(gf.note), gf.note);

  // nothing is mutated
  ck('suggesting does not change the watchlist', watch.length === 2 && watch[0].symbol === 'DEAD');
}

// ---- degenerate input
ck('no sessions returns null rather than a number', C.candidateScore([]).score === null);
ck('one session still scores without throwing', typeof C.candidateScore([strong[0]]).score === 'number');
ck('empty rows are ignored', C.candidateScore([[], strong[0]]).sessions === 1);


// ---- what happened AT the level, not just where the close landed
{
  // a five-session base whose multi-day high is 328.40
  const base = [
    sess('2026-08-28', 320, 322, 323.0, 319.0, 5e6),
    sess('2026-08-31', 322, 324, 325.0, 321.0, 5e6),
    sess('2026-09-01', 324, 326, 327.0, 323.0, 5e6),
    sess('2026-09-02', 326, 324.96, 328.40, 325.0, 5e6)
  ];
  const priorHigh = 328.40;

  // AAPL's actual shape: traded to 330.81, closed 328.21 — BELOW the level
  const failed = C.candidateScore(base.concat([sess('2026-09-03', 327, 328.21, 330.81, 326.0, 6e6)]));
  ck('a session that pierced the level and closed under it is a REJECTED breakout',
    failed.levelEvent === 'breakout_failed', failed.levelEvent);
  ck('and it says so in words', /נדחתה/.test(failed.parts.level.why), failed.parts.level.why);
  ck('the rejection names the price it reached', /330\.81/.test(failed.parts.level.why), failed.parts.level.why);

  // WMT's actual shape: closed 108.42 above 106.78 — a breakout that HELD
  const held = C.candidateScore(base.concat([sess('2026-09-03', 327, 331.0, 331.5, 326.5, 6e6)]));
  ck('a session that closed above the level is a HELD breakout',
    held.levelEvent === 'breakout_held', held.levelEvent);

  // never reached it
  const approaching = C.candidateScore(base.concat([sess('2026-09-03', 326, 328.0, 328.2, 325.5, 6e6)]));
  ck('a session that never reached the level is still approaching it',
    approaching.levelEvent === 'approaching_high' || approaching.levelEvent === 'testing_high',
    approaching.levelEvent);

  ck('a REJECTED breakout scores well below one that is still coiling',
    failed.parts.level.points < approaching.parts.level.points,
    'failed ' + failed.parts.level.points + ' vs approaching ' + approaching.parts.level.points);
  ck('and below one that held', failed.parts.level.points < held.parts.level.points,
    'failed ' + failed.parts.level.points + ' vs held ' + held.parts.level.points);
  ck('the overall candidate score reflects it', failed.score < approaching.score,
    'failed ' + failed.score + ' vs approaching ' + approaching.score);
}

// ---- the range figure must say what it measures
{
  const s2 = C.candidateScore([
    sess('2026-08-31', 100, 101, 101.5, 99.5, 5e6),
    sess('2026-09-01', 101, 102, 102.5, 100.5, 5e6),
    sess('2026-09-02', 102, 103, 103.5, 101.5, 5e6),
    sess('2026-09-03', 103, 104, 108.0, 102.0, 5e6)     // one much wider day
  ]);
  ck('the average window is reported, not just a number', s2.avgRangeWindow >= 2, String(s2.avgRangeWindow));
  ck("the last session's own range is available separately", s2.lastRangePct != null, String(s2.lastRangePct));
  ck('a wide final day makes its own range exceed the average',
    s2.lastRangePct > s2.atrPct, 'last ' + s2.lastRangePct + '% vs average ' + s2.atrPct + '%');
  ck('the wording says it is an average over N days', /ממוצע/.test(s2.parts.range.why), s2.parts.range.why);
}


// ---- the message must name the LEVEL, not the price it reached
{
  const base = [
    sess('2026-08-31', 80, 81, 81.5, 79.5, 5e6),
    sess('2026-09-01', 81, 82, 82.5, 80.5, 5e6),
    sess('2026-09-02', 82, 82.9, 83.12, 81.5, 5e6)      // the level: 83.12
  ];
  // NFLX's shape: reached 83.60, closed 82.67
  const s3 = C.candidateScore(base.concat([sess('2026-09-03', 82.9, 82.67, 83.60, 82.0, 6e6)]));
  const why = s3.parts.level.why;
  ck('the rejected-breakout text is present', /נדחתה/.test(why), why);

  const levelShown = (s3.levels.find(l => /גבוה רב-יומי/.test(l.name)) || {}).price;
  const first = (why.match(/[\d.]+/g) || [])[0];
  ck('the FIRST price in the sentence is the level, not the high reached',
    Math.abs(Number(first) - levelShown) < 0.011,
    'sentence starts with ' + first + ', level block says ' + levelShown);
  ck('the price it reached is named separately', /83\.6/.test(why), why);
  ck('the sentence and the level block cannot contradict each other',
    why.indexOf(levelShown.toFixed(2)) >= 0, why);
}

// ---- levels must say which session they came from
{
  const s4 = C.candidateScore([
    sess('2026-09-01', 100, 101, 101.5, 99.5, 5e6),
    sess('2026-09-02', 101, 102, 102.5, 100.5, 5e6),
    sess('2026-09-03', 102, 103, 103.5, 101.5, 5e6)
  ]);
  ck('a previous-session level names its date', s4.levels.some(l => /09\/02/.test(l.name)),
    s4.levels.map(l => l.name).join(' | '));
  ck('no level says the ambiguous "yesterday"', !s4.levels.some(l => /אתמול/.test(l.name)),
    s4.levels.map(l => l.name).join(' | '));
  ck('the prior session date is exposed', s4.priorDate === '2026-09-02', String(s4.priorDate));
}

// ---- the cap must name the measure it capped on
{
  const flat = [];
  ['2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'].forEach((d, i) =>
    flat.push(sess(d, 500 + i * 0.1, 500 + i * 0.1 + 0.05, 500 + i * 0.1 + 0.6, 500 + i * 0.1 - 0.6, 5e6)));
  const s5 = C.candidateScore(flat);
  if (s5.capReason) {
    ck('the cap says it is an average over N days', /ממוצע \d+ ימים/.test(s5.capReason), s5.capReason);
    ck('the cap does not say "daily range"', !/טווח יומי/.test(s5.capReason), s5.capReason);
    ck('the capped figure equals the one shown on the card',
      s5.capReason.indexOf(String(s5.atrPct)) >= 0, s5.capReason + ' vs atrPct ' + s5.atrPct);
  } else ck('a flat instrument is capped', false, 'no cap applied, atrPct ' + s5.atrPct);
}


// ---- completeness is about spanning the session, not counting bars
{
  const tmm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const bar = (t, i) => ({ date: '2026-09-02', time: t, unix: i, open: 100, high: 100.5, low: 99.5, close: 100, volume: 10 });

  // a thinly traded name: no print in one minute out of seven
  const thin = [];
  for (let i = 0; i < 390; i++) if (i % 7) thin.push(bar(tmm(i), i));
  ck('a thin but full-length session is accepted', C.toDaily([thin]).length === 1,
    thin.length + ' bars, ' + thin[0].time + '->' + thin[thin.length - 1].time);

  // truncated mid-session
  const cut = [];
  for (let i = 0; i < 231; i++) cut.push(bar(tmm(i), i));
  ck('a session that stops at 13:20 is refused however many bars it has',
    C.toDaily([cut]).length === 0, cut.length + ' bars, ends ' + cut[cut.length - 1].time);

  // starts late — missed the open
  const late = [];
  for (let i = 100; i < 390; i++) late.push(bar(tmm(i), i));
  ck('a session that misses the open is refused', C.toDaily([late]).length === 0,
    'starts ' + late[0].time);

  // and the count alone would have got both wrong
  ck('bar count alone would have accepted the truncated one and refused the thin one',
    cut.length / 390 > 0.55 && thin.length / 390 < 0.9,
    'truncated ' + Math.round(cut.length / 390 * 100) + '%, thin ' + Math.round(thin.length / 390 * 100) + '%');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
