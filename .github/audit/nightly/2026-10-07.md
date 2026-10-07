# Nightly 2026-10-07: PASS

- archive sync with Yahoo: PASS — junk rows deleted: 0; minutes inserted: 0; minutes with prices corrected to Yahoo: 59496; minutes with volume revised: 85783; real volumes kept where Yahoo reports 0: 6; symbols failed: 0
- archive audit: 3741 symbol-sessions, 3437 complete, 304 known-unfillable (older than Yahoo's 30 days), 0 NEW problems
- independent count check: 3741 symbol-sessions, 3437 OK, 304 known-unfillable, 0 NEW problems
- audit vs count-check agreement: 3741/3741
- accuracy vs Yahoo: 387 sampled symbol-days, 150179 minutes compared — missing 0, extra 0, price mismatches 0, volume mismatches 273, no source 0
- main table: PASS — sessions 2026-09-28, 2026-09-29, 2026-09-30, 2026-10-01, 2026-10-02, 2026-10-05, 2026-10-06



## Warnings
- accuracy: 273 volume mismatches (Yahoo revises recent volumes)
