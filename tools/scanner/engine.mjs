// Opportunity Scanner engine (docs/OPPORTUNITY_SCANNER_SPEC.md).
//
// Pure functions: no I/O. Input is the raw 1-minute bars that actually exist for
// each symbol; nothing is filled, forward-filled, synthesised, or defaulted
// (a missing volume stays null and is skipped, never counted as 0).
//
//   scanAll({ bars: { SYM: [{u,o,h,l,c,v}, ...] }, now })  ->  { rows, summary }
//
// u = minute start (epoch seconds), prices in dollars, v = volume or null.

// ------------------------------------------------------------------ time (ET)
const offCache = new Map();
function etOffsetSec(u) {                         // offset of America/New_York on that UTC day
  const day = Math.floor(u / 86400);
  let off = offCache.get(day);
  if (off === undefined) {
    const d = new Date((day * 86400 + 16 * 3600) * 1000);   // 16:00Z, inside the US day
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false, minute: '2-digit' }).formatToParts(d);
    const h = +p.find(x => x.type === 'hour').value % 24;
    off = (h - 16) * 3600;                        // -4h (EDT) or -5h (EST)
    offCache.set(day, off);
  }
  return off;
}
export function et(u) {
  const l = u + etOffsetSec(u);
  const date = new Date(l * 1000).toISOString().slice(0, 10);
  const mod = Math.floor((l % 86400) / 60);       // minute of day
  return { date, mod };
}
const hhmm = mod => String(Math.floor(mod / 60)).padStart(2, '0') + ':' + String(mod % 60).padStart(2, '0');
const OPEN = 570, CLOSE = 960;                    // 09:30, 16:00

// ------------------------------------------------------------------ helpers
const r2 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r4 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const pct = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 100);   // fraction -> % with 2 dp
const ord = n => { const k = Math.round(n), t = k % 100; return k + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th'); };
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const buffer = p => Math.max(0.01, p * 0.0005);
const up2 = x => Math.ceil(x * 100 - 1e-9) / 100;           // entries rounded up to the cent
const dn2 = x => Math.floor(x * 100 + 1e-9) / 100;          // stops rounded down

// ------------------------------------------------------------------ preparation
// Returns sessions (by ET date) of canonical 1m bars, plus quality facts.
export function prepare(raw, now) {
  const q = { duplicates: 0, offSession: 0, nullVolume: 0, total: raw.length };
  const seen = new Set(), bars = [];
  for (const b of raw.slice().sort((a, b) => a.u - b.u)) {
    if (seen.has(b.u)) { q.duplicates++; continue; }
    seen.add(b.u);
    if (b.u + 60 > now) continue;                 // the forming minute is never used
    const t = et(b.u);
    if (b.u % 60 !== 0 || t.mod < OPEN || t.mod >= CLOSE) { q.offSession++; continue; }
    if (b.v == null) q.nullVolume++;
    bars.push({ ...b, date: t.date, mod: t.mod });
  }
  const sessions = [];
  for (const b of bars) {
    const s = sessions[sessions.length - 1];
    if (!s || s.date !== b.date) sessions.push({ date: b.date, m1: [b] }); else s.m1.push(b);
  }
  return { bars, sessions, q };
}

// Aggregate one session's 1m bars into `size`-minute candles. A candle is
// `closed` when its whole interval has passed by `now` (a session in the past is
// closed by definition). Volume: sum of the volumes that exist; null if none do.
export function aggregate(sessions, size, now) {
  const out = [];
  const nowEt = et(now);
  for (const s of sessions) {
    const live = s.date === nowEt.date && nowEt.mod < CLOSE;
    let cur = null;
    for (const b of s.m1) {
      const k = Math.floor((b.mod - OPEN) / size);
      if (!cur || cur.k !== k) {
        if (cur) out.push(cur);
        cur = { k, date: s.date, mod: OPEN + k * size, u: b.u - (b.mod - (OPEN + k * size)) * 60, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: 1 };
      } else {
        cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.n++;
        if (b.v != null) cur.v = (cur.v == null ? 0 : cur.v) + b.v;
      }
    }
    if (cur) out.push(cur);
    for (let i = out.length - 1; i >= 0 && out[i].date === s.date; i--) {
      const c = out[i];
      c.closed = !live || c.mod + size <= nowEt.mod;
    }
  }
  return out;
}
export function daily(sessions) {
  return sessions.map(s => {
    let h = -Infinity, l = Infinity, v = null;
    for (const b of s.m1) { if (b.h > h) h = b.h; if (b.l < l) l = b.l; if (b.v != null) v = (v || 0) + b.v; }
    return { date: s.date, o: s.m1[0].o, h, l, c: s.m1[s.m1.length - 1].c, v, n: s.m1.length };
  });
}

// ------------------------------------------------------------------ structure
// Swing High: high above the 2 candles before and the 2 after. Swing Low mirrors it.
// Ties: 5m highs equal to the cent are common, and a strict test on both sides
// makes a double top invisible. The swing must be strictly above the 2 before and
// at least equal to the 2 after, so the first of two equal highs is the swing.
export function swings(c) {
  const out = [];
  for (let i = 2; i < c.length - 2; i++) {
    const h = c[i].h, l = c[i].l;
    if (h > c[i - 1].h && h > c[i - 2].h && h >= c[i + 1].h && h >= c[i + 2].h) out.push({ i, type: 'H', p: h, u: c[i].u });
    if (l < c[i - 1].l && l < c[i - 2].l && l <= c[i + 1].l && l <= c[i + 2].l) out.push({ i, type: 'L', p: l, u: c[i].u });
  }
  return out;
}
export function classify(sw) {
  const H = sw.filter(s => s.type === 'H'), L = sw.filter(s => s.type === 'L');
  if (H.length < 2 || L.length < 2) return { trend: 'MIXED', note: 'not enough swings', H, L };
  const [h1, h2] = H.slice(-2), [l1, l2] = L.slice(-2);
  if (h2.p > h1.p && l2.p > l1.p) return { trend: 'UPTREND', note: 'HH+HL', H, L };
  if (h2.p < h1.p && l2.p < l1.p) return { trend: 'DOWNTREND', note: 'LH+LL', H, L };
  return { trend: 'MIXED', note: (h2.p > h1.p ? 'HH' : 'LH') + '+' + (l2.p > l1.p ? 'HL' : 'LL'), H, L };
}

// ------------------------------------------------------------------ levels
// Cluster price levels; strength = how many separate observations formed it.
// A zone never grows wider than 2 x tol: chaining nearby levels one after another
// otherwise merged a 7% band into one "support zone" that every price sat inside.
function cluster(levels, tol) {
  const s = levels.slice().sort((a, b) => a.p - b.p), out = [];
  for (const x of s) {
    const z = out[out.length - 1];
    if (z && x.p - z.hi <= tol && x.p - z.lo <= 2 * tol) { z.hi = Math.max(z.hi, x.p); z.items.push(x); }
    else out.push({ lo: x.p, hi: x.p, items: [x] });
  }
  for (const z of out) {
    z.mid = (z.lo + z.hi) / 2;
    z.days = new Set(z.items.map(x => x.date)).size;
    z.strength = z.items.reduce((s, x) => s + (x.w || 1), 0);
  }
  return out;
}

// ------------------------------------------------------------------ quality
function quality(prep, latestAcrossSymbols, now) {
  const { sessions, q, bars } = prep;
  const issues = []; let level = 'OK';
  const warn = m => { issues.push(m); if (level === 'OK') level = 'WARNING'; };
  const bad = m => { issues.push(m); level = 'BAD'; };
  if (!bars.length) { bad('no usable bars'); return { level, issues, lastU: null }; }
  const last = bars[bars.length - 1];
  if (q.duplicates) warn(`${q.duplicates} duplicate timestamps`);
  if (q.nullVolume) warn(`${q.nullVolume} bars with missing volume`);
  const lag = latestAcrossSymbols - last.u;
  if (lag > 3600) bad(`last bar ${Math.round(lag / 60)} min behind the newest bar in the scan`);
  else if (lag > 15 * 60) warn(`last bar ${Math.round(lag / 60)} min behind the newest bar in the scan`);
  const nowEt = et(now);
  // gaps in the last 5 sessions (an in-progress session is judged up to its last bar)
  for (const s of sessions.slice(-5)) {
    const live = s.date === nowEt.date && nowEt.mod < CLOSE;
    const expected = live ? Math.max(0, Math.min(nowEt.mod, CLOSE) - OPEN - 1) : CLOSE - OPEN;
    const miss = expected - s.m1.length;
    if (miss > 0.05 * (CLOSE - OPEN)) bad(`${s.date}: ${miss} minutes missing`);
    else if (miss > 3) warn(`${s.date}: ${miss} minutes missing`);
  }
  // runs of identical OHLC with volume 0
  const recent = bars.slice(-5 * 390);
  let run = 0, maxRun = 0, flat = 0;
  for (const b of recent) {
    const f = b.o === b.h && b.h === b.l && b.l === b.c && b.v === 0;
    if (f) { flat++; run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }
  if (maxRun >= 15) bad(`${maxRun} consecutive flat zero-volume minutes`);
  else if (flat / Math.max(1, recent.length) > 0.02 || maxRun >= 5) warn(`${flat} flat zero-volume minutes in the last 5 sessions (longest run ${maxRun})`);
  return { level, issues, lastU: last.u };
}

// ------------------------------------------------------------------ volatility
function volatility(D) {
  if (!D.length) return null;
  const ranges = D.map(d => (d.h - d.l) / d.o);
  const tr = D.map((d, i) => i ? Math.max(d.h - d.l, Math.abs(d.h - D[i - 1].c), Math.abs(d.l - D[i - 1].c)) : d.h - d.l);
  const atr = mean(tr.slice(-14));
  const typical = median(ranges), recent = mean(ranges.slice(-5));
  const sig = D.filter(d => (d.h - d.l) / d.o >= 0.02 || Math.abs(d.c / d.o - 1) >= 0.015).length;
  return { atr, typical, recent, sigDays: sig, days: D.length };
}

// ------------------------------------------------------------------ relative strength
function returns(prep, P) {
  const s = prep.sessions; if (!s.length) return null;
  const today = s[s.length - 1].m1, bars = prep.bars, lastU = bars[bars.length - 1].u;
  const at = u => { let lo = 0, hi = bars.length - 1, r = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].u <= u) { r = bars[m]; lo = m + 1; } else hi = m - 1; } return r; };
  const back = mins => { const b = at(lastU - mins * 60); return b && b.date === today[0].date ? P / b.c - 1 : null; };
  const md = s.length > 5 ? P / s[s.length - 6].m1[s[s.length - 6].m1.length - 1].c - 1 : null;
  return { session: P / today[0].o - 1, m30: back(30), h2: back(120), multi: md };
}

