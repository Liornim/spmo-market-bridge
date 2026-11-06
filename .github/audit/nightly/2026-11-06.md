# Nightly 2026-11-06: FAIL

- archive sync with Alpaca: PASS — source: Alpaca SIP (all US exchanges), 2026-09-10..2026-11-05; minutes from Alpaca: 2087524 (+ 7166 no-trade minutes carried flat); minutes inserted: 51090; minutes with prices corrected to Alpaca: 4; minutes with volume corrected to Alpaca: 173; rows deleted (not a session minute): 0; not on Alpaca (archive untouched): none; symbols failed: 0
- archive audit: 5240 symbol-sessions, 5240 complete, 0 before the symbol's first data day (not gaps), 0 known-unfillable (in the old baseline), 0 NEW problems
- independent count check: 5240 symbol-sessions, 5240 OK, 0 before the symbol's first data day, 0 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 5240/5240
- accuracy vs Alpaca: 393 sampled symbol-days, 152757 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 0, no source 0
- main table: PASS — sessions 2026-10-28, 2026-10-29, 2026-10-30, 2026-11-02, 2026-11-03, 2026-11-04, 2026-11-05
- main table <- archive: PASS — minutes inserted: 51090; minutes corrected to the archive: 177; symbols failed: 0
- history files (R2): PASS — range: 2021-11..2026-10; files written: 0 (regular minutes 0, pre/after minutes 0, 0.0 MB); already there (skipped): 7789; symbol-months without trades (not listed yet): 71; files in the bucket: 7916, 948.5 MB; failed: 0
- database prune: PASS — cutoff: days before 2026-09-08 (keep 58 days); symbol-days deleted (identical to their history file): 0 (0 rows); kept because the month has no file yet: 0; kept because the file differs: 0
- pre/after-market: PASS — inserted 26690, prices corrected 6, rows in archive_ext_bars 837087
- database size: 446 MB of 500 MB (free plan)

## Failures
- database size 446 MB — over the 400 MB alarm; at 500 MB Supabase turns read-only


