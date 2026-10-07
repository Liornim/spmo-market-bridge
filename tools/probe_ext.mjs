// Does Yahoo return pre/after-market 1m bars, and how far back? Counts per day.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const et = u => { const p = Object.fromEntries(f.formatToParts(new Date(u * 1000)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute }; };
const now = Math.floor(Date.now() / 1000);
for (const s of ['AAPL', 'TSLA', 'SOFI', 'BMY']) {
  const by = {};
  for (let end = now; end > now - 29 * 86400; end -= 7 * 86400) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1m&includePrePost=true&period1=${end - 7 * 86400}&period2=${end}`, { headers: { 'User-Agent': UA } });
    const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res) { console.log(s, 'HTTP', r.status); continue; }
    const q = res.indicators.quote[0];
    res.timestamp.forEach((u, i) => { const e = et(u); const k = by[e.d] ||= { pre: 0, reg: 0, post: 0, preNull: 0, postNull: 0, preVol0: 0, postVol0: 0, first: null, last: null };
      const seg = e.m < 570 ? 'pre' : e.m < 960 ? 'reg' : 'post'; const nul = q.close[i] == null;
      if (nul) { if (seg !== 'reg') k[seg + 'Null']++; return; }
      k[seg]++; if (seg !== 'reg' && !q.volume[i]) k[seg + 'Vol0']++;
      if (!k.first || e.m < k.first) k.first = e.m; if (!k.last || e.m > k.last) k.last = e.m; });
    await new Promise(x => setTimeout(x, 400));
  }
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  console.log(`\n${s}: day  pre(of 330) reg post(of 240)  [null pre/post, vol0 pre/post]  first-last`);
  Object.keys(by).sort().forEach(d => { const k = by[d]; console.log(`  ${d} ${k.pre} ${k.reg} ${k.post}  [${k.preNull}/${k.postNull}, ${k.preVol0}/${k.postVol0}] ${hm(k.first)}-${hm(k.last)}`); });
}
