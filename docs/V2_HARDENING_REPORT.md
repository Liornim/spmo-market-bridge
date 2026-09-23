# V2 PRODUCTION HARDENING — FINAL REPORT

## 1. Executive result

**Verdict: SAFE FOR 3-SYMBOL PRODUCTION CANARY.**

| number | value |
|---|---|
| total tests across all suites | **1,939** (legacy 1,455 · V2 484) |
| new tests in this round | 229 (`v2_hardening.mjs` 181, `v2_soak.mjs` 48) |
| self-invented tests (not requested) | 23 |
| full-suite runs, all green | 3 consecutive + 3 alternate seeds |
| symbols simulated, max | **1,000** |
| ticks simulated | **1,290 soak + ~300 elsewhere** |
| provider calls simulated | **18,132 in the soak alone** |
| max outbound calls in any invocation | **36** (safe budget), never 37 |
| duplicate claims | **0** (was 324 before the fix) |
| duplicate candles | **0** |
| permanent locks | **0** |
| false gap detections | **0** after the calendar fix (was 390/symbol per weekend day) |
| gaps repaired | 400 queued and drained in the soak |
| synthetic bars replaced by real | verified, with `first_seen` preserved |
| queue depth max / final | 164 / **0** |
| worst wait, healthy symbol, in-session | p50 300 s · p95 360 s · p99 360 s |
| largest import tested | export of 1,350 candles round-tripped |
| largest export tested | 1,000 symbols / 1.23 M candles |
| fuzz cases | 21 structured + 400 randomized |
| fuzz crashes | **0** |
| bugs found | **5** |
| bugs fixed | **5** |
| remaining risks | 4, all listed in §18 |

## 2. Bugs found and fixed

### BUG #1 — the job claim was not atomic (P1, data-cost)
- **Severity:** high. Duplicate provider requests; with the scheduler delivering twice, the budget is spent twice on the same symbols.
- **How found:** new concurrency test firing 2/3/5/10 ticks in the same millisecond.
- **Reproduction:** `10 ticks: claimed 360, provider calls 360, duplicate calls 324`.
- **Root cause:** `claimJobs` was a plain `SELECT`. Nothing marked a job as taken, so every concurrent tick selected the same rows.
- **Production impact:** Cloudflare can deliver a scheduled event more than once; two deliveries would have doubled outbound calls and could have pushed a tick past the ceiling.
- **Fix:** a single atomic `UPDATE … WHERE id IN (SELECT … LIMIT ?) RETURNING *` that stamps `state='claimed'`, `lease_until` (120 s) and a per-run `claim_id`. Completion statements are fenced with `AND claim_id = ?`; jobs still claimed when the budget stops are released immediately.
- **Regression test:** `v2_hardening.mjs` C+D — `10 ticks: claimed 40, duplicate calls 0, non-ready jobs 0`; `v2_soak.mjs` #9 (lease expiry and fencing).
- **Files:** `v2_pipeline.js`.

### BUG #2 — a synthetic candle could overwrite a real one (P1, data integrity)
- **Severity:** high — silent data loss.
- **How found:** new precedence test (requirement V).
- **Reproduction:** store a real 09:31 (volume 500), then a carried-forward synthetic for the same minute → the row became `synthetic: 1, volume: 0`.
- **Root cause:** `writeCandles` compared values only, with no notion of precedence.
- **Fix:** an incoming synthetic candle never replaces a stored real one; it is counted as `unchanged` (and as `kept_real`). The reverse — real replacing synthetic — still happens, preserving `first_seen` and bumping `revisions`.
- **Regression test:** `v2_hardening.mjs` T+U+V (three checks).
- **Files:** `v2_pipeline.js`.

### BUG #3 — no market calendar: the gap engine "repaired" weekends and holidays (P1, cost + false alarms)
- **Severity:** high. A sweep on Christmas queued a 390-minute repair for **every** symbol; at 500 symbols that is 500 pointless provider requests.
- **How found:** new calendar test with 9 dated cases.
- **Reproduction:** `sweep('2026-12-25') → repairs_queued: 1 per symbol, missing: 390`.
- **Root cause:** `scanGaps` assumed 390 minutes for any date.
- **Fix:** `sessionMinutes(date)` with the US holiday list for 2025–2027 and the early-close list; weekends → 0, holidays → 0, early closes → 210. `scanGaps` uses it and `sweep` returns `market_closed` without queuing.
- **Regression test:** 11 checks across weekend / holiday / early close / ordinary day.
- **Files:** `v2_pipeline.js`.

