// Make archive_bars match Yahoo exactly, writing only what differs.
//
// Per symbol:
//   1. Read every archive row (keyset pages on the primary key).
//   2. Delete junk: rows that are not a canonical session minute
//      (unix % 60 != 0, or outside 09:30..15:59 ET).
//   3. Fetch Yahoo 1m over the last 30 days in 7-day windows, parsed exactly as
//      the Worker parses it (session minutes, 4-decimal prices, a no-trade
//      minute carried forward flat at the previous close with v=0).
//   4. Compare minute by minute:
//        missing in archive            -> insert
//        any price differs             -> update (Yahoo revised it, or the
//                                         archive holds a stale flat bar)
//        only volume differs           -> update, EXCEPT when Yahoo says 0 and
//                                         the archive has a real volume: Yahoo's
//                                         historical 1m queries report 0 for some
//                                         minutes (notably 09:30), and a real
//                                         number must not be replaced by that.
//   5. Upsert changed rows (merge-duplicates), refresh archive_symbols summary.
// Rows outside Yahoo's window are never touched except junk deletion.
// Env: SUPABASE_URL, SUPABASE_KEY, SYMBOLS (optional), DRY_RUN=1, DAYS (default 30).
import { parseYahoo } from './supabase_backfill.mjs';

const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const DAYS = Math.min(30, parseInt(process.env.DAYS || '30', 10));
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SCALE = 10000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
const hm = u => { const t = fmt.format(new Date(u * 1000)); return t.startsWith('24') ? '00' + t.slice(2) : t; };
const canonical = u => u % 60 === 0 && hm(u) >= '09:30' && hm(u) <= '15:59';

