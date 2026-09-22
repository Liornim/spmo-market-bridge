# SUBREQUEST ACCOUNTING — CALL BY CALL

Labels: **CODE-DERIVED** (read from source), **MEASURED** (published state /
logs / GitHub), **INFERRED FROM OBSERVED CUTOFF** (a model chosen because it
matches where failures actually begin — not direct platform proof), **UNKNOWN**.

---

## 3. What counts as a subrequest — corrected

I previously wrote that the data "proves" D1 and KV count against the limit.
**That was wrong, and the correction matters.** I had left the archive shard's
Supabase calls out of the arithmetic. With them included, the two models predict:

| model | external calls before the tracked loop | cost per tracked symbol | predicted first failure |
|---|---|---|---|
| **A: only `fetch()` counts** (Yahoo, Supabase, GitHub) | ~31–33 | 1 (the Yahoo pull) | **tracked symbol #17–19** |
| B: `fetch()` + D1 + KV all count | ~39 | 3–4 | tracked symbol #3–4 |

**MEASURED failure frequency per symbol** (out of 23 runs with errors on 09-18):

| position | symbol | runs failed |
|---|---|---|
| 15 | QCOM | 2 |
| 16 | QQQ | 19 |
| 17 | SMH | 22 |
| 18–27 | SPMO, SPY, TQQQ, TSLA, VOO, WFC, XLC, XLK, XLY | 23 each |

The cut-off sits between #15 and #18 — exactly where **model A** puts it, and
nowhere near model B. So: **external HTTP calls (Yahoo + Supabase) are what
exhausts the budget; D1 and KV binding calls are not the binding constraint
here.** Status: **INFERRED FROM OBSERVED CUTOFF.** Direct proof would need
Cloudflare's own runtime accounting, which I cannot read.

## 1. Full budget of one intraday cron invocation

Model A accounting. `→` marks an external call.

| # | step | function | destination | type | +ext | cumulative ext |
|---|---|---|---|---|---|---|
| 1 | `ensureSchema` | D1 DDL (first per isolate) | D1 | binding | 0 | 0 |
| 2 | `usageToday` | D1 `usage` | D1 | binding | 0 | 0 |
| 3 | `logEvent cron_fired` | KV get + put | KV | binding | 0 | 0 |
| 4 | `marketOpen` | pure CPU | — | — | 0 | 0 |
| 5 | `trackedSymbols` | D1 `symbols` | D1 | binding | 0 | 0 |
| 6 | `universeList` | D1 | D1 | binding | 0 | 0 |
| 7 | `archiveIntradayCursor` read | D1 `meta` | D1 | binding | 0 | 0 |
| 8 | `archiveId` cache refresh (≥5 min old) | `archive_symbols?select=id,symbol` | **Supabase** | fetch | 1 | 1 |
| 9–38 | **archive shard × 6 symbols** (see §4) | Yahoo 5d + Supabase writes | Yahoo, Supabase | fetch | 5 each = 30 | **31** |
| 39 | `archiveIntradayCursor` write | D1 `meta` | D1 | binding | 0 | 31 |
| 40 | `runs` INSERT | D1 | D1 | binding | 0 | 31 |
| 41 | #1 AAPL | `fetchYahoo('1d')` + D1 batches | Yahoo + D1 | fetch | 1 | 32 |
| 42 | #2 AMD | same | | 1 | 33 |
| … | … | | | | |
| 55 | #15 QCOM | same | | 1 | **46** |
| 56 | #16 QQQ | same | | 1 | 47 |
| 57 | #17 SMH | same | | 1 | 48 |
| 58 | #18 SPMO | same | | 1 | 49 |
| 59 | #19 SPY | same | | 1 | **50 → limit** |
| 60+ | #20–#27 | every call throws `Too many subrequests` | | | |
| last | `mirrorQueue` flush, 3 Supabase calls per changed symbol | Supabase | fetch | 3×N | never reached |
| last | `runs` UPDATE | D1 | D1 | binding | 0 | may still fail |

