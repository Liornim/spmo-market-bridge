// live check of the "בדיקת DB" page and its routes
const B = 'https://spmo-market-bridge.noamharelnim.workers.dev';
const t = await (await fetch(B + '/dbcheck?ts=' + Date.now())).text();
console.log('/dbcheck:', (t.match(/v\d+\s+\([^)]*\)/) || [])[0], '| title ok:', t.includes('<title>בדיקת DB</title>'));
const s = await (await fetch(B + '/xa/db/stats?ts=' + Date.now())).json();
console.log('stats:', JSON.stringify(s.rows), '| db MB:', s.db_bytes && Math.round(s.db_bytes / 1048576), '| symbols:', s.symbols?.length);
const lo = Math.floor(Date.parse('2026-10-08T04:00:00Z') / 1000), hi = lo + 86400;
for (const [tb, se] of [['reg', ''], ['ext', 'pre'], ['ext', 'after'], ['main', '']])
  console.log(`count AAPL 10-08 ${tb}${se ? '/' + se : ''}:`, (await (await fetch(`${B}/xa/db/count?symbol=AAPL&table=${tb}${se ? '&sess=' + se : ''}&lo=${lo}&hi=${hi}`)).json()).rows);
const r = await (await fetch(`${B}/xa/db/rows?symbol=AAPL&table=reg&lo=${lo}&hi=${hi}`)).text();
console.log('rows AAPL 10-08 reg:', r.split('\n').filter(Boolean).length - 1, '| first:', r.split('\n')[1]);