// ------------------------------------------------------------------ short term
function shortTerm(sym, ctx) {
  const { m5, m15, P, vol } = ctx;
  const c5 = m5.filter(c => c.closed);
  const dates = [...new Set(c5.map(c => c.date))];
  const look5 = c5.filter(c => dates.slice(-3).includes(c.date));
  const sw5 = swings(look5), st5 = classify(sw5);
  const c15 = m15.filter(c => c.closed);
  const d15 = [...new Set(c15.map(c => c.date))];
  const st15 = classify(swings(c15.filter(c => d15.slice(-10).includes(c.date))));
  const atr = vol ? vol.atr : null;
  const out = { structure5: st5.trend + ' (' + st5.note + ')', structure15: st15.trend + ' (' + st15.note + ')', candidates: [] };
  if (look5.length < 12) { out.none = 'fewer than 12 closed 5m candles'; return out; }
  const last = look5.length - 1;
  const after = i => look5.slice(i + 1);
  const H = st5.H, L = st5.L;

  // 1. BREAKOUT — consolidation under a clear resistance, structure positive
  {
    const positive = st5.trend === 'UPTREND' || (st5.trend === 'MIXED' && st15.trend === 'UPTREND');
    const allowed = Math.max(P * 0.005, atr ? atr * 0.35 : 0);
    let best = null;
    for (let k = 6; k <= Math.min(36, look5.length); k++) {
      const w = look5.slice(-k), hi = Math.max(...w.map(c => c.h)), lo = Math.min(...w.map(c => c.l));
      if (hi - lo <= allowed) best = { k, hi, lo, w }; else break;
    }
    if (best) {
      const tests = best.w.filter(c => c.h >= best.hi - Math.max(0.01, best.hi * 0.0015)).length;
      const miss = [], soft = [];
      if (!positive) miss.push(`structure not positive (5m ${st5.trend}, 15m ${st15.trend})`);
      if (P >= best.hi) miss.push('price already above the base high');
      if (tests < 2) soft.push(`resistance ${r2(best.hi)} tested only once`);
      const baseVol = best.w.map(c => c.v).filter(v => v != null), preVol = look5.slice(-best.k * 2, -best.k).map(c => c.v).filter(v => v != null);
      const volNote = baseVol.length && preVol.length ? (mean(baseVol) <= mean(preVol) ? 'volume contracting in the base' : 'volume not contracting in the base') : null;
      out.candidates.push({ setup: 'BREAKOUT', trigger: best.hi, stopRef: best.lo, levelRef: best.hi, miss, soft,
        desc: `${best.k * 5}-min base ${r2(best.lo)}–${r2(best.hi)} (${pct((best.hi - best.lo) / P)}% tall), resistance tested ${tests}x${volNote ? ', ' + volNote : ''}`,
        volGood: volNote === 'volume contracting in the base', since: best.w[0].u });
    }
  }

  // 2. PULLBACK CONTINUATION — uptrend, pullback holds the HL, buyers return
  if (H.length && L.length) {
    const sh = H[H.length - 1], hl = L.filter(s => s.i < sh.i).pop();
    if (hl) {
      const pb = after(sh.i);
      if (pb.length) {
        let li = 0; pb.forEach((c, i) => { if (c.l < pb[li].l) li = i; });
        const pbLow = pb[li].l, rec = pb.slice(li + 1);
        const miss = [], soft = [];
        if (st5.trend !== 'UPTREND') miss.push(`5m structure is ${st5.trend}, not an uptrend`);
        if (!(P < sh.p)) miss.push('no pullback below the last swing high');
        if (pbLow <= hl.p) miss.push(`pullback broke the Higher Low ${r2(hl.p)}`);
        const depth = (sh.p - pbLow) / Math.max(1e-9, sh.p - hl.p);
        if (depth < 0.25) soft.push('pullback shallower than 25% of the last leg');
        if (rec.length < 2) miss.push('buyers have not returned yet (fewer than 2 candles off the pullback low)');
        const localHigh = rec.length ? Math.max(...rec.map(c => c.h)) : null;
        if (rec.length >= 2 && !(rec[rec.length - 1].l > pbLow)) soft.push('no higher low off the pullback yet');
        const upV = look5.slice(hl.i, sh.i + 1).map(c => c.v).filter(v => v != null), pbV = pb.slice(0, li + 1).map(c => c.v).filter(v => v != null);
        const volGood = upV.length && pbV.length ? mean(pbV) < mean(upV) : null;
        if (localHigh != null) out.candidates.push({ setup: 'PULLBACK_CONTINUATION', trigger: localHigh, stopRef: pbLow, levelRef: pbLow, miss, soft, volGood,
          desc: `uptrend HL ${r2(hl.p)} → high ${r2(sh.p)}, pulled back ${Math.round(depth * 100)}% to ${r2(pbLow)} (HL held), local high ${r2(localHigh)}${volGood != null ? (volGood ? ', pullback on lighter volume' : ', pullback volume not lighter') : ''}`,
          since: pb[li].u });
      }
    }
  }

  // 3. REVERSAL — downtrend stops, no new LL, last LH reclaimed and held, HL formed
  if (L.length) {
    let ll = L[0]; for (const s of L) if (s.p <= ll.p) ll = s;          // lowest swing low in the window
    const before = sw5.filter(s => s.i <= ll.i), prior = classify(before);
    const lh = H.filter(s => s.i < ll.i).pop();
    if (lh && prior.trend === 'DOWNTREND') {
      const post = after(ll.i), miss = [], soft = [];
      const newLow = post.some(c => c.l < ll.p);
      if (newLow) miss.push(`a new low under ${r2(ll.p)} printed after the LL`);
      const ri = post.findIndex(c => c.c > lh.p);
      if (ri < 0) miss.push(`last Lower High ${r2(lh.p)} not reclaimed`);
      let held = false, hlAfter = null, trig = null;
      if (ri >= 0) {
        const hold = post.slice(ri);
        held = hold.length >= 3 && hold.every(c => c.c >= lh.p * 0.999) && P > lh.p;
        if (!held) (hold.length < 3 ? soft : miss).push(hold.length < 3 ? 'reclaim not yet held for 3 candles' : `price lost the reclaimed level ${r2(lh.p)}`);
        // The Higher Low that confirms the reversal is the lowest swing low after
        // the reclaim that is above the LL and was never broken afterwards. A
        // higher low that price later undercut is cancelled (spec: CANCEL BEFORE
        // ENTRY) and the next unbroken one takes its place.
        const cands = L.filter(s => s.i > ll.i + 1 + ri && s.p > ll.p && !look5.slice(s.i + 1).some(c => c.l < s.p));
        hlAfter = cands.length ? cands.reduce((a, b) => (b.p < a.p ? b : a)) : null;

        if (!hlAfter) miss.push('no Higher Low after the reclaim yet');
        else { const aft = after(hlAfter.i); trig = aft.length ? Math.max(...aft.map(c => c.h)) : null; if (trig == null) miss.push('no high after the Higher Low yet'); }
      }
      const preV = look5.slice(Math.max(0, ll.i - 12), ll.i + 1).map(c => c.v).filter(v => v != null), postV = post.map(c => c.v).filter(v => v != null);
      const volGood = preV.length && postV.length ? mean(postV) >= mean(preV) : null;
      out.candidates.push({ setup: 'REVERSAL', trigger: trig, stopRef: hlAfter ? hlAfter.p : null, levelRef: lh.p, miss, soft, volGood, reversal: true,
        desc: `downtrend to LL ${r2(ll.p)}; last LH ${r2(lh.p)} ${ri >= 0 ? 'reclaimed' + (held ? ' and held' : '') : 'not reclaimed'}${hlAfter ? `, HL ${r2(hlAfter.p)}` : ''}${volGood != null ? (volGood ? ', recovery volume strengthening' : ', recovery volume weaker') : ''}`,
        since: ll.u });
    }
  }

  // 4. BREAKOUT RETEST — broke a prior swing high, came back, held, HL formed
  {
    const all = swings(c5.filter(c => dates.slice(-10).includes(c.date))).filter(s => s.type === 'H');
    const tol = Math.max(0.01, P * 0.003);
    // only a level that mattered: a known resistance zone, or a prior session's high
    const prevHighs = ctx.D.slice(-11, -1).map(d => d.h);
    const meaningfulLevel = p => ctx.levelsAbove(p - tol * 2).some(z => z.lo <= p + tol && z.hi >= p - tol) || prevHighs.some(h => Math.abs(h - p) <= tol);
    for (const lvl of all.slice().reverse()) {
      if (!meaningfulLevel(lvl.p)) continue;
      const bi = look5.findIndex(c => c.u > lvl.u + 12 * 300 && c.c > lvl.p * 1.001);
      if (bi < 0) continue;
      const post = after(bi); if (post.length < 3) continue;
      let ri = 0; post.forEach((c, i) => { if (c.l < post[ri].l) ri = i; });
      const rLow = post[ri].l;
      if (rLow > lvl.p + tol) continue;                                   // never came back to the level
      const miss = [], soft = [];
      if (post.some(c => c.c < lvl.p - tol)) miss.push(`closed back under the breakout level ${r2(lvl.p)}`);
      const rec = post.slice(ri + 1);
      const hlConfirmed = rec.length >= 2 && rec.every(c => c.l > rLow);
      if (!hlConfirmed) miss.push('Higher Low at the retest not confirmed yet');
      const trig = rec.length ? Math.max(...rec.map(c => c.h)) : null;
      if (trig == null) miss.push('no local high after the retest yet');
      if (st5.trend === 'DOWNTREND') miss.push('5m structure is a downtrend');
      const bv = look5[bi].v, pv = look5.slice(Math.max(0, bi - 12), bi).map(c => c.v).filter(v => v != null);
      const volGood = bv != null && pv.length ? bv > 1.3 * mean(pv) : null;
      if (volGood === false) soft.push('the breakout candle had no volume expansion');
      out.candidates.push({ setup: 'BREAKOUT_RETEST', trigger: trig, stopRef: rLow, levelRef: lvl.p, miss, soft, volGood,
        desc: `broke ${r2(lvl.p)}, retested to ${r2(rLow)} and held`, since: look5[bi].u });
      break;
    }
  }

  // ---- price every candidate, pick the best
  ctx.st15 = out.structure15;
  for (const k of out.candidates) price(k, ctx, st5);
  const rankOf = s => ({ READY: 0, ARMED: 1, WATCH: 2, FAILED_SETUP: 3, AVOID: 4 })[s];
  out.candidates.sort((a, b) => rankOf(a.status) - rankOf(b.status) || b.score - a.score);
  out.best = out.candidates[0] || null;
  return out;
}