### BUG #4 — the CSV parser broke on quoted fields and a BOM (P2, import)
- **Severity:** medium. A BOM-prefixed file had every row rejected; a quoted field split on the comma inside it.
- **How found:** import edge-case matrix (17 cases).
- **Fix:** a real CSV splitter honouring `"` quoting and doubled quotes, plus BOM stripping.
- **Regression test:** `v2_hardening.mjs` AL — BOM, CRLF, quoted fields, whitespace padding, reordered and extra columns.
- **Files:** `v2_routes.js`.

### BUG #5 — weekend candles were accepted by the canonical filter (P2, data integrity)
- **Severity:** medium. A provider payload containing a Sunday would have been stored.
- **How found:** self-invented test #19b, after the calendar work.
- **Fix:** `isSessionMinute` now also requires a weekday in ET. **Holidays are deliberately NOT rejected at ingestion**: a wrong entry in a hand-maintained holiday list would silently discard real candles, so the holiday list only decides what the gap engine *expects*, never what is kept.
- **Regression test:** #19b, plus the corrected bootstrap expectation (a 5-day window containing a Sunday now yields 1,350 candles, not 1,740).
- **Files:** `v2_pipeline.js`.

## 3. New tests

| suite | checks | covers |
|---|---|---|
| `v2_hardening.mjs` | 181 | concurrency ×4, budget boundaries ×6, crash matrix ×7 checkpoints, synthetic precedence, market calendar ×11, DST ×8, session boundaries ×12, provider fuzzing ×21, randomized 400 payloads, backoff matrix ×8 modes + escalation, import edge cases ×17, symbol-injection ×15, authorization ×13, schema constraint, query plans ×5 |
| `v2_soak.mjs` | 48 | 3-day soak (1,290 ticks), 1,000-symbol scale, and 23 self-invented scenarios |

### Self-invented scenarios (§3 of `v2_soak.mjs`)

| # | test | why | result |
|---|---|---|---|
| 1 | symbol deleted while its job is claimed | orphaned FK-less rows | no crash |
| 2 | future-dated job | early claiming | not claimed |
| 3 | corrupt queue rows (empty symbol, unknown kind, attempts 999999) | poison pill | batch survives |
| 4 | corrupt stored candle (null OHLC, `99:99`) | status/sweep robustness | both 200 |
| 5 | clock jumps backwards 5 min | isolate clock skew | no negative due time |
| 6 | live + recovery for the same symbol in one tick | double fetch | one call per job, no duplicates |
| 7 | backfill for a date the provider can't serve | infinite retry | job retired, no loop |
| 8 | enqueue the same job twice | queue duplication | one row |
| 9 | lease expiry + dead worker completing | fencing | new claim wins |
| 10 | 500 jobs with identical `due_at` | non-deterministic order | identical order across runs |
| 11 | payload labelled with another symbol | cross-contamination | rows carry the requested symbol |
| 12 | volume at 2³¹ and 2⁵³−1 | integer overflow | exact round trip |
| 13 | price 761.0021 through export | float drift | exact |
| 14 | export → import → export | lossless round trip | identical |
| 15 | status at 05:30 ET | "stale" at night is meaningless | freshness judged only while open |
| 16 | 100 idle ticks | wasted work | 0 provider calls, <6 statements each |
| 17 | run-log growth | unbounded table | 166 k rows/year ≈ 19 MB — retention deferred, quantified |
| 18 | ten sweeps over one gap | job multiplication | exactly one repair job |
| 19 | import of a holiday candle | contract question | stored only as a session minute |
| 19b | weekend timestamp | BUG #5 | rejected |
| 20 | cold isolate on every tick | hidden module state | identical to hot |
| 21 | legacy tables before/after every V2 operation | isolation | byte-identical |
| 22 | schema applied twice + migration audit | destructive SQL | additive only, all objects `*_v2` |

## 4. Budget evidence

| symbols | executions per cycle | provider requests | max in one execution |
|---|---|---|---|
| 27 | 1 | 27 | 27 |
| 50 | 2 | 50 | 36 |
| 118 | 4 | 118 | 36 |
| 200 | 6 | 200 | 36 |
| 500 | 14 | 500 | 36 |
| **1,000** | **28** | **1,000** | **36** |

