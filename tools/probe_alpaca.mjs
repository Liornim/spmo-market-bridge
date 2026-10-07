// ALAB after the close on 2026-10-07: Alpaca (all US exchanges, SIP) trades and
// 1-minute bars vs what Yahoo gave us. Answers: was there a real trade at ~370
// around 16:06 ET, with what size and conditions, and does Alpaca carry volume.
const K = process.env.ALPACA_KEY_ID, S = process.env.ALPACA_SECRET_KEY;
if (!K || !S) { console.log('ALPACA_KEY_ID / ALPACA_SECRET_KEY secrets are missing'); process.exit(1); }
const H = { 'APCA-API-KEY-ID': K, 'APCA-API-SECRET-KEY': S };
const sym = process.env.SYM || 'ALAB', start = '2026-10-07T20:00:00Z', end = '2026-10-07T20:40:00Z';   // 16:00-16:40 ET
const et = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'America/New_York' });
async function get(path) { const r = await fetch('https://data.alpaca.markets/v2/stocks/' + path, { headers: H }); const t = await r.text(); return { status: r.status, body: t }; }
for (const feed of ['sip', 'iex']) {
  const b = await get(`${sym}/bars?timeframe=1Min&start=${start}&end=${end}&feed=${feed}&limit=1000`);
  console.log(`\n== bars feed=${feed}: HTTP ${b.status}`);
  if (b.status !== 200) { console.log(b.body.slice(0, 300)); continue; }
  for (const x of JSON.parse(b.body).bars || []) console.log(`${et(x.t)} o ${x.o} h ${x.h} l ${x.l} c ${x.c} v ${x.v} trades ${x.n}`);
}
let tok = null, all = [];
do {
  const t = await get(`${sym}/trades?start=${start}&end=${end}&feed=sip&limit=10000${tok ? '&page_token=' + tok : ''}`);
  if (t.status !== 200) { console.log(`\n== trades sip: HTTP ${t.status} ${t.body.slice(0, 300)}`); break; }
  const j = JSON.parse(t.body); all = all.concat(j.trades || []); tok = j.next_page_token;
} while (tok);
if (all.length) {
  console.log(`\n== trades sip 16:00-16:40 ET: ${all.length} trades, ${all.reduce((a, x) => a + x.s, 0)} shares`);
  const far = all.filter(x => x.p < 378 || x.p > 386);
  console.log(`trades priced below 378 or above 386: ${far.length}`);
  far.slice(0, 40).forEach(x => console.log(`  ${et(x.t)} price ${x.p} size ${x.s} exchange ${x.x} conditions ${JSON.stringify(x.c)}`));
  console.log('sample of normal trades:'); all.slice(0, 8).forEach(x => console.log(`  ${et(x.t)} price ${x.p} size ${x.s} exchange ${x.x} conditions ${JSON.stringify(x.c)}`));
}
