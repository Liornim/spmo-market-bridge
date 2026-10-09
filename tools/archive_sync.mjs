// Make archive_bars (the regular session, 09:30-16:00 ET) equal to Alpaca's
// consolidated feed (SIP, every US exchange), writing only what differs.
//
// Why Alpaca and not Yahoo (2026-10-09): Yahoo answered the same minutes
// differently from one request to the next, and a single read "corrected"
// 63,585 good minutes to bad values. Alpaca's history is fixed once the
// minute is 15 minutes old, goes back to 2016, and carries real volume.
//
// Per group of 20 symbols:
//   1. Alpaca bars from (window start - 7 days) to now-16min. The extra week
//      only seeds the carry-forward close for the first day of the window.
//   2. The grid of minutes per trading day comes from Alpaca's market calendar
//      (open..close, so a half day ends at 13:00). A minute with a trade is
//      Alpaca's bar; a minute without one is carried forward flat at the
//      previous close with volume 0 — the same rule the archive always used.
//      A day on which Alpaca has no trade at all for the symbol is not touched.
//   3. Compared with the archive minute by minute, exactly (integers x1e4):
//        missing -> insert; any price or volume differs -> update;
//        an archive row on a covered day that is not a grid minute -> delete.
//   4. archive_symbols summary refreshed.
// Rows outside the window are never touched.
// Env: SUPABASE_URL, SUPABASE_KEY, ALPACA_KEY_ID, ALPACA_SECRET_KEY,
//      SYMBOLS (optional), DAYS (calendar days back, default 60), DRY_RUN=1.
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const DAYS = Math.min(3650, Math.max(1, parseInt(process.env.DAYS || '60', 10)));
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = u => new Date(u * 1000).toISOString();
const dfmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etDate = u => dfmt.format(new Date(u * 1000));
const pf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function etWall(date, hm) {                       // ET wall clock -> unix seconds
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  const off = t => { const p = Object.fromEntries(pf.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000 - t; };
  let t = guess - off(guess); if (off(t) !== off(guess)) t = guess - off(t);
  return t;
}

if (!SB || !KEY) { console.log('SUPABASE_URL / SUPABASE_KEY missing'); console.log('SYNC_VERDICT: FAIL'); process.exit(1); }
if (!AK || !AS) { console.log('ALPACA_KEY_ID / ALPACA_SECRET_KEY missing'); console.log('SYNC_VERDICT: FAIL'); process.exit(1); }

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
    await sleep(r.status === 429 ? 15000 : 2000 * a);     // free plan: 200 calls / minute
  }
}

const now = Math.floor(Date.now() / 1000), ceil = now - 16 * 60;
const floorDate = etDate(now - DAYS * 86400), seedDate = etDate(now - (DAYS + 7) * 86400), today = etDate(now);
// trading days with their real open/close (half days end at 13:00)
const cal = (await alpaca(`https://paper-api.alpaca.markets/v2/calendar?start=${seedDate}&end=${today}`))
  .map(d => ({ date: d.date, open: etWall(d.date, d.open), close: etWall(d.date, d.close) }));
const sessOf = new Map(cal.map(d => [d.date, d]));
const regular = u => { const d = sessOf.get(etDate(u)); return !!d && u % 60 === 0 && u >= d.open && u < d.close; };
const days = cal.filter(d => d.date >= floorDate);
const winLo = days.length ? days[0].open : ceil;

let syms = await (await rq('archive_symbols?select=id,symbol&order=symbol.asc&limit=10000')).json();
const only = new Set((process.env.SYMBOLS || '').toUpperCase().split(/[\s,;]+/).filter(Boolean));
if (only.size) syms = syms.filter(s => only.has(s.symbol));
console.log(`archive sync (Alpaca SIP): ${syms.length} symbols, ${days.length} trading days ${floorDate}..${today} (to ${iso(ceil)})${DRY ? ' — DRY RUN' : ''}`);

const toA = s => s.replace(/-/g, '.');
const tot = { ins: 0, price: 0, vol: 0, del: 0, flat: 0, alpaca: 0, failed: [], notOnAlpaca: [] };

async function fetchGroup(group) {              // -> Map(symbol -> Map(unix -> bar))
  const fromA = new Map(group.map(s => [toA(s), s])), got = new Map(group.map(s => [s, new Map()]));
  let tok = null;
  do {
    const j = await alpaca(`https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(group.map(toA).join(','))}&timeframe=1Min&start=${iso(cal.length ? cal[0].open : winLo)}&end=${iso(ceil)}&feed=sip&adjustment=raw&limit=10000${tok ? '&page_token=' + tok : ''}`);
    for (const [asym, bars] of Object.entries(j.bars || {})) for (const b of bars) {
      const u = Math.floor(Date.parse(b.t) / 1000); if (!regular(u)) continue;
      got.get(fromA.get(asym) || asym)?.set(u, { o: Math.round(b.o * 1e4), h: Math.round(b.h * 1e4), l: Math.round(b.l * 1e4), c: Math.round(b.c * 1e4), v: Math.round(b.v) });
    }
    tok = j.next_page_token;
  } while (tok);
  return got;
}

