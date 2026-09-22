# DATA FORENSICS — WHAT HAPPENED, CURRENT STATE ONLY

Sources of evidence: the `data` branch state files published by the Worker
(`days.json`, `runs.json`, `coverage.json`, `storage.json`, generated
2026-09-21T08:36:28Z), the published CSVs and manifests, the GitHub API, and the
repo source. **MEASURED** = from those files. **CODE-DERIVED** = computed from
source. **UNKNOWN** = stated as such. No fixes proposed here.

---

## 1–2. The 206 partial days are not random holes — they are end-of-day truncations

Across all **374 symbol-days** in D1 (MEASURED):

| pattern | symbol-days |
|---|---|
| starts at 09:30 | **374 (100%)** |
| contiguous block, no internal holes | **294** |
| has internal holes | **15** (holes of 1, 2, 3, 5, 7 minutes) |
| more than 390 bars | 65 |

So the damage is: the day begins correctly and **stops early**.

**Cut-off minute by date** — how many symbols stopped at the same minute:

| date | symbols cut | shared cut-off minutes |
|---|---|---|
| 2026-09-08 | 25 | 15:33 ×18, 15:18 ×4 |
| 2026-09-09 | 26 | 15:31 ×12, 15:32 ×7, 15:19 ×6 |
| 2026-09-10 | 27 | 15:30 ×19, 15:17 ×7 |
| **2026-09-14** | 25 | **11:53 ×25 — one single cut-off for the whole board** |
| 2026-09-15 | 25 | 15:18 ×19, 11:16 ×5 |
| 2026-09-16 | 24 | 12:55 ×19, 12:51 ×5 |
| **2026-09-17** | 27 | 13:01 ×12, 10:23 ×8, 13:02 ×4, 11:50 ×1, 10:03 ×1 |
| 2026-09-18 | 19 | 15:57 ×14, 15:50 ×2, 09:31 ×2 |

This is a batch failure, not missing candles.

## 6 + 17 + 18. The cut follows the alphabetical position of the symbol

