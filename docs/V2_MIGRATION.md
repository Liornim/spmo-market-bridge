# V2 MIGRATION / BOOTSTRAP

Goal: populate V2 from the best data that already exists, **without asking the
provider for candles somebody already paid for**.

## Source priority

1. **Legacy D1 `bars`** — free: a binding call, no external request. Filtered to
   canonical rows (`unix % 60 = 0`, `09:30 ≤ time ≤ 15:59`), so the duplicate
   minutes and 16:00 rows the audit found are dropped on the way in.
2. **Supabase `archive_bars`** — costs external requests, so it is a separate,
   budgeted call. It holds days that legacy D1 lost: measured on 2026-09-22,
   HD had 234 rows in D1 and 6,086 in the archive.
3. **Provider backfill** — only for ranges neither store has. Queued as normal
   `backfill` jobs.

## Tools

| route | what it does |
|---|---|
| `GET /v2/bootstrap?symbols=&from=&to=` | preview: rows available in legacy D1, gaps that would remain |
| `GET /v2/bootstrap?...&apply=1` | copies legacy D1 rows, then queues provider backfills for days still incomplete |
| `GET /v2/copy/from-d1?symbols=&from=&to=[&apply=1]` | just the D1 copy |
| `GET /v2/copy/from-archive?symbols=&from=&to=[&apply=1][&budget=N]` | archive copy, budget-aware, stops cleanly instead of overrunning |
| `POST /v2/import[?apply=1&source=...]` | CSV import, preview by default |

All of them are **read-only against legacy**. None writes to `bars`, `days`,
`symbols`, `archive_bars` or the mirror.

## Report

Every tool returns counts, never a silent success:
`inserted`, `updated`, `unchanged`, `rejected`, plus `remaining_gaps` for
bootstrap and `budget: {used, max}` for the archive copy.

## Suggested order for a real migration

```
1. /v2/symbols/add/<the tracked list>        (tier=live for SPY,QQQ,SMH,…)
2. /v2/bootstrap?apply=1                     (free, from legacy D1)
3. /v2/copy/from-archive?apply=1&budget=40   (repeat; it resumes safely)
4. /v2/gaps                                  (see what is still missing)
5. let the cron fill the rest through queued backfills
```

Steps 2–4 are safe to repeat: deduplication is `(symbol, unix)` and repeated
rows are reported as `unchanged`.

## Import correctness note

V2's CSV parser reads columns **by name from the header**. The legacy replay
importer reads by position, which silently shifts every price column when given
an `/export` file (LOCALLY VERIFIED in the audit). V2 accepts the app's own
export formats correctly and rejects non-canonical rows with a reason.
