// Quantitative model of reads/writes per path. CODE-DERIVED: every constant
// below is taken from worker.js or the pages; nothing here is measured in
// production. Run: node docs/audit/cost_tables.mjs
const S = 27;              // tracked symbols (MEASURED: 27 rows in the published days state)
const M = 390;             // session minutes
const SUMM = M * (M + 1) / 2;   // 76,245 — cost of re-reading a growing day once per minute
const READ_LIMIT = 5e6, KV_WRITE_LIMIT = 1000;
const pct = n => (n / READ_LIMIT * 100).toFixed(1) + '%';
const fmt = n => Math.round(n).toLocaleString();

// ---------- D1: rows_read per session, by path
const paths = [
  ['cron DAYS_REFRESH (recount of the whole symbol-day, every sync)', 'cron', M * S, SUMM / M, SUMM * S],
  ['cron bars re-read for the mirror queue (15-min overlap)', 'cron', M * S, 15, M * S * 15],
  ['V2 radar tab, overlap 15 min + full every 10th (v248)', 'radar', M, S * 15 * 0.9 + S * M * 0.1, M * (S * 15 * 0.9 + S * M * 0.1)],
  ['V2 radar tab, pre-v248 full read every minute', 'radar', M, S * M / 2, M * S * M / 2],
  ['trader-v2-live, full /day every 15 s, one symbol', 'trader', M * 4, M / 2, M * 4 * M / 2],
  ['/view tab: 4 full /day per minute', 'ui', M * 4, M / 2, M * 4 * M / 2],
  ['production radar tab, incremental /board', 'radar', M, S * 2, M * S * 2],
  ['/day full read on card open (per symbol, ≤5 prior days)', 'ui', 5, M, 5 * M],
  ['repairFromOpen: ≤8 full /day per refresh cycle', 'repair', 8, M, 8 * M],
  ['/tick heartbeat (usage row only)', 'radar', M, 1, M],
  ['/usage per radar refresh', 'coverage', M, 21, M * 21],
  ['/storage full table scan (one call)', 'coverage', 1, 123854, 123854],
  ['/bars/daily over 17 days, 27 symbols (two passes)', 'export', 1, 2 * S * 17 * M, 2 * S * 17 * M],
  ['/bars/export whole history, one symbol', 'export', 1, 17 * M, 17 * M],
  ['/audit recompute (25 symbols sampled)', 'coverage', 1, 25 * M, 25 * M],
];
console.log('\n=== D1 rows_read per trading session (model) ===');
console.log('path'.padEnd(62), 'group'.padEnd(9), 'calls'.padStart(7), 'rows/call'.padStart(10), 'rows/session'.padStart(13), '%5M'.padStart(7));
for (const [n, g, c, rc, tot] of [...paths].sort((a, b) => b[4] - a[4]))
  console.log(n.padEnd(62), g.padEnd(9), fmt(c).padStart(7), fmt(rc).padStart(10), fmt(tot).padStart(13), pct(tot).padStart(7));

// ---------- one browser tab
console.log('\n=== one browser tab: requests / D1 rows / KV ops per hour ===');
const tabs = [
  // name, refresh seconds (default, fastest), requests per refresh, D1 rows per refresh, provider calls per refresh
  ['/view', 60, 60, 4, 4 * M / 2, 0],
  ['production radar', 60, 3, 4 + 1, S * 2 + 21, 0],
  ['V2 radar', 60, 3, 4 + 1, S * 15 * 0.9 + S * M * 0.1 + 21, 0],
  ['trader-v2-live', 15, 15, 2, M / 2 + S, 0],
  ['scan', 300, 300, 3 + S / 40, S * M / 2, 0],
];
console.log('tab'.padEnd(18), 'refresh'.padStart(8), 'req/h'.padStart(7), 'D1 rows/h'.padStart(11), 'KV ops/h (warn tier)'.padStart(21));
for (const [n, def, fast, req, rows] of tabs) {
  for (const [label, sec] of [['default ' + def + 's', def], ['fastest ' + fast + 's', fast]]) {
    const per = 3600 / sec;
    const kv = per * req;          // budget_warn: 1 get + 1 put per request at tier warn
    console.log(n.padEnd(18), label.padStart(8), fmt(per * req).padStart(7), fmt(per * rows).padStart(11), (fmt(kv) + ' get+put').padStart(21));
    if (def === fast) break;
  }
}

// ---------- tabs × session
console.log('\n=== D1 rows per full session, by number of open tabs ===');
const sessionRows = { '/view': 4 * M * M / 2, 'production radar': M * (S * 2 + 21), 'V2 radar': M * (S * 15 * 0.9 + S * M * 0.1 + 21), 'trader-v2-live': M * 4 * M / 2 };
const cron = SUMM * S + M * S * 15;
for (const k of [1, 3, 5]) {
  const mix = Object.values(sessionRows).reduce((a, b) => a + b, 0) / Object.keys(sessionRows).length * k;
  console.log(`${k} tab(s) (average tab) + cron:`.padEnd(34), fmt(cron + mix).padStart(12), pct(cron + mix).padStart(7));
}
console.log('cron alone:'.padEnd(34), fmt(cron).padStart(12), pct(cron).padStart(7));

// ---------- KV
console.log('\n=== KV operations per day (model) ===');
const cronRuns = 540, sessionRuns = M, closedRuns = cronRuns - sessionRuns;
const kv = [
  ['cron_fired (every run)', 'cron', cronRuns, cronRuns],
  ['cron_skipped_closed (runs outside the session)', 'cron', closedRuns, closedRuns],
  ['cron_skipped (runs at write tier frugal)', 'cron', 0, 0],
  ['board_full_read (per full /board, per tab)', 'tab', M / 10, M / 10],
  ['budget_warn (every request once tier=warn)', 'tab', M * 5, M * 5],
  ['snapshotPut BOARD (≤1 per 15 min per isolate)', 'cron/tab', M / 15, M / 15],
  ['snapshotPut per symbol-day', 'tab', S * M / 15, S * M / 15],
  ['readLog on /db (7 gets)', 'tab', 7, 0],
  ['publish/archive events (nightly)', 'cron', 8, 8],
  ['watch add/remove, self_drive, expensive_request', 'tab', 5, 5],
];
console.log('source'.padEnd(50), 'who'.padEnd(9), 'gets/day'.padStart(9), 'puts/day'.padStart(9));
for (const [n, w, g, p] of [...kv].sort((a, b) => b[3] - a[3])) console.log(n.padEnd(50), w.padEnd(9), fmt(g).padStart(9), fmt(p).padStart(9));
const cronPuts = cronRuns + closedRuns;
console.log('\ncron alone, puts/day:', fmt(cronPuts), '| KV free write limit:', fmt(KV_WRITE_LIMIT),
  cronPuts > KV_WRITE_LIMIT ? '→ OVER the limit before any browser traffic' : '');