Boundary matrix (budget, reserve): (1,0) (2,0) (5,4) (36,0) (37,1) (40,4) — in every case
`outbound ≤ budget` and `jobs claimed == outbound calls`. Outbound by host across
cold start, error paths, sweep and recovery: **one host, the provider**. The sweep
makes **zero** outbound calls.

## 5. Concurrency evidence

| concurrent ticks | jobs claimed | provider calls | duplicate calls | duplicate candles | locked jobs |
|---|---|---|---|---|---|
| 2 | 40 | 40 | 0 | 0 | 0 |
| 3 | 40 | 40 | 0 | 0 | 0 |
| 5 | 40 | 40 | 0 | 0 | 0 |
| 10 | 40 | 40 | 0 | 0 | 0 |

(40 is the whole queue; the extra ticks find nothing left to claim.)

## 6. Crash and recovery evidence

Injected DB failure at 7 checkpoints — queue read, claim update, symbol-state
read, bars read, freshness update, run stats, run insert. After each: a fresh
tick runs, **0 permanent locks, 0 duplicate candles, all 5 jobs survive**, and
the tick does not throw.

## 7. Queue and fairness evidence

Soak, 200 symbols, 3 days, injected failures: every healthy symbol serviced;
wait between services p50 300 s, p95 360 s, p99 360 s in-session; queue depth
max 164 → final **0**; zero orphan jobs. A permanently failing symbol backs off
(120→240→480→960→1800 s, then parked) without taking a slot every run.

## 8. Market calendar, DST and gaps

| date | meaning | expected minutes |
|---|---|---|
| 2026-09-19 / 20 | Saturday / Sunday | 0 |
| 2026-01-01, 07-03, 11-26, 12-25 | holidays | 0 |
| 2026-11-27, 12-24 | early closes | 210 |
| 2026-09-17 | ordinary session | 390 |

DST: verified on the Monday after both 2026 transitions — 09:30 local opens the
session, 15:59 is the last canonical minute, `16:00` is not, and the session is
exactly 390 minutes in both EDT and EST.

## 9. Synthetic and correction evidence