async function syncSymbol(s, a) {
  // grid: every regular minute of every day Alpaca traded the symbol, flat-filled
  const want = new Map(), covered = new Set(); let last = null, flat = 0;
  for (const d of cal) {
    let traded = false; for (let u = d.open; u < d.close; u += 60) if (a.has(u)) { traded = true; break; }
    if (!traded) continue;
    const write = d.date >= floorDate;
    if (write) covered.add(d.date);
    for (let u = d.open; u < d.close && u + 60 <= ceil; u += 60) {
      const b = a.get(u);
      if (b) { last = b.c; if (write) want.set(u, b); }
      else if (last != null && write) { want.set(u, { o: last, h: last, l: last, c: last, v: 0 }); flat++; }
    }
  }
  // archive rows in the window
  const have = new Map(); let after = winLo - 1;
  for (;;) {
    const rows = await (await rq(`archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${s.id}&unix=gt.${after}&unix=lte.${ceil}&order=unix.asc&limit=1000`)).json();
    rows.forEach(r => have.set(r.unix, r)); if (rows.length < 1000) break; after = rows[rows.length - 1].unix;
  }
  const up = [], gone = []; let ins = 0, price = 0, vol = 0;
  for (const [u, b] of want) {
    const h = have.get(u);
    if (!h) { up.push({ symbol_id: s.id, unix: u, ...b }); ins++; }
    else if (h.o !== b.o || h.h !== b.h || h.l !== b.l || h.c !== b.c) { up.push({ symbol_id: s.id, unix: u, ...b }); price++; }
    else if (h.v !== b.v) { up.push({ symbol_id: s.id, unix: u, ...b }); vol++; }
  }
  for (const u of have.keys()) if (!want.has(u) && covered.has(etDate(u)) && u + 60 <= ceil) gone.push(u);
  if (!DRY) {
    for (let k = 0; k < up.length; k += 1000)
      await rq('archive_bars?on_conflict=symbol_id,unix', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(up.slice(k, k + 1000)) });
    for (let k = 0; k < gone.length; k += 200)
      await rq(`archive_bars?symbol_id=eq.${s.id}&unix=in.(${gone.slice(k, k + 200).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (up.length || gone.length) {
      const hc = await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}`, { method: 'HEAD', headers: { Prefer: 'count=exact', Range: '0-0' } });
      const bars = parseInt((hc.headers.get('content-range') || '').split('/')[1], 10);
      const f = await (await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}&order=unix.asc&limit=1`)).json();
      const l = await (await rq(`archive_bars?select=unix&symbol_id=eq.${s.id}&order=unix.desc&limit=1`)).json();
      await rq(`archive_symbols?id=eq.${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ bars, first_unix: f[0]?.unix ?? null, last_unix: l[0]?.unix ?? null }) });
    }
  }
  tot.ins += ins; tot.price += price; tot.vol += vol; tot.del += gone.length; tot.flat += flat; tot.alpaca += want.size - flat;
  return `${s.symbol}: ${covered.size} days, alpaca ${want.size - flat} + flat ${flat}, inserted ${ins}, price-corrected ${price}, volume-corrected ${vol}, deleted ${gone.length}`;
}

for (let i = 0; i < syms.length; i += 20) {
  const group = syms.slice(i, i + 20);
  let got = null;
  try { got = await fetchGroup(group.map(s => s.symbol)); }
  catch (e) {
    console.log(`alpaca ${group[0].symbol}..: ${e.message} — retrying one by one`);
    got = new Map();
    for (const s of group) {
      try { got.set(s.symbol, (await fetchGroup([s.symbol])).get(s.symbol)); }
      catch (e2) { if (/invalid symbol/i.test(e2.message)) tot.notOnAlpaca.push(s.symbol); else tot.failed.push(`${s.symbol}: ${e2.message}`); }
    }
  }
  for (const [k, s] of group.entries()) {
    const a = got.get(s.symbol); if (!a) continue;
    if (!a.size) { tot.failed.push(`${s.symbol}: Alpaca returned no regular-session bars`); console.log(`[${i + k + 1}/${syms.length}] ${s.symbol} FAILED no bars`); continue; }
    try { console.log(`[${i + k + 1}/${syms.length}] ` + await syncSymbol(s, a)); }
    catch (e) { tot.failed.push(`${s.symbol}: ${e.message}`); console.log(`[${i + k + 1}/${syms.length}] ${s.symbol} FAILED ${e.message}`); }
  }
}

console.log(`\n## archive sync${DRY ? ' (dry run)' : ''}\nsource: Alpaca SIP (all US exchanges), ${floorDate}..${today}\nminutes from Alpaca: ${tot.alpaca} (+ ${tot.flat} no-trade minutes carried flat)\nminutes inserted: ${tot.ins}\nminutes with prices corrected to Alpaca: ${tot.price}\nminutes with volume corrected to Alpaca: ${tot.vol}\nrows deleted (not a session minute): ${tot.del}\nnot on Alpaca (archive untouched): ${tot.notOnAlpaca.join(', ') || 'none'}\nsymbols failed: ${tot.failed.length}${tot.failed.length ? '\n  ' + tot.failed.join('\n  ') : ''}`);
console.log(`SYNC_VERDICT: ${tot.failed.length || tot.notOnAlpaca.length ? 'FAIL' : 'PASS'}`);
if (tot.failed.length || tot.notOnAlpaca.length) process.exit(1);