function price(k, ctx, st5) {
  const { P, vol, rs, q, levelsAbove, volState } = ctx;
  if (k.trigger != null && k.stopRef != null) {
    k.entry = up2(k.trigger + buffer(k.trigger));
    k.stop = dn2(k.stopRef - buffer(k.stopRef));
    k.R = k.entry - k.stop;
  }
  if (k.R != null && k.R <= 0) k.miss.push('risk per share is not positive (entry <= stop)');
  if (k.R > 0) {
    const sig = levelsAbove(k.entry * 1.001);
    const block = sig.find(z => z.lo < k.entry + 1.5 * k.R);
    if (block) k.miss.push(`significant resistance ${r2(block.lo)} (${block.strength} touches) sits before 1.5R (${r2(k.entry + 1.5 * k.R)})`);
    k.t1 = r2(k.entry + k.R);
    const t2z = sig.find(z => z.lo >= k.entry + 1.5 * k.R && z.lo <= k.entry + 3 * k.R);
    k.t2 = r2(t2z ? t2z.lo : k.entry + 2 * k.R);
    k.t2why = t2z ? `resistance ${r2(t2z.lo)}` : '2R';
    k.rr1 = (k.t1 - k.entry) / k.R; k.rr2 = (k.t2 - k.entry) / k.R;
    // already triggered?
    if (P >= k.entry) {
      if (P > k.entry + 0.5 * k.R) k.miss.push(`trigger ${k.entry} already passed; price is ${r2((P - k.entry) / k.R)}R above it (extended)`);
      if (k.levelRef != null && P < k.levelRef && st5.trend !== 'UPTREND') k.failed = true;
    }
    if (P <= k.stop) k.miss.push(`price ${r2(P)} is at/below the structural stop ${k.stop} — setup cancelled`), k.cancelled = true;
  }
  // structure rule (long only): a 5m downtrend can only become READY/ARMED through a confirmed reversal
  if (st5.trend === 'DOWNTREND' && !k.reversal) k.miss.push('5m structure still DOWNTREND; only a confirmed reversal may trigger');
  if (q.level === 'BAD') k.miss.push('data quality problem: ' + q.issues.join('; '));
  // 15m context: a 15m downtrend keeps any setup below READY
  if ((ctx.st15 || '').startsWith('DOWNTREND')) k.soft.push('15m context is a DOWNTREND');
  // enough upside for this stock: Target 2 must be worth at least 0.8%, and at
  // least 40% of the stock's typical daily range
  if (k.R > 0 && vol && vol.typical != null) {
    const need = Math.max(0.008, 0.4 * vol.typical), have = k.t2 / k.entry - 1;
    if (have < need) k.miss.push(`upside to Target 2 is ${pct(have)}%, under ${pct(need)}% (40% of the typical daily range ${pct(vol.typical)}%)`);
  }
  // status
  const hard = k.miss.length, softN = k.soft.length;
  k.status = k.failed ? 'FAILED_SETUP' : k.cancelled ? 'AVOID' : !hard && !softN ? 'READY' : !hard && softN === 1 ? 'ARMED' : (hard + softN) <= 3 ? 'WATCH' : 'AVOID';
  if (k.status === 'READY' && !(k.rr2 >= 1.5)) k.status = 'WATCH', k.miss.push('Target 2 below 1.5R');
  // score
  const setupQ = k.status === 'READY' ? 25 : k.status === 'ARMED' ? 19 : k.status === 'WATCH' ? 10 : k.status === 'FAILED_SETUP' ? 0 : 4;
  const s15 = (ctx.st15 || '').split(' ')[0];
  const structure = st5.trend === 'UPTREND' ? (s15 === 'UPTREND' ? 20 : 15) : k.reversal && !k.miss.length ? 13 : st5.trend === 'MIXED' ? 7 : 0;
  const rsS = rs ? rs.score : 0;
  const volS = clamp((volState ? volState.points : 3) + (k.volGood === true ? 5 : k.volGood === false ? 0 : 2), 0, 10);
  const move = vol && vol.typical != null ? clamp((vol.typical - 0.008) / (0.03 - 0.008) * 12, 0, 12) + (vol.recent >= vol.typical ? 3 : 0) : 0;
  const rrS = k.rr2 >= 3 ? 15 : k.rr2 >= 2 ? 11 : k.rr2 >= 1.5 ? 7 : 0;
  let score = setupQ + structure + rsS + volS + move + rrS;
  if (q.level === 'WARNING') score *= 0.85;
  if (q.level === 'BAD') score *= 0.6;
  k.score = Math.round(score);
  k.parts = { setup: setupQ, structure, rs: rsS, volume: volS, move: Math.round(move), rr: rrS };
}

