// Prints what the live Worker answers on a few routes (status + key facts).
const B = 'https://spmo-market-bridge.noamharelnim.workers.dev';
const r = await fetch(B + '/bars?ts=' + Date.now()); const t = await r.text();
console.log('/bars ->', r.status, '| build:', (t.match(/v\d+\s+\([^)]*\)/) || [])[0], '| reads /xa/index:', t.includes("/xa/index"), '| D1 route /bars/index:', t.includes("'/bars/index'"), '| scanner tab:', t.includes('tabScan'), '| update tab:', t.includes('tabUpd'));
for (const p of ['/auth', '/xa/index', '/xa/days/SOFI', '/xa/update/status', '/health']) {
  const x = await fetch(B + p + '?ts=' + Date.now()); const b = await x.text();
  console.log(p, '->', x.status, b.replace(/\s+/g, ' ').slice(0, 160));
}
