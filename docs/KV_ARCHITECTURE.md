# KV ARCHITECTURE

One namespace, binding `LOG` (`49f201f3…`). Free tier: 100,000 reads and
**1,000 writes** per day (Cloudflare published limits; NOT VERIFIED IN
PRODUCTION for this account).

## Every KV operation (CODE-DERIVED, worker.js)
| Line | Function | Op | Key | TTL | Purpose | Caller / frequency |
|---|---|---|---|---|---|---|
| 332 | `logEvent` | get | `log:<UTC date>` | — | read today's event list before appending | every logged event |
| 351 | `logEvent` | put | `log:<UTC date>` | 30 d | append event (list trimmed to 300) | every event not folded |
| 387 | `snapshotPut` | put | `snap:<SYM or BOARD>:<ET date>` | 3 d | last good payload, fallback when D1 is frozen/fails | full `/board` (key BOARD) and full `/day` for today while open; ≥15 min per key **per isolate** |
| 392 | `snapshotGet` | get | `snap:…` | — | serve fallback | only when read tier frozen or D1 throws |
| 402 | `readLog` | get ×N days | `log:<date>` | — | read events | `/log` page, `/selfcheck` (1 day), nightly publish (2 days) |

KV is used as: an **event log** (state) and a **fallback snapshot cache**.
It is not used for locks, Trader state, scanner state or per-request caching
(CODE-DERIVED: no other `LOG.` call exists).

## Who writes events (27 codes)
Per cron run: `cron_fired` (every invocation, `authorized`, line 1467),
`cron_skipped_closed` (every run outside the session), `cron_skipped` (every
run while write tier ≥ frugal), `cron_partial`, archive/publish codes.
Per request: `budget_warn` (EVERY request while overall tier is `warn`),
`board_full_read` (every `/board` without a cursor), `expensive_request`
(≥20,000 rows), `read_guard`, `rate_limited`, `self_drive`, `gap_repaired`,
watch add/remove.

## Why the KV write limit was hit (F-KV-1)
`logEvent` folds a repeat only when it equals the **immediately previous**
entry (same code and message, <10 min), then writes only every 10th repeat.
That works for a single repeating source and fails as soon as two sources
interleave:

| Situation | Interleaving | Puts |
|---|---|---|
| closed-market cron minute | `cron_fired`, `cron_skipped_closed`, `cron_fired`, … | 2 / minute |
| session with D1 write tier ≥ frugal | `cron_fired`, `cron_skipped`, … | 2 / minute |
| session with a V2 radar tab doing full reads (v225–v247) | `cron_fired`, `board_full_read`, … | 2 / minute per tab |
| overall tier `warn` | `budget_warn` from every request between the above | +1 get per request |

540 cron minutes/day (13:00–21:59 UTC) × 2 = **1,080 puts — above the 1,000
limit from cron logging alone on any day the cron is standing down or the
market is closed** (CODE-DERIVED arithmetic). The production log shows the
pattern: 2026-09-20 15:41 → 2026-09-21 01:45Z holds 163 `cron_fired` and 150
`cron_skipped_closed` entries, **zero folded repeats** (MEASURED from
`data/state/log.json`).

The caps meant to prevent this (`LOG_WRITE_CAP` 400, `SNAP_MAX_PER_DAY` 400)
are module variables, i.e. **per isolate**. Every cron invocation and every
request can land in a fresh isolate starting at zero, so they bound nothing
account-wide (CODE-DERIVED; the code comment at line 335 says the same).

Second-order effect: when KV writes are exhausted, `snapshotPut` fails
silently, so the frozen-tier fallback has no fresh snapshot to serve
(INFERRED).

## Reads
Reads are far from their limit in every realistic scenario: one get per
event plus one per `/log` view (INFERRED). Only the `warn`-tier
`budget_warn`-per-request path scales with traffic.

## Fix (Phase 13, F-KV-1)
1. Do not write `cron_fired` to KV. The `runs` table and Cloudflare's own
   cron logs already record every run; keep it as `console.log` (Workers Logs
   is enabled in wrangler.toml and costs no KV).
2. Fold against the most recent entry **with the same code** in the last
   10 minutes, not only the last entry.
3. Per-request informational events (`board_full_read`, `budget_warn`) go to
   `console.log`, not KV.
Test: a simulated day of 540 alternating cron events must produce ≤ 60 puts.