- synthetic never replaces real (BUG #2 regression)
- real replaces synthetic, `first_seen` preserved, `revisions` bumped, `source` updated
- a hole older than the revision window is **not** fixed by a routine refresh, is
  detected by the sweep, and is repaired by the next tick at one request

## 10. Provider fuzzing evidence

21 structured mutations (unsorted, duplicate, null, NaN, Infinity, negative
price/volume, high<low, open>high, 1e18, short/long arrays, empty, t=0, ancient,
future, milliseconds, string timestamp, missing quote, corrupted nesting) and
400 randomized payloads: **0 crashes, 0 invalid rows stored, 0 duplicates,
0 off-session rows**.

## 11. Database evidence

- the database itself rejects a duplicate `(symbol, unix)` — proven by a raw insert
- query plans: due jobs → `jobs_v2_ready` index; symbol/day → `bars_v2_sym_date`;
  export range → same; window read → primary key; latest-candle aggregate →
  covering index. No unindexed scan on a hot path.
- 1,000 symbols / 1.23 M candles: tick p50 0.3 ms; `/v2/status` 47 ms and
  **4 SQL statements** (no N+1); sweep 138 ms.
- growth at 500 symbols: 195 k candles/day ≈ 49 M/year.

## 12. Import / export evidence

17 import cases: empty, headers-only, valid, BOM, CRLF, reordered columns, extra
columns, missing column, quoted fields, whitespace, lowercase symbol, scientific
notation, malformed number, malformed date, 16:00 row, duplicate rows,
conflicting duplicates. Preview performs **zero** mutations (snapshot before and
after). A malformed import cannot damage a stored good candle. Export→import→
export is lossless.

## 13. Security evidence

All 8 mutating endpoints return 401 without a key; header and query-string keys
both accepted; wrong key rejected; read endpoints open by design. 15 hostile
symbol inputs (SQL fragments, `../`, `%00`, emoji, newlines, 64-char) — no 500,
schema intact, only canonical symbols stored. No secret appears in any response.

## 14. Legacy non-regression evidence

- all 7 legacy suites green: 664 · 127 · 335 · 109 · 103 · 53 · 51
- legacy tables byte-identical (row counts, sums) after tick, sweep, copy,
  bootstrap and export (#21)
- `worker.js` diff vs the audit checkpoint: three additive hooks only (import,
  `/v2` route mount, V2-only cron branch); `wrangler.toml`: two added triggers
- migration audited: no `DROP/DELETE/TRUNCATE/ALTER/UPDATE/INSERT`, every created
  object ends in `_v2`

## 15. Data parity evidence

`v2_validation.mjs`: 8 symbols (AAPL, NVDA, HD, QCOM, SPY, QQQ, SMH, and a
symbol last alphabetically) on identical provider payloads — **390/390 candles
each, every OHLCV value identical, 0 unexplained mismatches**, no 16:00 row and
no duplicate minute on either side. Scenario B at the ceiling: legacy 50/118,
V2 118/118.

## 16. Scale and soak evidence

Soak: 1,290 ticks over 3 simulated trading days including a one-hour provider
outage, 16 injected DB failures, and a fixed failure mix (500s, timeouts, 429s,
empties) — 18,132 provider calls, max 36 per tick, 347,100 candles,
**0 duplicates, 0 locks, queue drained to 0**.

## 17. Rollback evidence

Simulated and documented in `docs/V2_CLOSING_VALIDATION.md` §8: restoring the two
original cron lines stops V2 entirely; legacy triggers were never modified, so
legacy is unaffected. Dropping the five `*_v2` tables is safe because no legacy
object references them (verified by the migration audit and #21).

## 18. Remaining risks

| # | risk | status | what would close it |
|---|---|---|---|
| R1 | the holiday list is hand-maintained; a missed holiday makes the sweep expect 390 minutes and queue a useless repair (one request per symbol, once) | **RISK, bounded** | an exchange-calendar source, or an auto-suppress rule when every symbol reports 0 present |
| R2 | no external consumer of the legacy Supabase mirror was found **in this repo**; another Worker or an external client cannot be seen from here | **NOT PROVEN** | an account-wide search in the Cloudflare and Supabase dashboards. Non-blocking: V2 changes nothing about the mirror |
| R3 | the 30-minute revision window rests on a 52-row, one-symbol, one-day production sample | **RISK, mitigated** | a wider `first_seen`/`updated_at` study; mitigated because the sweep repairs anything later |
| R4 | `runs_v2` grows ~166 k rows/year with no retention | **RISK, quantified** | add retention when it matters; ~19 MB/year |
| R5 | Cloudflare's own subrequest accounting cannot be read from here; the ceiling of 50 is inferred from the production cutoff landing exactly at symbol 50 | **NOT PROVEN** | one Workers Logs trace of a scheduled invocation |

## 19. Files changed in this round

| file | change |
|---|---|
| `v2_pipeline.js` | atomic claim + lease + fencing; synthetic precedence; market calendar; weekend rejection in the canonical filter |
| `v2_routes.js` | real CSV splitter (quotes, BOM) |
| `v2_test.mjs` | bootstrap expectations corrected for weekend rejection (contract proven, not test massaged) |
| `v2_hardening.mjs` | **new** — 181 adversarial checks |
| `v2_soak.mjs` | **new** — 48 checks: soak, 1,000-symbol scale, 23 self-invented scenarios |
| `migrations/0001_v2_schema.sql` | regenerated with the lease/claim columns |
| `package.json` | both new suites wired into `npm test` |
| `docs/V2_HARDENING_REPORT.md` | this report |

## 20. Final verdict

**SAFE FOR 3-SYMBOL PRODUCTION CANARY.**

Against the gate: outbound ≤ safe budget in every stress test (max 36, never 37);
no duplicate claims under 10-way concurrency; no permanent locks across 7 crash
points; crash recovery proven; no starvation at 1,000 symbols; calendar and gap
logic correct for weekends, holidays and early closes; synthetic replaced by
real and never the reverse; DB-level uniqueness proven; migration provably
additive; import cannot corrupt good data; every mutation endpoint authenticated;
parity with zero unexplained mismatches; soak queue drained to zero; rollback is
one config line; all legacy suites green.

The five open items in §18 are risks to watch, not blockers — two of them
(R2, R5) are unprovable from this environment and neither affects V2's behaviour.
