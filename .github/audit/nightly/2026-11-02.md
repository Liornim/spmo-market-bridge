# Nightly 2026-11-02: FAIL

- archive sync with Alpaca: PASS — source: Alpaca SIP (all US exchanges), 2026-09-06..2026-11-01; minutes from Alpaca: 1985166 (+ 7344 no-trade minutes carried flat); minutes inserted: 0; minutes with prices corrected to Alpaca: 0; minutes with volume corrected to Alpaca: 0; rows deleted (not a session minute): 0; not on Alpaca (archive untouched): none; symbols failed: 0
- archive audit: 5109 symbol-sessions, 5109 complete, 0 before the symbol's first data day (not gaps), 0 known-unfillable (in the old baseline), 0 NEW problems
- independent count check: 5109 symbol-sessions, 5109 OK, 0 before the symbol's first data day, 0 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 5109/5109
- accuracy vs Alpaca: 393 sampled symbol-days, 152730 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 0, no source 0
- main table: PASS — sessions 2026-10-22, 2026-10-23, 2026-10-26, 2026-10-27, 2026-10-28, 2026-10-29, 2026-10-30
- main table <- archive: PASS — minutes inserted: 0; minutes corrected to the archive: 0; symbols failed: 0
- history files (R2): PASS — range: 2021-11..2026-10; files written: 131 (regular minutes 1123980, pre/after minutes 432997, 19.1 MB); already there (skipped): 7658; symbol-months without trades (not listed yet): 71; files in the bucket: 7916, 948.5 MB; failed: 0
- database prune: PASS — cutoff: days before 2026-09-04 (keep 58 days); symbol-days deleted (identical to their history file): 131 (51090 rows); kept because the month has no file yet: 0; kept because the file differs: 0
- pre/after-market: PASS — inserted 0, prices corrected 0, rows in archive_ext_bars 740125
- database size: 438 MB of 500 MB (free plan)

## Failures
- database size 438 MB — over the 400 MB alarm; at 500 MB Supabase turns read-only