// ------------------------------------------------------------------ long term
function longTerm(sym, ctx) {
  const { D, P, vol, m15, q } = ctx;
  const n = D.length;
  const closes = D.map(d => d.c);
  const hi = Math.max(...D.map(d => d.h)), lo = Math.min(...D.map(d => d.l));
  const percentile = 100 * closes.filter(c => c < P).length / n;
  const med = median(closes), avg = mean(closes);
  const atr = vol && vol.atr ? vol.atr : P * 0.02;
  const win = k => (n > k ? { ret: P / closes[n - 1 - k] - 1, hi: Math.max(...D.slice(-k).map(d => d.h)), lo: Math.min(...D.slice(-k).map(d => d.l)) } : null);
  const W = { d5: win(5), d20: win(20), d60: win(60), d120: win(120) };

  // support / resistance from all history: daily swing lows/highs (weight 2), 15m swing lows/highs
  const c15 = m15.filter(c => c.closed);
  const sw15 = swings(c15), swD = swings(D.map(d => ({ ...d, u: Date.parse(d.date + 'T16:00:00Z') / 1000 })));
  const tol = Math.max(P * 0.005, atr * 0.3);
  // A reversal: price moved at least 1 ATR away from the level within the next 3 sessions.
  const turned = (p, u, side) => {
    const di = D.findIndex(d => Date.parse(d.date + 'T23:59:00Z') / 1000 >= u);
    if (di < 0) return false;
    const w = D.slice(di, di + 4);
    return side === 'L' ? Math.max(...w.map(d => d.h)) - p >= atr : p - Math.min(...w.map(d => d.l)) >= atr;
  };
  const lowPts = [], highPts = [];
  for (const s of swD) (s.type === 'L' ? lowPts : highPts).push({ p: s.p, date: D[s.i].date, w: 2, rev: turned(s.p, s.u, s.type) });
  for (const s of sw15) (s.type === 'L' ? lowPts : highPts).push({ p: s.p, date: c15[s.i].date, w: 1, rev: turned(s.p, s.u, s.type) });
  const avgVol15 = mean(c15.map(c => c.v).filter(v => v != null)) || 0;
  // A zone is built from swing points only; plain daily lows/highs merely count
  // as touches (the days whose low, or high, reached into the zone).
  const scoreZone = (z, side) => {
    z.days = new Set(D.filter(d => { const x = side === 'L' ? d.l : d.h; return x >= z.lo - tol / 2 && x <= z.hi + tol / 2; }).map(d => d.date)).size;
    z.reversals = z.items.filter(x => x.rev).length;
    z.dwell = D.filter(d => d.c >= z.lo - tol / 2 && d.c <= z.hi + tol / 2).length;
    const zv = c15.filter(c => c.l <= z.hi && c.h >= z.lo).map(c => c.v).filter(v => v != null);
    z.volHi = zv.length >= 3 && avgVol15 > 0 && mean(zv) > 1.2 * avgVol15;
    z.power = z.days + 2 * z.reversals + 0.5 * Math.min(z.dwell, 4) + (z.volHi ? 1 : 0);
    return z;
  };
  // A zone counts when it holds a daily swing point, or when 15m reversals
  // happened there on at least two different days. One intraday wiggle is not a
  // historical level.
  const meaningful = z => z.items.some(x => x.w === 2) || new Set(z.items.filter(x => x.rev).map(x => x.date)).size >= 2;
  // Support must be established: touched on a day at least 5 sessions back and
  // reversed from at least once — fresh lows of the current decline are not
  // support yet, however many of them there are.
  const cutoff = n > 5 ? D[n - 6].date : D[0].date;
  const established = z => z.items.some(x => x.date <= cutoff && x.rev);
  const sup = cluster(lowPts, tol).map(z => scoreZone(z, 'L')).filter(z => meaningful(z) && established(z) && (z.days >= 2 || z.reversals >= 1));
  // meaningful resistance: price has turned down from it before (a daily swing
  // high, or a 15m swing high followed by a 1-ATR decline)
  const res = cluster(highPts, tol).map(z => scoreZone(z, 'H')).filter(meaningful);
  const supBelow = sup.filter(z => z.lo <= P * 1.005).sort((a, b) => b.hi - a.hi);
  const strong = supBelow.filter(z => z.power >= 3);
  const S = strong[0] || null;                                  // nearest strong support at or below price
  const resAbove = p => res.filter(z => z.lo > p * 1.005).sort((a, b) => a.lo - b.lo);

  // falling risk
  const lastK = closes.slice(-10), k = lastK.length;
  let slope = null;
  if (k >= 3) { const xm = (k - 1) / 2, ym = mean(lastK); let num = 0, den = 0; lastK.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; }); slope = num / den / ym; }
  const dsw = swD, dH = dsw.filter(s => s.type === 'H').slice(-2), dL = dsw.filter(s => s.type === 'L').slice(-2);
  let pts = 0; const fr = [];
  if (slope != null) { if (slope < -0.005) { pts += 2; fr.push(`10d slope ${pct(slope)}%/day`); } else if (slope < -0.002) { pts += 1; fr.push(`10d slope ${pct(slope)}%/day`); } }
  if (dH.length === 2 && dH[1].p < dH[0].p) { pts++; fr.push('daily lower highs'); }
  if (dL.length === 2 && dL[1].p < dL[0].p) { pts++; fr.push('daily lower lows'); }
  if (n > 10) { const r5 = P / closes[n - 6] - 1, p5 = closes[n - 6] / closes[n - 11] - 1; if (r5 < p5 && r5 < -0.03) { pts++; fr.push(`decline accelerating (5d ${pct(r5)}% vs prior ${pct(p5)}%)`); } }
  const last10 = D.slice(-10).map((d, i, a) => ({ d, dn: i ? d.c < a[i - 1].c : d.c < d.o }));
  const dv = last10.filter(x => x.dn && x.d.v != null).map(x => x.d.v), uv = last10.filter(x => !x.dn && x.d.v != null).map(x => x.d.v);
  if (dv.length && uv.length && mean(dv) > 1.3 * mean(uv)) { pts++; fr.push('heavier volume on down days'); }
  const ma20 = mean(closes.slice(-20));
  const dist = P / ma20 - 1;
  if (dist < -0.10) { pts += 2; fr.push(`${pct(dist)}% below the ${Math.min(20, n)}-day average`); } else if (dist < -0.05) { pts++; fr.push(`${pct(dist)}% below the ${Math.min(20, n)}-day average`); }
  let newLows = 0; for (let i = Math.max(1, n - 10); i < n; i++) { const prior = Math.min(...D.slice(Math.max(0, i - 20), i).map(d => d.l)); if (D[i].l < prior) newLows++; }
  if (newLows >= 3) { pts += 2; fr.push(`${newLows} new lows in the last 10 sessions`); } else if (newLows >= 1) { pts++; fr.push(`${newLows} new low(s) in the last 10 sessions`); }
  const falling = pts >= 5 ? 'HIGH' : pts >= 2 ? 'MEDIUM' : 'LOW';

  // action
  const dd = P / hi - 1, fromLow = P / lo - 1;
  const conf = Math.min(1, 0.55 + n / 260);                     // less history -> less confidence
  const out = { history_days: n, history_start: D[0].date, history_end: D[n - 1].date, percentile, hi, lo, med, avg, dd, fromLow, W, falling, fallingWhy: fr, support: S, conf };
  const notes = [];
  let action = 'NOT INTERESTING', buy = null, why = '';
  const inZone = S && P <= S.hi + tol * 0.5 && P >= S.lo - tol * 0.5;
  const buyPrice = S ? (inZone ? P : S.hi) : null;
  let T1 = null, T2 = null, inval = null;
  if (S) {
    inval = dn2(Math.min(S.lo, ...S.items.map(x => x.p)) - Math.max(0.01, S.lo * 0.005));
    const r = resAbove(buyPrice * 1.02);
    T1 = r[0] ? r[0].lo : (med > buyPrice * 1.02 ? med : null);
    const r2nd = resAbove((T1 || buyPrice) * 1.02);
    T2 = r2nd[0] ? r2nd[0].lo : (hi > (T1 || buyPrice) * 1.02 ? hi : null);
  }
  const down = S ? (buyPrice - inval) / buyPrice : null;
  const upside1 = T1 ? T1 / (buyPrice || P) - 1 : null;
  const ratio = down > 0 && upside1 != null ? upside1 / down : null;
  if (percentile > 50 || dd > -0.05) { action = 'NOT INTERESTING'; notes.push(percentile > 50 ? `price is above the history median (${ord(percentile)} percentile)` : `only ${pct(-dd)}% below the period high`); }
  else if (!S) { action = 'WATCH'; notes.push('no historical support with 2+ touches or a reversal at or below the price'); }
  else if (upside1 == null || upside1 < 0.04) { action = 'WATCH'; notes.push('less than 4% upside to the first resistance'); }
  else if (ratio == null || ratio < 2) { action = 'WATCH'; notes.push(`upside/downside ${ratio == null ? '—' : ratio.toFixed(2)} is under 2`); }
  else if (inZone) { action = 'BUY NOW'; buy = r2(P); }
  else if ((P - S.hi) / P <= 0.08) { action = 'BUY LOWER'; buy = dn2(S.hi); }
  else { action = 'WATCH'; notes.push(`support ${r2(S.hi)} is ${pct((P - S.hi) / P)}% below — too far for a single buy level`); }
  if (q.level === 'BAD' && (action === 'BUY NOW' || action === 'BUY LOWER')) { notes.push('data quality problem: ' + q.issues.join('; ')); action = 'WATCH'; buy = null; }

  // score
  const attract = 30 * (1 - percentile / 100);
  const disc = 20 * clamp(-dd / 0.30, 0, 1);
  const supS = S ? 20 * clamp(S.power / 8, 0, 1) * (P - S.hi <= P * 0.05 ? 1 : 0.5) : 0;
  const ud = ratio == null ? 0 : 20 * clamp(ratio / 4, 0, 1);
  const recent = falling === 'LOW' ? 10 : falling === 'MEDIUM' ? 5 : 0;
  let score = (attract + disc + supS + ud + recent) * conf;
  if (q.level === 'WARNING') score *= 0.9;
  out.score = Math.round(score);
  out.parts = { attractiveness: Math.round(attract), discount: Math.round(disc), support: Math.round(supS), upside_vs_downside: Math.round(ud), recent: recent, confidence: Math.round(conf * 100) };
  out.action = action; out.buy = buy;
  out.T1 = r2(T1); out.T2 = r2(T2); out.inval = inval;
  out.t1pct = T1 && (buy || P) ? T1 / (buy || P) - 1 : null; out.t2pct = T2 && (buy || P) ? T2 / (buy || P) - 1 : null;
  out.ratio = ratio; out.notes = notes;
  out.why = [
    `Current price ${r2(P)} is in the ${ord(percentile)} percentile of ${n} sessions (${D[0].date}..${D[n - 1].date}), ${pct(-dd)}% below the period high ${r2(hi)} and ${pct(fromLow)}% above the period low ${r2(lo)}.`,
    S ? `Nearest strong support ${r2(S.lo)}–${r2(S.hi)}: ${S.days} separate days touched it, ${S.reversals} reversal(s) from it, ${S.dwell} closes inside it${S.volHi ? ', heavy volume there' : ''}; ${inZone ? 'the price is inside this zone' : 'it is ' + pct((P - S.hi) / P) + '% below the price'}.` : 'No support zone at or below the price has 2+ touches or a reversal.',
    T1 ? `Upside to ${r2(T1)} (first resistance) is ${pct(out.t1pct)}%${T2 ? `, to ${r2(T2)} is ${pct(out.t2pct)}%` : ''}; downside to invalidation ${inval} is ${pct(down)}% (ratio ${ratio != null ? ratio.toFixed(2) : '—'}).` : '',
    `Falling risk ${falling}${fr.length ? ': ' + fr.join(', ') : ''}.`,
    n < 120 ? `Only ${n} sessions of history — confidence ${Math.round(conf * 100)}%.` : '',
    notes.length ? 'Not a buy because: ' + notes.join('; ') + '.' : ''
  ].filter(Boolean).join(' ');
  return out;
}

