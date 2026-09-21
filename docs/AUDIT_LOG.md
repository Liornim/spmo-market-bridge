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
| 13 | SQL inventory | worker.js | /tmp/sqlinv.mjs + grep `FROM bars` | 101 `prepare()` sites (63 reads, 28 writes, 10 DDL/const). 24 statements read `bars` (CODE-DERIVED) | EQP |
| 14 | EXPLAIN QUERY PLAN | production bars schema, 1,014,000 rows (130×20×390) | node:sqlite | every per-request bars read is `SEARCH ... USING INDEX`. Full scans only in `/storage` (whole table per call) and the one-time `days` backfill in ensureSchema (LOCALLY VERIFIED) | cost model |
| 15 | Hidden read cost | `DAYS_REFRESH` | EQP | returns 1 row but scans every bar of that symbol today; runs on every sync that stored a bar (every minute per tracked symbol) (LOCALLY VERIFIED plan, CODE-DERIVED frequency) | cost model |
| 16 | Frontend | view.html load() | read | each /view tab re-reads full day for SYM + SPY + QQQ every 60 s, background tabs included; each /day on today may run syncSymbol (CODE-DERIVED) | cost model |
| 17 | Published prod state | data branch `data/state/*.json` | curl raw.githubusercontent | usage.json generated 2026-09-21 08:36Z: 5,247 reads, 5 writes, tier normal — pre-session, Worker labels it "lower bound" (MEASURED) | log |
| 18 | Published prod log | `data/state/log.json` | python | 330 entries 2026-09-20 15:41 → 2026-09-21 01:45Z: cron_fired 163, cron_skipped_closed 150, publish_failed 6, archive_pass 7 (MEASURED) | KV cause |
| 19 | **KV root cause** | `logEvent`, `scheduledRun` | code + log | fold rule only matches the immediately previous entry; cron writes `cron_fired` then `cron_skipped_*` alternately, so nothing folds: 2 KV gets + 2 puts per cron minute. 540 cron minutes/day → up to 1,080 puts, above the 1,000/day free limit by itself on a closed day; on a session day, once D1 write tier hits `frugal` the cron stands down each minute and the same doubling runs all afternoon (MEASURED pattern, CODE-DERIVED arithmetic) | D1 model |
| 20 | **Publish failing** | nightly publish | log | `publish_failed: Too many subrequests by single Worker invocation` ×6 on 2026-09-21 00:05–00:30Z; one `publish_shard` (4 symbols) at 00:01 (MEASURED). The GitHub archive is the only channel the sandbox/Trader 3 can read | publish code |
