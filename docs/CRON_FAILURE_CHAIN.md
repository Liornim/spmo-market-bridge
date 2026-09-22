# CRON INVOCATION — SUBREQUEST BUDGET AND FAILURE CHAIN

Evidence: repo source (CODE-DERIVED), the published `runs.json` / `days.json` /
`coverage.json` / manifests (MEASURED, snapshot 2026-09-21T08:36Z), and
Cloudflare's documented per-invocation subrequest limit. No fixes proposed.

---

## 2. What counts as a subrequest — and how the data settles it

Cloudflare counts outbound `fetch()` **and** binding calls (D1, KV) against the
per-invocation subrequest limit; the free plan limit is 50. I cannot run the
platform to prove its accounting, so I tested the two candidate models against
the observed failure position instead.

| model | cost per tracked symbol | predicted first failure | observed |
|---|---|---|---|
| only external `fetch()` counts | 1 (Yahoo) | symbol ~24 | — |
| `fetch()` + D1 + KV all count | 3–4 | symbol **14–15** | **QCOM = #15** |

**MEASURED:** the first symbol ever named in a cron error is QCOM (position 15),
and everything from position 15 onward fails. That matches the second model and
rules out the first. So **D1 calls consume the same budget as Yahoo calls.**

## 1. Budget of one cron invocation, step by step

Preamble, then 27 symbols in alphabetical order. `ensureSchema` costs extra on
the first invocation of each isolate only.

| step | function | destination | +subreq | cumulative |
|---|---|---|---|---|
| `usageToday` | D1 `usage` | D1 | 1 | 1 |
| `logEvent cron_fired` | KV get + put | KV | 2 | 3 |
| `trackedSymbols` | D1 `symbols` | D1 | 1 | 4 |
| `universeList` (for the intraday archive shard) | D1 | D1 | 1 | 5 |
| `archiveIntradayCursor` read | D1 `meta` | D1 | 1 | 6 |
| `runs` INSERT … RETURNING (start of `syncMany`) | D1 | D1 | 1 | 7 |
| **#1 AAPL** | Yahoo 1d + upsert batch + bookkeeping batch + mirror read | Yahoo, D1 ×3 | 3–4 | ~10 |
| #2 AMD | same | | 3–4 | ~13 |
| … | | | | |
| **#14 PLTR** | same | | 3–4 | **~48** |
| **#15 QCOM** | Yahoo fetch | **fails: Too many subrequests** | — | **>50** |
| #16–#27 QQQ … XLY | every one fails the same way | | | |
| `mirrorQueue` flush (after `syncMany`) | 3 Supabase calls per changed symbol | Supabase | 3×N | never reached |
| `runs` UPDATE (finalise) | D1 | D1 | 1 | often fails too |

**In parallel, in the same invocation:** `ctx.waitUntil` runs the *intraday
archive shard* — `SHARD = min(10, floor((40 − tracked)/2))` = **6 symbols** with
27 tracked — each costing 1 Yahoo 5d fetch + ~3 Supabase calls ≈ **24 more
subrequests**, drawn from the same budget. `waitUntil` work shares the
invocation's limits; it is not a separate budget.

## 3. `syncSymbol` trace, one symbol

| part | calls | subreq |
|---|---|---|
| `fetchYahoo(sym, '1d')` | 1 external fetch | 1 |
| normalization (`localDateTime`, canonical filter) | pure CPU | 0 |
| bar upserts | `db.batch` of ≤100 statements — **one batch call** | 1 per 100 bars (incremental: 1) |
| bookkeeping (`DAYS_REFRESH` per date + `symbols` upsert) | one `db.batch` when anything changed, else one `UPDATE` | 1 |
| mirror read (`SELECT … FROM bars WHERE symbol=? AND unix>=?`) | only when `changes > 0` and Supabase is configured | 0 or 1 |
| Supabase write | **not here** — queued in memory, flushed after `syncMany` | 0 |
| logging | none per symbol | 0 |
| **total** | | **3 when nothing changed, 4 when it did** |

## 4. Is the cost per symbol constant? No — the formula

```
subrequests(symbol) = 1                      // Yahoo fetch
                    + ceil(bars_to_write / 100)   // upsert batches (1 for an incremental pull)
                    + 1                      // bookkeeping batch, or the no-change UPDATE
                    + (changes > 0 && mirrorOn ? 1 : 0)   // mirror read
```
It grows with a backfill (`5d` ≈ 1,950 bars → 20 batches), with a first contact
(`firstContact` forces the bookkeeping batch), and with gap repair (which adds a
Supabase read plus a Yahoo 5d fetch on top). It does **not** depend on the quota
tier, except that frugal stops the run entirely.