// ------------------------------------------------------------------ scan
export function scanAll({ bars, now }) {
  const syms = Object.keys(bars).sort();
  const prep = {}; let newest = 0;
  for (const s of syms) { prep[s] = prepare(bars[s], now); const b = prep[s].bars; if (b.length) newest = Math.max(newest, b[b.length - 1].u); }
  const bench = ['SPY', 'QQQ'].filter(b => prep[b] && prep[b].bars.length);
  const benchRet = {};
  for (const b of bench) { const bb = prep[b].bars; benchRet[b] = returns(prep[b], bb[bb.length - 1].c); }
  const scanTime = new Date(now * 1000).toISOString();
  const rows = [];
  for (const s of syms) {
    const p = prep[s];
    const q = quality(p, newest, now);
    const row = { scan_time: scanTime, symbol: s };
    if (!p.bars.length) { rows.push({ ...row, data_quality_status: 'BAD', _q: q, _st: null, _lt: null }); continue; }
    const last = p.bars[p.bars.length - 1], P = last.c;
    const D = daily(p.sessions);
    const m5 = aggregate(p.sessions, 5, now), m15 = aggregate(p.sessions, 15, now);
    const vol = volatility(D);
    // RS vs the average of SPY/QQQ, four windows
    let rs = null;
    if (bench.length && !bench.includes(s)) {
      const me = returns(p, P), keys = ['session', 'm30', 'h2', 'multi'], diff = {};
      let pos = 0, have = 0;
      for (const k of keys) {
        const bv = bench.map(b => benchRet[b] && benchRet[b][k]).filter(x => x != null);
        if (me[k] == null || !bv.length) continue;
        diff[k] = me[k] - mean(bv); have++;
        if (diff[k] > 0.003) pos++;
      }
      const benchSession = mean(bench.map(b => benchRet[b].session).filter(x => x != null));
      const weakMkt = benchSession != null && benchSession < -0.003 && diff.session > 0.005;
      const score = have ? Math.min(15, Math.round(pos * 15 / Math.max(have, 1) * 0.8 + (weakMkt ? 3 : 0))) : 0;
      rs = { diff, score, label: !have ? null : pos >= 3 ? 'STRONG' : pos >= 2 ? 'POSITIVE' : Object.values(diff).filter(x => x < -0.003).length >= 3 ? 'NEGATIVE' : 'NEUTRAL', weakMkt };
    }
    // volume vs the same time of day in prior sessions (last 6 closed 5m candles)
    let volState = null;
    {
      const c5 = m5.filter(c => c.closed), recent = c5.slice(-6);
      const prior = c5.filter(c => c.date !== (recent[0] || {}).date);
      const prof = {}; for (const c of prior) if (c.v != null) (prof[c.mod] = prof[c.mod] || []).push(c.v);
      let cur = 0, base = 0, n = 0;
      for (const c of recent) { const m = prof[c.mod] ? median(prof[c.mod].slice(-20)) : null; if (c.v != null && m) { cur += c.v; base += m; n++; } }
      if (n >= 3 && base > 0) { const r = cur / base; volState = { rvol: r, label: r >= 1.5 ? 'EXPANDING' : r >= 0.7 ? 'NORMAL' : 'LOW', points: r >= 1.5 ? 5 : r >= 0.7 ? 3 : 1 }; }
    }
    // resistance levels above a price, from all history (daily highs weight 2, 15m/5m swing highs)
    const tolS = Math.max(P * 0.0025, 0.01);
    const lv = [];
    for (const sw of swings(m15.filter(c => c.closed))) if (sw.type === 'H') lv.push({ p: sw.p, date: 'x' + sw.u, w: 1 });
    for (const sw of swings(D.map(d => ({ ...d, u: 0 })))) if (sw.type === 'H') lv.push({ p: sw.p, date: 'd' + sw.i, w: 2 });
    const zones = cluster(lv, tolS).map(z => { z.strength += D.filter(d => d.h >= z.lo - tolS && d.h <= z.hi + tolS).length; return z; })
      .filter(z => z.strength >= 2);
    const levelsAbove = x => zones.filter(z => z.lo > x).sort((a, b) => a.lo - b.lo);
    const ctx = { m5, m15, D, P, vol, rs, q, levelsAbove, volState };
    const st = shortTerm(s, ctx);
    const lt = longTerm(s, ctx);
    rows.push({ ...row, _p: p, _q: q, _st: st, _lt: lt, _P: P, _last: last, _vol: vol, _rs: rs, _volState: volState });
  }
  return finalize(rows, scanTime);
}