async function rq(path, opts = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status < 300) return r;
    if (a >= 4) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 90)} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await sleep(1500 * a);
  }
}
async function yahoo(sym, p1, p2) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&includePrePost=false&period1=${p1}&period2=${p2}`;
  for (let a = 1; a <= 4; a++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 200) return parseYahoo(await r.json(), Math.floor(Date.now() / 1000));
    if (r.status !== 429 && r.status < 500) return { bars: [], error: 'yahoo HTTP ' + r.status };
    await sleep(2000 * a);
  }
  return { bars: [], error: 'yahoo retries exhausted' };
}

async function main() {
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY missing');
  let syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
  if (process.env.SYMBOLS) { const want = new Set(process.env.SYMBOLS.toUpperCase().split(/[\s,]+/)); syms = syms.filter(s => want.has(s.symbol)); }
  const now = Math.floor(Date.now() / 1000);
  const floor = now - DAYS * 86400 + (DAYS >= 30 ? 3600 : 0);
  const wins = []; for (let end = now; end > floor; end -= 7 * 86400) wins.push([Math.max(end - 7 * 86400, floor), end]);
  console.log(`archive sync: ${syms.length} symbols, Yahoo window ${new Date(floor * 1000).toISOString().slice(0, 10)}..now${DRY ? ' — DRY RUN' : ''}`);
  const tot = { junk: 0, ins: 0, price: 0, vol: 0, keptVol: 0, unstable: 0, failed: [] };
  for (const [i, s] of syms.entries()) {
    // 1. archive rows
    const have = new Map(), junk = []; let after = null;
    for (;;) {
      const rows = await (await rq(`archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&order=unix.asc&limit=1000` + (after != null ? `&unix=gt.${after}` : ''))).json();
      for (const r of rows) { if (canonical(r.unix)) have.set(r.unix, r); else junk.push(r.unix); }
      if (rows.length < 1000) break;
      after = rows[rows.length - 1].unix;
    }
    // 2. junk
    if (junk.length && !DRY) for (let k = 0; k < junk.length; k += 200)
      await rq(`archive_bars?symbol_id=eq.${s.id}&unix=in.(${junk.slice(k, k + 200).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    // 3. Yahoo — asked TWICE. On 2026-10-09 Yahoo answered the same minutes
    // differently from one request to the next (opens like 330.73 for a real
    // 331.425), and a single read "corrected" 63,585 good minutes to bad values.
    // A minute is taken only when two reads agree; if they do not, a third read
    // decides by majority; with no majority the minute is left as it is.
    const read = async () => { const m = new Map(); for (const [p1, p2] of wins) { const r = await yahoo(s.symbol, p1, p2); if (r.error) errs.push(r.error); for (const b of r.bars) m.set(b.unix, b); await sleep(250); } return m; };
    const same = (a, b) => a && b && Math.abs(a.o - b.o) <= 0.0002 && Math.abs(a.h - b.h) <= 0.0002 && Math.abs(a.l - b.l) <= 0.0002 && Math.abs(a.c - b.c) <= 0.0002;
    const errs = [];
    const A1 = await read(), A2 = await read();
    const y = new Map(); const unsure = [];
    for (const [u, b] of A1) { if (same(b, A2.get(u))) y.set(u, b); else unsure.push(u); }
    for (const [u, b] of A2) if (!A1.has(u)) unsure.push(u);
    if (unsure.length) {
      const A3 = await read();
      for (const u of unsure) { const a = A1.get(u), b = A2.get(u), c = A3.get(u);
        if (same(c, a)) y.set(u, c); else if (same(c, b)) y.set(u, c); else tot.unstable++; }
    }
    if (!y.size) { tot.failed.push(`${s.symbol}: ${errs.join(' | ') || 'no data'}`); console.log(`[${i + 1}/${syms.length}] ${s.symbol} FAILED ${errs.join(' | ')}`); continue; }
    // 4. diff
    const up = []; let ins = 0, price = 0, vol = 0, keptVol = 0;
    for (const [u, b] of y) {
      const e = { symbol_id: s.id, unix: u, o: Math.round(b.o * SCALE), h: Math.round(b.h * SCALE), l: Math.round(b.l * SCALE), c: Math.round(b.c * SCALE), v: Math.round(b.v || 0) };
      const a = have.get(u);
      if (!a) { up.push(e); ins++; continue; }
      // Yahoo answers the same minute with values that differ in the 4th decimal
      // depending on the request window, so an exact comparison rewrote ~145,000
      // rows every night for nothing. A price counts as different only beyond
      // 0.0002 (2 units), a volume only beyond 2% and 100 shares -- the same
      // tolerances the independent accuracy check uses.
      const far = (x, y) => Math.abs(x - y) > 2;
      const pd = far(a.o, e.o) || far(a.h, e.h) || far(a.l, e.l) || far(a.c, e.c);
      if (pd) { if (e.v === 0 && a.v > 0 && !(e.o === e.h && e.h === e.l && e.l === e.c)) e.v = a.v; up.push(e); price++; continue; }
      const vd = Math.abs(a.v - e.v) > 100 && Math.abs(a.v - e.v) > 0.02 * Math.max(1, e.v);
      if (vd) { if (e.v === 0 && a.v > 0) { keptVol++; continue; } up.push(e); vol++; }
    }
    // 5. write
    if (!DRY) for (let k = 0; k < up.length; k += 1000)
      await rq('archive_bars?on_conflict=symbol_id,unix', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(up.slice(k, k + 1000)) });
    if (!DRY && (up.length || junk.length)) {
      const hc = await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}`, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
      const bars = parseInt((hc.headers.get('content-range') || '').split('/')[1], 10);
      const f = await (await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}&order=unix.asc&limit=1`)).json();
      const l = await (await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}&order=unix.desc&limit=1`)).json();
      await rq(`archive_symbols?id=eq.${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ bars, first_unix: f[0]?.unix ?? null, last_unix: l[0]?.unix ?? null }) });
    }
    tot.junk += junk.length; tot.ins += ins; tot.price += price; tot.vol += vol; tot.keptVol += keptVol;
    console.log(`[${i + 1}/${syms.length}] ${s.symbol}: yahoo ${y.size}, junk ${junk.length}, inserted ${ins}, price-updated ${price}, volume-updated ${vol}, kept real volume over Yahoo 0: ${keptVol}${errs.length ? ' (window errors: ' + errs.length + ')' : ''}`);
  }
  console.log(`\n## archive sync${DRY ? ' (dry run)' : ''}\njunk rows deleted: ${tot.junk}\nminutes inserted: ${tot.ins}\nminutes with prices corrected to Yahoo: ${tot.price}\nminutes with volume revised: ${tot.vol}\nreal volumes kept where Yahoo reports 0: ${tot.keptVol}\nminutes left unchanged because Yahoo's answers disagreed: ${tot.unstable}\nsymbols failed: ${tot.failed.length}${tot.failed.length ? '\n  ' + tot.failed.join('\n  ') : ''}`);
  console.log(`SYNC_VERDICT: ${tot.failed.length ? 'FAIL' : 'PASS'}`);
  if (tot.failed.length) process.exit(1);
}
main().catch(e => { console.error(e); console.log('SYNC_VERDICT: FAIL (crash)'); process.exit(1); });
