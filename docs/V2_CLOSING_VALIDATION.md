# V2 CLOSING VALIDATION — PASS / FAIL WITH EVIDENCE

All evidence from `v2_closing_validation.mjs` (32 checks) unless stated.
It counts **every** outbound `fetch()` regardless of URL or caller, and throws
Cloudflare's exact error at a hard ceiling, exactly as production would.

---

## 1. The 4-vs-5 run contradiction — **PASS (my report was sloppy, the system is right)**

Both numbers were true and I did not say so. `ceil(118/36) = 4` runs do the
work; the 5th claims nothing and exists only because the validation loop keeps
calling until a run comes back empty. Per-run ledger:

| run | jobs claimed | outbound calls | processed ok | failed | remaining due |
|---|---|---|---|---|---|
| 1 | 36 | 36 | 36 | 0 | 82 |
| 2 | 36 | 36 | 36 | 0 | 46 |
| 3 | 36 | 36 | 36 | 0 | 10 |
| 4 | 10 | 10 | 10 | 0 | 0 |
| 5 | 0 | **0** | 0 | 0 | 0 |

**4 working runs, 118 symbols, 118 calls, zero waste.** The report should have
said "4 working runs plus an empty confirmation".

## 2. The 36-call ceiling covers every outbound path — **PASS**

Instrumented by host across cold start, error paths, sweep and recovery:

```
by host: { "query1.finance.yahoo.com": 108 }
cold start 36 calls · error tick 36 · sweep 0 · recovery tick 36
```

| path | outbound calls | evidence |
|---|---|---|
| cold start (no symbol state, 5d bootstrap range) | 1 per claimed job | `coldCalls === cold.jobs_claimed` |
| provider HTTP 500 | 1 (no retry in-run) | error tick calls == jobs claimed |
| provider timeout | 1 | 〃 |
| empty provider response | 1 | 〃 |
| partial provider response | 1 | 〃 |
| metadata / symbol state | **0** — D1 bindings | only yahoo appears in `byHost` |
| gap sweep | **0** | `sweepCalls === 0` |
| recovery/backfill | 1 per job, same budget | `recCalls <= 36` |
| archive lookups, pagination, mirror | **0 — none exist in the V2 cron path** | `byHost` has one host |

The archive copy *does* spend requests, but it is an HTTP tool
(`/v2/copy/from-archive`), never reached from the cron, and it carries its own
`Budget` that refuses rather than overruns.

## 3. The invariant, proven in the source — **PASS**

| assertion | result |
|---|---|
| `v2_pipeline.js` contains exactly **one** `fetch()` call site | PASS |
| that site is wrapped in `budget.spend()` | PASS |
| the budget is charged **before** the request is issued (`this.used += n` precedes `await fn()`) | PASS |
| `runLiveJob` calls the provider exactly once, never inside a loop | PASS |
| `runBackfillJob` calls the provider exactly once, never inside a loop | PASS |
| no other function calls the provider | PASS |
| a failed job is rescheduled for a **future** tick — no in-run retry | PASS |
| a run claims at most `budget − reserve` jobs | PASS |
| the executor stops claiming when the budget cannot pay | PASS |

**The exact invariant: one claimed job costs at most one outbound request, and
the charge happens before the socket opens.** A failure still costs its one
slot — which is why the ceiling holds under failure, not just under success.
Retries do not consume a second slot in the same run; they consume one slot in
a later run, after a backoff of `min(60·2^attempts, 1800)` seconds.

## 4. Chaos at 500 symbols — **PASS**

20 symbols returning HTTP 500, 14 timing out, 12 empty, 9 partial, plus two
injected D1 failures in run 3.

| run | jobs claimed | outbound | ok | failed | remaining due | max calls |
|---|---|---|---|---|---|---|
| 1 | 36 | 36 | 34 | 2 | 464 | 36 |
| 2 | 36 | 36 | 33 | 3 | 428 | 36 |
| 3 | 0 | **0** | 0 | 0 | 428 | 36 | ← transient DB failure; the next run continues |
| 4 | 36 | 36 | 32 | 4 | 392 | 36 |
| … | | | | | | |
| 15 | 32 | 32 | 29 | 3 | 0 | 36 |

- every healthy symbol served — **PASS**
- **no run ever exceeded 36 outbound calls** — PASS
- a DB failure mid-cycle costs one run, not the cycle — PASS
- every genuinely failing symbol carries a visible error (45 = 20+14+12, minus
  overlaps) — PASS
- a partial response stores the real candle and marks the carried-forward one
  `synthetic = 1` — PASS

## 5. Starvation over a full 500-symbol cycle — **PASS**

```
symbols that got a turn: 500/500 · never: 0
```
With `S250` failing permanently: 500 symbols still got a turn, and the broken
symbol backs off (`attempts <= 3`, `due_at` in the future) instead of taking a
slot every run.