The exact crossing point moves with the archive shard's page count and with
whether `archiveId`'s 5-minute cache is warm, which is why the observed
boundary is a gradient (#15 rarely, #16 often, #18+ always) rather than a
single symbol.

## 4. The archive shard: why 6 symbols cost ~30 external calls

Per symbol, from `archiveWrite` (CODE-DERIVED):

| call | destination | count |
|---|---|---|
| `fetchYahoo(sym, '5d')` | Yahoo | 1 |
| `archive_bars?on_conflict=symbol_id,unix` POST, chunked at 1,000 rows | Supabase | ceil(bars/1000) = **2** for a 5-day pull (~1,950 bars) |
| `archive_bars?select=unix&limit=1` with `Prefer: count=exact` | Supabase | 1 |
| `archive_symbols?id=eq.N` PATCH (summary) | Supabase | 1 |
| `archiveId` lookup | Supabase | 0 when cached (5-minute TTL), else 1 |
| **per symbol** | | **5** |

`SHARD = min(10, floor((40 − tracked)/2))` → with 27 tracked, **6 symbols**, i.e.
**~30 external calls**, before a single live candle is fetched.

Note the code's own budget assumption: `BUDGET = 40` and 2 calls per archive
symbol. The real cost is 5, so the guard under-counts by more than half.

## 5. Does the archive cost grow as Supabase fills up?

**Writes: no.** `archiveWrite` posts only the bars just fetched — always a 5-day
pull, so 2 POSTs, regardless of archive size. The `count=exact` call is O(1) for
the client.

**Reads: yes, linearly.** `archiveRead` pages at 1,000 rows:
```
pages(symbol) = ceil(rows_in_window / 1000)
```
That is what the **publish** path pays: 7 days ≈ 3 pages, 17 days ≈ 7,
42 days ≈ 17. **MEASURED confirmation:** in the nightly runs of 09-21, every
`archive_pass 5/5` succeeded (writes are cheap) and every `publish_failed`
followed immediately on the same 5 symbols (reads are not) — e.g. slices
`NVDA, MSFT, AAPL, GOOGL, AMZN` at 00:05 and `META, AVGO, TSLA, BRK-B, JPM` at
00:10.

## 2 + 6. Execution order and whether `waitUntil` shares the budget

Order in `scheduledRun` (CODE-DERIVED):
1. preamble (quota, market check) — awaited
2. `trackedSymbols` — awaited
3. `ctx.waitUntil(<archive shard IIFE>)` — **started first**
4. `ctx.waitUntil(syncMany(...).then(mirror flush).then(log))` — started second
5. the handler returns immediately

Both run as promises inside the **same invocation**, concurrently, interleaving
their `await`s. The archive shard is started first, so its ~30 calls land early.

**Does `waitUntil` share the invocation's subrequest budget?** Cloudflare
documents `waitUntil` as extending the lifetime of the **same** invocation, and
limits are per invocation — so yes on the documentation. I cannot demonstrate it
from runtime output. Status: **INFERRED**, and it is the single load-bearing
assumption of this whole analysis. The supporting evidence is circumstantial but
consistent: the tracked-symbol failures start at a position that only makes
sense if ~30 calls were already spent elsewhere, and the only other consumer in
that invocation is the archive shard.

## 7. Which call fails first

Whatever is attempted after the budget is gone. In the tracked loop that is
almost always **`fetchYahoo`** — the first external call of `syncSymbol` — which
returns an error object, so the symbol is recorded as failed and the loop moves
on. **MEASURED:** every error string in `runs.json` is attached to a symbol,
i.e. it surfaced through the fetch path, not through a D1 call.

## 8 + 9. `partial` vs `running`, and whether `rows=0` means nothing was written

- `syncMany` inserts the run as `status='running', rows_written=0` **before** the loop.
- Each symbol has its own `try/catch`; failures go into `errors` and the loop continues.
- At the end it runs `UPDATE runs SET finished_at, status, rows_written, errors`.
- `status` is `partial` when some symbols failed, `failed` when all did, `ok` otherwise.

So a row stays `running` only if the invocation never reached that final UPDATE —
the invocation was cut short (CPU/time/subrequests) or the D1 call itself failed.

**MEASURED example of the misleading case:** on 09-18 the run at 15:57 ET is
`partial` with `rows_written = 23`, while the runs at 15:58, 15:59 and 16:00 are
`running` with `rows_written = 0`. Yet D1 holds bars for positions 1–15 up to
**15:57–15:58** on that date. Bars were written in invocations whose run row
still says zero. **`rows_written` is the counter's last value, not the truth.**

## 10 + 12. The 10 ETFs: by design, not by failure

`ARCHIVE_UNIVERSE` is a fixed list of **100 symbols, all individual stocks —
no ETFs** (CODE-DERIVED). `universeList` = that list plus `universe_extra`.
Both the nightly pass and the intraday shard iterate **only** that list.
So QQQ, SMH, SPMO, SPY, TQQQ, VOO, XLC, XLF, XLK, XLY are **never archived by
design**. The nightly Yahoo 5d pull does not cover them, which is why
`archive_bars` shows 0 for them.

Why they nonetheless have a row in `archive_symbols` with `bars = 0`:
**UNKNOWN** — no current code path creates a row without writing bars.

**But there is a second Supabase table.** `mirrorBars` writes to
`/rest/v1/bars` (`MIRROR_SCHEMA`), a different table from `archive_bars`, and it
covers **all tracked symbols including the ETFs**. That table is read by exactly
two routes: `/mirror/:sym` and `/selfcheck`. **No data path — `/day`, `/board`,
`/bars/export`, `/days`, publish — ever reads it.** So ETF data may exist in
Supabase and still be unreachable by every screen and every download.

## 11. All 27 symbols: position, archive, damage (MEASURED)

| # | symbol | archive_bars | 17/09 bars | 17/09 last | 18/09 bars | 18/09 last |
|---|---|---|---|---|---|---|
| 1 | AAPL | 6,641 | 388 | 15:57 | 389 | 15:58 |
| 2 | AMD | 5,859 | 213 | 13:02 | 388 | 15:57 |
| 3 | AMZN | 6,641 | 213 | 13:02 | 388 | 15:57 |
| 4 | ANET | 5,856 | 213 | 13:02 | 388 | 15:57 |
| 5 | AVGO | 6,640 | 213 | 13:02 | 388 | 15:57 |
| 6 | BRK-B | 6,640 | 212 | 13:01 | 388 | 15:57 |
| 7 | C | 5,858 | 212 | 13:01 | 388 | 15:57 |
| 8 | GOOGL | 6,641 | 212 | 13:01 | 388 | 15:57 |
| 9 | INTC | 5,858 | 212 | 13:01 | 388 | 15:57 |
| 10 | JPM | 6,640 | 212 | 13:01 | 388 | 15:57 |
| 11 | META | 6,640 | 212 | 13:01 | 388 | 15:57 |
| 12 | MSFT | 6,641 | 212 | 13:01 | 388 | 15:57 |
| 13 | NVDA | 6,641 | 212 | 13:01 | 388 | 15:57 |
| 14 | PLTR | 5,859 | 212 | 13:01 | 388 | 15:57 |
| 15 | QCOM | 5,858 | 212 | 13:01 | 388 | 15:57 |
| 16 | QQQ | **none** | 212 | 13:01 | 381 | 15:50 |
| 17 | SMH | **none** | 212 | 13:01 | 381 | 15:50 |
| 18 | SPMO | **none** | 141 | 11:50 | **2** | 09:31 |
| 19 | SPY | **none** | 54 | 10:23 | **2** | 09:31 |
| 20 | TQQQ | **none** | 54 | 10:23 | **no row** | — |
| 21 | TSLA | 6,641 | 54 | 10:23 | **no row** | — |
| 22 | VOO | **none** | 54 | 10:23 | **no row** | — |
| 23 | WFC | 5,858 | 54 | 10:23 | **no row** | — |
| 24 | XLC | **none** | 54 | 10:23 | **no row** | — |
| 25 | XLF | **none** | 34 | 10:03 | **no row** | — |
| 26 | XLK | **none** | 54 | 10:23 | **no row** | — |
| 27 | XLY | **none** | 54 | 10:23 | **no row** | — |

The gradient is monotonic in position, and the symbols with no archive copy are
concentrated at the end of the alphabet. **The structural bias you named is
real: position in the alphabet determines how much data a symbol keeps.**

## 13. Does a failed invocation lose the mirror for the symbols it did write?

Yes. `mirrorQueue` is a module-level array; `syncSymbol` pushes into it, and the
flush runs in `.then(...)` **after** the whole loop:
```
ctx.waitUntil(syncMany(...).then(async r => { const q = mirrorQueue; mirrorQueue = [];
  for (const item of q) await mirrorBars(env, item.sym, item.bars); ... }))
```
If the invocation dies mid-loop, the queue is never flushed — and because the
rows are already in D1, the **next** run sees `changes = 0` for those minutes and
never queues them again. D1 moves ahead of Supabase permanently for those bars.
(For tracked ETFs this is doubly moot: nothing reads the mirror table anyway.)

## 14. Worst case: independent Yahoo pulls for one symbol in one minute

| path | range | condition |
|---|---|---|
| cron `syncMany` | 1d | every minute |
| self-drive | 1d | a `/board`/`/radar`/`/tick` request, ≥60 s since the last |
| `/day` top-up | 1d | a full `/day` read of a stale symbol |
| `repairSessionGaps` | 5d | the same read, if the day has a hole |
| `/bars/last` live | 5d | the symbol is "behind" |
| intraday archive shard | 5d | only if the symbol is in the 100-symbol universe |
**Worst case: 6 pulls of the same symbol in the same minute**, from one Worker.

## 15. Are the 6 archive symbols fixed or rotating?

Rotating: `cur = archiveIntradayCursor(db)`, slice `[cur, cur+SHARD)`, then
`archiveIntradayCursor(db, cur + SHARD)` **after** the loop. If the invocation
dies before that write, the cursor does not advance and **the same 6 symbols are
re-fetched next minute** — spending the same ~30 external calls on data already
written, and starving the tracked list again. MEASURED in the nightly variant:
`archive_pass … cursor 5/119, 10/119, 15/119 …` advancing normally, and wrapping
at `cursor 120/119`.

## 16. One real invocation, 2026-09-18 (MEASURED + modelled)

The run at **15:57 ET**: status `partial`, `rows_written = 23`, errors naming
`SPMO, SPY, TQQQ, TSLA, VOO, WFC, XLC, XLK, XLY` (and in neighbouring runs
`QQQ`, `SMH`).

```
ext 1        archive_symbols id refresh (Supabase)
ext 2..31    archive shard, 6 universe symbols x 5 calls
               (Yahoo 5d, 2 POSTs, count, PATCH)
ext 32       #1  AAPL     Yahoo 1d   -> written, D1 now holds 15:57
ext 33       #2  AMD      Yahoo 1d   -> written
 ...
ext 46       #15 QCOM     Yahoo 1d   -> written (last success in this run)
ext 47       #16 QQQ      Yahoo 1d   -> written
ext 48       #17 SMH      Yahoo 1d   -> written
ext 49       #18 SPMO     Yahoo 1d   -> FAILS: Too many subrequests
ext 50+      #19..#27                -> all fail, same error
             mirrorQueue flush        -> never runs
             UPDATE runs              -> succeeded here (status partial, 23 rows)
                                         in the next three runs it did not
                                         (status stayed "running", rows 0)
```
D1 after that day: positions 1–15 reach 15:57, 16–17 reach 15:50, 18–19 hold
2 bars, 20–27 have no row at all — which is exactly the measured table in §11.

---

## Corrections to my earlier statements
1. **The accounting model is reversed.** Including the archive shard's Supabase
   calls, the evidence fits "only external `fetch()` counts", not "D1 and KV
   count too". My previous claim that the data proved D1 counting was wrong —
   it was arithmetic that omitted 30 Supabase calls.
2. The archive shard costs **~5 external calls per symbol (~30 for the shard)**,
   not ~4 per symbol / 24 total.
3. The ETFs are missing from the archive **by design** (`ARCHIVE_UNIVERSE` has
   no ETFs), not because of a failure.
4. There are **two** Supabase tables: `archive_bars` (universe, read by
   everything) and `bars` (mirror of D1, read by nothing but two diagnostics).
