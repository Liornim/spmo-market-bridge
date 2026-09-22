// Final cost accounting, every number with a unit. CODE-DERIVED constants only.
// Run: node docs/audit/accounting_ledger.mjs
const TRACKED = 27, UNIVERSE = 119, M = 390;          // MEASURED: 27 tracked, 119 universe, 390 session minutes
const SHARD = Math.min(10, Math.floor((40 - TRACKED) / 2));   // = 6
const BARS_5D = 5 * 390;                               // ~1,950 bars in a 5-day 1-minute pull
const POST_CHUNK = 1000, ARCHIVE_PAGE = 1000;
const NIGHTLY_SHARD = 5, NIGHTLY_RUNS = 24;            // */5 over 00:00-01:59 UTC
const n = x => Math.round(x).toLocaleString();

console.log('\n=== ONE ARCHIVE SYMBOL REFRESH (external HTTP requests) ===');
const postChunks = Math.ceil(BARS_5D / POST_CHUNK);
console.log('  Yahoo 5d pull ............ 1');
console.log(`  archive_bars POST ........ ${postChunks}   (ceil(${BARS_5D}/${POST_CHUNK}))`);
console.log('  count=exact GET .......... 1');
console.log('  archive_symbols PATCH .... 1');
console.log('  archiveId (cache warm) ... 0   TTL 5 min, per isolate');
console.log(`  -> minimum/typical ....... ${1 + postChunks + 2} requests`);
console.log(`  -> cold id cache ......... ${1 + postChunks + 3}`);
console.log(`  -> new symbol (id POST + re-list) . ${1 + postChunks + 5}`);

console.log('\n=== ONE INTRADAY CRON INVOCATION (external HTTP demanded) ===');
const arch = SHARD * (1 + postChunks + 2), live = TRACKED, mirror = TRACKED, idref = 1;
console.log(`  intraday archive shard ... ${arch}   (${SHARD} symbols x ${1 + postChunks + 2})`);
console.log(`  live ingestion ........... ${live}   (1 Yahoo 1d pull per tracked symbol)`);
console.log(`  mirror flush ............. ${mirror}   (1 POST per changed symbol - mirrorBars does NOT chunk)`);
console.log(`  archiveId cache refresh .. ${idref}`);
console.log(`  TOTAL DEMANDED ........... ${arch + live + mirror + idref} external requests, against a 50 limit  (${Math.round((arch + live + mirror + idref) / 50 * 100)}%)`);
console.log(`  without the archive shard  ${live + mirror + idref} -> still over 50 by ${live + mirror + idref - 50}`);

console.log('\n=== INTRADAY ARCHIVE, PER DAY (units kept separate) ===');
const refreshes = M * SHARD;
console.log(`  symbol-refresh operations . ${n(refreshes)} ops/day      (${M} runs x ${SHARD} symbols)`);
console.log(`  per universe symbol ....... ${(refreshes / UNIVERSE).toFixed(1)} refreshes/day   (universe = ${UNIVERSE})`);
console.log(`  external HTTP requests .... ${n(refreshes * (1 + postChunks + 2))} requests/day`);
console.log(`  Supabase POST operations .. ${n(refreshes * postChunks)} POSTs/day`);
console.log(`  rows transmitted .......... ${n(refreshes * BARS_5D)} rows/day`);
console.log(`  rows upserted (same) ...... ${n(refreshes * BARS_5D)} upserts/day`);
const uniqueNew = UNIVERSE * M;
console.log(`  UNIQUE new candle rows .... ${n(uniqueNew)} rows/day   (${UNIVERSE} symbols x ${M} minutes)`);
console.log(`  re-sent history ........... ${n(refreshes * BARS_5D - uniqueNew)} rows/day = ${((1 - uniqueNew / (refreshes * BARS_5D)) * 100).toFixed(1)}% of the traffic`);
console.log(`  redundancy factor ......... ${(refreshes * BARS_5D / uniqueNew).toFixed(0)}x`);

console.log('\n=== ONE CANDLE: AAPL 2026-09-17 12:00, writes to archive_bars ===');
const perDay = refreshes / UNIVERSE;
const dayOfBirth = perDay * (1 - (12 * 60 - 570) / M);     // refreshes remaining after 12:00
console.log(`  day it was created ........ ~${dayOfBirth.toFixed(1)} times (the refreshes left after 12:00)`);
console.log(`  next 4 trading days ....... ~${(perDay * 4).toFixed(0)} times (still inside the 5-day pull window)`);
console.log(`  nightly pass .............. ~${(NIGHTLY_RUNS * NIGHTLY_SHARD / UNIVERSE * 5).toFixed(0)} times`);
console.log(`  TOTAL ..................... ~${(dayOfBirth + perDay * 4 + NIGHTLY_RUNS * NIGHTLY_SHARD / UNIVERSE * 5).toFixed(0)} upserts of the same candle`);

console.log('\n=== FAILURE POINT RANGE (external requests spent before tracked symbol #k) ===');
for (const [label, archCost, idCost] of [['best case (id warm, 1 POST chunk)', SHARD * (1 + 1 + 2), 0],
  ['typical (id warm, 2 POST chunks)', arch, 1], ['worst (id cold, 2 chunks, new symbol)', SHARD * (1 + postChunks + 3), 2]]) {
  const before = archCost + idCost;
  const reach = 50 - before;
  console.log(`  ${label.padEnd(38)} archive=${String(archCost).padStart(3)}  -> tracked symbols reachable: ${reach}  (wall at #${reach + 1})`);
}
console.log('  NOTE: both promises run concurrently, so "spent before #k" is the interleaved total, not a phase.');
