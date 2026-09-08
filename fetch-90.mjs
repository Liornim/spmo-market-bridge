import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const SYMS = 'ABBV,ABT,ADBE,ADI,ADP,ALAB,AMGN,AMT,APH,APP,ASML,AXP,BAC,BKNG,BLK,BMY,BRK-B,BSX,BX,C,CAT,CB,CME,COP,COST,CRWD,CSCO,CVX,DE,DELL,DIS,DUK,ELV,ETN,FISV,GE,GILD,GS,HD,HON,IBM,ICE,INTU,ISRG,JNJ,JPM,KKR,KO,LIN,LLY,LMT,LOW,LRCX,MA,MCD,MDLZ,MDT,MRK,MRSH,MRVL,MS,MSTR,NEE,NOW,PEP,PG,PGR,PLD,PM,RBLX,RTX,SBUX,SCHW,SO,SPGI,SYK,T,TJX,TMUS,TSM,TXN,UNH,UNP,V,VRTX,VZ,WFC,WM,WMT,XOM'.split(',');
const url = s => `https://raw.githubusercontent.com/Liornim/spmo-market-bridge/data/data/bars/${s}.csv`;
const log = []; let ok = 0;
for (const s of SYMS) {
  const t0 = Date.now(); let r, body = '';
  try { r = await fetch(url(s), { cache: 'no-store' }); body = r.ok ? await r.text() : ''; } catch (e) { r = { status: 0, statusText: String(e.message) }; }
  const rows = body ? body.split('\n').filter(Boolean).length - 1 : 0;
  const dates = body ? Array.from(new Set(body.split('\n').slice(1).filter(Boolean).map(l => l.split(',')[1]))).sort() : [];
  log.push({ symbol: s, source_symbol: s, url: url(s), status: r.status, bytes: body.length, rows, first_date: dates[0] || '', last_date: dates[dates.length - 1] || '', sha256_16: createHash('sha256').update(body).digest('hex').slice(0, 16), ms: Date.now() - t0, result: r.status === 200 ? 'OK' : 'FAIL' });
  if (r.status === 200) { writeFileSync(`qa-90/${s}.csv`, body); ok++; }
}
writeFileSync('qa-90/fetch-log.json', JSON.stringify(log, null, 1));
writeFileSync('qa-90-fetch-log.csv', ['symbol,source_symbol,url,status,bytes,rows,first_date,last_date,sha256_16,ms,result'].concat(log.map(l => [l.symbol, l.source_symbol, l.url, l.status, l.bytes, l.rows, l.first_date, l.last_date, l.sha256_16, l.ms, l.result].join(','))).join('\n'));
console.log('fetched ' + ok + '/' + SYMS.length);
log.filter(l => l.result !== 'OK').forEach(l => console.log('  FAIL ' + l.symbol + ' HTTP ' + l.status));
console.log('date coverage:', JSON.stringify(log.filter(l => l.result === 'OK').reduce((a, l) => (a[l.first_date + '→' + l.last_date] = (a[l.first_date + '→' + l.last_date] || 0) + 1, a), {})));
