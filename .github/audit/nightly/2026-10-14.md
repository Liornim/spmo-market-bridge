# Nightly 2026-10-14: FAIL

- archive sync with Alpaca: PASS — source: Alpaca SIP (all US exchanges), 2026-08-18..2026-10-13; minutes from Alpaca: 2034041 (+ 9559 no-trade minutes carried flat); minutes inserted: 51090; minutes with prices corrected to Alpaca: 2; minutes with volume corrected to Alpaca: 158; rows deleted (not a session minute): 0; not on Alpaca (archive untouched): none; symbols failed: 0
- archive audit: 5109 symbol-sessions, 5109 complete, 0 before the symbol's first data day (not gaps), 0 known-unfillable (in the old baseline), 0 NEW problems
- independent count check: 5109 symbol-sessions, 5109 OK, 0 before the symbol's first data day, 0 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 5109/5109
- accuracy vs Alpaca: 393 sampled symbol-days, 152563 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 0, no source 0
- main table: PASS — sessions 2026-10-05, 2026-10-06, 2026-10-07, 2026-10-08, 2026-10-09, 2026-10-12, 2026-10-13
- main table <- archive: PASS — minutes inserted: 27510; minutes corrected to the archive: 23542; symbols failed: 0
- history files (R2): PASS — range: 2021-10..2026-09; files written: 0 (regular minutes 0, pre/after minutes 0, 0.0 MB); already there (skipped): 7785; symbol-months without trades (not listed yet): 75; files in the bucket: 7785, 929.4 MB; failed: 0
- database prune: did not finish — 
- pre/after-market: PASS — inserted 20113, prices corrected 13, rows in archive_ext_bars 475953
- database size: 399 MB of 500 MB (free plan)

## Failures
- database prune: did not finish (see db_prune.log)

## Warnings
- database size 399 MB — approaching the 400 MB alarm
