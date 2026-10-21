# Nightly 2026-10-21: FAIL

- archive sync with Alpaca: PASS — source: Alpaca SIP (all US exchanges), 2026-08-25..2026-10-20; minutes from Alpaca: 2034656 (+ 8944 no-trade minutes carried flat); minutes inserted: 51090; minutes with prices corrected to Alpaca: 11; minutes with volume corrected to Alpaca: 167; rows deleted (not a session minute): 0; not on Alpaca (archive untouched): none; symbols failed: 0
- archive audit: 5109 symbol-sessions, 5109 complete, 0 before the symbol's first data day (not gaps), 0 known-unfillable (in the old baseline), 0 NEW problems
- independent count check: 5109 symbol-sessions, 5109 OK, 0 before the symbol's first data day, 0 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 5109/5109
- accuracy vs Alpaca: 393 sampled symbol-days, 152636 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 0, no source 0
- main table: PASS — sessions 2026-10-12, 2026-10-13, 2026-10-14, 2026-10-15, 2026-10-16, 2026-10-19, 2026-10-20
- main table <- archive: PASS — minutes inserted: 51090; minutes corrected to the archive: 178; symbols failed: 0
- history files (R2): PASS — range: 2021-10..2026-09; files written: 0 (regular minutes 0, pre/after minutes 0, 0.0 MB); already there (skipped): 7785; symbol-months without trades (not listed yet): 75; files in the bucket: 7785, 929.4 MB; failed: 0
- database prune: PASS — cutoff: days before 2026-08-23 (keep 58 days); symbol-days deleted (identical to their history file): 1310 (510900 rows); kept because the month has no file yet: 0; kept because the file differs: 0
- pre/after-market: PASS — inserted 19347, prices corrected 6, rows in archive_ext_bars 575752
- database size: 421 MB of 500 MB (free plan)

## Failures
- database size 421 MB — over the 400 MB alarm; at 500 MB Supabase turns read-only


