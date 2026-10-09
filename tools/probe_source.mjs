// Which source is right when the archive and Yahoo disagree? For a few minutes
// from the 10-09 accuracy failures: archive vs Yahoo (1-day window) vs Yahoo
// (7-day window, as the sync asks) vs Alpaca SIP.
const SB = process.env.SUPABASE_URL.replace(/\/$/, ''), KEY = process.env.SUPABASE_KEY;
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cases = [['AAPL', '2026-09-15', ['09:44', '09:59', '10:40', '10:42', '10:53']], ['CAT', '2026-09-17', []], ['BRK-B', '2026-10-06', []]];
const ny = (d, hm) => Math.floor(Date.parse(`${d}T${hm}:00-04:00`) / 1000);
const f = x => x == null ? '—' : (+x).toFixed(4);
async function yahoo(sym, p1, p2) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&includePrePost=false&period1=${p1}&period2=${p2}`, { headers: { 'User-Agent': UA } });
  const j = await r.json(), res = j.chart.result[0], q = res.indicators.quote[0], m = new Map();
  res.timestamp.forEach((u, i) => m.set(u, { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] })); return m;
}
const ids = Object.fromEntries((await (await fetch(SB + '/rest/v1/archive_symbols?select=id,symbol', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json()).map(r => [r.symbol, r.id]));
for (const [sym, day, mins] of cases) {
  const o = ny(day, '09:30'), c = ny(day, '16:00');
  const arch = new Map((await (await fetch(`${SB}/rest/v1/archive_bars?select=unix,o,h,l,c,v&symbol_id=eq.${ids[sym]}&unix=gte.${o}&unix=lt.${c}&order=unix.asc`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json()).map(r => [r.unix, { o: r.o / 1e4, h: r.h / 1e4, l: r.l / 1e4, c: r.c / 1e4, v: r.v }]));
  const y1 = await yahoo(sym, o, c), y7 = await yahoo(sym, o - 3 * 86400, c + 3 * 86400);
  const aj = await (await fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${sym.replace('-', '.')}&timeframe=1Min&feed=sip&adjustment=raw&limit=10000&start=${new Date(o * 1000).toISOString()}&end=${new Date(c * 1000).toISOString()}`, { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } })).json();
  const alp = new Map((Object.values(aj.bars || {})[0] || []).map(b => [Math.floor(Date.parse(b.t) / 1000), b]));
  // agreement across the whole session
  let n = 0, aY1 = 0, aY7 = 0, y1y7 = 0, aAl = 0, y1Al = 0;
  const close = (p, q) => p && q && Math.abs(p.o - q.o) <= 0.0002 && Math.abs(p.c - q.c) <= 0.0002 && Math.abs(p.h - q.h) <= 0.0002 && Math.abs(p.l - q.l) <= 0.0002;
  for (const [u, a] of arch) { n++; const p = y1.get(u), q = y7.get(u), r = alp.get(u);
    if (close(a, p)) aY1++; if (close(a, q)) aY7++; if (close(p, q)) y1y7++; if (close(a, r)) aAl++; if (close(p, r)) y1Al++; }
  console.log(`\n${sym} ${day}: ${n} minutes · archive=Yahoo(1d) ${aY1} · archive=Yahoo(7d) ${aY7} · Yahoo(1d)=Yahoo(7d) ${y1y7} · archive=Alpaca ${aAl} · Yahoo(1d)=Alpaca ${y1Al}`);
  for (const hm of mins) { const u = ny(day, hm), a = arch.get(u), p = y1.get(u), q = y7.get(u), r = alp.get(u);
    console.log(`  ${hm} open  archive ${f(a?.o)}  yahoo1d ${f(p?.o)}  yahoo7d ${f(q?.o)}  alpaca ${f(r?.o)}   | close archive ${f(a?.c)} y1 ${f(p?.c)} y7 ${f(q?.c)} alp ${f(r?.c)}`); }
}
