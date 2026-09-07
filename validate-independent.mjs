import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const SYMS = ['ABNB','ARM','COIN','CRDO','DDOG','HOOD','SHOP','SMCI','SNOW','UBER'];
const DATES = ['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04'];
const parse = t => t.split('\n').filter(Boolean).slice(1).map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7] }; });
const RTH = t => t >= '09:30' && t <= '15:59';
const minutes = []; for (let h = 9, m = 30; h < 16; ) { minutes.push(String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0')); if (++m === 60) { m = 0; h++; } }
const inv = [];
console.log('=== 5. RAW DATA INVENTORY (from fetched bytes) ===');
console.log('sym   date        src  first  last   rth  dup  miss  zvol  oos  1600  ohlc  status');
for (const s of SYMS) {
  const rows = parse(readFileSync(`qa-independent/${s}.csv`, 'utf8'));
  for (const d of DATES) {
    const day = rows.filter(r => r.date === d);
    const times = day.map(r => r.time);
    const dup = times.length - new Set(times).size;
    const rth = day.filter(r => RTH(r.time));
    const have = new Set(rth.map(r => r.time));
    const miss = minutes.filter(m => !have.has(m));
    const zvol = rth.filter(r => r.volume === 0).length;
    const oos = day.filter(r => !RTH(r.time) && r.time !== '16:00').length;
    const t1600 = day.filter(r => r.time === '16:00').length;
    const ohlc = day.filter(r => r.high < Math.max(r.open, r.close) - 1e-9 || r.low > Math.min(r.open, r.close) + 1e-9 || r.high < r.low).length;
    const status = day.length === 0 ? 'ABSENT' : (rth.length === 390 && !dup && !ohlc) ? 'COMPLETE' : 'INCOMPLETE';
    inv.push({ symbol: s, date: d, source_rows: day.length, first: times[0] || '', last: times[times.length - 1] || '', rth: rth.length, dup, missing: miss.length, missing_list: miss.join(' '), zero_vol: zvol, out_of_session: oos, rows_1600: t1600, ohlc_violations: ohlc, status });
    console.log(`${s.padEnd(5)} ${d}  ${String(day.length).padStart(3)}  ${(times[0]||'—').padEnd(5)}  ${(times[times.length-1]||'—').padEnd(5)}  ${String(rth.length).padStart(3)}  ${String(dup).padStart(3)}  ${String(miss.length).padStart(4)}  ${String(zvol).padStart(4)}  ${String(oos).padStart(3)}  ${String(t1600).padStart(4)}  ${String(ohlc).padStart(4)}  ${status}${miss.length ? '  [' + miss.slice(0,3).join(',') + ']' : ''}`);
  }
}
writeFileSync('qa-independent/inventory.json', JSON.stringify(inv, null, 1));
const complete = inv.filter(x => x.status === 'COMPLETE').length;
console.log(`\n${complete}/50 complete · ${inv.filter(x=>x.status==='INCOMPLETE').length} incomplete · ${inv.filter(x=>x.status==='ABSENT').length} absent · zero-vol RTH total ${inv.reduce((a,x)=>a+x.zero_vol,0)} · OHLC violations ${inv.reduce((a,x)=>a+x.ohlc_violations,0)}`);

console.log('\n=== 6. TIMEZONE TEST ===');
console.log('Source: Yahoo returns epoch seconds (UTC). The Worker converts to America/New_York before storing; the file carries HH:MM local.');
console.log('Check: the first RTH row of each session must be 09:30 and the last 15:59; a 1h/4h offset would put the first row at 08:30/05:30 or 10:30/13:30.');
for (const s of ['ABNB','COIN','ARM']) {
  const rows = parse(readFileSync(`qa-independent/${s}.csv`, 'utf8')).filter(r => r.date === '2026-09-03');
  const first = rows[0], last = rows.filter(r => RTH(r.time)).pop();
  // 2026-09-03 09:30 America/New_York (EDT, UTC-4) = 13:30:00Z = epoch 1788780600? compute:
  const openUtc = Date.UTC(2026, 8, 3, 13, 30) / 1000;
  console.log(`  ${s.padEnd(5)} first row ${first.time}  last RTH row ${last.time}  | expected NY open 09:30 = ${new Date(openUtc*1000).toISOString()} UTC  → ${first.time === '09:30' && last.time === '15:59' ? 'NO OFFSET' : 'OFFSET DETECTED'}`);
}

console.log('\n=== 7. DATA SPOT-CHECK (raw bars) ===');
for (const s of ['ABNB','COIN','ARM']) for (const d of ['2026-09-02','2026-09-04']) {
  const rows = parse(readFileSync(`qa-independent/${s}.csv`, 'utf8')).filter(r => r.date === d);
  const pick = t => rows.find(r => r.time === t);
  console.log(`  ${s} ${d}`);
  ['09:30','09:31','12:30','15:58','15:59'].forEach(t => { const r = pick(t); console.log(`    ${t}  ${r ? [r.open, r.high, r.low, r.close, r.volume].join('  ') : 'MISSING'}`); });
}

console.log('\n=== 8. FETCH REPRODUCIBILITY ===');
const url = `https://raw.githubusercontent.com/Liornim/spmo-market-bridge/data/data/bars/COIN.csv`;
const a = await (await fetch(url + '?r=1', { cache: 'no-store' })).text();
const b = await (await fetch(url + '?r=2', { cache: 'no-store' })).text();
const ra = parse(a).filter(r => r.date === '2026-09-03' && RTH(r.time)), rb = parse(b).filter(r => r.date === '2026-09-03' && RTH(r.time));
let same = 0; const diffs = [];
ra.forEach((x, i) => { const y = rb[i]; if (y && ['time','open','high','low','close','volume'].every(k => x[k] === y[k])) same++; else diffs.push(x.time); });
console.log(`  COIN 2026-09-03 fetched twice: sha ${createHash('sha256').update(a).digest('hex').slice(0,12)} vs ${createHash('sha256').update(b).digest('hex').slice(0,12)} → identical rows ${same}/${ra.length}, differences ${diffs.length}`);
if (diffs.length) console.log('  differing minutes:', diffs.slice(0, 5).join(', '));
console.log('  the published file is a snapshot of the archive; two reads of the same snapshot cannot differ — a difference would mean a republish landed between them.');
