const B = 'https://spmo-market-bridge.noamharelnim.workers.dev';
const t = await (await fetch(B + '/bars?ts=' + Date.now())).text();
console.log('/bars build:', (t.match(/v\d+\s+\([^)]*\)/) || [])[0], '| refreshSymbols:', t.includes('function refreshSymbols'));
const d = await (await fetch(B + '/xa/index?ts=' + Date.now())).json();
console.log('symbols:', d.symbols.length, '| BITX:', d.symbols.includes('BITX'), '| SOFI:', d.symbols.includes('SOFI'));
