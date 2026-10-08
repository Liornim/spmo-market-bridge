// Pre-market (04:00-09:30 ET) and after-market (16:00-20:00 ET) 1-minute bars
// from Alpaca's consolidated feed (SIP, all US exchanges) -> archive_ext_bars.
//
// Why Alpaca and not Yahoo (probe 2026-10-08, ALAB after the 10-07 close):
//   - Yahoo reports volume 0 for every extended-hours minute; Alpaca has volume
//     and trade counts.
//   - Yahoo folded late-reported "prior reference price" trades (condition P,
//     e.g. 370.00 at 16:07 when the market was at 382) into its bars; Alpaca's
//     bars follow the tape rules and leave them out of OHLC.
// Alpaca's free plan serves SIP history except the latest 15 minutes, which is
// all a nightly job needs. The 16:00 bar carries the closing auction's volume.
//
// For every window the archive is made equal to Alpaca: bars inserted or
// corrected, and stored minutes Alpaca does not have (old Yahoo artefacts)
// deleted. archive_bars is never touched.
// Env: SUPABASE_URL, SUPABASE_KEY, ALPACA_KEY_ID, ALPACA_SECRET_KEY,
//      SYMBOLS (optional), DAYS (default 29), DRY_RUN=1.
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY || '';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const DAYS = Math.min(3650, Math.max(1, parseInt(process.env.DAYS || '29', 10)));
const DRY = process.env.DRY_RUN === '1';
const sleep = ms => new Promise(x => setTimeout(x, ms));
const hf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), offs = {};
const etOff = u => { const d = Math.floor(u / 86400); if (offs[d] === undefined) offs[d] = ((+hf.format(new Date((d * 86400 + 57600) * 1000))) % 24 - 16) * 3600; return offs[d]; };
const mod = u => { const d = new Date((u + etOff(u)) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const isExt = u => { if (u % 60) return false; const m = mod(u); return (m >= 240 && m < 570) || (m >= 960 && m < 1200); };
if (!SB || !KEY) { console.log('SUPABASE_URL / SUPABASE_KEY missing'); console.log('EXT_VERDICT: FAIL'); process.exit(1); }
if (!AK || !AS) { console.log('ALPACA_KEY_ID / ALPACA_SECRET_KEY missing'); console.log('EXT_VERDICT: FAIL'); process.exit(1); }

async function rq(path, opts = {}) {
  for (let a = 1; ; a++) {
    const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
    if (r.status < 300) return r;
    if (a >= 4) throw new Error(`${opts.method || 'GET'} ${path.slice(0, 90)} -> HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await sleep(1500 * a);
  }
}
async function alpaca(url) {
  for (let a = 1; ; a++) {
    const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } });
    if (r.status === 200) return r.json();
    if (a >= 5 || (r.status !== 429 && r.status < 500)) throw new Error(`alpaca HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await sleep(r.status === 429 ? 15000 : 2000 * a);      // free plan: 200 calls / minute
  }
}

let syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
if (only.size) syms = syms.filter(s => only.has(s.symbol));
const now = Math.floor(Date.now() / 1000), floor = now - DAYS * 86400, ceil = now - 16 * 60;
const iso = u => new Date(u * 1000).toISOString();
console.log(`ext sync (Alpaca SIP): ${syms.length} symbols, ${iso(floor)} .. ${iso(ceil)}${DRY ? ' — DRY RUN' : ''}`);

// 1. Alpaca bars, 20 symbols per request, all pages. Yahoo writes share
// classes with '-' (BRK-B), Alpaca with '.' (BRK.B). A group that fails is
// retried symbol by symbol, so one bad symbol cannot sink nineteen others.
const toA = s => s.replace(/-/g, '.'), fromA = new Map(syms.map(s => [toA(s.symbol), s.symbol]));
const got = new Map(syms.map(s => [s.symbol, new Map()]));
const failed = [], notOnAlpaca = [];
async function fetchGroup(group) {
  let tok = null, pages = 0;
  do {
    const j = await alpaca(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(group.map(toA).join(','))}&timeframe=1Min&start=${iso(floor)}&end=${iso(ceil)}&feed=sip&adjustment=raw&limit=10000${tok ? '&page_token=' + tok : ''}`);
    for (const [asym, bars] of Object.entries(j.bars || {})) for (const b of bars) {
      const u = Math.floor(Date.parse(b.t) / 1000); if (!isExt(u)) continue;
      got.get(fromA.get(asym) || asym)?.set(u, { unix: u, o: Math.round(b.o * 1e4), h: Math.round(b.h * 1e4), l: Math.round(b.l * 1e4), c: Math.round(b.c * 1e4), v: Math.round(b.v) });
    }
    tok = j.next_page_token; pages++;
  } while (tok);
  return pages;
}
for (let i = 0; i < syms.length; i += 20) {
  const group = syms.slice(i, i + 20).map(s => s.symbol);
  try { console.log(`alpaca ${group[0]}..${group[group.length - 1]}: ${await fetchGroup(group)} page(s)`); }
  catch (e) {
    console.log(`alpaca ${group[0]}..: ${e.message} — retrying one by one`);
    for (const s1 of group) {
      try { await fetchGroup([s1]); }
      catch (e2) { if (/invalid symbol/i.test(e2.message)) notOnAlpaca.push(s1); else failed.push(`${s1}: ${e2.message}`); }
    }
  }
}
if (notOnAlpaca.length) console.log(`not on Alpaca (skipped, archive untouched): ${notOnAlpaca.join(', ')}`);

// 2. make the archive equal to Alpaca inside the window
const tot = { ins: 0, upd: 0, del: 0, alpaca: 0 };
const writes = [];
for (const [i, s] of syms.entries()) {
  const a = got.get(s.symbol); if (notOnAlpaca.includes(s.symbol) || failed.some(f => f.startsWith(s.symbol + ':'))) continue;
  const have = new Map(); let after = floor - 1;
  for (;;) {
    const rows = await (await rq(`archive_ext_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&unix=gt.${after}&unix=lte.${ceil}&order=unix.asc&limit=1000`)).json();
    rows.forEach(r => have.set(r.unix, r)); if (rows.length < 1000) break; after = rows[rows.length - 1].unix;
  }
  const up = [], gone = [];
  for (const [u, b] of a) { const h = have.get(u);
    if (!h) { up.push({ symbol_id: s.id, ...b }); tot.ins++; }
    else if (h.o !== b.o || h.h !== b.h || h.l !== b.l || h.c !== b.c || h.v !== b.v) { up.push({ symbol_id: s.id, ...b }); tot.upd++; } }
  for (const u of have.keys()) if (!a.has(u)) gone.push(u);
  tot.del += gone.length; tot.alpaca += a.size;
  if (!DRY) {
    for (let k = 0; k < up.length; k += 5000) writes.push(['up', up.slice(k, k + 5000)]);
    for (let k = 0; k < gone.length; k += 300) writes.push(['del', s.id, gone.slice(k, k + 300)]);
  }
  if ((i + 1) % 20 === 0 || i === syms.length - 1) console.log(`[${i + 1}/${syms.length}] compared · pending writes ${writes.length}`);
  // flush in parallel batches of 4 so memory stays small
  while (writes.length >= 8 || (i === syms.length - 1 && writes.length)) {
    await Promise.all(writes.splice(0, 4).map(w => w[0] === 'up'
      ? rq('archive_ext_bars?on_conflict=symbol_id,unix', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(w[1]) })
      : rq(`archive_ext_bars?symbol_id=eq.${w[1]}&unix=in.(${w[2].join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })));
  }
}
const cnt = await rq('archive_ext_bars?select=unix', { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
console.log(`\n## pre/after-market sync (Alpaca SIP)${DRY ? ' (dry run)' : ''}\nextended minutes from Alpaca: ${tot.alpaca}\ninserted: ${tot.ins}\nprices corrected: ${tot.upd}\ndeleted (not in Alpaca): ${tot.del}\nrows in archive_ext_bars: ${(cnt.headers.get('content-range') || '').split('/')[1]}\nnot on Alpaca: ${notOnAlpaca.join(', ') || 'none'}\nsymbols failed: ${failed.length}${failed.length ? '\n  ' + failed.slice(0, 20).join('\n  ') : ''}`);
console.log(`EXT_VERDICT: ${failed.length ? 'FAIL' : 'PASS'}`);
if (failed.length) process.exit(1);
