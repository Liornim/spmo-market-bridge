// how far the history files have got (manifest summary)
const m = await (await fetch('https://spmo-market-bridge.noamharelnim.workers.dev/xa/hist/manifest?ts=' + Date.now())).json();
const f = m.files || {}; let n = 0, bytes = 0, reg = 0, ext = 0; const months = new Set();
for (const s of Object.values(f)) for (const [ym, x] of Object.entries(s)) { n++; bytes += x.bytes; reg += x.reg; ext += x.ext; months.add(ym); }
const ms = [...months].sort();
console.log(`files ${n}, symbols ${Object.keys(f).length}, months ${ms[0]}..${ms[ms.length - 1]} (${ms.length}), ${(bytes / 1048576).toFixed(1)} MB, regular ${reg}, pre/after ${ext}, updated ${m.updated_at}`);
const short = Object.entries(f).map(([s, x]) => [s, Object.keys(x).sort()]).filter(([, k]) => k.length < ms.length);
console.log('symbols with fewer months:', short.map(([s, k]) => `${s} ${k[0]}→${k[k.length - 1]} (${k.length})`).join('; '));
console.log('META:', Object.keys(f.META || {}).sort().slice(0, 3).join(','), '| GOOGL first:', Object.keys(f.GOOGL || {}).sort()[0]);
