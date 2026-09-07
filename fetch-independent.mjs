// INDEPENDENT FETCH. Source: the Worker's published archive on GitHub —
// raw.githubusercontent.com is the only host this sandbox can reach. No file
// from the operator is read. Every request is logged with status, bytes and
// the content sha so the fetch is evidenced, not asserted.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const REPO = 'Liornim/spmo-market-bridge', BRANCH = 'data';
const SYMS = ['ABNB','ARM','COIN','CRDO','DDOG','HOOD','SHOP','SMCI','SNOW','UBER'];
const url = s => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/bars/${s}.csv`;
mkdirSync('qa-independent', { recursive: true });
const log = [];
for (const s of SYMS) {
  const t0 = Date.now();
  const r = await fetch(url(s), { cache: 'no-store' });
  const body = r.ok ? await r.text() : '';
  const sha = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const rows = body ? body.split('\n').filter(Boolean).length - 1 : 0;
  log.push({ symbol: s, url: url(s), status: r.status, bytes: body.length, rows, sha256_16: sha, ms: Date.now() - t0,
    etag: r.headers.get('etag') || '', last_modified: r.headers.get('last-modified') || '' });
  if (r.ok) writeFileSync(`qa-independent/${s}.csv`, body);
}
writeFileSync('qa-independent/fetch-log.json', JSON.stringify(log, null, 1));
console.log('source  : raw.githubusercontent.com — Worker-published archive (Supabase archive_bars via /publish/shard, PUBLISH_DAYS=7)');
console.log('interval: 1m, RTH rows the Worker filtered (09:30–15:59 America/New_York) plus a 16:00 terminal row when present');
console.log('time    : exchange-local HH:MM in the file; the Worker decodes Yahoo epoch seconds to America/New_York');
console.log('adjust  : unadjusted (Yahoo chart endpoint, includeAdjustedClose not used for 1m)');
log.forEach(l => console.log(`  ${l.symbol.padEnd(5)} HTTP ${l.status}  ${String(l.bytes).padStart(7)} bytes  ${String(l.rows).padStart(5)} rows  sha ${l.sha256_16}  ${l.ms}ms`));
const bad = log.filter(l => l.status !== 200);
console.log(bad.length ? 'FAILED: ' + bad.map(l => l.symbol + ' HTTP ' + l.status).join(', ') : 'all 10 fetched');
