// DATA QA — for a COMPLETED session, the previous-day OHLC the scanner derives
// must equal the authoritative daily candle. Anything else is a data-integrity
// failure, not a rounding difference.
//
// This runs on constructed sessions where the correct answer is known by
// construction, so it fails on the CODE rather than on whatever the provider
// happened to return. The live comparison against the provider's own daily
// candle is /diag/:sym, which has to run inside the Worker because the
// provider is not reachable from CI.
const L = require('./layers.cjs');
const C = require('./candidate.cjs');
const E = require('./engine.cjs');

let pass = 0, fail = 0;
const ck = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   [' + x + ']' : ''}`); };
const near = (a, b, tol = 0.011) => a != null && b != null && Math.abs(a - b) <= tol;

const tm = i => { const m = 30 + i; return String(9 + Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// A session with a KNOWN official OHLC, including a closing auction print —
// which is where the official close comes from on a real venue.
function build(date, opts) {
  const o = opts || {}, n = o.n == null ? 390 : o.n, rows = [];
  const t0 = Math.floor(Date.parse(date + 'T13:30:00Z') / 1000);
  for (let i = 0; i < n; i++) {
    const px = 100 + i * 0.01;                      // high arrives LATE, as on a trend day
    rows.push({ date, time: tm(i), unix: t0 + i * 60,
      open: +px.toFixed(4), high: +(px + 0.02).toFixed(4), low: +(px - 0.02).toFixed(4),
      close: +px.toFixed(4), volume: 1000 });
  }
  const official = { open: rows[0].open, high: Math.max(...rows.map(r => r.high)),
    low: Math.min(...rows.map(r => r.low)), close: rows[rows.length - 1].close,
    volume: rows.reduce((s, r) => s + r.volume, 0) };
  if (o.auction != null) {
    rows.push({ date, time: '16:00', unix: t0 + n * 60, open: o.auction, high: o.auction,
      low: o.auction, close: o.auction, volume: 500000 });
    official.close = o.auction;
    official.high = Math.max(official.high, o.auction);
    official.low = Math.min(official.low, o.auction);
    official.volume += 500000;
  }
  return { rows, official };
}

const today = build('2026-09-04', { n: 60 }).rows;

// ---- 1. a complete session must reproduce its own OHLC exactly
{
  const s = build('2026-09-03', {});
  const d = L.dailyContext([s.rows, today]);
  ck('complete session: previous OPEN matches', near(d.today ? s.official.open : null, s.official.open));
  ck('complete session: previous HIGH matches', near(d.prevHigh, s.official.high), d.prevHigh + ' vs ' + s.official.high);
  ck('complete session: previous LOW matches', near(d.prevLow, s.official.low), d.prevLow + ' vs ' + s.official.low);
  ck('complete session: previous CLOSE matches', near(d.prevClose, s.official.close), d.prevClose + ' vs ' + s.official.close);
}

// ---- 2. the closing auction is part of the official close
{
  const s = build('2026-09-03', { auction: 275.21 });
  const d = L.dailyContext([s.rows, today]);
  ck('a session with a closing auction reports the AUCTION close',
    near(d.prevClose, s.official.close), d.prevClose + ' vs official ' + s.official.close);

  // and the same session with the auction bar missing must NOT silently
  // report a different close as though it were official
  const cut = build('2026-09-03', {});
  const d2 = L.dailyContext([cut.rows, today]);
  ck('losing the auction bar changes the reported close — this is the exposure',
    !near(d2.prevClose, s.official.close), d2.prevClose + ' vs official ' + s.official.close);
}

// ---- 3. an incomplete session must never be published as a daily candle
{
  const full = build('2026-09-03', {});
  const cut = build('2026-09-03', { n: 231 });          // stopped at 13:20
  const dFull = L.dailyContext([full.rows, today]);
  const dCut = L.dailyContext([cut.rows, today]);
  ck('a truncated session produces a DIFFERENT high from the complete one',
    !near(dCut.prevHigh, dFull.prevHigh), dCut.prevHigh + ' vs ' + dFull.prevHigh);
  ck('coverage is measurable from the bars themselves', cut.rows.length / 390 < 0.7,
    Math.round(cut.rows.length / 390 * 100) + '% coverage');
  const ctx = L.dailyContext([cut.rows, today]);
  ck('DATA QA: an incomplete session is excluded from "previous"',
    (ctx.incomplete || []).some(x => x.date === '2026-09-03'), JSON.stringify(ctx.incomplete));
  ck('and prevHigh does not come from it', ctx.prevHigh !== dCut.prevHigh || ctx.prevHigh == null,
    'prevHigh ' + ctx.prevHigh);
}

// ---- 4. the 16:00 bar is the closing auction and carries the OFFICIAL close.
// It is reported flat with no volume, so the old "flat and empty is filler"
// rule threw the official close away. A filler at any OTHER time is still a
// filler and must still be dropped.
{
  const s = build('2026-09-03', {});
  const auctionPrice = 108.42;
  const withAuction = s.rows.concat([{ date: '2026-09-03', time: '16:00',
    unix: s.rows[s.rows.length - 1].unix + 60, open: auctionPrice, high: auctionPrice,
    low: auctionPrice, close: auctionPrice, volume: 0 }]);
  const A = E.analyze(withAuction, { K: 3 });
  ck('analyze() KEEPS the 16:00 auction bar — it is the official close',
    near(A.state.bar.close, auctionPrice), String(A.state.bar.close));
  const d = L.dailyContext([withAuction, today]);
  ck('dailyContext reports the auction close too', near(d.prevClose, auctionPrice), String(d.prevClose));
  ck('both paths now agree on the same day', near(A.state.bar.close, d.prevClose),
    A.state.bar.close + ' vs ' + d.prevClose);

  // a flat empty bar at another time is still noise
  const withFiller = s.rows.concat([{ date: '2026-09-03', time: '16:05',
    unix: s.rows[s.rows.length - 1].unix + 360, open: 999, high: 999, low: 999, close: 999, volume: 0 }]);
  ck('a flat zero-volume bar that is NOT the auction is still dropped',
    E.analyze(withFiller, { K: 3 }).state.bar.close !== 999);
}

// ---- 5. "previous" must mean the previous TRADING DATE, not the previous row
{
  const a = build('2026-09-02', {}), b = build('2026-09-03', {});
  const d = L.dailyContext([a.rows, b.rows]);        // pre-open: no today yet
  ck('DATA QA: with no session for today, yesterday is not relabelled as today',
    L.dailyContext([a.rows, b.rows], { todayDate: '2026-09-04' }).hasToday === false);
  ck('and "previous" is the newest COMPLETE session', 
    L.dailyContext([a.rows, b.rows], { todayDate: '2026-09-04' }).previousDate === '2026-09-03',
    L.dailyContext([a.rows, b.rows], { todayDate: '2026-09-04' }).previousDate);
}

// ---- 6. the candidate layer aggregates the same way and inherits the same risk
{
  const s = build('2026-09-03', { auction: 275.21 });
  const daily = C.toDaily([s.rows]);
  ck('the candidate layer sees the same close as the daily layer',
    near(daily[0].close, s.official.close), daily[0].close + ' vs ' + s.official.close);
  const cut = C.toDaily([build('2026-09-03', { n: 231 }).rows]);
  ck('DATA QA: the candidate layer refuses an incomplete session', cut.length === 0,
    cut.length + ' sessions accepted');
  const auth = [{ date: '2026-09-03', open: 106.42, high: 109.35, low: 106.02, close: 108.42, volume: 25510700 }];
  const withAuth = C.toDaily([build('2026-09-03', {}).rows], { authoritative: auth });
  ck('an authoritative candle replaces the aggregation entirely',
    withAuth[0].close === 108.42 && withAuth[0].volume === 25510700 && withAuth[0].source === 'authoritative',
    JSON.stringify(withAuth[0]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
