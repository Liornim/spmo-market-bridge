# AUDIT LOG

Labels: MEASURED · LOCALLY VERIFIED · CODE-DERIVED · INFERRED · NOT VERIFIED IN PRODUCTION

| # | Action | Files | Command | Result / discovery | Next |
|---|---|---|---|---|---|
| 1 | Record state | repo | `git rev-parse HEAD` | HEAD e136e819, VERSION 248, clean tree (MEASURED) | tag |
| 2 | Checkpoint | repo | `git tag audit-checkpoint-v248` | pushed (MEASURED) | config |
| 3 | Reachability | — | `curl` workers.dev / api.cloudflare.com | 403 `host_not_allowed` from shell (MEASURED). The fetch tool reached `/view/AAPL/2026-09-21` once but only opens URLs already present in the conversation, so it cannot be used to explore. Production numbers are NOT VERIFIED IN PRODUCTION. | inventory |
| 4 | Deploy config | wrangler.toml | read | 1 Worker `spmo-market-bridge`, main worker.js; D1 `DB`→`bars-vault`; KV `LOG`; crons `* 13-21 * * *` and `*/5 0-1 * * *`; observability on (CODE-DERIVED) | env |
| 5 | Secret NAMES | worker.js | grep `env.X` | DB, LOG, SUPABASE_URL, SUPABASE_KEY, GH_REPO, GH_TOKEN, API_KEY, RATE_PER_MIN, SYMBOLS, SELF_DRIVE (CODE-DERIVED; values never read) | routes |
| 6 | Routes | worker.js | grep `route ===` | 35 route heads + page routes via `p0[0]` (scan, data, db) (CODE-DERIVED) | schema |
| 7 | Schema | worker.js SCHEMA | grep CREATE | 9 tables; ONE secondary index `bars_symbol_date_unix (symbol,date,unix)`; bars PK (symbol,unix) (CODE-DERIVED) | meter |
| 8 | Metering | worker.js `metered`,`count`,`tallyRoute`,`flushUsage` | read | Worker meters its own D1 rows from `meta.rows_read`. Totals are per-isolate in memory, flushed ≤1/min; an evicted isolate loses its unflushed tally; route tallies drop requests <50 rows. **Internal meter can only UNDER-count the account** (INFERRED from code) | cron |
| 9 | Cron | `scheduledRun` | read | **Cron stands down entirely at write tier `frugal` (75%)** — contradicts `selfDriveIfStale` ("only frozen stops collection"). This is the cause of tracked symbols freezing mid-session (NVDA 13:23). Cron's D1 writer pulls Yahoo `1d`, the feed known to drop minutes; the archive pulls `5d` (CODE-DERIVED) | KV |
| 10 | KV | worker.js | grep `LOG.` | 5 call sites, 2 key families: `log:<utc-date>` (logEvent get+put, readLog get), `snap:<SYM>:<et-date>` (snapshotPut/Get). All caps are per isolate, not account-wide (CODE-DERIVED) | pages |
| 11 | Preamble | fetch handler | read | every request: `usageToday` (1 D1 read); in overall tier `warn` every request also runs `logEvent` → 1 KV read (CODE-DERIVED) | frontend |
| 12 | Frontend polling | *.html | grep timers | view.html reloads `/day/SYM/DATE` every 60 s with NO `document.hidden` check; trader-v2-radar polls board at `#every` (default 60 s, skips when hidden) AND sends `/tick` every 60 s with NO hidden check; trader-v2-live polls every 15 s (CODE-DERIVED) | SQL |
