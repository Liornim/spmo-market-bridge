// Pre-market (04:00-09:30 ET) and after-market (16:00-20:00 ET) 1-minute bars:
// Yahoo -> archive_ext_bars (same layout as archive_bars), for the last DAYS
// (<=29; Yahoo keeps 1m data ~30 days). Facts from the 2026-10-07 probe:
//   - Yahoo reports volume 0 for extended-hours minutes: only prices are real.
//   - A minute with no trade is simply absent (thin stocks have few bars), so
//     nothing is filled in and completeness is not expected.
// Insert missing minutes, correct changed prices (same tolerance as the regular
// sync: more than 2 units = 0.0002), never touch archive_bars.
// Env: SUPABASE_URL, SUPABASE_KEY, SYMBOLS (optional), DAYS (default 29), DRY_RUN=1.
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const DAYS = Math.min(29, Math.max(1, parseInt(process.env.DAYS || '29', 10)));
const DRY = process.env.DRY_RUN === '1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(x => setTimeout(x, ms));
const hf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), offs = {};
const etOff = u => { const d = Math.floor(u / 86400); if (offs[d] === undefined) offs[d] = ((+hf.format(new Date((d * 86400 + 57600) * 1000))) % 24 - 16) * 3600; return offs[d]; };
const mod = u => { const d = new Date((u + etOff(u)) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const isExt = u => { if (u % 60) return false; const m = mod(u); return (m >= 240 && m < 570) || (m >= 960 && m < 1200); };

async function rq(path, opts = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status < 300) return r;
    if (a >= 4) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 90)} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await sleep(1500 * a);
  }
}
async function yahoo(sym, p1, p2) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&includePrePost=true&period1=${p1}&period2=${p2}`;
  for (let a = 1; a <= 4; a++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (r.status === 200) {
      const j = await r.json(), res = j?.chart?.result?.[0]; if (!res) return { bars: [], error: 'no result' };
      const q = res.indicators?.quote?.[0] || {}, now = Math.floor(Date.now() / 1000), bars = [];
      (res.timestamp || []).forEach((u, i) => {
        if (u + 60 > now || !isExt(u)) return;
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) return;             // no trade: no bar
        bars.push({ unix: u, o: Math.round(o * 1e4), h: Math.round(h * 1e4), l: Math.round(l * 1e4), c: Math.round(c * 1e4), v: Math.round(q.volume?.[i] || 0) });
      });
      return { bars, error: null };
    }
    if (r.status !== 429 && r.status < 500) return { bars: [], error: 'yahoo HTTP ' + r.status };
    await sleep(2000 * a);
  }
  return { bars: [], error: 'yahoo retries exhausted' };
}

let syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
if (only.size) syms = syms.filter(s => only.has(s.symbol));
const now = Math.floor(Date.now() / 1000), floor = now - DAYS * 86400;
const wins = []; for (let end = now; end > floor; end -= 7 * 86400) wins.push([Math.max(end - 7 * 86400, floor), end]);
console.log(`ext sync: ${syms.length} symbols, ${DAYS} days${DRY ? ' — DRY RUN' : ''}`);
const tot = { ins: 0, upd: 0, yahoo: 0, failed: [] };
for (const [i, s] of syms.entries()) {
  const have = new Map(); let after = floor - 1;
  for (;;) {
    const rows = await (await rq(`archive_ext_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&unix=gt.${after}&order=unix.asc&limit=1000`)).json();
    rows.forEach(r => have.set(r.unix, r)); if (rows.length < 1000) break; after = rows[rows.length - 1].unix;
  }
  const y = new Map(), errs = [];
  for (const [p1, p2] of wins) { const r = await yahoo(s.symbol, p1, p2); if (r.error) errs.push(r.error); r.bars.forEach(b => y.set(b.unix, b)); await sleep(300); }
  if (errs.length === wins.length) { tot.failed.push(`${s.symbol}: ${errs.join(' | ')}`); console.log(`[${i + 1}/${syms.length}] ${s.symbol} FAILED ${errs[0]}`); continue; }
  const up = []; let ins = 0, upd = 0;
  const far = (a, b) => Math.abs(a - b) > 2;
  for (const [u, b] of y) {
    const a = have.get(u), e = { symbol_id: s.id, ...b };
    if (!a) { up.push(e); ins++; } else if (far(a.o, b.o) || far(a.h, b.h) || far(a.l, b.l) || far(a.c, b.c) || (b.v > 0 && a.v !== b.v)) { up.push(e); upd++; }
  }
  if (!DRY) for (let k = 0; k < up.length; k += 1000)
    await rq('archive_ext_bars?on_conflict=symbol_id,unix', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(up.slice(k, k + 1000)) });
  tot.ins += ins; tot.upd += upd; tot.yahoo += y.size;
  console.log(`[${i + 1}/${syms.length}] ${s.symbol}: yahoo ${y.size} extended minutes, inserted ${ins}, prices corrected ${upd}${errs.length ? ' (window errors: ' + errs.length + ')' : ''}`);
}
const cnt = await rq('archive_ext_bars?select=unix', { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
console.log(`\n## pre/after-market sync${DRY ? ' (dry run)' : ''}\nextended minutes from Yahoo: ${tot.yahoo}\ninserted: ${tot.ins}\nprices corrected: ${tot.upd}\nrows in archive_ext_bars: ${(cnt.headers.get('content-range') || '').split('/')[1]}\nsymbols failed: ${tot.failed.length}${tot.failed.length ? '\n  ' + tot.failed.join('\n  ') : ''}`);
console.log(`EXT_VERDICT: ${tot.failed.length ? 'FAIL' : 'PASS'}`);
if (tot.failed.length) process.exit(1);
