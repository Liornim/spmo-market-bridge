# V2 CANARY READINESS — EVIDENCE BEHIND THE WORD "SAFE"

Your framing is right: what I proved is mostly **V2 engine and queue safety**.
This document separates that from **end-to-end production data safety**, which is
not proven and cannot be from here. No code changed while writing this.

---

## 1. What exactly goes into the canary

| item | value |
|---|---|
| symbols | **AAPL, SPY, ZTS** — one mega-cap also tracked by legacy, one ETF (the class legacy loses first), one alphabetically last so a positional bug would show |
| cron paths activated | `* 12-22 * * *` → `v2Tick` · `7 2 * * *` → `v2Sweep`. Legacy `* 13-21 * * *` and `*/5 0-1 * * *` are untouched and still run |
| tables written | `bars_v2`, `symbols_v2`, `jobs_v2`, `runs_v2`, `meta_v2` — **only these** |
| tables read | the five above; `bars` (legacy) **read-only**, and only by `/v2/copy/from-d1` and `/v2/bootstrap` when called by hand |
| endpoints reading V2 | `/v2/status`, `/v2/day`, `/v2/export`, `/v2/gaps`, `/v2/accounting`, `/v2/ui` — **no legacy page links to any of them** |
| consumers moved | **none** |

## 2. Is the canary purely V2? Yes for ingestion

```
Yahoo v8 chart (interval=1m, includePrePost=false)
   │  one request per symbol per refresh, charged to the budget before the socket opens
   ▼
normalise()            forming minute dropped · 4dp rounding · canonical filter
   │                   (minute-aligned, 09:30–15:59 ET, weekday) · synthetic flag
   ▼
writeCandles()         window = [last_bar_unix − 30 min, ∞) · compare-then-write
   │                   inserted / revised / unchanged / rejected counted
   ▼
D1 bars_v2             PK (symbol, unix)
   ▼
/v2/status · /v2/day · /v2/export · /v2/gaps          (nothing else reads it)
```

Legacy, Supabase, the mirror and the archive are **not** in this path. They enter
only through two manual tools (`/v2/copy/from-d1`, `/v2/copy/from-archive`), both
read-only against their sources.

## 3. Can the canary affect Trader or Radar? No

- No HTML page in the repo references `/v2` (grep: zero hits outside the V2 files).
- The V2 UI is a separate page at `/v2/ui`, not linked from any legacy page.
- Trader and Radar read `/board` and `/day`, which query `bars` — a table V2 never writes.
- The V2 route is mounted **before** the legacy preamble and returns, so it cannot alter legacy metering, quota state or self-drive.
- Frozen engine hashes unchanged: `496bd9b5a8a4936f`, `69468cc604a44a41`, `cf0537b3131c25ab`, `6c87104345566e54`.

## 4. What "max 36" means — measured breakdown

**It means outbound `fetch()` calls in one Worker invocation**, which for V2 are
provider calls only. The most expensive invocation recorded:

```
jobs claimed 36 | outbound fetch() calls 36 | budget.used 36
by host: { "query1.finance.yahoo.com": 36 }
all 36 are /v8/finance/chart requests: true
```

D1 statements are bindings, not external subrequests, and are counted separately
(`/v2/status` = 4 statements; an idle tick < 6). KV is not used by V2 at all.

## 5. Does 36 hold on failure paths? Yes — measured

| scenario | jobs claimed | outbound | ≤36 |
|---|---|---|---|
| every provider call times out | 36 | 36 | yes |
| every response is partial | 36 | 36 | yes |
| half return HTTP 500 | 36 | 36 | yes |
| 50 jobs held by a dead worker, leases expired and reclaimed | 36 | 36 | yes |
| **two scheduled deliveries at once** | 36 + 36 | 36 **each** | yes, per invocation |

The last row needs stating plainly: the ceiling is **per invocation**. Two
deliveries are two invocations spending 36 each. Because the claim is atomic they
claim **disjoint** jobs, so the 72 calls are 72 different symbols, not duplicates.

## 6. Canary success criteria — numeric, decided in advance

Measured from `/v2/status`, `/v2/accounting` and `/v2/gaps`, over 3 sessions:

| # | criterion | threshold |
|---|---|---|
| 1 | duplicate provider calls for the same symbol-minute | **0** |
| 2 | duplicate canonical candles `(symbol, unix)` | **0** |
| 3 | jobs stuck in `claimed` with an expired lease | **0** |
| 4 | queue depth at session end | **0** |
| 5 | missing expected closed candles per symbol-day | **0** |
| 6 | real candle overwritten by a synthetic one | **0** |
| 7 | `max_requests_in_one_execution` | **≤ 36** |
| 8 | rows written to `bars`, `days`, `symbols`, `archive_bars`, Supabase | **0** |
| 9 | `stale_seconds > 600` while the market is open | **0** |
| 10 | OHLCV mismatch vs legacy on AAPL for minutes both hold | **0 unexplained** |

## 7. What counts as canary failure — stop immediately

Any one of these, without waiting for judgement:

