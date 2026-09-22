# V2 RECOVERY

Recovery is server-driven. Nothing waits for a human to open a page.

## What is detected

| condition | how | where |
|---|---|---|
| missing entire day | `scanGaps` finds `present = 0` for a session date | `sweep()` nightly, `/v2/gaps` on demand |
| truncated session | present > 0 but the tail of the 390 labels is missing | same |
| internal gaps | any missing label between 09:30 and 15:59 | same |
| stale symbol | `/v2/status` per symbol: `stale_seconds` versus `expected_latest` | continuous |
| failed job | `jobs_v2.state = 'failed'` after 5 bounded attempts | `/v2/status`, `/v2/accounting` |

## How repair is scheduled

`sweep()` costs **zero external requests** — it reads only what V2 already
stored. For each symbol-day with gaps it enqueues one `backfill` job
(`priority 3`, ahead of routine live refreshes at priority 5). Those jobs are
claimed by the ordinary `tick()` under the ordinary budget, so recovery can
never itself exhaust the invocation.

A repair is one provider request for a 5-day range, filtered to the target date
before writing.

## Triggers

| trigger | effect |
|---|---|
| cron `7 2 * * *` | sweep of the previous session for every active symbol |
| `GET /v2/sweep?date=YYYY-MM-DD` | same, on demand (API key) |
| `GET /v2/recover/SYM?date=YYYY-MM-DD` | queue one repair (API key) |
| `GET /v2/gaps?date=&symbols=` | read-only report |

## Guarantees

- A missed symbol becomes eligible automatically: its job keeps an old `due_at`
  and is claimed first next execution.
- Repairs are idempotent: candles already correct are counted as `unchanged`.
- Repairs are bounded: one request per symbol-day, retried at most 5 times with
  exponential backoff, then parked and visible.
- No browser involvement anywhere in this path.

## Verified

`v2_test.mjs` §8: ten minutes are deleted from a stored session, the gap scan
finds them, the sweep queues exactly one repair, the next tick refills the hole,
and the run stays inside its budget.
