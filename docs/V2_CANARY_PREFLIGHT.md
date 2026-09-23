# V2 CANARY — PRE-FLIGHT

No code was changed to produce this. Every answer is read out of the repository
or measured by running the existing code.

## 1. Migration safety

`migrations/0001_v2_schema.sql` creates seven objects and nothing else:

| # | object | statement | destructive verbs |
|---|---|---|---|
| 1 | `bars_v2` | `CREATE TABLE IF NOT EXISTS bars_v2 (symbol, unix, date, time, open, high, low, close, volume, source, synthetic, first_seen, updated_at, revisions, PRIMARY KEY(symbol, unix))` | none |
| 2 | `bars_v2_sym_date` | `CREATE INDEX IF NOT EXISTS bars_v2_sym_date ON bars_v2 (symbol, date, unix)` | none |
| 3 | `symbols_v2` | `CREATE TABLE IF NOT EXISTS symbols_v2 (symbol PK, tier, added_at, active, last_fetch_at, last_bar_unix, last_error, last_ok_at)` | none |
| 4 | `jobs_v2` | `CREATE TABLE IF NOT EXISTS jobs_v2 (id PK AUTOINCREMENT, kind, symbol, arg, priority, due_at, attempts, last_error, state, updated_at, lease_until, claim_id, UNIQUE(kind, symbol, arg))` | none |
| 5 | `jobs_v2_ready` | `CREATE INDEX IF NOT EXISTS jobs_v2_ready ON jobs_v2 (state, due_at, priority)` | none |
| 6 | `runs_v2` | `CREATE TABLE IF NOT EXISTS runs_v2 (id PK AUTOINCREMENT, started_at, finished_at, trigger, budget, used, jobs_done, jobs_failed, rows_downloaded, candidates, inserted, revised, unchanged, synthetic_inserted, kept_real, rejected, partial_responses, lease_reclaims, symbols, status, note)` | none |
| 7 | `meta_v2` | `CREATE TABLE IF NOT EXISTS meta_v2 (key PK, value)` | none |

No triggers, no views.

- **`DROP` / `ALTER` / `DELETE` / `UPDATE` / `TRUNCATE` / `INSERT` count in the file: 0** (measured by grep).
- **Idempotent:** every statement is `IF NOT EXISTS`. Running it twice is a no-op; proven locally in `v2_soak.mjs` #22, which also asserts a pre-existing legacy row survives.
- **Name collisions:** legacy objects in the live database are `bars`, `bars_symbol_date_unix`, `daily_bars`, `days`, `meta`, `runs`, `symbols`, `universe_extra`, `usage`, `usage_route`. Set intersection with the seven above: **empty** (measured with `comm`).

**Does this migration modify any existing legacy row or schema object? NO.**

## 2. Deploy behaviour

`wrangler.toml` after deploy:
```toml
crons = ["* 13-21 * * *", "*/5 0-1 * * *", "* 12-22 * * *", "7 2 * * *"]
```

| cron | owner | what it runs |
|---|---|---|
| `* 13-21 * * *` | legacy | unchanged legacy ingestion |
| `*/5 0-1 * * *` | legacy | unchanged legacy nightly |
| `* 12-22 * * *` | **V2** | `v2Tick` — every minute, 12:00–22:59 UTC |
| `7 2 * * *` | **V2** | `v2Sweep` — 02:07 UTC, gap scan only |

**Do the V2 triggers start immediately? Yes** — from the first matching minute
after deploy.

**Can V2 make provider calls before you add the symbols? No.** Measured on an
empty database:

```
jobs claimed: 0 | provider calls: 0 | budget used: 0 | SQL statements: 12 | stopped_by: work-complete
```

A tick with no rows in `jobs_v2` claims nothing, spends nothing, writes one
`runs_v2` row and returns. Twelve D1 statements, zero external requests.

## 3. Canary scope — only the three symbols

Jobs can be created at exactly four call sites (grep of `enqueue(`):

| site | creates | symbol source |
|---|---|---|
| `v2_routes.js:172` — `/v2/symbols/add` | `live` | **only what you pass in the URL**, filtered by `/^[A-Z][A-Z0-9.\-]{0,9}$/` |
| `v2_routes.js:195` — `/v2/recover/SYM` | `backfill` | the symbol in the URL, manual, key-protected |
| `v2_routes.js:450` — `/v2/bootstrap?apply=1` | `backfill` | symbols you pass, manual, key-protected |
| `v2_pipeline.js:405` — `sweep()` | `backfill` | `SELECT symbol FROM symbols_v2 WHERE active = 1` |

The only automatic path is the sweep, and it iterates **`symbols_v2` itself**. It
cannot introduce a symbol that is not already enrolled.

