# CONSISTENCY REPORT

## Method
`consistency_test.mjs` (repo root) runs the real `worker.js` against a
SQLite-backed D1 shim, ingests one full session through `/backfill`, and reads
the same symbol-day through every candle path: D1 directly, `/day` JSON,
`/day` CSV, `/board`, `/bars/export`, `/export`, `/bars/last`. It compares the
minute set and OHLCV field by field, and runs the completeness validator on
each. The provider payload reproduces two patterns MEASURED in the published
archive: a non-minute-aligned timestamp with null prices inside 14:51, and a
16:00 closing stamp. `CONSISTENCY_STRICT=0` makes it report without failing.

## Result at audit checkpoint v248 (LOCALLY VERIFIED)
| Path | rows | distinct minutes | dup minutes | outside session | verdict |
|---|---|---|---|---|---|
| D1 bars | 392 | 391 | 1 | 1 | CORRUPT |
| /day json | 392 | 391 | 1 | 1 | CORRUPT |
| /day csv | 392 | 391 | 1 | 1 | CORRUPT |
| /board | 392 | 391 | 1 | 1 | CORRUPT |
| /bars/export | 392 | 391 | 1 | 1 | CORRUPT |
| /export | 392 | 391 | 1 | 1 | CORRUPT |
| /bars/last (n capped) | 390 | 389 | 1 | 1 | CORRUPT |

Mismatch report (every path against the first stored row of the minute):

| symbol | minute | source A | source B | field | A | B | reason |
|---|---|---|---|---|---|---|---|
| SPMO | 14:51 | D1 first row | D1 second row (and every path) | o/h/l/c/v | 103.21/103.31/103.11/103.26/1321 | 103.26/103.26/103.26/103.26/0 | null-price provider timestamp 14:51:37 stored as its own row |

**The read paths agree with each other** — they all serve the same stored
rows. The disagreement appears in consumers, depending on how each collapses
two rows with the same minute label:

| Consumer | How it keys rows | What it shows for 14:51 |
|---|---|---|
| trader-v2-radar `absorb` | `date+unix` | both rows → the engine sees two 14:51 candles |
| `v2FindGap` | `time` | one — the duplicate is invisible |
| any map keyed by `time`, last-wins (e.g. a chart) | `time` | the **fake flat** bar |
| first-wins consumer | `time` | the real bar |
| archive CSV | `symbol,date,time` | both lines |

And the 16:00 row switches off the Trader's gap check entirely
(`v2FindGap` returns "no gap" when the last row is after 15:59).

## Same pattern in production (MEASURED, published archive `data` branch)
Validator on 6 symbols × 7 sessions (2026-09-08 … 09-17):
AAPL 5/7 CORRUPT, NVDA 5/7, BLK 6/7 (up to 5 duplicate minutes and 73 flat
volume-0 bars in a day), DE 5/7, PLD 5/7. Every CORRUPT day is caused by the
16:00 row and/or duplicate minutes; none had missing minutes. SPY is not in
the archive (404).

## Can card / download / upload / chart / Trader disagree?
Yes, for these reasons (all LOCALLY VERIFIED or MEASURED above):
1. duplicate minute rows, collapsed differently per consumer;
2. the 16:00 row counted as a candle by some consumers and not others;
3. `/bars/last` live top-up (v246) filters to minute starts while the stored
   path does not — the same minute can differ between the copy button and a
   stored read when the stored copy is the flat duplicate;
4. freshness: `/view`, the radar and the copy buttons read at different times
   and the store lags the market by 1–3 minutes (see DATA_FLOW §6).
There is no upload path into the Worker, so upload cannot create a
different stored version (CODE-DERIVED).

## After the fix
See CHANGELOG_AUDIT.md (F-DATA-1). The same test runs strict in the suite.
