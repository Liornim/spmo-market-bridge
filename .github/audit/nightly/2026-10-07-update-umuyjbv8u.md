# Update 2026-10-07 23:04: FAIL

request: umuyjbv8u · symbols: BITX · days back: 30

- symbols: requested 1; already in the archive 0; REGISTERED: BITX; REJECTED: none
- archive sync with Yahoo: PASS — junk rows deleted: 0; minutes inserted: 8580; minutes with prices corrected to Yahoo: 0; minutes with volume revised: 0; real volumes kept where Yahoo reports 0: 0; symbols failed: 0
- archive audit: 30 symbol-sessions, 22 complete, 8 before the symbol's first data day (not gaps), 0 known-unfillable (older than Yahoo's 30 days), 0 NEW problems
- independent count check: 30 symbol-sessions, 22 OK, 8 before the symbol's first data day, 0 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 30/30
- accuracy vs Yahoo: 20 sampled symbol-days, 7789 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 6, no source 0
- main table: FAIL — sessions 2026-09-29, 2026-09-30, 2026-10-01, 2026-10-02, 2026-10-05, 2026-10-06, 2026-10-07

## Failures
- main table check: FAIL (see bars_trim.log)

## Warnings
- accuracy: 6 volume mismatches (Yahoo revises recent volumes)
