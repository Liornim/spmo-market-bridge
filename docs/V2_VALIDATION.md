# V2 VALIDATION

Two suites, both running the real code against shims that enforce the real
ceiling. Neither modifies production.

## `v2_test.mjs` — 69 checks

| section | what it proves |
|---|---|
| 1 | canonical rules: minute alignment, 16:00 rejected, 15:59 kept |
| 2 | one symbol = one provider request; a cold symbol bootstraps 1,740 candles from a single request; re-running writes nothing |
| 3 | the second pass is bounded by the revision window (≤ 35 candidate rows, not 1,950) |
| 4 | 118 symbols under a 50 ceiling: all served in 4 executions, none exceeding 36 requests, first and last symbol equally covered |
| 5 | after a mid-run stop the next execution continues with a **disjoint** set — no restart at the first symbol |
| 6 | two failing symbols do not abort the other eight; backoff is bounded and visible; no retry storm |
| 7 | a D1 failure does not destroy the batch |
| 8 | gap detection, sweep queues one bounded repair, the next tick refills the hole without a browser |
| 9 | export/import round trip, preview before write, idempotent re-import, rejection of a 16:00 row and an impossible candle, columns read by name |
| 10 | copy from legacy D1: preview, canonical filtering, legacy table untouched, idempotent |
| 11 | status reports `used N / safe M`, per-symbol freshness, stale count |
| 12 | load: 27 / 50 / 118 / 200 / 500 symbols |
| 13 | duplicate invocation does no duplicate work; a cold isolate resumes from the queue |
| 14 | a job with missing symbol metadata does not crash the run |

## `v2_validation.mjs` — side by side, 11 checks

### Scenario A — identical provider payloads, 8 symbols including SPY, QQQ, SMH, HD, QCOM and a symbol last alphabetically

| symbol | legacy bars | V2 bars | legacy last | V2 last | OHLCV match | 16:00 rows | duplicate minutes |
|---|---|---|---|---|---|---|---|
| AAPL | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| NVDA | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| HD | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| QCOM | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| SPY | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| QQQ | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| SMH | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |
| ZZZZ | 390 | 390 | 15:59 | 15:59 | 390/390 | 0 / 0 | 0 / 0 |

Both reject the 16:00 stamp and the mid-minute null row (legacy does so since
the v250 audit fix). **Where both hold a minute, every OHLCV value is identical
— V2 changes the plumbing, not the data.**

### Scenario B — 118 symbols, ceiling 50: the case that broke production

```
legacy: 50/118 symbols collected in one invocation (last stored: S049)
V2    : 118/118 symbols collected across 5 executions, max 36 requests in any one
```

This is the whole point of V2, reproduced under laboratory conditions: the same
provider, the same ceiling, the same symbols — and no truncation.

## How to run

```
node v2_test.mjs          # 69 checks incl. the load table
node v2_validation.mjs    # side-by-side comparison
```
Both are part of `npm test`.
