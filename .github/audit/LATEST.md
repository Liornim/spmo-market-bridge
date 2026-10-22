# Nightly 2026-10-22: FAIL

- archive sync with Alpaca: PASS — source: Alpaca SIP (all US exchanges), 2026-08-26..2026-10-21; minutes from Alpaca: 2034904 (+ 8696 no-trade minutes carried flat); minutes inserted: 51090; minutes with prices corrected to Alpaca: 6; minutes with volume corrected to Alpaca: 194; rows deleted (not a session minute): 0; not on Alpaca (archive untouched): none; symbols failed: 0
- archive audit: 5109 symbol-sessions, 5109 complete, 0 before the symbol's first data day (not gaps), 0 known-unfillable (in the old baseline), 0 NEW problems
- independent count check: 5109 symbol-sessions, 5109 OK, 0 before the symbol's first data day, 0 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 5109/5109
- accuracy vs Alpaca: 393 sampled symbol-days, 152646 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 0, no source 0
- main table: PASS — sessions 2026-10-13, 2026-10-14, 2026-10-15, 2026-10-16, 2026-10-19, 2026-10-20, 2026-10-21
- main table <- archive: PASS — minutes inserted: 51090; minutes corrected to the archive: 200; symbols failed: 0
- history files (R2): PASS — range: 2021-10..2026-09; files written: 0 (regular minutes 0, pre/after minutes 0, 0.0 MB); already there (skipped): 7785; symbol-months without trades (not listed yet): 75; files in the bucket: 7785, 929.4 MB; failed: 0
- database prune: PASS — cutoff: days before 2026-08-24 (keep 58 days); symbol-days deleted (identical to their history file): 0 (0 rows); kept because the month has no file yet: 0; kept because the file differs: 0
- pre/after-market: PASS — inserted 19537, prices corrected 48, rows in archive_ext_bars 596064
- database size: 423 MB of 500 MB (free plan)

## Failures
- database size 423 MB — over the 400 MB alarm; at 500 MB Supabase turns read-only


