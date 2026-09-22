# EXECUTION ORDER, THE TWO SUPABASE TABLES, AND THE 21/09 CASE

Labels: **CODE-DERIVED**, **MEASURED**, **INFERRED**, **UNKNOWN**.
Your external note about the platform limits (50 external subrequests per
invocation on Free, ~1,000 internal binding calls, `waitUntil` staying inside the
same invocation) matches the model the data forced me to adopt, and I treat it
as the documented limit from here on.

---

## 1. Execution order — my "30 before the loop" was wrong

CODE-DERIVED, `scheduledRun`:

| line | what happens |
|---|---|
| — | quota check, market check, `trackedSymbols` (awaited, binding calls only) |
| **3268** | `ctx.waitUntil((async () => { … intraday archive shard … })())` — promise **started** |
| **3297** | `ctx.waitUntil(syncMany(...).then(mirror flush).then(log))` — promise **started** |
| — | the handler returns; both promises keep running in the same invocation |

So the archive shard does **not** complete before the loop. Both run
**concurrently and interleave at every `await`**: the archive's Yahoo fetch, then
a live symbol's fetch, then an archive POST, and so on. The archive is started
first, so it gets a head start, but the two consume the same counter in
interleaved order.

**This is why the failure point moves** between QCOM (#15), QQQ (#16) and SMH
(#17) from run to run: the crossing depends on how the two promises interleave,
on whether `archiveId`'s 5-minute cache is warm, and on how many POST chunks that
minute's archive symbols need. MEASURED: QCOM fails in 2 of 23 runs, QQQ in 19,
SMH in 22, everything from #18 in all 23.

## 2. Exact external ledger for one real run

**UNKNOWN as a measurement.** Nothing records individual `fetch()` calls: the
Worker logs events, not requests, and Workers Logs (where the runtime would show
them) is not readable from here. What exists is the modelled order in §16 plus
the MEASURED outcome per symbol. To produce a true ledger you would need the
Cloudflare Workers Logs / trace for one scheduled invocation.

## 3. Which plan and limits are configured

`wrangler.toml` has **no `[limits]` block** (CODE-DERIVED) — so whatever the
account's plan default is, applies; nothing is overridden in config. The account
is on the Free plan (your Cloudflare email), and the error text itself is the
Free-plan subrequest message. Status: **CODE-DERIVED for "no override",
external evidence for the plan.**

## 4. Proof that a Supabase write is 5 external calls per symbol

From `archiveWrite` (CODE-DERIVED, line by line):

| line | call | requests |
|---|---|---|
| `const id = await archiveId(env, sym)` | `archive_symbols?select=id,symbol` (cached 5 min; POST if the symbol is new) | 0–2 |
| `for (let i = 0; i < bars.length; i += 1000)` → `sb('archive_bars?on_conflict=symbol_id,unix', POST)` | **one POST per 1,000 bars**; a 5-day pull ≈ 1,950 bars | **2** |
| `sb('archive_bars?select=unix&symbol_id=eq.ID&limit=1', Prefer: count=exact)` | 1 | 1 |
| `sb('archive_symbols?id=eq.ID', PATCH)` | 1 | 1 |
| plus the Yahoo 5d pull in the caller | 1 | 1 |
| **total** | | **5 (6 when the id cache is cold)** |

No assumption: each `sb(...)` is a single `fetch`.

## 5. What `ctx.waitUntil` does here

Line 3268 creates the archive promise by invoking an async IIFE — **it starts
executing immediately**, up to its first `await` (the `universeList` binding
call), and continues as the event loop lets it. Line 3297 does the same for
`syncMany`. The handler then returns, and `waitUntil` keeps the invocation alive
until both settle. There is no isolation: one shared subrequest counter, one
CPU budget, one time budget.

## 6. What is actually inside the Supabase `bars` mirror table

**UNKNOWN.** I cannot query Supabase (no credentials in the sandbox) and cannot
reach the Worker's `/mirror/:sym` route (403 to workers.dev). This is the
highest-value unknown left, because the missing ETF minutes may be sitting there.
To resolve it, one of: `GET /mirror/SPY?date=2026-09-17` from a browser, or
`GET /mirror/compare`, or a direct Supabase query
`select count(*), min(date), max(date) from bars where symbol='SPY'`.

## 7. Complete reader/writer map of the two tables (CODE-DERIVED, every `sb()` call)

| table | function / route | op | purpose |
|---|---|---|---|
| **`archive_bars`** | `archiveWrite` (1117, 1124) | POST, GET count | write the universe archive |
| | `archiveRead` (1151) | GET paged | **the read path used by `/day` fallback, `/board` fallback, `/bars/export`, `/export`, `/days`, `/archive/check`, `/archive/dates`, publish** |
| | `archivePrune` (1178) | DELETE | 42-day retention |
| | `/archive/dates` (2306) | GET | coverage probes |
| | `/archive` status (2430), `/archive?apply` (2750) | GET count | before deleting from D1 |
| **`archive_symbols`** | `archiveId` (1078, 1086, 1097, 1103) | GET, POST | id lookup / create |
| | `archiveWrite` (1127) | PATCH | summary columns |
| | `publishState` (866, 869), `/bars/index` (1853), `/coverage` (2301, 2322, 2357), `/archive` (2749) | GET | listings |
| **`bars` (mirror)** | `mirrorBars` (623) | POST | **the only writer** |
| | `mirrorRead` (642) → `/mirror/:sym`, `/selfcheck` | GET | diagnostics |
| | `/mirror/compare` (2831) | GET count | diagnostics |

**Confirmed: no data path reads the mirror table.** Every screen, download and
export reads `archive_bars`. The mirror is written at a cost of 3 external calls
per symbol per sync and is consumed by nothing but two diagnostic routes.

## 8. Can one candle exist in three versions at once?

Yes, by construction (CODE-DERIVED):
| store | written by | contents |
|---|---|---|
| D1 `bars` | cron / self-drive / `/day` top-up (Yahoo **1d**) | OHLCV + `revisions`, `first_seen`, `updated_at` |
| Supabase `bars` | `mirrorBars`, copying D1 rows | the same fields, as of the moment the mirror ran |
| Supabase `archive_bars` | `archiveWrite` from an **independent Yahoo 5d pull** | OHLCV only, prices as integers ×10,000 |
They can disagree because (a) the 1d and 5d Yahoo feeds are fetched at different
times and the 5d feed fills minutes the 1d feed dropped, and (b) the mirror can
be skipped entirely (§11). **A three-way value comparison for one real candle is
UNKNOWN** — it needs the two Supabase queries above.

## 9. Why an ETF has an `archive_symbols` row with `bars = 0`

The only code that creates such a row is `archiveId(env, sym)` with the default
`create = true`, and the only caller that uses the default is **`archiveWrite`**
(`archiveRead` passes `false`). So the sequence must have been: something called
`archiveWrite` for an ETF — reachable through `/archive/fill/:syms` (the scan
page's "השלם חסרים" and the bars page pass arbitrary symbols) or `/universe/add`
— the row was created, and then the POST or the fetch failed, leaving the
summary at its default 0. **INFERRED**; nothing records which call it was.
Note the consequence: `archive_symbols` lists symbols that the archive never
collects, and `/bars/index` unions that list into the symbol picker.

## 10. Cursor failure loop — mechanism proven, instance not

CODE-DERIVED: `archiveIntradayCursor(db, cur + SHARD)` runs **after** the loop.
If the invocation dies first, the cursor stays, and the next minute re-fetches
the same 6 symbols. **MEASURED for the nightly variant** the opposite case —
cursor advancing cleanly: `archive_pass … cursor 5/119, 10/119, 15/119, 20/119,
25/119, 30/119` and wrapping at `120/119`. For the **intraday** shard the
published log covers a weekend only, so there is no failing pair to show:
**UNKNOWN as an observed instance.**

## 11. mirrorQueue loss — mechanism proven, instance not

CODE-DERIVED chain: `syncSymbol` pushes to `mirrorQueue` only when
`changes > 0`; the flush runs in `.then()` after the whole loop; a truncated
invocation never reaches it; `mirrorQueue` is module state that a new isolate
starts empty; and the next run re-reads the same minutes from Yahoo, finds the
values already stored, gets `changes = 0`, and therefore **never queues them
again**. So a candle written to D1 in a run that later died can be permanently
absent from the mirror. **The specific instance (AAPL on a failed run) is
UNKNOWN** — it needs the mirror-table query from §6.

## 12. How often the archive rewrites the same symbol in a day

With the cursor advancing normally: 6 symbols × 390 minutes = **2,340
symbol-writes per day** across a 119-symbol universe = **~19.7 rewrites per
symbol per day**, each posting a **5-day** pull (~1,950 rows) =
**~4.5 million rows POSTed to Supabase per day** to maintain an archive that
grows by ~46,000 rows a day. If the cursor fails to advance, the same symbols
repeat and the number rises further.

## 13. What the budget formula assumed vs reality

`SHARD = min(10, floor((40 − tracked)/2))` — the `/2` says the author budgeted
**2 external calls per archive symbol**, and the `40 − tracked` says **1 per
tracked symbol**, for an assumed total of 27 + 12 = **39 of 50**.
Reality: 5 per archive symbol (30), 1 per tracked symbol (27), plus 3 per symbol
for the mirror flush (81) = **138 external calls needed**, against a 50 limit.
**The guard under-counts by 3.5×.**

## 14. Where `archive_bars` data comes from for a tracked symbol

Only from the nightly or intraday **Yahoo 5d** pull. `mirrorBars` writes to the
other table and never touches `archive_bars` (§7). So for a symbol that is both
tracked and in the universe (AAPL, NVDA, META…), **D1 and the archive are built
from two independent Yahoo fetches** — different moments, different ranges
(1d vs 5d), no comparison between them. That is the structural reason the
archive can hold 390/390 while D1 holds 144.

## 15. Nightly vs intraday archive — same writer, different wrapper

| | intraday (every minute) | nightly (`*/5 0-1 UTC`) |
|---|---|---|
| code | inline IIFE in `scheduledRun` (3268) | `archiveNightlyShard` |
| symbols per run | `min(10, floor((40−tracked)/2))` = **6** | `NIGHTLY_SHARD` = **5** |
| writer | `archiveWrite` (same function) | `archiveWrite` (same function) |
| also publishes to GitHub | **no** | **yes** — `publishShard` on the same symbols |
| also prunes | no | yes, on cursor wrap |
| MEASURED result | no events in the published window | `archive_pass 5/5` **succeeds**, then `publish_failed` |

That table answers why the nightly archive succeeds and the publish behind it
does not: the write is 5 calls per symbol (25 for the shard), while the publish
adds `ceil(rows/1000)` **read** pages per symbol — 7 per symbol at today's size,
35 more — crossing 50 right at the publish step.

## 16. Budget split of one intraday invocation (50 external)

| responsibility | external calls | share |
|---|---|---|
| **archive shard** (6 universe symbols × 5) | **30** | **60%** |
| live ingestion (1 Yahoo pull per tracked symbol) | 27 needed | 54% needed |
| mirror flush (3 per changed symbol) | 81 needed | 162% needed |
| diagnostics/metadata (`archiveId` refresh) | 1 | 2% |
| **total demanded** | **139** | **278% of the limit** |

## 17. Simulation: the same cron without any archive work (calculation only)

With the archive shard removed and everything else unchanged:
- live ingestion: 27 Yahoo pulls → **all 27 symbols reached**, 23 calls to spare;
- mirror flush: needs 81 calls, has 22 → **the flush would still fail around the
  7th symbol**.

So the archive shard is **the** reason live ingestion truncates (it takes 60% of
the budget), and the mirror is a second, independent over-subscription that no
amount of ordering fixes. Both statements are arithmetic, not a recommendation.

## 18. The 21/09 case, closed

| path | what it read | why it looked current or stale | write-back? |
|---|---|---|---|
| `/day`, `/board` → screens, Trader, radar | **D1 only** (Supabase only for a past date with zero D1 rows) | D1 stopped at the minute the cron budget ran out | repair can write back, but only during a **full** `/day` read; `repairFromOpen` skips days that start at 09:30, which these do |
| `/bars/export` download | D1 ∪ `archive_bars` | looked fuller than the screen for universe symbols; unchanged for the 10 ETFs, which have no archive rows | none |
| `/export`, scan copy | D1 only when D1 has any row | looked exactly as truncated as the screen | none |
| **`/bars/last?n=2`** | symbol "behind" (newest bar older than 120 s while open) → **`fetchYahoo(sym,'5d')` live** | returned 15:37–15:38 for every symbol, including ones whose stored day ended hours earlier | **explicitly none** — the code comment states the route is a pure read; the rows are returned and discarded |
| published GitHub CSV | `archive_bars` via publish | frozen at 09-16, publish failing since | n/a |

That is the whole contradiction in one table: five buttons, five different
sources, and the only one that was current is the one that never stores what it
fetched.

---

## Corrections to my earlier statements
1. **"~30 archive calls happen before the tracked loop" was wrong.** Both run as
   concurrent `waitUntil` promises and interleave; the archive merely starts first.
2. The archive shard costs **5 external calls per symbol**, and the code's own
   guard assumed 2 — a 3.5× under-count across the invocation.
3. Even with the archive removed, the **mirror flush alone** exceeds the budget
   (81 needed, 22 available).