1. `max_requests_in_one_execution > 36` in any run.
2. any duplicate `(symbol, unix)` row in `bars_v2`.
3. any row appearing in a legacy table whose `source`/timing points at V2.
4. `jobs_failed` > 10% of claims for two consecutive sessions with no provider-side explanation.
5. queue depth rising across three consecutive sessions (divergence).
6. a legacy endpoint (`/status`, `/day`, `/board`) changing shape or failing.
7. Cloudflare reporting a subrequest error on a V2 cron invocation.
8. a `bars_v2` row with `synthetic = 1` replacing one that was `synthetic = 0`.

## 8. The rollback line, exactly

`wrangler.toml` line 29:
```toml
crons = ["* 13-21 * * *", "*/5 0-1 * * *", "* 12-22 * * *", "7 2 * * *"]
```
Remove the last two entries and deploy:
```toml
crons = ["* 13-21 * * *", "*/5 0-1 * * *"]
```
**What happens to queued work:** nothing runs it. Jobs stay in `jobs_v2` with
their `due_at` in the past and `state = 'ready'`. Nothing retries, nothing
expires, no external call is made. The `/v2/*` routes still answer (they are not
cron-driven); to remove them too, revert the V2 commit and deploy.

## 9. Does rollback leave rows behind?

Yes: `bars_v2`, `symbols_v2`, `jobs_v2`, `runs_v2`, `meta_v2` remain.
They are harmless — no legacy object references them (proven by the migration
audit: every created object matches `*_v2`, and no `DROP/DELETE/ALTER/UPDATE`
statement exists in the file).
**On re-enable:** V2 continues from where it stopped. Jobs are past-due, so the
first tick claims the 36 oldest and the cycle resumes; already-stored candles are
recognised as `unchanged` and are not rewritten (proven by the idempotency tests).

## 10. How production parity gets proven — and why it is not yet

The comparison must not let legacy touch V2 or vice versa. Procedure:
1. after a session ends, `GET /v2/export/AAPL?date=D` (V2, read-only);
2. `GET /export/AAPL/D` (legacy, read-only — note `/day` can trigger a repair write, so use `/export`);
3. join on `time` and produce, per minute: `minute | provider | V2 | legacy | same OHLCV?`.

The provider column requires a direct Yahoo fetch, which this sandbox cannot make
(403 to external hosts). **Status: NOT YET PROVEN in production.** What *is*
proven is offline parity on identical payloads: 8 symbols × 390 minutes, every
OHLCV value identical, 0 mismatches (`v2_validation.mjs`).

## 11. What the 1.23 M candle run actually tested

It was **load generation + persistence + scheduling**, not completeness:

| measured | value |
|---|---|
| symbols | 1,000 |
| executions to cover all | 28 (= ceil(1000/36)) |
| max outbound per execution | 36 |
| rows written | 1,230,000 |
| tick wall time | p50 0.3 ms, p95 0.3 ms |
| `/v2/status` | 47 ms, **4 SQL statements**, 485 KB |
| sweep over 1,000 symbols | 138 ms, 2,001 statements |

It did **not** test data correctness at that scale — correctness is tested by the
fuzz, parity and calendar suites at small scale.

## 12. Where the calendar came from, and what it covers

The lists are **hand-entered from the published NYSE/Nasdaq calendar**, not
derived from an API. That is the weakness (§18 R1 of the hardening report).

- holidays: **30 entries**, 2025-01-01 → 2027-12-24 (10 per year)
- early closes: **2025-07-03, 2025-11-28, 2025-12-24, 2026-11-27, 2026-12-24, 2027-11-26**
- every one of those six returns **210** minutes — all six are asserted, not just Christmas
- weekends and holidays return **0**

## 13. What happens in 2028 (measured)

| date | result |
|---|---|
| 2028-01-03 (Mon) | 390 |
| 2028-07-04 (Tue, a real holiday) | **390 — wrong** |
| 2028-12-25 (Mon, a real holiday) | **390 — wrong** |
| 2028-01-01 (Sat) | 0 (weekend rule still applies) |

Consequence past 2027: the sweep expects a session on an untabulated holiday and
queues **one** repair per symbol that day. Cost is one provider request per
symbol, once; no data is harmed. Ingestion is unaffected because holidays are
deliberately not filtered there.

## 14. Can the weekend filter delete a legitimate candle? No — measured

The filter takes the weekday of the **ET date**, not the UTC date. Scanned every
session-boundary minute across 400 days (324 boundary minutes, 92 of them on
weekends):

```
minutes whose UTC date differs from their ET date: 0
WEEKDAY session minutes wrongly rejected:          0
```
This is structural, not luck: the session 09:30–15:59 ET is 13:30–21:00 UTC, so a
session minute can never roll into another UTC day. An extended-hours or
after-close correction is rejected for being outside 09:30–15:59, not for the
weekday rule.

## 15. Is the CSV parser by name or by position? By name — measured

