# Update 2026-10-07 11:58: FAIL

request: umuxv1z24 · symbols: SOFI · days back: 30

- symbols: requested 1; already in the archive 0; REGISTERED: none; REJECTED: SOFI (archive insert HTTP 400)
- archive sync with Yahoo: PASS — junk rows deleted: 0; minutes inserted: 0; minutes with prices corrected to Yahoo: 0; minutes with volume revised: 0; real volumes kept where Yahoo reports 0: 0; symbols failed: 0
- archive audit: 3741 symbol-sessions, 3437 complete, 239 before the symbol's first data day (not gaps), 65 known-unfillable (older than Yahoo's 30 days), 0 NEW problems
- independent count check: 3741 symbol-sessions, 3437 OK, 239 before the symbol's first data day, 65 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 3741/3741
- accuracy vs Yahoo: 387 sampled symbol-days, 140822 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 269, no source 24
- main table: PASS — sessions 2026-09-28, 2026-09-29, 2026-09-30, 2026-10-01, 2026-10-02, 2026-10-05, 2026-10-06

## Failures
- symbol registration: requested 1; already in the archive 0; REGISTERED: none; REJECTED: SOFI (archive insert HTTP 400)

## Warnings
- accuracy: 269 volume mismatches (Yahoo revises recent volumes)
