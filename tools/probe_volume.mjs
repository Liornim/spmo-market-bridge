// Whose minute volumes add up to the day's real volume? AAPL/CAT on a few days:
// Alpaca daily bar vs the sum of Alpaca 1m bars (all sessions / regular only),
// Yahoo daily volume vs the sum of Yahoo 1m regular-session volumes.
const AH = { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const hf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const mod = u => { const [h, m] = hf.format(new Date(u * 1000)).split(':').map(Number); return h * 60 + m; };
for (const sym of ['AAPL', 'CAT', 'SOFI']) for (const day of ['2026-09-17', '2026-10-06', '2026-10-08']) {
  const s = `${day}T04:00:00-04:00`, e = `${day}T20:00:00-04:00`;
  const d = await (await fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${sym}&timeframe=1Day&feed=sip&adjustment=raw&start=${day}&end=${day}`, { headers: AH })).json();
  let tok = null, all = 0, reg = 0, o930 = 0;
  do { const j = await (await fetch(`https://data.alpaca.markets/v2/stocks/bars?symbols=${sym}&timeframe=1Min&feed=sip&adjustment=raw&limit=10000&start=${s}&end=${e}${tok ? '&page_token=' + tok : ''}`, { headers: AH })).json();
    for (const b of j.bars?.[sym] || []) { const m = mod(Date.parse(b.t) / 1000); all += b.v; if (m >= 570 && m < 960) reg += b.v; if (m === 570) o930 = b.v; } tok = j.next_page_token; } while (tok);
  const p1 = Math.floor(Date.parse(s) / 1000), p2 = Math.floor(Date.parse(e) / 1000);
  const y = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&period1=${p1}&period2=${p2}&includePrePost=false`, { headers: { 'User-Agent': UA } })).json();
  const r = y.chart?.result?.[0]; let yreg = 0, y930 = 0; (r?.timestamp || []).forEach((t, i) => { const m = mod(t), v = r.indicators.quote[0].volume[i] || 0; if (m >= 570 && m < 960) yreg += v; if (m === 570) y930 = v; });
  const yd = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${p1}&period2=${p2}`, { headers: { 'User-Agent': UA } })).json();
  const ydv = yd.chart?.result?.[0]?.indicators?.quote?.[0]?.volume?.[0];
  console.log(`${sym} ${day} | alpaca day ${d.bars?.[sym]?.[0]?.v} | alpaca 1m all ${all} | alpaca 1m regular ${reg} | alpaca 09:30 ${o930} || yahoo day ${ydv} | yahoo 1m regular ${yreg} | yahoo 09:30 ${y930}`);
}