// ------------------------------------------------------------------ report rows
export const COLUMNS = ['scan_time', 'symbol', 'history_start', 'history_end', 'history_days', 'last_bar_time', 'current_price', 'data_quality_status',
  'short_term_rank', 'short_term_status', 'short_term_score', 'short_term_setup', 'short_term_structure_5m', 'short_term_structure_15m',
  'short_term_relative_strength', 'short_term_volume_state', 'short_term_move_potential', 'short_term_entry_action', 'short_term_entry_price',
  'short_term_stop_price', 'short_term_target_1', 'short_term_target_1_pct', 'short_term_target_2', 'short_term_target_2_pct',
  'short_term_risk_per_share', 'short_term_rr_target_1', 'short_term_rr_target_2', 'short_term_cancel_condition', 'short_term_exit_condition',
  'short_term_why', 'short_term_why_not_ready',
  'long_term_rank', 'long_term_status', 'long_term_score', 'long_term_buy_action', 'long_term_buy_price', 'long_term_price_percentile',
  'long_term_period_high', 'long_term_period_low', 'long_term_drawdown_from_high_pct', 'long_term_distance_from_low_pct', 'long_term_support_price',
  'long_term_falling_risk', 'long_term_target_1', 'long_term_target_1_pct', 'long_term_target_2', 'long_term_target_2_pct',
  'long_term_invalidation_price', 'long_term_why'];