**Is there a universe or default symbol list in V2? No.** `ARCHIVE_UNIVERSE` and
`universe_extra` belong to legacy and are never read by V2 (grep: no V2
statement references them). After step 5 of the runbook, `symbols_v2` contains
exactly AAPL, QQQ, XLY.

## 4. Why the manual `/v2/tick`

**It is a smoke test, not a bootstrap.** The scheduled trigger would do the same
work within a minute. Running it by hand gives you a synchronous response you can
read before committing the session to it.

The first call will: claim the three jobs (atomic `UPDATE … RETURNING`, lease
120 s), make **three** Yahoo requests — `range=5d` for each, because
`last_bar_unix` is null — normalise, write ~1,350 candles per symbol (3 prior
sessions + today so far, with the weekend day rejected), update
`symbols_v2.last_bar_unix`, reschedule each job for +60 s, and write one
`runs_v2` row. Expected response: `done: 3`, `budget.used: 3 / safe 36`.

**Note on the 5-day bootstrap:** it means the canary's first write includes
history from 09-18 through 09-22, not just today. That is intended, but day-level
comparisons for those earlier dates are bootstrap data, not canary evidence.
Judge the canary on **2026-09-23 only**.

## 5. Authentication

- **Secret name: `API_KEY`** (an environment variable / Worker secret; the V2
  code reads `env.API_KEY` and nothing else for auth).
- **Does it already exist in production?** It is the same variable legacy uses for
  its own protected routes, so if legacy's key-protected endpoints work today, it
  is set. I cannot read it from here — check with
  `wrangler secret list`.
- **If it is missing:** `authed()` returns true when `env.API_KEY` is falsy —
  meaning **every mutating V2 endpoint becomes open**. That is inherited legacy
  behaviour and it is a real risk: verify the secret exists *before* deploying.
- **Endpoints without a key:** `/v2/status`, `/v2/accounting`, `/v2/gaps`,
  `/v2/day`, `/v2/export`, `/v2/canary`, `/v2/ui` are read-only and open by
  design. All eight mutating endpoints return 401 (13 assertions in
  `v2_hardening.mjs` §AS).

## 6. Is `/v2/canary/<date>` read-only? Proven

Every database call inside that branch, extracted from the source:

```
SELECT * FROM bars_v2 WHERE symbol = ? AND date = ? ORDER BY unix
SELECT … FROM bars WHERE symbol = ? AND date = ? …            (legacy, read)
SELECT * FROM runs_v2 WHERE started_at >= ? AND started_at < ?
SELECT COUNT(*) … FROM bars_v2 GROUP BY symbol, unix HAVING k > 1
SELECT COUNT(*) … FROM jobs_v2 WHERE state = 'claimed' …
SELECT COUNT(*) … FROM jobs_v2 WHERE state = 'ready' …
```

Count of `INSERT|UPDATE|DELETE|fetch(|enqueue|writeCandles|tick(|sweep(` inside
the branch: **0** (measured). No Yahoo call, no gap repair, no D1 write, no queue
change. V2 never uses KV at all.

## 7. Expected session for 2026-09-23 (measured)

```
weekday: Wed | holiday: false | early close: false
sessionMinutes: 390 | first label: 09:30 | last label: 15:59
```
Market open 09:30 ET (13:30 UTC), close 16:00 ET (20:00 UTC). The 16:00 stamp is
**not** a candle; the last expected candle is the minute starting 15:59.

## 8. Synthetic candles — when they are allowed, and how they appear

A synthetic candle is created **only** when the provider returns a timestamp for
a session minute but null prices for it. It is the previous close repeated, with
`volume = 0` and `synthetic = 1`.

It is **not** created when the provider omits the minute entirely — that stays a
gap, which is exactly why row count alone must not be trusted.

If Yahoo genuinely fails to supply a minute, the report shows
`missing_minutes ≥ 1` with the label in `missing_sample`, and the sweep queues a
repair. If Yahoo supplies the minute with null prices, the report shows
`synthetic_bars ≥ 1` and `real_bars = 390 − synthetic`.

**Judge the day on `real_bars`, `missing_minutes` and `synthetic_bars`
separately — never on `v2_bars = 390`.** In the simulation, `v2_bars` was 390 and
one of them was synthetic; that is a partially incomplete day dressed as a
complete one, which is the trap you are pointing at.

## 9. Provider corrections and the 16:15 timing

- **Observed in production data:** `updated_at − first_seen` up to 1,026 s
  (~17 min), sample of 52 rows, one symbol, one day. That is the only row-level
  evidence that exists.
- **16:15 ET** is the close plus that observed maximum, rounded up. It is not
  derived from a long study.
- **The 16:15 report is a SNAPSHOT, not final.** Run `/v2/canary/<date>` again the
  next morning (before 09:30 ET so the day is quiet) and compare. If
  `total_revisions` or `DIFFERENT_OHLCV` changed between the two, the later one is
  authoritative and the window assumption needs revisiting.