## 5. `running` vs `partial` — and why `runs.json` is misleading

- `syncMany` writes the row as `status='running', rows_written=0` **before** the
  loop, and updates it at the end.
- Each symbol is wrapped in its own `try/catch`, so a failing symbol becomes an
  entry in `errors` and the loop continues → final status `partial`.
- The closing `UPDATE runs …` is itself a D1 call. **When the budget is already
  exhausted, that update fails too**, and the row stays `running` with
  `rows_written = 0` forever.

**So `running` + 0 rows does NOT mean nothing was written.** Bars for the early
symbols were committed; only the bookkeeping row was never closed. MEASURED: 77
of 100 runs are in exactly that state. `runs.json` therefore under-reports both
success and volume.

## 6. Does the failure kill only that symbol, or everything after it?

Control flow: the exception is raised inside `fetchYahoo`/`db` and caught by the
per-symbol `catch` in `syncMany`, so the loop **continues**. But the budget is a
property of the invocation, not of the symbol, so **every subsequent symbol
fails the same way**. That is why the errors always cover a contiguous tail.
`ctx.waitUntil` tasks already started (the archive shard) keep running and keep
consuming the same exhausted budget, so they fail too — MEASURED as
`archive_intraday_partial` events.

## 7. What survives a failed invocation

| item | state after the failure |
|---|---|
| D1 bars for symbols before the cut | **committed** — each `db.batch` is its own transaction |
| `days` / `symbols` bookkeeping for those symbols | committed |
| Supabase mirror for those symbols | **not written** — the flush runs after the loop and never gets there |
| `runs` row | left `running`, 0 rows |
| symbols after the cut | nothing at all |

So one invocation routinely leaves a **partial transaction across symbols**:
D1 ahead of Supabase for the early names, nothing for the late ones.

## 8. 2026-09-14: why 25 symbols stop at exactly 11:53

MEASURED: 25 of 27 symbols have `last = 11:53` and 144 bars. The two exceptions
are AAPL (390, last 15:59) and AMZN (391, last 16:00).

Reading: the cron stopped succeeding **for every symbol** at 11:53 — not just the
tail. From that minute on, either the whole invocation died before symbol #1 or
the run never wrote. The two complete symbols were filled **later, by a different
path**: AMZN's 391 bars include a 16:00 row, which is the signature of a
`5d`-range fetch — the range used by `repairSessionGaps` and by backfill, never
by the `1d` cron pull. That is consistent with somebody opening those two
symbols in `/view` or a radar, which triggers a full `/day` read and repair.

**UNKNOWN:** the exact reason the 11:53 invocation and every one after it failed
at symbol #1 — `runs.json` only covers 09-18, so there is no run record for 09-14.

## 9. Why AAPL is nearly complete and the tail is not

AAPL is position #1, so **every** invocation reaches it before the budget runs
out. The tail is reached only when the earlier symbols happen to be cheap (no
changes → 3 instead of 4 subrequests). The 2026-09-17 staircase is exactly that:

| position | last bar | interpretation |
|---|---|---|
| 1 AAPL | 15:57 | reached almost every minute |
| 2–5 | 13:02 | reached until the budget tightened |
| 6–17 | 13:01 | one symbol earlier in the same minute |
| 18 SPMO | 11:50 | dropped earlier |
| 19–27 | 10:23 (XLF 10:03) | stopped being reached mid-morning |

## 10. What changed around 13–14/09 — what can and cannot be proven

**MEASURED (symbols present per date in D1):**

| date | symbols with data | note |
|---|---|---|
| 08-26 … 09-03 | 20 | stable |
| 09-04 | 23 | +3 |
| 09-08 | 26 | +3 (AMD, ANET, INTC) |
| 09-09 | 27 | +QCOM |
| 09-10 onward | 27 | stable |

**MEASURED (archive):** the earliest date in any published CSV or manifest is
**2026-09-08** — the Supabase archive began then. Before that date there was no
mirror read per symbol and no intraday archive shard.

Putting those together: the per-invocation cost jumped twice in the same week —
tracked symbols 20 → 27 (+21 subrequests at 3 each) **and** the archive going
live (+1 mirror read per changed symbol, +24 for the intraday shard). The
damage starts on 09-08, the exact date the archive appears, and worsens as the
symbol count rises.

**Not provable from what I can read:** the deployment dates and the code
versions in between. The published build stamp is a single value (`v234,
2026-09-17`), `runs.json` holds one afternoon, and the git history of the `data`
branch is destroyed by the parentless force-push. **There is no deployment
timeline to reconstruct.**