const ST_ORDER = { READY: 0, ARMED: 1, WATCH: 2, FAILED_SETUP: 3, AVOID: 4 };
const LT_ORDER = { 'BUY NOW': 0, 'BUY LOWER': 1, WATCH: 2, 'NOT INTERESTING': 3 };

function finalize(rows, scanTime) {
  const out = rows.map(r => {
    const o = Object.fromEntries(COLUMNS.map(c => [c, null]));
    o.scan_time = scanTime; o.symbol = r.symbol;
    o.data_quality_status = r._q ? (r._q.level === 'OK' ? 'OK' : 'WARNING') : 'WARNING';
    o._dq_detail = r._q ? r._q.issues.join('; ') : '';
    o._dq_level = r._q ? r._q.level : 'BAD';
    if (!r._lt) { o.short_term_status = 'AVOID'; o.long_term_status = 'NOT INTERESTING'; o.short_term_why_not_ready = 'no usable bars'; return o; }
    const lt = r._lt, st = r._st, P = r._P, k = st.best;
    o.history_start = lt.history_start; o.history_end = lt.history_end; o.history_days = lt.history_days;
    const t = et(r._last.u); o.last_bar_time = `${t.date} ${hhmm(t.mod)}`;
    o.current_price = r2(P);
    o.short_term_structure_5m = st.structure5; o.short_term_structure_15m = st.structure15;
    if (r._rs) o.short_term_relative_strength = `${r._rs.label}: ` + Object.entries(r._rs.diff).map(([k2, v]) => `${k2} ${v >= 0 ? '+' : ''}${pct(v)}%`).join(', ') + ' vs SPY/QQQ' + (r._rs.weakMkt ? ' (holding up in a weak market)' : '');
    if (r._volState) o.short_term_volume_state = `${r._volState.label} (last 30m at ${r._volState.rvol.toFixed(2)}x its usual volume for that time of day)`;
    if (r._vol) o.short_term_move_potential = `${r._vol.typical >= 0.03 ? 'HIGH' : r._vol.typical >= 0.015 ? 'MEDIUM' : 'LOW'}: typical daily range ${pct(r._vol.typical)}%, recent 5d ${pct(r._vol.recent)}%, ATR ${r2(r._vol.atr)}, ${r._vol.sigDays}/${r._vol.days} days moved 2%+`;
    if (k) {
      o.short_term_status = k.status; o.short_term_score = k.score; o.short_term_setup = k.failed ? 'FAILED_SETUP (' + k.setup + ')' : k.setup;
      if (k.entry != null && k.status !== 'FAILED_SETUP') {
        o.short_term_entry_action = `BUY IF PRICE >= ${k.entry.toFixed(2)}`;
        o.short_term_entry_price = k.entry; o.short_term_stop_price = k.stop;
        if (k.R > 0) {
          o.short_term_target_1 = k.t1; o.short_term_target_1_pct = pct(k.t1 / k.entry - 1);
          o.short_term_target_2 = k.t2; o.short_term_target_2_pct = pct(k.t2 / k.entry - 1);
          o.short_term_risk_per_share = r2(k.R); o.short_term_rr_target_1 = r2(k.rr1); o.short_term_rr_target_2 = r2(k.rr2);
          o.short_term_cancel_condition = `CANCEL IF PRICE < ${k.stop.toFixed(2)} BEFORE ENTRY (structure low ${r2(k.stopRef)} broken)`;
          o.short_term_exit_condition = `SELL 100% IF PRICE <= ${k.stop.toFixed(2)}; SELL 50% AT ${k.t1.toFixed(2)} AND MOVE STOP TO ${k.entry.toFixed(2)}; SELL REMAINING 50% AT ${k.t2.toFixed(2)}; EXIT (FAILED_SETUP) IF A 5m CLOSE IS BACK BELOW ${r2(k.levelRef)} AND 5m STRUCTURE TURNS NEGATIVE`;
        }
      }
      if (k.status === 'FAILED_SETUP') o.short_term_exit_condition = `EXIT: price ${r2(P)} is back below ${r2(k.levelRef)} after triggering, and the 5m structure is no longer positive`;
      const distTxt = k.entry ? ` Entry trigger is ${pct(k.entry / P - 1)}% ${k.entry >= P ? 'above' : 'below'} the current price.` : '';
      o.short_term_why = `${k.setup}: ${k.desc}. 5m ${st.structure5}, 15m ${st.structure15}.${distTxt}` +
        (k.R > 0 ? ` Risk ${r2(k.R)}/share (${pct(k.R / k.entry)}%); Target 1 ${k.t1} = 1R (${pct(k.t1 / k.entry - 1)}%), Target 2 ${k.t2} (${k.t2why}) = ${r2(k.rr2)}R (${pct(k.t2 / k.entry - 1)}%).` : '') +
        (r._rs ? ` Relative strength ${r._rs.label}.` : '') + ` Score parts: ${Object.entries(k.parts).map(([a, b]) => a + ' ' + b).join(', ')}.`;
      const wn = k.miss.concat(k.soft);
      o.short_term_why_not_ready = k.status === 'READY' ? null : wn.join('; ') || null;
    } else {
      o.short_term_status = 'AVOID'; o.short_term_score = 0;
      o.short_term_why_not_ready = st.none || `no BREAKOUT / PULLBACK / REVERSAL / RETEST pattern on the 5m structure (${st.structure5})`;
    }
    o.long_term_status = lt.action; o.long_term_score = lt.score;
    o.long_term_buy_action = lt.action === 'BUY NOW' ? `BUY NOW AT ${lt.buy.toFixed(2)}` : lt.action === 'BUY LOWER' ? `BUY IF PRICE <= ${lt.buy.toFixed(2)}` : null;
    o.long_term_buy_price = lt.buy;
    o.long_term_price_percentile = Math.round(lt.percentile * 10) / 10;
    o.long_term_period_high = r2(lt.hi); o.long_term_period_low = r2(lt.lo);
    o.long_term_drawdown_from_high_pct = pct(lt.dd); o.long_term_distance_from_low_pct = pct(lt.fromLow);
    o.long_term_support_price = lt.support ? r2(lt.support.hi) : null;
    o.long_term_falling_risk = lt.falling;
    if (lt.support) {
      o.long_term_target_1 = lt.T1; o.long_term_target_1_pct = pct(lt.t1pct);
      o.long_term_target_2 = lt.T2; o.long_term_target_2_pct = pct(lt.t2pct);
      o.long_term_invalidation_price = lt.inval;
    }
    o.long_term_why = lt.why;
    if (o._dq_level !== 'OK') {
      o.short_term_why = (o.short_term_why || '') + ` DATA ${o._dq_level}: ${o._dq_detail}.`;
      o.long_term_why = (o.long_term_why || '') + ` DATA ${o._dq_level}: ${o._dq_detail}.`;
    }
    return o;
  });
  // ranking across all symbols
  out.slice().sort((a, b) => (ST_ORDER[a.short_term_status] - ST_ORDER[b.short_term_status]) || ((b.short_term_score || 0) - (a.short_term_score || 0)) || (a.symbol < b.symbol ? -1 : 1))
    .forEach((o, i) => { o.short_term_rank = i + 1; });
  out.slice().sort((a, b) => (LT_ORDER[a.long_term_status] - LT_ORDER[b.long_term_status]) || ((b.long_term_score || 0) - (a.long_term_score || 0)) || (a.symbol < b.symbol ? -1 : 1))
    .forEach((o, i) => { o.long_term_rank = i + 1; });
  const count = (k, v) => out.filter(o => o[k] === v).length;
  const summary = {
    scan_time: scanTime, scanned: out.length,
    short_ready: count('short_term_status', 'READY'), short_armed: count('short_term_status', 'ARMED'), short_watch: count('short_term_status', 'WATCH'),
    short_failed: count('short_term_status', 'FAILED_SETUP'),
    long_buy_now: count('long_term_status', 'BUY NOW'), long_buy_lower: count('long_term_status', 'BUY LOWER'), long_watch: count('long_term_status', 'WATCH'),
    data_warnings: out.filter(o => o.data_quality_status !== 'OK').length,
    top_short: out.filter(o => ['READY', 'ARMED'].includes(o.short_term_status)).sort((a, b) => a.short_term_rank - b.short_term_rank).slice(0, 5).map(o => o.symbol),
    top_long: out.filter(o => ['BUY NOW', 'BUY LOWER'].includes(o.long_term_status)).sort((a, b) => a.long_term_rank - b.long_term_rank).slice(0, 5).map(o => o.symbol)
  };
  return { rows: out, summary };
}

// ------------------------------------------------------------------ CSV
const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
export function toCsv(rows) { return [COLUMNS.join(',')].concat(rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))).join('\n') + '\n'; }
export function candidates(rows) {
  return rows.filter(r => ['READY', 'ARMED'].includes(r.short_term_status) || ['BUY NOW', 'BUY LOWER'].includes(r.long_term_status))
    .sort((a, b) => ((b.short_term_status === 'READY') - (a.short_term_status === 'READY')) || ((b.short_term_score || 0) - (a.short_term_score || 0)) || ((b.long_term_score || 0) - (a.long_term_score || 0)));
}
