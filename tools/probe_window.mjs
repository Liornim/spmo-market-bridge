// Does Yahoo's 1-minute answer depend on the request window? Same day, windows of
// 1, 2, 3, 5, 7 days; agreement with Alpaca SIP and with the 1-day answer.
const AK = process.env.ALPACA_KEY_ID, AS = process.env.ALPACA_SECRET_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ny = (d, hm) => Math.floor(Date.parse(`${d}T${hm}:00-04:00`) / 1000);
const close = (p, q) => p && q && p.o != null && Math.abs(p.o - q.o) <= 0.0002 && Math.abs(p.c - q.c) <= 0.0002 && Math.abs(p.h - q.h) <= 0.0002 && Math.abs(p.l - q.l) <= 0.0002;
async function yahoo(sym, p1, p2) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&includePrePost=false&period1=${p1}&period2=${p2}`, { headers: { 'User-Agent': UA } });
  const j = await r.json(), m = new Map(); const res = j?.chart?.result?.[0]; if (!res) return m; const q = res.indicators.quote[0];
  res.timestamp.forEach((u, i) => m.set(u, { o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })); return m;
}
for (const [sym, day] of [['AAPL', '2026-09-15'], ['AAPL', '2026-10-08'], ['NVDA', '2026-10-01'], ['MSFT', '2026-10-08']]) {
  const o = ny(day, '09:30'), c = ny(day, '16:00');
  const aj = await (await fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${sym}&timeframe=1Min&feed=sip&adjustment=raw&limit=10000&start=${new Date(o * 1000).toISOString()}&end=${new Date(c * 1000).toISOString()}`, { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } })).json();
  const alp = new Map((aj.bars?.[sym] || []).map(b => [Math.floor(Date.parse(b.t) / 1000), b]));
  const base = await yahoo(sym, o, c);
  const line = [];
  for (const [label, p1, p2] of [['1d', o, c], ['day-1..day', o - 86400, c], ['±1d', o - 86400, c + 86400], ['3d', o - 2 * 86400, c + 86400], ['7d before', c - 7 * 86400, c], ['7d after', o, o + 7 * 86400]]) {
    const y = await yahoo(sym, p1, Math.min(p2, Math.floor(Date.now() / 1000)));
    let sameBase = 0, sameAlp = 0, n = 0;
    for (const [u, b] of base) { if (u < o || u >= c) continue; n++; if (close(y.get(u), b)) sameBase++; if (close(y.get(u), alp.get(u))) sameAlp++; }
    line.push(`${label}: =1d ${sameBase}/${n}, =Alpaca ${sameAlp}`);
    await new Promise(x => setTimeout(x, 300));
  }
  console.log(`${sym} ${day}: ` + line.join(' · '));
}
