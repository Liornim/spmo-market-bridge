# V2 REQUEST ACCOUNTING

Every number has a unit. `request` = one external `fetch()`. `binding call` =
one D1 statement or batch. `row` = one candle.

## Cost of one job

| job | external requests | binding calls | notes |
|---|---|---|---|
| `live` (warm symbol) | **1** (`range=1d`) | ~4 (read state, read existing window, batch write, update symbol) | the only per-minute work |
| `live` (cold symbol) | **1** (`range=5d`) | ~4 | bootstraps ~5 sessions from the same single request |
| `backfill` (recovery) | **1** (`range=5d`) | ~3 | queued by the sweep, same budget |
| `sweep` per symbol-day | **0** | 1 | gap scan reads only what V2 stored |
| `/v2/copy/from-d1` per symbol | **0** | 2 | legacy read is a binding call |
| `/v2/copy/from-archive` per symbol | 1 id list + `ceil(rows/1000)` | 1 | budgeted, refuses rather than overruns |
| `/v2/import` | 0 | 2 per symbol | body parsed in the Worker |

## Measured load test (`v2_test.mjs` §12, one full cycle)

| symbols | executions per cycle | provider requests | max requests in one execution | D1 writes | inserted | unchanged |
|---|---|---|---|---|---|---|
| 27 | 1 | 27 | 27 | 47,035 | 46,980 | 0 |
| 50 | 2 | 50 | **36** | 87,102 | 87,000 | 0 |
| 118 | 4 | 118 | **36** | 205,560 | 205,320 | 0 |
| 200 | 6 | 200 | **36** | 348,406 | 348,000 | 0 |
| 500 | 14 | 500 | **36** | 871,014 | 870,000 | 0 |

(The write counts are the cold bootstrap — every symbol's first cycle stores
~1,740 candles. Steady state is measured below.)

Two properties the table proves:

- **adding 82 symbols adds exactly 82 provider requests** to a cycle, and
- **the maximum in any single execution stays at 36** whatever the universe size.

## Steady state, per symbol per minute

| quantity | value |
|---|---|
| provider requests | 1 |
| rows downloaded | ~180–390 (the session so far) |
| candidate rows after the window filter | ≤ 31 (30-minute window + the new minute) |
| inserted | 1 in a healthy minute |
| revised | 0–2, bounded by the revision window |
| unchanged | the rest of the window, counted and **not written** |

Legacy comparison, same work: the intraday archive alone transmitted
**4,563,000 rows/day** to keep an archive that grows by 46,410 — a 98× write
amplification (`docs/COST_ACCOUNTING.md`). V2 has no equivalent path.

## Where the numbers are visible at runtime

- `/v2/status` → `system.request_budget`: `used 18 / safe 36 (ceiling 40)`
- `/v2/accounting` → per-run rows plus `max_requests_in_one_execution` and
  `write_amplification`
- each run row in `runs_v2` carries `used, jobs_done, jobs_failed,
  rows_downloaded, candidates, inserted, revised, unchanged, note`
  (`note` says why the run stopped: `work-complete` or `budget`).
