// Prints what the live Worker answers on a few routes (status + body head).
const B = 'https://spmo-market-bridge.noamharelnim.workers.dev';
for (const p of ['/health', '/bars/index', '/xa/index', '/days/AAPL', '/coverage']) {
  try { const r = await fetch(B + p); const t = await r.text(); console.log(`${p} -> ${r.status}\n${t.slice(0, 700)}\n`); }
  catch (e) { console.log(`${p} -> ERR ${e.message}`); }
}