## 6. The 30-minute revision window — **PASS with a stated limit on the sample**

**Sample: small and honestly so.** `GET /mirror/read/SPY/2026-09-17` returned
**52 rows, one symbol, one date**, the only row-level production data with
`first_seen` and `updated_at` I could reach. In it, `updated_at − first_seen`
reached **1,026 s (17.1 min)** with `revisions` of 1–2.
30 minutes is that maximum plus ~75% margin. It is **not** a multi-week study;
a wider sample would need `/export/SYM/DATE` for several symbol-days.

**What makes the window safe anyway:** anything later than the window is caught
by the gap machinery, proven here —

| step | result |
|---|---|
| delete 09:40–10:20, advance 3 hours | routine refresh does **not** fix it (window is bounded) — PASS |
| `sweep()` | detects the hole and queues exactly one repair — PASS |
| next tick | hole filled, one outbound request per claimed job — PASS |

So the window controls cost, and recovery controls correctness. A provider
outage longer than 30 minutes cannot silently lose data.

## 7. "No consumers of the legacy mirror" — **NOT PROVEN, and it does not block anything**

What I actually checked (repo-only):

| check | result |
|---|---|
| `rest/v1/bars` references in all code | 3, all in `worker.js`: the writer, `mirrorRead`, and `/mirror/compare` |
| any page linking `/mirror` | none |
| other Workers / functions in the repo | none — one `wrangler.toml`, one Worker |
| `t3/` research scripts touching Supabase | none |

**What I cannot see from here:** another Cloudflare Worker in the account, a
Supabase Edge Function, a scheduled query, a BI dashboard, or any external
client with the Supabase key. Treat item 7 as **repo-proven, account-unproven**.

**Why it is not a blocker:** V2 does not remove, rename or stop writing the
mirror. Legacy keeps mirroring exactly as before. The statement only justifies
V2 *not creating its own* mirror.

## 8. Dry-run deployment checklist

**Nothing below changes legacy behaviour or moves a consumer.**

| # | step | command / action | expected |
|---|---|---|---|
| 1 | apply the schema | `wrangler d1 execute bars-vault --file=migrations/0001_v2_schema.sql` | 5 tables + 2 indexes created, all named `*_v2` |
| 2 | verify legacy untouched | `GET /status`, `GET /day/AAPL?format=json` | both 200, unchanged output |
| 3 | deploy | `wrangler deploy` | 4 cron triggers listed: 2 legacy, 2 V2 |
| 4 | confirm V2 is alive and empty | `GET /v2/status` | `tracked: 0`, `no run yet` |
| 5 | add three test symbols | `GET /v2/symbols/add/AAPL,SPY,ZTS?key=…` | `added: [...]` |
| 6 | one manual tick | `GET /v2/tick?key=…` | `done: 3`, `budget.used: 3 / safe 36` |
| 7 | let the cron run overlapping legacy | wait one session | `/v2/status` shows `stale_symbols: 0` |
| 8 | compare | `GET /v2/day/AAPL/<date>` vs `GET /day/AAPL/<date>?format=json` | same minutes, same OHLCV |
| 9 | check accounting | `GET /v2/accounting` | `max_requests_in_one_execution ≤ 36` |

**Criteria before expanding to all symbols** (all must hold for 3 sessions):
- `/v2/gaps` reports 0 symbols with gaps at session end;
- `max_requests_in_one_execution ≤ 36` in every run;
- `/v2/status` shows no symbol with `stale_seconds > 600` while the market is open;
- V2 and legacy agree candle-for-candle on the overlapping symbols;
- `jobs_failed` is 0, or every failure has a provider-side explanation.

**Rollback — one step, no data loss:**
1. `wrangler.toml`: restore `crons = ["* 13-21 * * *", "*/5 0-1 * * *"]` and deploy. V2 stops running; legacy is unaffected because its triggers never changed.
2. Optional, to remove the routes as well: `git revert <V2 commit>` and deploy.
3. Optional, to reclaim storage: `DROP TABLE bars_v2, symbols_v2, jobs_v2, runs_v2, meta_v2;` — no legacy object references them.

At no point does rollback touch `bars`, `days`, `symbols`, `archive_bars`, the
mirror, `/day`, `/status` or Saved Candles.

---

## Summary

| item | verdict |
|---|---|
| 1 run-count contradiction | **PASS** — reporting error, ledger supplied |
| 2 ceiling covers every outbound path | **PASS** |
| 3 invariant proven in code | **PASS** |
| 4 chaos at 500 symbols | **PASS** |
| 5 starvation over a full cycle | **PASS** |
| 6 revision window + late candles | **PASS**, sample limits stated |
| 7 no mirror consumers | **NOT PROVEN account-wide** — repo-proven only, non-blocking |
| 8 deployment checklist | supplied, with rollback |