## 10. Proving V2 wrote nothing to legacy, without relying on checksums

You are right that legacy keeps writing. The proof is structural, from three
independent angles:

**(a) SQL call sites.** Every write statement in both V2 modules, enumerated:
```
UPDATE jobs_v2 ×4 · UPDATE symbols_v2 ×2 · UPDATE runs_v2 ×1 · UPDATE bars_v2 ×1
INSERT INTO bars_v2 ×1 · INSERT INTO jobs_v2 ×1 · INSERT INTO runs_v2 ×1 · INSERT INTO symbols_v2 ×1
DELETE FROM jobs_v2 ×2
```
Grep for any V2 statement whose target is `bars|days|symbols|meta|runs|usage|daily_bars|universe_extra|usage_route`: **NONE**. The only legacy contact is three `SELECT … FROM bars` (canary comparison, copy, bootstrap).

**(b) Route and handler separation.** `/v2/*` is dispatched before the legacy
preamble and returns; the V2 cron branch returns before any legacy cron code. No
V2 path can reach a legacy write function.

**(c) Writer attribution at run time.** Legacy rows carry `first_seen`/`updated_at`.
After the session:
```sql
SELECT symbol, MAX(updated_at) FROM bars WHERE symbol IN ('AAPL','QQQ','XLY') AND date = '2026-09-23' GROUP BY symbol;
```
Compare those timestamps with legacy's own run log (`SELECT * FROM runs ORDER BY id DESC LIMIT 20`). Every legacy write should line up with a legacy run. A write at a minute where only a V2 cron fired would be the smoking gun — and none can exist given (a).

## 11. Rollback

```toml
# wrangler.toml line 29 — remove the last two entries
crons = ["* 13-21 * * *", "*/5 0-1 * * *"]
```
then `wrangler deploy`.

| what | after rollback |
|---|---|
| jobs currently claimed | keep `state='claimed'` until `lease_until` passes; then they are simply `ready` again for a tick that never comes. Harmless |
| pending jobs | stay in `jobs_v2` with past `due_at`. Nothing runs them |
| leases | expire on their own after 120 s; no process holds anything |
| candles already in `bars_v2` | stay. No consumer reads them; no legacy object references them |

**Does removing the triggers fully stop provider calls? Yes for scheduled work.**
The one remaining path is manual: `/v2/tick`, `/v2/recover`, `/v2/bootstrap` and
`/v2/copy/from-archive` still exist and would call out if *you* invoke them. To
remove them too, revert the V2 commit and deploy. A stricter shutdown without a
deploy: `UPDATE symbols_v2 SET active = 0; DELETE FROM jobs_v2;` — then even a
manual tick has nothing to claim.

## 12. Success criteria, fixed before the run

| metric | PASS | FAIL |
|---|---|---|
| external calls per invocation | ≤ 36 | ≥ 37 |
| duplicate job claims (same symbol, two runs, same minute) | 0 | ≥ 1 |
| duplicate canonical candles `(symbol, unix)` | 0 | ≥ 1 |
| missing expected minutes per symbol, after 16:15 | 0 | ≥ 1 |
| unexpected minutes (16:00, non-minute, weekend) | 0 | ≥ 1 |
| synthetic count per symbol | ≤ 5 and each traceable to a null-price provider minute | > 5, or any untraceable |
| synthetic overwrote real | 0 | ≥ 1 |
| stuck leases (`claimed` with expired lease) | 0 | ≥ 1 |
| queue final depth at session end | 0 | ≥ 1 |
| unexplained OHLCV mismatches vs legacy | 0 | ≥ 1 |
| writes to legacy caused by V2 | 0 | ≥ 1 |

These thresholds will not be changed after the results are seen.

---

# PRE-FLIGHT VERDICT

```
MIGRATION SAFE:                    YES
DEPLOY SAFE:                       YES
CANARY ISOLATED TO 3 SYMBOLS:      YES
CANARY REPORT READ-ONLY:           YES
ROLLBACK VERIFIED:                 YES (locally; the deploy step itself is untested from here)
READY FOR MANUAL PRODUCTION CANARY: YES — with one precondition
```

**The precondition:** confirm `API_KEY` exists as a Worker secret before
deploying. If it is unset, every mutating `/v2/*` endpoint is open to anyone who
knows the URL. That is inherited legacy behaviour, not something V2 introduced,
but it becomes newly relevant the moment V2 has write endpoints in production.

Two honest caveats on the YES lines: "ROLLBACK VERIFIED" means the queue and
lease semantics were verified locally — I have never executed `wrangler deploy`.
And the migration has only ever been applied to an in-memory SQLite database, not
to D1 itself; D1 accepts the same DDL, but that is an expectation, not a
measurement.