## 11. Everything one cron invocation is responsible for

1. quota check (D1) and the `cron_fired` event (KV)
2. market-open check
3. live ingestion of all 27 tracked symbols: Yahoo + D1 writes + bookkeeping
4. the `days` recount per symbol-day (`DAYS_REFRESH`)
5. reading back changed rows for the mirror
6. flushing the mirror queue to Supabase (3 calls per symbol)
7. **the intraday archive shard: 6 universe symbols, Yahoo 5d + Supabase writes**
8. the archive cursor update (D1)
9. failure logging (KV)
10. closing the `runs` row (D1)

Items 5–8 are not needed to store the current minute, and they share the same
budget as item 3.

## 12. D1 vs Supabase in the damaged week (MEASURED)

| symbol | date | D1 bars | D1 last | Supabase | source of the Supabase figure |
|---|---|---|---|---|---|
| AAPL | 09-14 | 390 (repaired) | 15:59 | 391 | manifest NVDA shard |
| AAPL | 09-16 | 390 | 15:59 | 390 | manifest NVDA shard |
| AAPL | 09-17, 09-18 | 388 / 389 | 15:57 / 15:58 | present | META-shard manifest covers 09-17 |
| META | 09-14 | 144 | 11:53 | 391 | manifest META shard |
| META | 09-17 | 212 | 13:01 | 391 | manifest META shard |
| TSLA | 09-17 | 212 | 13:01 | in archive (6,641 rows) | coverage |
| WFC | 09-17 | 54 | 10:23 | in archive (5,858 rows) | coverage |
| **QQQ, SPY, XLY, SMH, SPMO, TQQQ, VOO, XLC, XLF, XLK** | 09-14 … 09-18 | 54–212 | 10:23–13:01 | **0 rows — absent from the archive** | coverage |

**The decisive overlap:** of the 13 symbols that fail in the cron errors, **10
have no archive copy at all**: QQQ, SMH, SPMO, SPY, TQQQ, VOO, XLC, XLF, XLK,
XLY. The symbols that lose the most data are exactly the ones with no backup.
Only QCOM, TSLA and WFC among the failing set are recoverable from Supabase.

## 13. Is Supabase itself complete? No — "391" is not "complete"

MEASURED from the published manifests and CSVs: `bars_per_day` is
`[391, 391, 390, 391, 391, 390, 391]` for AAPL and most symbols. So:
- **391 = 390 session minutes + one 16:00 row.** The archive carries the same
  non-canonical row as D1.
- Some symbols report 392 (ICE on 09-11, DUK on 09-17) and 2,736 total (AMT, PM)
  → **duplicate minutes exist in the archive too**.
- No day in the published files is short, so no missing internal minutes there.
- **Non-minute timestamps:** cannot be checked from the CSV, which has no `unix`
  column — **UNKNOWN**, though a duplicate minute implies one.

## 14. Is there any reconciliation back into D1? No

- No job scans for damaged days.
- `repairSessionGaps` **does** read Supabase first (then Yahoo 5d), but it runs
  **only inside a full `/day` read** — no `since` cursor, more than one row.
- Its triggers are: a human opening `/view`, `/bars`, a radar card, the replay
  page, or a radar's `repairFromOpen` (≤8 symbols whose first row is after 09:35
  — note: a day truncated at 11:53 starts at 09:30, so `repairFromOpen` does
  **not** select it).
- **A day nobody opens stays damaged in D1 indefinitely.** That is the state of
  the tail symbols for 09-14 … 09-18.

## 15. Current-day failure model — cron starts failing at 12:00

| symbol | 13:00 | 14:00 | 15:59 |
|---|---|---|---|
| #1 AAPL | up to date if any invocation reaches #1 | same | same |
| #5 AVGO | stops wherever the budget stopped reaching #5 | frozen there | frozen, unless a full `/day` read repairs it |
| #15 QCOM | frozen at 12:00 | frozen | frozen |
| #27 XLY | frozen at 12:00 | frozen | frozen |

What can change that picture during the day:
- **self-drive** (`/board`, `/radar`, `/tick`) calls the same `syncMany` with the
  same budget and the same order → it heals the head of the alphabet, not the tail.
- **`/day` full read** on a symbol → gap repair → that one symbol-day is filled
  from Supabase or Yahoo 5d.
- **Radar / Trader** show stale symbols with a STALE badge; the V2 gap check
  reports the hole; the engine keeps deciding on whatever rows exist.
- **`/bars/last`** bypasses all of it (see §16).

So yes: **UI activity heals whichever symbols a human happens to look at**, which
is why AAPL and AMZN are complete on 09-14 and the rest are not.

