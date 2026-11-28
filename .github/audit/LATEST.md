# Nightly 2026-11-28: FAIL

- archive sync with Alpaca: no verdict — 
- main table: no verdict
- pre/after-market: did not run
- database size: unknown (the db_size() function is missing in Supabase)

## Failures
- SUPABASE BLOCKED — the free plan monthly egress quota is used up (HTTP 402 exceed_egress_quota). Nothing could be read or written. Fix: wait for the next billing cycle or upgrade in the Supabase dashboard (Usage page shows the cycle date).
- archive_audit.csv missing — the audit did not run
- qa_count.csv missing — the independent count check did not run
- qa_accuracy.csv missing — the accuracy check did not run
- archive sync: did not run (see archive_sync.log)
- main table check: did not run (see bars_trim.log)


