# CHANGELOG — AUDIT FIXES

Checkpoint: tag `audit-checkpoint-v248`. Frozen engine hashes verified after
every fix: trader-v2-engine 496bd9b5a8a4936f · replay 69468cc604a44a41 ·
engine cf0537b3131c25ab · layers 6c87104345566e54.

## v249–v250

### F-DATA-1 (P1) — one canonical row per minute
- **BEFORE:** storage key was the provider timestamp. A mid-minute timestamp
  with null prices became a second, flat, volume-0 row for that minute; Yahoo's
  16:00 closing stamp became a 391st candle. MEASURED in the published archive
  (BLK up to 5 duplicate minutes/day; 16:00 row on most days for 5 symbols).
- **CHANGE:** `isSessionMinute(unix)` in worker.js — `unix % 60 == 0` and ET
  minute in 09:30–15:59 (one formatter call per UTC hour). `fetchYahoo` skips
  anything else *before* the null-price branch, so no synthetic bar can come
  from a non-canonical stamp. `CANON_SQL` (same predicate) added to every
  consumer-facing read of `bars`: `/day` (both forms), `/board`, `/bars/last`,
  `/bars/export`, `/bars/daily`, `/export`, archive fill, mirror, and
  `DAYS_REFRESH`; `archiveRead` filters Supabase rows the same way. `/diag`
  stays raw on purpose. **No row is deleted.**
- **TEST:** `consistency_test.mjs` (in `npm test`): 0/11 at the checkpoint →
  11/11. Every path returns 390 rows, 390 minutes, COMPLETE, 0 mismatches.
  Index plans re-checked: all still `SEARCH … USING INDEX`.
- **AFTER:** every path serves exactly the 390 canonical minutes.
- **ROLLBACK:** `git revert` the commit; stored data is unchanged, so the old
  rows reappear exactly as before.
- **Known limit:** rows already in the Supabase archive and the published CSVs
  stay as they are until re-published; readers of the CSV (t3/) should apply
  `docs/audit/completeness.mjs`.

### F-D1-2 (P2) — `/bars/last` no longer depends on the planner
- **BEFORE:** `ORDER BY date DESC, unix DESC LIMIT n`. When SQLite picks the
  primary key it sorts the symbol's whole history: 2,730 rows visited for n=5
  over 7 days (LOCALLY VERIFIED). On the 1M-row replica the planner picked the
  other index and visited ~n rows. Which one D1 picks: NOT VERIFIED IN PRODUCTION.
- **CHANGE:** `ORDER BY unix DESC LIMIT n` (date is a function of unix; same result).
- **TEST:** plan is `SEARCH … (symbol=? AND unix<?)` with no temp sort on both
  the small table and the 1M replica; 5 rows visited. Two stale source-text
  assertions and a fixture with non-minute labels updated in test.mjs.
- **ROLLBACK:** revert the one line.

### F-DATA-2 (P1) — the Trader's gap check cannot be switched off by data
- **BEFORE:** `v2FindGap` returned "no gap" whenever any row was before 09:30
  or after 15:59, so the 16:00 row disabled gap detection for the whole day.
- **CHANGE:** the check considers only 09:30–15:59 rows (trader-v2-radar.html,
  page code; engine untouched).
- **TEST:** radar_v2_test runs the page's real `v2FindGap`: late start → no
  gap; a 14:51 hole is found with a 16:00 row appended and with a 09:29 row
  prepended. The last two FAIL on the checkpoint code (LOCALLY VERIFIED).
- **ROLLBACK:** revert the function.

### F-TRD-1 (P1 diagnostic) — Trader freshness is visible
- **CHANGE:** the V2 copy report gains DATA FRESHNESS: DATA_AS_OF,
  LATEST_BAR, DROPPED_NEWEST, BAR_AGE, SOURCE, FRESHNESS, CANDLE_COUNT,
  GAP_COUNT, DUPLICATE_COUNT, DAY_COMPLETE, MARKET_CONTEXT_AS_OF. Text only;
  nothing feeds the engine.
- **NOT CHANGED (needs an explicit decision):** T-1, both Trader pages drop
  the newest stored row as "forming" although the server stores closed
  minutes only — decisions run one closed candle late. DROPPED_NEWEST now
  shows it on every report.
