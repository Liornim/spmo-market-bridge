import { readFileSync, writeFileSync } from 'node:fs';
const SYMS = JSON.parse(readFileSync('qa-90/fetch-log.json','utf8')).filter(l=>l.result==='OK').map(l=>l.symbol);
const DATES = ['2026-09-01','2026-09-02','2026-09-03','2026-09-04'];
const RTH = t => t >= '09:30' && t <= '15:59';
const minutes = []; for (let h = 9, m = 30; h < 16; ) { minutes.push(String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')); if (++m === 60) { m = 0; h++; } }
const inv = [], dupRows = [];
let master = ['symbol,date,time,open,high,low,close,volume'];
for (const s of SYMS) {
  const rows = readFileSync(`qa-90/${s}.csv`,'utf8').split('\n').filter(Boolean).slice(1).map(l => { const p = l.split(','); return { symbol: p[0], date: p[1], time: p[2], open: +p[3], high: +p[4], low: +p[5], close: +p[6], volume: +p[7], raw: l }; });
  for (const d of DATES) {
    const day = rows.filter(r => r.date === d);
    let malformed = day.filter(r => [r.open,r.high,r.low,r.close].some(x => !isFinite(x))).length;
    // duplicates: report both rows, then one deterministic rule — keep the
    // row with the higher volume (a zero-volume twin is a snapshot artefact)
    const seen = {}, dups = [];
    day.forEach(r => { if (seen[r.time]) { dups.push([seen[r.time], r]); } else seen[r.time] = r; });
    dups.forEach(([a,b]) => dupRows.push({ symbol: s, date: d, time: a.time, row_a: a.raw, row_b: b.raw, kept: (b.volume > a.volume ? 'b' : 'a') }));
    const dedup = Object.values(seen).map(r => { const twin = dups.find(x => x[0] === r); return twin && twin[1].volume > r.volume ? twin[1] : r; });
    const rth = dedup.filter(r => RTH(r.time));
    const have = new Set(rth.map(r => r.time));
    const miss = minutes.filter(m => !have.has(m));
    const zvol = rth.filter(r => r.volume === 0).length;
    const oos = dedup.filter(r => !RTH(r.time) && r.time !== '16:00').length;
    const t1600 = dedup.filter(r => r.time === '16:00').length;
    const ohlc = rth.filter(r => r.high < Math.max(r.open,r.close)-1e-9 || r.low > Math.min(r.open,r.close)+1e-9 || r.high < r.low).length;
    const status = day.length === 0 ? 'UNAVAILABLE' : (rth.length === 390 && miss.length === 0 && !ohlc && !malformed) ? 'COMPLETE' : 'INCOMPLETE';
    inv.push({ symbol: s, date: d, source_rows: day.length, rth_bars: rth.length, duplicates: dups.length, missing_minutes: miss.length, missing_list: miss.slice(0,5).join(' '), malformed, ohlc_violations: ohlc, zero_volume_rth: zvol, out_of_session: oos, rows_1600: t1600, first: dedup[0]?.time || '', last: dedup[dedup.length-1]?.time || '', status });
    if (status === 'COMPLETE') rth.forEach(r => master.push([s,d,r.time,r.open,r.high,r.low,r.close,r.volume].join(',')));
  }
}
writeFileSync('qa-90/master.csv', master.join('\n'));
const cols = Object.keys(inv[0]);
writeFileSync('qa-90-data-inventory.csv', [cols.join(',')].concat(inv.map(r => cols.map(c => JSON.stringify(r[c] == null ? '' : r[c])).join(','))).join('\n'));
writeFileSync('qa-90/duplicates.json', JSON.stringify(dupRows, null, 1));
const n = k => inv.filter(x => x.status === k).length;
console.log(`symbol-days: ${inv.length} of 360 expected · COMPLETE ${n('COMPLETE')} · INCOMPLETE ${n('INCOMPLETE')} · UNAVAILABLE ${n('UNAVAILABLE')}`);
console.log(`duplicates ${dupRows.length} · malformed ${inv.reduce((a,x)=>a+x.malformed,0)} · OHLC violations ${inv.reduce((a,x)=>a+x.ohlc_violations,0)} · missing minutes ${inv.reduce((a,x)=>a+x.missing_minutes,0)} · zero-vol RTH ${inv.reduce((a,x)=>a+x.zero_volume_rth,0)} · out-of-session ${inv.reduce((a,x)=>a+x.out_of_session,0)} · 16:00 rows ${inv.reduce((a,x)=>a+x.rows_1600,0)}`);
inv.filter(x => x.status !== 'COMPLETE').forEach(x => console.log(`  ${x.status.padEnd(12)} ${x.symbol.padEnd(6)} ${x.date}  rth ${x.rth_bars}  missing ${x.missing_minutes} [${x.missing_list}]  dup ${x.duplicates}  ohlc ${x.ohlc_violations}`));
console.log('master rows for primary:', master.length - 1);
