# V2 ARCHITECTURE

Designed from the failure, not from the existing code. The legacy system is
untouched and still serves every existing screen.

## The problem being designed away

One scheduled invocation walked the whole tracked universe alphabetically and
spent one external request per symbol, plus ~30 on an archive walk that shared
the same invocation. The per-invocation external-request ceiling (50) was
reached mid-list, so symbols after the cut never ran — permanently, because the
next minute restarted at AAPL. Proven in `docs/CUTOFF_PROOF.md`.

**The design rule that follows: the number of tracked symbols must not be
coupled to the request budget of a single invocation.**

## Shape

```
cron "* 12-22 * * *"  ──►  tick()            budget = V2_BUDGET (40), reserve 4
                             │
                             ├─ claim ≤ 36 jobs, oldest due first
                             ├─ per job: ONE provider request
                             │     └─ normalise once → write once (bars_v2)
                             └─ reschedule each job at now + interval
cron "7 2 * * *"      ──►  sweep()           gap scan (no external requests)
                             └─ queue bounded backfill jobs
HTTP /v2/*            ──►  status · export · import · copy · bootstrap · recover
```

Every execution knows its maximum work **before it starts**: it claims at most
`budget − reserve` jobs and each job is priced at one request. It cannot reach
the platform ceiling, so it never dies mid-symbol.

## Bounded work, not a loop over the universe

| tracked symbols | executions per full cycle | requests in any one execution |
|---|---|---|
| 27 | 1 | 27 |
| 50 | 2 | 36 |
| 118 | 4 | 36 |
| 200 | 6 | 36 |
| 500 | 14 | 36 |

(Measured by `v2_test.mjs`, section 12.) Cycle length is
`ceil(N / (budget − reserve))` executions. With a one-minute trigger, 118
symbols refresh every 4 minutes and 500 every 14 — the cadence degrades
gracefully with size instead of the tail starving. Raising `V2_BUDGET` (a paid
plan lifts the ceiling to 1,000) shortens the cycle without any code change.

## Fair scheduling

`jobs_v2` holds one row per (kind, symbol). Jobs are claimed
`ORDER BY priority, due_at, symbol` — **oldest due first**. A symbol skipped
because the budget ran out keeps its original due time and is therefore first in
the next execution. Alphabetical order is only the final tie-break, so it can
never decide who gets served. Verified: after a mid-run stop, the next run
serves a disjoint set (test 5), and every symbol of 500 is served within a cycle
(test 12).

## One fetch, many uses

`fetchProvider()` is the only place that calls the provider. Its normalised
output is the single input for every downstream write. There is no second fetch
for an archive, a mirror or a verification copy. Range selection happens once
per job: `1d` when the symbol has recent data, `5d` when it is cold or being
repaired.

## Storage decision — canonical store is D1 `bars_v2`

| criterion | D1 | Supabase |
|---|---|---|
| cost per access | internal binding, does **not** consume the external-request budget | one external request per page — the exact resource that broke legacy |
| bulk write | `batch()` of 100 statements, one binding call | 1,000-row POST, one external request each |
| query speed for a day of one symbol | indexed, single-digit ms | network round trip |
| read quota headroom | 5M rows/day, measured use 0.1% | Supabase plan limits + subrequest cost |
| export | direct SQL → CSV | needs paging |
| recovery | same store, same transaction semantics | cross-store reconciliation |

**D1 wins on the one axis that caused the outage.** Supabase is *not* a V2
dependency; it remains reachable only through the explicit
`/v2/copy/from-archive` tool, which is budgeted like any other external work.

**No mirror.** The legacy mirror table has one writer and three diagnostic
readers and no production consumer (`docs/EXECUTION_ORDER_AND_STORES.md`).
V2 creates no second copy until a real consumer and failure model exist.

## Incremental writes

For each symbol, `symbols_v2.last_bar_unix` states what is already stored.
The write window is `[last_bar_unix − REVISION_WINDOW, ∞)`; everything older in
the payload is discarded before any comparison. Each candidate is compared with
what is stored and classified **inserted / revised / unchanged / rejected**, and
those four counters are recorded per run in `runs_v2`. Write amplification is a
metric, not a guess.

## Revision window — 30 minutes, from evidence

Production rows fetched from the live system (`/mirror/read/SPY/2026-09-17`)
show `updated_at − first_seen` up to **1,026 seconds (~17 minutes)** with
`revisions` of 1–2. A 30-minute window covers the observed maximum with margin,
against the legacy behaviour of re-sending five days on every pass.

## Failure isolation and retries

Each job has its own `try/catch`. A failure records the message on the job,
increments `attempts`, and pushes `due_at` out by `min(60·2^attempts, 1800)`
seconds. At 5 attempts the job is parked as `failed` and shown in `/v2/status`.
There is no recursive retry: one job, one request, per execution.

## Idempotency

Re-running any operation is safe. Ingestion compares before writing; import and
copy deduplicate on `(symbol, unix)`; a duplicate scheduled invocation claims no
jobs because the first run already pushed their due times out (test 13).

## ETFs are first-class

`symbols_v2` has no notion of a "context symbol". SPY, QQQ, SMH and the sector
ETFs are tracked rows with the same scheduling as everything else, so their
collection is server-driven. Nothing depends on a browser tab being open.

## Isolation from legacy

- separate tables: `bars_v2`, `symbols_v2`, `jobs_v2`, `runs_v2`, `meta_v2`
- separate routes: everything under `/v2/*`, mounted before the legacy preamble
- separate triggers: `* 12-22 * * *` and `7 2 * * *`, intercepted at the top of
  `scheduled()` so legacy cron behaviour — including its event log — is unchanged
- separate accounting: `runs_v2` and `/v2/accounting`
- legacy tables are read only by `/v2/copy/from-d1` and `/v2/bootstrap`, never written
