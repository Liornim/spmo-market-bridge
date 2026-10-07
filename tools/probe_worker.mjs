// Live check of /bars: the page build, and today's candles through the Yahoo pass-through.
const B = 'https://spmo-market-bridge.noamharelnim.workers.dev';
const t = await (await fetch(B + '/bars?ts=' + Date.now())).text();
console.log('/bars build:', (t.match(/v\d+\s+\([^)]*\)/) || [])[0], '| download buttons:', t.includes('class="lvD"'));
const now = Math.floor(Date.now() / 1000);
for (const s of ['AAPL', 'SOFI', 'TSLA']) {
  const r = await fetch(`${B}/xa/yahoo/${s}?p1=${now - 7 * 86400}&p2=${now}`); const j = await r.json();
  const ts = j?.chart?.result?.[0]?.timestamp || [];
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 10);
  const td = ts.filter(u => new Date(u * 1000).toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 10) === today);
  const last = td.length ? new Date(td[td.length - 1] * 1000).toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(11, 16) : '-';
  console.log(`${s}: HTTP ${r.status}, ${ts.length} minutes in 7 days, today ${today}: ${td.length} minutes, last ${last} ET (now ${new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(11, 16)} ET)`);
}