`trackedSymbols` orders by `SELECT … ORDER BY symbol` and `syncMany` walks that
list **sequentially inside one Worker invocation** (CODE-DERIVED, with the
comment "Sequential on purpose: parallel hits on Yahoo from one IP get
throttled"). So the order is fixed:

`1.AAPL 2.AMD 3.AMZN 4.ANET 5.AVGO 6.BRK-B 7.C 8.GOOGL 9.INTC 10.JPM 11.META
12.MSFT 13.NVDA 14.PLTR 15.QCOM 16.QQQ 17.SMH 18.SPMO 19.SPY 20.TQQQ 21.TSLA
22.VOO 23.WFC 24.XLC 25.XLF 26.XLK 27.XLY`

**2026-09-17, by position (MEASURED):**

| position | symbols | last bar | missing |
|---|---|---|---|
| 1 | AAPL | 15:57 | 2 |
| 2–5 | AMD, AMZN, ANET, AVGO | 13:02 | 177 |
| 6–17 | BRK-B … SMH | 13:01 | 178 |
| 18 | SPMO | 11:50 | 249 |
| 19–27 | SPY, TQQQ, TSLA, VOO, WFC, XLC, XLF, XLK, XLY | 10:23 (XLF 10:03) | 336–356 |

**The later a symbol sits in the alphabet, the earlier its data stops.** That is
the signature the question predicted, and it is confirmed by the run log.

## 5. Root cause, with direct evidence

`runs.json` (MEASURED, 100 runs, 2026-09-18 14:21 → 16:00 ET):

| status | runs | rows written |
|---|---|---|
| `partial` **with errors** | 23 | 22–212 |
| `running`, never finished, 0 rows | **77** | 0 |

Every error is the same: **`Too many subrequests by single Worker invocation`**.
The symbols named in those errors, with how many runs each failed in:

`SPMO 23, SPY 23, TQQQ 23, TSLA 23, VOO 23, WFC 23, XLC 23, XLK 23, XLY 23,
SMH 22, QQQ 19, QCOM 2`

— i.e. **only symbols at positions 15–27**. Nothing earlier in the alphabet ever
fails.

**Mechanism (CODE-DERIVED):** one cron invocation syncs all 26–27 symbols
sequentially. Each `syncSymbol` costs 1 Yahoo fetch plus its D1 statements
(upsert batch, `DAYS_REFRESH`, `symbols` update, mirror read). Cloudflare counts
each of those as a subrequest, with a limit of about 50 per invocation. The
budget is exhausted around symbol 14–17, and everything after that throws.
The 77 runs stuck at `running` with 0 rows are invocations that never reached the
closing `UPDATE runs` at all.

**This is the same failure class as the GitHub publish error** — one invocation,
too many outbound calls — and it explains both the truncated days and the stale
CSVs.

**What is NOT proven:** what changed on 13–14/09 to push it over the edge. The
published state contains no deployment history, and `runs.json` holds only the
last 100 runs (one afternoon). Candidates visible in the data: the tracked list
grew (09-08 added AMD, ANET, INTC; 09-09 QCOM; more later), and the archive grew,
making each `archiveRead` page count larger. **UNKNOWN which one crossed the
limit, and on which date exactly.**

## 3 + 4. Composition of the 65 over-length days (MEASURED, decomposed)

| composition | days |
|---|---|
| exactly one extra row at **16:00**, no duplicate minutes | **59** |
| duplicate minutes inside 09:30–15:59 (1, 4, 5, 16 of them) | 6 |
| worst case | SPMO 2026-09-11: 406 bars = 16 duplicate minutes |

A duplicate minute can only exist when the two rows have different `unix`
(the primary key is `(symbol, unix)`), so **every duplicate minute is also a
non-minute-aligned timestamp**. The two categories in the question are the same
rows counted twice.

**Canonical / rejected across the whole store:** of 123,854 rows, the rejected
ones are (59 × 1) + (1+4+5+16 + 2 more days' worth) ≈ **85 rows**, i.e.
**0.07%**. Exact per-row classification needs `/table/bars` or `/export` per day,
which requires Worker access — **UNKNOWN at row level**.

## 7. 2026-09-18 in full (MEASURED)

19 symbols have a row for that date; 8 have none at all. The "2 bars" case is
`09:31` as last bar. Positions 1–13 all reach 15:57–15:58; the tail does not
appear at all. The `first` column is 09:30 for every symbol that has a row, and
the largest gap is always the tail (contiguous block, as in §1).

## 8. The ETF contradiction — the correct number is 10

Tracked symbols with **zero rows and null summaries** in the archive:
`QQQ, SMH, SPMO, SPY, TQQQ, VOO, XLC, XLF, XLK, XLY` = **10**. My earlier "11"
was a miscount of the same list. For these, **D1 is the only store**.

## 9. What `bars` means in `archive_symbols` — correction

CODE-DERIVED from `archiveWrite`: after writing, it issues
`archive_bars?select=unix&symbol_id=eq.<id>&limit=1` with `Prefer: count=exact`
and PATCHes `bars` with the total from the `content-range` header. **It is an
exact row count at write time, not a write counter.** My previous statement that
it "behaves like a write counter" was wrong.

`first_unix` and `last_unix`, however, are set to `Math.min/max` **of the batch
just written**, so they describe the last write, not the archive. That is why
every symbol reports first_unix = 2026-09-14: the last nightly 5-day batch.

## 10 + 25. Why AAPL's CSV holds 2,735 rows and stops at 2026-09-16

The published manifests answer this directly (MEASURED):

```
data/manifest/NVDA.json  generated 2026-09-17T00:15:46Z   days: 7
  AAPL  rows 2735  dates 7  2026-09-08..2026-09-16  bars/day [391,391,390,391,391,390,391]
```

1. **The file was last written on 2026-09-17**, by a publish run whose
   `PUBLISH_DAYS` was **7** — the manifest records the parameter. The current
   source has `PUBLISH_DAYS = ARCHIVE_DAYS = 42`; the deployment that last
   published successfully used 7. So 2,735 rows = exactly 7 days × 390/391.
2. **Nothing has published that shard since.** The nightly runs on 09-18 → 09-21
   failed with `publish_failed: Too many subrequests` (MEASURED in the event log).
3. The file still exists in the newest commit because `publishFiles` builds each
   commit on a stored `base_tree`, carrying unchanged files forward.
4. So the chain is: Supabase (which does hold 09-17 and 09-18) → **publish never
   ran** → GitHub file frozen at the 09-17 content.

No rows are lost in pagination: 2,735 = 1000 + 1000 + 735, a clean short final
page, matching `ARCHIVE_PAGE = 1000`.

**Bonus finding (CODE-DERIVED + MEASURED):** `publishFiles` creates every commit
with `parents: []` and force-updates the ref. Each publish therefore replaces the
branch with a **single parentless commit**, which is why `data/bars/AAPL.csv` has
exactly one commit in its history. **There is no older data in git history at
all** — the archive-of-last-resort does not exist.

## 11. Per-day bar counts inside the published AAPL CSV (MEASURED)

`[391, 391, 390, 391, 391, 390, 391]` for 09-08 … 09-16 — i.e. **391 on five of
the seven days**: the 16:00 row again, now also inside the published archive.
No missing minutes in those days.

## 12 + 13. Where the archive's better data came from, and why D1 stayed broken

The source comment states the mechanism outright (CODE-DERIVED):

> "The live collector re-checks OVERLAP_BARS trailing bars. … a minute that
> fills in beyond the overlap window is therefore never recovered during the
> session. The nightly 5-day backfill does recover it, which is why the archive
> reads 390/390 while D1 shows holes hours old."

For a minute missing in D1 but present in Supabase there is exactly one possible
write path: **`archiveNightlyShard` → `fetchYahoo(sym, '5d')` → `archiveWrite`**.
The mirror path cannot produce it, because the mirror only copies rows that
exist in D1.

**Reconciliation Supabase → D1: there is no automatic one.** The only path that
writes archive rows into D1 is `repairSessionGaps`, and it runs **only** inside a
full `/day` read — i.e. when a human opens that symbol-day, or a radar's
`repairFromOpen` picks it. Nothing scans for damaged days on its own.

## 14 + 15. Quota thresholds and what stops (CODE-DERIVED)

`TIER_WARN 0.55`, `TIER_FRUGAL 0.75`, `TIER_FROZEN 0.90`, graded **separately**
for reads (`reads / 5,000,000`) and writes (`writes / 100,000`).

| tier | ingestion | reads | what is served |
|---|---|---|---|
| normal | all | all | D1 |
| warn ≥55% | unchanged | unchanged | D1 + a `budget_warn` KV event per request |
| frugal ≥75% | **cron stands down for ALL symbols** (`cron_skipped`); `/day` top-up blocked; `/daily` refresh blocked | `/day` full read of today prefers a KV snapshot | snapshot or stale D1 |
| frozen ≥90% | cron stands down; self-drive disabled | `/board` and `/day` refuse D1 | KV snapshot, else 503 |

**Which counter stops ingestion:** the cron checks `budget.write_tier` **and**
`budget.read_tier` (`if (write_tier is frugal|frozen || read_tier === 'frozen')`),
so a **read**-driven frozen state also stops writing. The numbers come from the
Worker's own `usage` table, which is a per-isolate lower bound — not from
Cloudflare's meter.

**Important for this incident:** the published usage for 09-21 is
`reads 5,247 / read_pct 0.1 / tier normal`. **The quota was NOT the cause of the
truncation on 14–18/09** — the run log shows subrequest exhaustion, not a
stand-down. My earlier attribution of that damage to the quota was wrong.

## 16. Is the feedback loop real? Yes, and it is code-visible

At frugal the cron stops ⇒ minutes are missed ⇒ the gap sits beyond the 15-minute
overlap ⇒ it can only be fixed by a **full** `/day` read ⇒ every such read costs
~390 rows plus a Supabase read plus a Yahoo 5d fetch ⇒ `repairSessionGaps` has
**no cooldown**, so an unfillable gap repeats that cost on every full read. The
loop exists. Whether it has fired in production is **UNKNOWN** (usage was normal
in the snapshot).

## 19. Cron rows_read, itemised (CODE-DERIVED, one 390-minute session, 27 symbols)

| component | arithmetic | rows |
|---|---|---|
| `DAYS_REFRESH` (recount of the whole symbol-day per sync) | Σ₁..₃₉₀ × 27 = 76,245 × 27 | 2,058,615 |
| mirror re-read of changed rows (15-minute overlap) | 15 × 27 × 390 | 157,950 |
| `trackedSymbols` per run | 27 × 390 | 10,530 |
| `usage` row per run | 1 × 390 | 390 |
| **total** | | **2,227,485** |

My earlier figure of 2,216,565 omitted the last two lines.

## 20. V2 radar tab, rows/hour (CODE-DERIVED formula)

Per refresh at 60 s, with 27 symbols and the day at minute *m*:
- `/board?since` (9 of every 10 passes): 27 × 15 = **405 rows**
- `/board` full (1 of every 10): 27 × *m* rows; averaged over the session (*m*≈195) = **5,265**
- `/day?since` for market ETFs (SPY, QQQ + up to 4 sector ETFs): 6 × 15 = **90**
- `/usage`: **21**; `/tick`: **1**

Per hour at 60 s: 54×405 + 6×5,265 + 60×(90+21+1) = 21,870 + 31,590 + 6,720 =
**60,180 rows/h** (average day position). Late in the session the full pass costs
27×390 = 10,530, giving 54×405 + 6×10,530 + 6,720 = **91,770 rows/h**.
My earlier single number, 86,310, used 390 rows per symbol for the full pass and
folded the ETFs in differently; the formula above is the accurate one.

At 3 s the refresh count is ×20: **≈1.2M–1.8M rows/h**, i.e. one tab exceeds the
daily limit within a session.

## 21. Does `/board?since` really read incrementally? Yes

SQL: `… WHERE symbol IN (…) AND date = ? AND unix > ? AND <canonical> ORDER BY
symbol, unix`, served by the `(symbol, date, unix)` index (EXPLAIN on the 1M-row
replica: `SEARCH bars USING INDEX bars_symbol_date_unix`). Rows read ≈ rows
returned. The model's 15 rows/symbol for a 15-minute overlap is correct; the
full pass every 10th refresh is the expensive part.

## 22. `/view` = four full-day reads per refresh

`load()` requests `/day/SYM/DATE?format=json` for the symbol **and** for SPY,
QQQ and the sector ETF — **none of them uses `since`**. Each is
`SELECT * FROM bars WHERE symbol = ? AND date = ? AND <canonical> ORDER BY unix`.
Rows/refresh = 4 × *m* (4 × 390 = 1,560 at the end of the day), i.e. up to
**93,600 rows/hour** at the fixed 60-second interval.

## 23. How KV reaches ~690 writes/day, event by event (CODE-DERIVED)

| event | runs/day | puts if nothing folds |
|---|---|---|
| `cron_fired` | 540 | 540 |
| `cron_skipped_closed` (runs outside 09:30–16:00) | 150 | 150 |
| **total, cron only** | | **690** |

Folding only suppresses a write when the **immediately previous** entry is
identical. During the session `cron_fired` would fold (→ ~39 writes) if nothing
interleaved; a single `board_full_read` or `budget_warn` from one open tab breaks
the chain. **MEASURED:** in the published log, 163 `cron_fired` and 150
`cron_skipped_closed` entries with **zero folded repeats**, so the no-fold case
is what actually happens. Best case ≈ 339/day, worst case 690/day, before any
per-request events.

## 24. Publish subrequests, best and worst case (CODE-DERIVED)

Per symbol: 1 id lookup (cached 5 min) + ceil(rows/1000) pages.

| archive size per symbol | pages | 5-symbol nightly shard | 10-symbol `/publish/shard` |
|---|---|---|---|
| 2,735 rows (7 days) | 3 | 5×(1+3)=20 +5 Yahoo +5 writes +4 GitHub +~5 D1 ≈ **39** | 10×4=40 +4 +~5 ≈ **49** |
| 6,641 rows (17 days) | 7 | 5×8=40 +5 +5 +4 +5 ≈ **59** | 10×8=80 +4 +5 ≈ **89** |
| 16,380 rows (42 days) | 17 | 5×18=90 … ≈ **109** | ≈ **179** |

Against a ~50 subrequest limit the failure is **deterministic above roughly
3,500–4,000 rows per symbol** for the 5-symbol nightly shard — which is exactly
when it started failing. Best case (fresh symbols, few rows) still passes.

## 26. vol_x on a real candle — AAPL 2026-09-15 15:38, volume 56,545 (MEASURED rows)

| surface | denominator | value |
|---|---|---|
| `engine.cjs volx` / V2 `relVol` | avg of 09:30–15:38, 369 bars = 53,350 | **1.06** |
| radar CSV copy / server full-day CSV | avg of all 390 printed rows = 60,588 | **0.93** |
| analysis pack §15 | avg of the 50 printed rows, 14:49–15:38 = 39,347 | **1.44** |
| `/day?since` returning 3 rows | avg of 15:36–15:38 = 51,480 | **1.10** |

The engine's participation threshold is `volSurge = 1.2`. The same candle is
above it in the pack and below it everywhere else.

## 27. Other window-dependent metrics (CODE-DERIVED)

| metric | window used | same on every surface? |
|---|---|---|
| VWAP | cumulative from the first **loaded** row | **no** — a truncated or partial day shifts it |
| EMA9 / EMA20 | seeded from the first loaded row, k=2/10 and 2/21 | **no** — same seeding problem |
| ATR / "average candle range" | last 20 loaded bars | **no** |
| relative volume | see §26 | **no** |
| session high/low/open | first and last loaded rows | **no** |
| market context | SPY/QQQ/sector analyses, each from its own `/day` | **no** — fetched separately |
| daily context (multi-day) | days loaded in the tab (usually ≤6) | **no** |
Only the raw OHLCV of a single stored minute is window-independent.

## 28. Copy Card as-of — what the code produces

A single card mixes: candles as-of the last refresh (3–120 s ago + 1–3 min
ingestion lag); SPY/QQQ/sector as-of the same `loadAll` but separate requests;
the Cboe book as-of the refresh **after** the card was opened; prior days and
calibration as-of when the card was opened. Only the candle time and the book
timestamp are printed. **A real timestamp-by-timestamp example needs a live
session, which I cannot run — UNKNOWN as a measurement, certain as a code path.**

## 29. Silent fallbacks returning HTTP 200 with partial data — final count: **12**

`/bars/export` (Supabase failure), `/days` (Supabase failure), `/board`
(Supabase failure / symbol budget), `/day` (archive fallback failure),
`/bars/daily` (`daily_bars` failure), `/archive/dates` (probe failures),
`/bars/last` (live failures — **this one does tell the client**), radar range
copy (day failures — count only), `localStorage` quota, `snapshotPut` failure,
usage/route meter flush failure, mirror-to-Supabase failure.
**Client is told:** 3 of 12 (`not_fetched`, `live_failed`/`not_reached`,
`from_snapshot`). **User is told:** 2 (the copy message, the snapshot toast).

## 30. DATA LOSS / DIVERGENCE LEDGER (MEASURED where stated)

Yahoo keeps roughly 7 days of 1-minute history, so recoverability depends on
today's date relative to the damaged day.

| date | D1 state | Supabase | GitHub CSV | recoverable from Yahoo |
|---|---|---|---|---|
| 2026-08-26 … 09-04 | complete or ±1 row (20–23 symbols) | **absent** for these dates (archive starts later) | absent | **no** — beyond Yahoo's 1-minute window |
| 2026-09-08 | 25 symbols cut at 15:18–15:33 | 390/391 per day (published files prove it) | published (09-08 present) | no |
| 2026-09-09 | 26 symbols cut at 15:17–15:32 | 390/391 | published | no |
| 2026-09-10 | 27 symbols cut at 15:17–15:30 | 390/391 | published | no |
| 2026-09-11 | complete; SPMO has 16 duplicate minutes | 391 | published | no |
| **2026-09-14** | **25 symbols stop at 11:53** (144 bars) | 391 (manifest) | published | no |
| 2026-09-15 | 19 symbols cut at 15:18, 5 at 11:16 | 390 | published | no |
| 2026-09-16 | 19 cut at 12:55, 5 at 12:51 | 391 | published (last published date) | no |
| **2026-09-17** | **staircase 13:02 → 10:03 by alphabet** | in Supabase (manifest of the 09-18 shard) | **not published** | borderline |
| **2026-09-18** | 19 symbols cut at 15:57; **8 symbols missing entirely** | in Supabase | **not published** | borderline |
| 2026-09-19 onward | **UNKNOWN** — the published state stops at 09-21 08:36Z | UNKNOWN | not published | UNKNOWN |

**Net:** no candle in this ledger is lost outright — every damaged D1 day
appears complete in Supabase — but **nothing moves it back into D1 automatically**,
and the GitHub copy stopped on 09-16.

---

## Corrections to my earlier statements
1. The 14–18/09 damage was **not** caused by the D1 quota. It was subrequest
   exhaustion inside the cron (MEASURED in `runs.json`). Usage was `normal`.
2. Supabase `bars` is an **exact count**, not a write counter.
3. The ETFs missing from the archive number **10**, not 11.
4. Cron rows_read per session is **2,227,485** when `trackedSymbols` and the
   `usage` read are included, not 2,216,565.
5. V2 radar at 60 s is **60,180–91,770 rows/h** depending on the day position,
   not a flat 86,310.
6. Git history holds **nothing** older: every publish commit is parentless and
   force-pushed, so the branch has exactly one commit.


---

# MEASURED FROM PRODUCTION, 2026-09-22 20:59Z

Three things were resolved by two live requests to the Worker.

## A. The missing SPY minutes are NOT in the mirror — the data is gone

`GET /mirror/read/SPY/2026-09-17` returns **52 rows, 09:30 → 10:21**.
D1 for the same symbol-day holds **54 rows, ending 10:23**.

So the mirror table does not hold the truncated afternoon. This settles the open
question: for the 10 ETFs (SPY, QQQ, SMH, TQQQ, VOO, XLC, XLF, XLK, XLY, SPMO)
the minutes after the cron cut **exist in no store at all** —
not D1, not `archive_bars` (they are not in the universe by design), not the
mirror `bars` table, not GitHub.

Recovery window: Yahoo serves roughly 7 days of 1-minute history, so as of
2026-09-22 the 09-17 and 09-18 sessions are still inside it. That is a fact
about the provider, not a recommendation.

## B. The mirrorQueue loss now has a measured instance

D1: 54 rows, last **10:23**. Mirror: 52 rows, last **10:21**.
The mirror is exactly **two minutes behind D1** — the last invocation(s) wrote
the bars to D1 and died before reaching the `mirrorQueue` flush, and because
those minutes are already stored, no later run produces `changes > 0` for them,
so they will never be queued again.
**Status upgraded: CODE-PROVEN → MEASURED.**

## C. `/mirror/verify` fails with the same subrequest wall

```
GET /mirror/verify
{"error":true,"path":"/mirror/verify",
 "message":"Too many subrequests by single Worker invocation", ...}
```
The route loops over every tracked symbol issuing a `count=exact` request per
symbol (27 external calls) on top of the request preamble. This is the same
limit that truncates the cron, now reproduced on demand from a plain GET —
independent confirmation that the 50-external-request ceiling is what the system
keeps hitting, on read paths as well as on the cron.

## D. Incidental: volume-0 minutes with real OHLC

In the returned SPY rows, 09:52 and 10:07 carry four distinct prices
(e.g. 761.28 / 761.74 / 761.20 / 761.36) with `volume: 0`. These are not the
synthesized flat bars described in the candle contract (those have
open = high = low = close); they are minutes where the provider supplied prices
but no volume, and `fetchYahoo` maps a null volume to 0. Consequence: every
relative-volume definition returns 0 for those minutes, and the V2 engine's
participation test (`volSurge = 1.2`) can never pass on them.

`revisions` in the same rows runs 0–2, confirming that minutes are rewritten by
the 15-minute overlap window as expected.


---

# LIVE STATE, 2026-09-22 21:04Z (MEASURED from /status and /days/SPY)

## The tracked list grew from 26 to 118 symbols

`recent_runs` reports `symbols: 118` on every run. `/status` lists ~118 symbols,
and most of the new ones have `days: 1, bars: 234, revisions: 0` — they were
added on 2026-09-21 and have collected one partial day since.

This is the escalation the earlier analysis predicted: one cron invocation now
attempts **118 Yahoo pulls + ~30 archive calls + up to 118 mirror POSTs**
against a 50-external-request limit.

## Today's damage, by alphabetical position (MEASURED)

| symbols | last stored bar (ET) | note |
|---|---|---|
| AAPL (#1) | **09-22 15:59** | complete day |
| ABBV (#2) | 09-22 15:48 | |
| ABNB … GS (≈#3–50) | 09-22 15:10 | |
| **HD … XLY (≈#51–118)** | **09-21 13:23** | **nothing at all today — stuck since yesterday** |
| QQQ, SMH, SPY, XLC, XLF, XLK, XLY | 09-22 09:53 | see below |
| TQQQ, TSLA, VOO | 09-21 13:15 | |

`worst_stale_seconds: 100086` = 27.8 hours.

**Why the ETFs have a later bar than their neighbours:** they are the market
context symbols that both radars load through `/day` (`loadSymbol` for SPY, QQQ
and the sector ETFs). That path performs its own top-up sync, so a browser tab
open at 09:53 pulled them while the cron never reached them. It is direct
evidence that **UI activity, not the cron, is what keeps some symbols alive.**

## Every symbol carries the same error

`last_error` on essentially every symbol from HD onward:
`Too many subrequests by single Worker invocation`.

## The run log is uninformative by construction

All ten recent runs: `status: running`, `rows_written: 0`, `errors: null`,
`finished_at: null` — the closing UPDATE never executes. Bars *were* written
(AAPL reached 15:59 today), so the run table reports zero for runs that
succeeded partially. Confirms §5 of CRON_FAILURE_CHAIN.md.

## The quota was never the problem

`reads 2,658 / 5,000,000 (0.1%)`, `writes 523 / 100,000 (0.5%)`, tier `normal`
on all three counters. KV: 0 puts today. **The system is failing at 0.1% of its
database quota**, purely on the per-invocation external-request ceiling.

## SPY day by day (MEASURED, /days/SPY)

| date | bars | last | verdict |
|---|---|---|---|
| 09-22 | **24** | 09:53 | today, still open when read |
| 09-21 | 234 | 13:23 | truncated |
| 09-18 | **2** | 09:31 | truncated |
| 09-17 | 54 | 10:23 | truncated |
| 09-16 | 206 | 12:55 | truncated |
| 09-15 | 349 | 15:18 | truncated |
| 09-14 | 144 | 11:53 | truncated |
| 09-11 | 390 | 15:59 | complete |
| 09-10 | 361 | 15:30 | truncated |
| 09-09 | 362 | 15:31 | truncated |
| 09-08 | 364 | 15:33 | truncated |
| 09-04, 09-02, 09-01 | 391, 392, 391 | 16:00 | over-length (16:00 row, and 09-02 has a duplicate minute) |
| 08-26 … 08-31 | 390 | 15:59 | complete |
| **09-03** | 248 | — | **`source: archive` — the day exists only in Supabase, not in D1** |

So for SPY: 4 clean days out of 19, one day that lives only in the archive, and
every session since 09-08 truncated.

## Mirror vs D1 for AAPL 2026-09-17

`/mirror/read/AAPL/2026-09-17` returns rows 09:33 → 09:37 with
`revisions: 0` and `first_seen == updated_at`. D1 holds 388 bars for that day.
A full three-store value comparison still needs `/export/AAPL/2026-09-17`
alongside a direct `archive_bars` query — **still UNKNOWN**.


---

# CORRECTION FROM /coverage, 2026-09-22 (MEASURED)

`/coverage` returns per-symbol counts for both stores. It overturns part of the
loss ledger.

## The archive holds the days D1 is missing — for every stock symbol

| symbol | D1 days / bars | archive days / bars |
|---|---|---|
| HD | **1 / 234** | **15.6 / 6,086** |
| HON | 1 / 234 | 16.0 / 6,236 |
| NVDA | 17 / 5,817 | 17.6 / 6,867 |
| MSFT | 17 / 5,743 | 17.6 / 6,867 |
| JPM | 17 / 5,743 | 17.6 / 6,868 |
| TSLA | 16 / 4,918 | 17.6 / 6,868 |
| QCOM | 9 / 2,646 | 16.0 / 6,248 |
| WFC | 11 / 2,964 | 15.6 / 6,089 |

Totals: **129 symbols registered, 118 with live D1 bars, 119 with archive bars,
`registered_but_empty: []`.**

So the sessions truncated in D1 on 09-14 … 09-18 **exist in `archive_bars`** for
every symbol with `in_universe: true`. Earlier I wrote that the truncated
minutes were "gone" — that is correct **only for the ETFs**.

## Exactly which symbols are genuinely unrecoverable

`in_universe: false` **and** `archive_bars: 0`:

**QQQ, SMH, SPMO, SPY, TQQQ, VOO, XLC, XLF, XLK, XLY** — 10 symbols.

These are never archived (not in `ARCHIVE_UNIVERSE`), their mirror copy holds
only what D1 held (MEASURED earlier: SPY 09-17 ends at 10:21 versus D1's 10:23),
and Yahoo keeps roughly 7 days of 1-minute history. For them the 09-14 … 09-18
afternoons are recoverable only until that window closes.

## The archive stopped at 09-21

Every archive entry reports `last: 2026-09-21`, and only the ETFs (served by
browser `/day` top-ups) show `last: 2026-09-22`. That is the intraday shard
being switched off by `SHARD = 0` above 40 tracked symbols: the universe now
only advances on the nightly pass.

## Eleven universe symbols are archived but not tracked

TSM, TXN, UBER, UNH, UNP, V, VRTX, VZ, WM, WMT, XOM — `live_tracked: false`,
`d1_bars: 0`, archive 14.6–16 days each. They exist only in Supabase, and no
screen reads them unless a path falls back to the archive.

## What this changes

| claim | status now |
|---|---|
| "the truncated minutes exist in no store" | **wrong for 108 symbols**, right for the 10 ETFs |
| "D1 is the operational store, Supabase the partial archive" | inverted in practice: for most symbols the archive holds **more** days than D1 |
| "no reconciliation path exists" | unchanged — `repairSessionGaps` can read the archive, but only inside a full `/day` read |