## 16. Why "last 2 bars" was current on 09-21 while full days were truncated

Proven trace, both paths in code:
- **Full-day path:** `/day`, `/board` → `readDay` / board SQL → **D1 only** (plus
  a Supabase fallback for a past date). If the cron never stored 14:00–15:59,
  D1 has nothing and the screen shows the truncation.
- **Latest-bars path:** `/bars/last` marks a symbol "behind" when its newest
  stored bar is older than 120 s while the market is open, and then calls
  **`fetchYahoo(sym, '5d')` live**, returns those rows, and **never stores them**
  (`read_live` in the response names those symbols).

Both statements are therefore true at once: the store is truncated, and the copy
button shows the current minute, because the copy button is not reading the store.

## 17. Independent ingestion paths (7)

| # | trigger | source | writes to | symbols | frequency | can repair old bars? |
|---|---|---|---|---|---|---|
| 1 | cron, every minute | Yahoo 1d | D1 | 27 tracked, alphabetical | 1/min | only within the 15-minute overlap |
| 2 | cron `waitUntil` intraday shard | Yahoo 5d | Supabase | 6 universe symbols per run | 1/min | yes, 5 days back |
| 3 | nightly cron | Yahoo 5d | Supabase | 5 universe symbols per run | every 5 min, 00–02 UTC | yes, 5 days back |
| 4 | self-drive (`/board`, `/radar`, `/tick`) | Yahoo 1d | D1 | all tracked, same order | ≥60 s apart | only within the overlap |
| 5 | `/day` top-up | Yahoo 1d | D1 | one symbol | per request, when stale | no |
| 6 | `repairSessionGaps` inside a full `/day` | Supabase, then Yahoo 5d | D1 | one symbol-day | per full read, no cooldown | **yes — the only path back into D1** |
| 7 | `/watch/add`, `/universe/add`, `/archive/fill` | Yahoo 1d / 5d | D1 / Supabase | as requested | manual | yes |

## 18. FAILURE CHAIN

```
ROOT EVENT
  one cron invocation must do live ingestion for 27 symbols
  AND mirror reads AND a 6-symbol intraday archive shard
      ↓
BUDGET EXHAUSTED
  the per-invocation subrequest limit (~50). Cost is ~3–4 per tracked symbol
  plus ~24 for the archive shard plus ~7 preamble  →  well over 50
  (evidence: failure always begins at symbol #15, which only the
   "D1 calls count too" model predicts)
      ↓
WHICH FUNCTION FAILS
  fetchYahoo / db calls inside syncSymbol throw
  "Too many subrequests by single Worker invocation";
  the closing UPDATE of the runs row often fails as well
      ↓
WHICH SYMBOLS ARE SKIPPED
  every symbol from the cut position to the end of the alphabet
  (MEASURED: QCOM, QQQ, SMH, SPMO, SPY, TQQQ, TSLA, VOO, WFC, XLC, XLF, XLK, XLY)
      ↓
WHAT REMAINS IN D1
  the day starts at 09:30 and stops at the minute the budget ran out;
  294 of 374 symbol-days are contiguous blocks with no internal holes;
  the run row is left "running, 0 rows", so the log under-reports the damage
      ↓
WHAT NIGHTLY PUTS IN SUPABASE
  a 5-day Yahoo backfill rebuilds those days — but only for the 119 universe
  symbols. 10 of the 13 symbols that fail most are ETFs that are NOT in the
  universe, so nothing backs them up
      ↓
WHAT THE UI AND TRADER SEE NEXT DAY
  D1 still truncated (no reconciliation job); a day is repaired only if a human
  opens it, which is why AAPL and AMZN are complete on 09-14 and the rest are not.
  Trader evaluates on a day that ends at 11:53 and reports it as STALE;
  indicators (VWAP, EMA, relative volume) are computed over the truncated window
      ↓
WHY DIFFERENT BUTTONS RETURN DIFFERENT DATASETS
  /day and /board read the truncated D1;
  /bars/last fetches Yahoo live and shows the current minute;
  /bars/export unions D1 with Supabase and looks fuller;
  /export returns D1 only and looks truncated;
  the published CSV is frozen at 09-16 because the publish hits the same
  subrequest wall.
```

## Corrections to my own earlier statements
1. I attributed the 14–18/09 damage to the D1 quota. It is the subrequest limit;
   usage was `normal` (0.1%) in the same snapshot.
2. `runs.json` cannot be read at face value: `running`/0 rows still means data
   was written for the early symbols.
3. The intraday archive shard (6 symbols) runs **inside the same cron
   invocation** as live ingestion — I had described the archive as nightly-only.
