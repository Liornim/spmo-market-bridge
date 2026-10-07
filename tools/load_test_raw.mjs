// Live load test of the archive page's bulk download path: every symbol, 30
// days, paged through /xa/raw exactly as the page does (sequential, retries on
// 429/5xx). Reports rows per symbol, retries and any hard failures.
const W = 'https://spmo-market-bridge.noamharelnim.workers.dev';
const syms = (await (await fetch(W + '/xa/index')).json()).symbols;
let retries = 0, fails = [], total = 0, req = 0; const t0 = Date.now(); const per = {};
async function get(u, tries = 0) {
  req++;
  const r = await fetch(u, { cache: 'no-store' });
  if ((r.status === 429 || r.status >= 500) && tries < 5) { retries++; await new Promise(x => setTimeout(x, Math.min(15000, 800 * 2 ** tries))); return get(u, tries + 1); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
for (const s of syms) {
  try {
    let after = null, n = 0;
    for (;;) {
      const t = await get(`${W}/xa/raw/${encodeURIComponent(s)}?from=2026-09-08&to=2026-10-07${after != null ? '&after=' + after : ''}`);
      const lines = t.split('\n').slice(1).filter(Boolean);
      n += lines.length;
      if (lines.length < 1000) break;
      after = lines[lines.length - 1].split(',')[0];
    }
    per[s] = n; total += n;
  } catch (e) { fails.push(s + ' ' + e.message); }
}
const counts = Object.values(per);
console.log(`symbols ${syms.length}, ok ${counts.length}, failed ${fails.length}, rows ${total}, requests ${req}, retries ${retries}, ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('rows per symbol: min', Math.min(...counts), 'max', Math.max(...counts));
if (fails.length) console.log('FAILED: ' + fails.join(' | '));
console.log(fails.length ? 'LOAD_TEST: FAIL' : 'LOAD_TEST: PASS');