```
/export column order (unix in position 4) -> open = 250.1
fully reordered header                    -> open = 250.1  close = 250.2
```
The legacy replay bug — `open` receiving the unix timestamp — cannot happen: V2
maps `head.indexOf('open')`, so column order is irrelevant. Both before and after
the BOM/quote fix, parsing was by name; the fix addressed the *header* being
corrupted by a BOM (which made every name miss) and commas inside quoted fields.

## 16. The two numbers, in their own units

**Assertions** (individual `check()` calls that printed PASS):

| suite | assertions |
|---|---|
| test.mjs | 664 |
| bars_test.mjs | 127 |
| radar_v2_test.mjs | 335 |
| trader_v2_test.cjs | 109 |
| scan_test.mjs | 103 |
| live_test.mjs | 53 |
| layout_test.mjs | 51 |
| consistency_test.mjs | 13 |
| v2_test.mjs | 70 |
| v2_validation.mjs | 11 |
| v2_closing_validation.mjs | 32 |
| **v2_hardening.mjs** | **181** |
| **v2_soak.mjs** | **48** |
| **total** | **1,797** |

So **181 is assertions in one suite**, and the corpus is **1,797 assertions across
13 suites** — my earlier "1,939" double-counted; the correct figure is 1,797
(legacy 1,455, V2 342). Corrected here rather than defended.

## 17. Engine-input parity — what the hashes do and do not prove

You are right that an unchanged hash proves nothing about inputs. What is
actually unchanged for Trader/Radar:

| property | evidence |
|---|---|
| input schema | Trader reads `/board` and `/day`, whose SQL and row shape are untouched by the V2 commits (diff of `worker.js` vs the checkpoint: three additive hooks only) |
| candle ordering | same `ORDER BY unix` in the same functions |
| canonical filtering | the `CANON_SQL` predicate is from v249/v251, before V2; V2 did not modify it |
| number of bars delivered | `consistency_test.mjs` (13 assertions) still returns 390/390 through every legacy path |
| legacy suites | radar 335, trader 109, live 53, layout 51 — all green |

## 18. Observability during the canary

| signal | where | what failure looks like |
|---|---|---|
| requests per invocation | `/v2/accounting` → `max_requests_in_one_execution` | > 36 |
| claims / completions / failures | `runs_v2` rows, `/v2/accounting` | `jobs_failed` climbing |
| queue depth and oldest due | `/v2/status` → `jobs_ready`, `oldest_due` | rising across sessions |
| lease expirations | `jobs_v2.state='claimed' AND lease_until < now` | non-zero |
| canonical rows written | `runs_v2.inserted` | 0 during a session |
| revisions | `runs_v2.revised` | unexpected spikes |
| synthetic rows | `SELECT COUNT(*) FROM bars_v2 WHERE synthetic=1` | growing share |
| gaps | `/v2/gaps` | `with_gaps > 0` at session end |
| per-symbol freshness | `/v2/status` → `stale_seconds`, `last_error` | > 600 s while open |
| provider errors | `symbols_v2.last_error` + `console.log` in Workers Logs | any subrequest message |

Detection time: `/v2/status` is one request and reflects the last tick, so a
failure is visible within a minute.

## 19. Legacy isolation, table by table (measured)

After a V2 tick, sweep, copy-from-d1, bootstrap, export, import, status and gaps
on a database holding both schemas:

| table | rows before/after | checksum before/after | schema identical |
|---|---|---|---|
| bars | 300/300 | 165833315 / 165833315 | true |
| days | 1/1 | 3022892724 / 3022892724 | true |
| symbols | 1/1 | 2540189456 / 2540189456 | true |
| meta | 1/1 | 2643338809 / 2643338809 | true |
| runs | 1/1 | 1019941186 / 1019941186 | true |
| usage | 1/1 | 901741913 / 901741913 | true |
| daily_bars | 1/1 | 914220153 / 914220153 | true |

**All legacy tables byte-identical**, while V2 stored 2,820 candles of its own in
the same database.

## 20. Split verdict

| area | verdict |
|---|---|
| **V2 LOCAL HARDENING** | **PASS** — 181 adversarial assertions, 5 bugs found and fixed, 0 fuzz crashes |
| **V2 LOAD / SOAK** | **PASS** — 1,290 ticks, 1,000 symbols, 18,132 provider calls, max 36, queue drained to 0 |
| **LEGACY ISOLATION** | **PASS** — byte-identical tables (§19), three additive hooks, all 7 legacy suites green |
| **PRODUCTION DATA PARITY** | **NOT YET PROVEN** — offline parity is proven on identical payloads; no production three-way comparison has been run |
| **PRODUCTION CANARY OBSERVABILITY** | **READY** — every criterion in §6 is readable from `/v2/status` and `/v2/accounting` within a minute |

### CANARY READINESS

**READY TO START a 3-symbol canary, NOT PROVEN as end-to-end production-correct.**

The canary is the experiment that produces the missing evidence (§10): it is safe
to run because it writes only V2 tables, moves no consumer, and switches off with
one config line — not because production parity has been demonstrated. That
demonstration is the canary's output, not its precondition.
