// Reproducible D1 rows_read model for one regular session (390 minutes).
// Every per-call figure is the size of the index range the query visits
// (plans verified with EXPLAIN QUERY PLAN, see D1_QUERY_INVENTORY.md).
// Frequencies are CODE-DERIVED from worker.js and the page timers.
// Run: node docs/audit/d1_cost_model.mjs [tracked=27]
const T = +(process.argv[2] || 27), SESSION = 390;
const sumM = n => Array.from({ length: SESSION }, (_, i) => n(i + 1)).reduce((a, b) => a + b, 0);
const OVERLAP = 15;                       // OVERLAP_BARS in syncSymbol
const perSync = m => (OVERLAP + 1)        // overlap read (PK range)
  + (OVERLAP + 1)                          // UPSERT conflict lookups (INFERRED: D1 counts them)
  + m                                      // DAYS_REFRESH: every bar of the symbol today
  + 1;                                     // symbols upsert
const cronDay = T * sumM(perSync) + SESSION * (1 + T);   // + usageToday + trackedSymbols per run
const daysRefreshShare = T * sumM(m => m) / cronDay;
const v2Full = sumM(m => 1 + T * m);                     // v225..v247: whole board every minute
const v2Overlap = sumM(m => 1 + (m % 10 === 0 ? T * m : T * Math.min(m, OVERLAP)));  // v248
const tick = SESSION * (1 + 1 + T);                      // /tick: usageToday + self_drive_at + trackedSymbols
const viewTab = sumM(m => 3 * (1 + m));                  // /view: SYM + SPY + QQQ full day, every 60 s
const radarIncr = SESSION * (1 + T * 2);                 // production radar, since=cursor
const liveRunning = sumM(m => 4 * (1 + m));              // trader-v2-live: one symbol, every 15 s
const f = n => Math.round(n).toLocaleString('en-US').padStart(11);
console.log(`tracked symbols T = ${T}, session = ${SESSION} min, sum of m = ${sumM(m => m).toLocaleString()}\n`);
console.log('per day, rows read');
console.log(f(cronDay), ' cron sync of T symbols (DAYS_REFRESH is ' + (daysRefreshShare * 100).toFixed(0) + '% of it)');
console.log(f(v2Full), ' one V2 radar tab, full board every minute (v225-v247)');
console.log(f(v2Overlap), ' one V2 radar tab, 15-min overlap + full every 10th (v248)');
console.log(f(tick), ' /tick heartbeat from one radar tab');
console.log(f(viewTab), ' one /view tab (background tabs keep polling)');
console.log(f(radarIncr), ' one production radar tab (incremental)');
console.log(f(liveRunning), ' one trader-v2-live session running');
const scen = (label, n) => console.log(f(n), ' ' + label + '  → ' + (n / 5e6 * 100).toFixed(0) + '% of 5,000,000');
console.log('\nscenarios');
scen('cron + 1 V2 radar tab (v225-v247)', cronDay + v2Full + tick);
scen('cron + 2 V2 radar tabs (v225-v247)', cronDay + 2 * (v2Full + tick));
scen('cron + 1 V2 tab + 2 /view tabs + 1 live', cronDay + v2Full + tick + 2 * viewTab + liveRunning);
scen('cron + 2 V2 tabs (v248 overlap)', cronDay + 2 * (v2Overlap + tick));
