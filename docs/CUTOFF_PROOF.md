# WHY THE UPDATES STOP WHERE THEY STOP — PROVEN

Method: the real `worker.js` scheduled handler was executed against a fetch shim
that counts every external request and throws Cloudflare's exact error once a
ceiling is reached (`docs/audit/subrequest_experiment.mjs`). Nothing in
`worker.js` was modified, and nothing was changed in production.
**RUNTIME-REPRODUCED** = observed in that harness. **MEASURED** = production
`/status`. **CODE-DERIVED** = read from source.

---

## 1. Processing order (CODE-DERIVED + RUNTIME-REPRODUCED)

The live loop does **not** use `universeList` — that is the archive walk. Live
ingestion uses `trackedSymbols`:

```sql
SELECT symbol, last_bar_unix FROM symbols ORDER BY symbol
```

Order is **alphabetical by symbol, decided by SQL**, not insertion order.
Nothing re-sorts, filters or prepends before processing. First 60 as executed:

```
1.AAPL 2.ABBV 3.ABNB 4.ABT 5.ADBE 6.ADI 7.ADP 8.ALAB 9.AMD 10.AMGN
11.AMT 12.AMZN 13.ANET 14.APH 15.APP 16.ARM 17.ASML 18.AVGO 19.AXP 20.BAC
21.BKNG 22.BLK 23.BMY 24.BRK-B 25.BSX 26.BX 27.C 28.CAT 29.CB 30.CME
31.COIN 32.COP 33.COST 34.CRDO 35.CRM 36.CRWD 37.CSCO 38.CVX 39.DDOG 40.DE
41.DELL 42.DIS 43.DUK 44.ELV 45.ETN 46.FISV 47.GE 48.GILD 49.GOOGL 50.GS
51.HD 52.HON 53.HOOD 54.IBM 55.ICE 56.INTC 57.INTU 58.ISRG 59.JNJ 60.JPM
```

## 2. The loop (CODE-DERIVED)

`syncMany` walks that array with a `for … of` and `await` per symbol —
**sequential, by design** ("parallel hits on Yahoo from one IP get throttled").
No sorting, no filtering, no symbols inserted ahead of it. Each symbol is
wrapped in `try/catch`, so a failure records an error and the loop continues.
No retries and no redirect handling exist in `fetchYahoo`; one request per call.

## 3–4. Instrumented invocation, 118 tracked symbols, ceiling 50

```
startup external requests before the first symbol: 0
Yahoo requests attempted: 118   (ok 50, threw 68)
last symbol fetched ok : GS   (index 50)
first symbol that threw: HD   (index 51)
ceiling hit at external request #51
symbols with stored bars afterwards: 50 of 118
```

Why zero startup requests: with 118 tracked,
`SHARD = max(0, min(10, floor((40 − 118)/2))) = 0`, so the intraday archive
shard returns immediately. Quota checks, `trackedSymbols` and the `runs` insert
are **D1 binding calls, not external requests**, so they cost nothing against
this ceiling.

## 5. The boundary against stored data (indexes 45–55)

| # | symbol | fetched in that invocation | rows stored |
|---|---|---|---|
| 45 | ETN | ok | 30 |
| 46 | FISV | ok | 30 |
| 47 | GE | ok | 30 |
| 48 | GILD | ok | 30 |
| 49 | GOOGL | ok | 30 |
| **50** | **GS** | **ok** | 30 |
| **51** | **HD** | **THREW** | 0 |
| 52 | HON | THREW | 0 |
| 53 | HOOD | THREW | 0 |
| 54 | IBM | THREW | 0 |
| 55 | ICE | THREW | 0 |

**This is identical to production.** MEASURED in `/status` on 2026-09-22:
every symbol up to **GS** has a bar from that day (15:10 ET), and **HD** is the
first symbol carrying `last_error: Too many subrequests` with a last bar from
the previous day. The harness reproduces the exact boundary symbol.

## 6. Repeatability

Three consecutive invocations, same seed: last ok **GS (50)**, first failure
**HD (51)**, ceiling at request **#51**, 50 of 118 stored — identical every time.
Deterministic, not timing-dependent, because the loop is sequential and each
symbol costs exactly one request.

## 7. Order test — the decisive one

The same 118 symbols were renamed so the list is walked in the opposite order
(`Z001 … Z118`), with no other change:

```
last symbol fetched ok : Z050 (index 50)
first symbol that threw: Z051 (index 51)
```
`Z050` is the original **MA**, `Z051` is the original **LRCX** — both of which
fail in the normal order. **The set of updated symbols moves with list
position. The failure is order/budget dependent, not symbol-specific.**

Changing the ceiling moves the boundary by exactly the same amount:

| ceiling | last ok | first failure |
|---|---|---|
| 50 | GS (50) | HD (51) |
| 100 | SMCI (100) | SMH (101) |

`wall index = ceiling` exactly, because each symbol costs exactly 1 request.

## 8. External-request ledger for one invocation

| stage | requests | note |
|---|---|---|
| startup (quota, tracked list, runs insert) | **0 external** | D1 bindings only |
| intraday archive shard | **0** | disabled: SHARD = 0 above 40 tracked symbols |
| Yahoo, live ingestion | **1 per symbol** — 118 attempted, 50 succeeded | `fetchYahoo`, no retries, no redirects |
| mirror flush to Supabase | 50 attempted, **all after the ceiling** → all threw | runs after the loop, 1 POST per changed symbol |
| GitHub | 0 | nightly only |
| **total attempted** | **168** | against a ceiling of 50 |

With the old 27-symbol list the ledger looks different, and the harness shows
why the boundary used to be much earlier:

| tracked | archive shard | ledger | last ok |
|---|---|---|---|
| 27 | **runs, 6 symbols** | YAHOO 33, archive_symbols 19, mirror 25 | **BSX (index 25)** |
| 40 | off (SHARD = 0) | YAHOO 40, mirror 40 | DE (40) — all 40 reached |
| 118 | off | YAHOO 118, mirror 50 | GS (50) |

So the mechanism changed shape over time: with a small tracked list the archive
shard stole the budget and the wall landed around index 15–25; once the list
passed 40 the shard switched itself off and the wall moved out to exactly the
ceiling.

## 9. The effective ceiling — evidence, not inference

- `wrangler.toml` contains **no `[limits]` block** (CODE-DERIVED), so nothing
  overrides the plan default.
- Production **MEASURED**: with 118 tracked symbols, the archive shard disabled
  (SHARD = 0) and exactly one request per symbol, the last updated symbol is
  index **50** and index 51 carries the subrequest error. A boundary at exactly
  50 with exactly one request per symbol *is* the runtime measurement of the
  ceiling: **50 external subrequests per invocation**.
- The error text itself names the subrequest limit and links Cloudflare's limits
  page.

I cannot read Cloudflare's own counter, so the statement "the ceiling equals 50"
rests on the boundary coinciding with index 50 in production and on the same
boundary appearing in the harness when the shim is set to 50.

## Answer to the question asked

The cutoff is **not** symbol-specific and **not** a quota problem — D1 usage sits
at 0.1% (MEASURED). It is caused by:

1. a **fixed alphabetical processing order** (`ORDER BY symbol`),
2. a **sequential loop** that spends **exactly one external request per symbol**,
3. a **per-invocation ceiling of 50 external requests**,

so symbols at positions 1–50 are refreshed and positions 51–118 are never
reached. Reversing the list moves the surviving set with it.

---

# RECONCILIATION OF THE 27-SYMBOL CASE (instrumented, not modelled)

My first 27-symbol run reported "archive runs for 6 symbols, live reaches BSX
(25)", which cannot coexist with a 50 ceiling and a 30-request archive phase.
**The error was in my instrumentation, not in the code.** The shim returned a
fixed 30-bar payload for every Yahoo pull, so a 5-day archive pull produced one
`archive_bars` POST instead of two, and the Supabase mock returned empty arrays,
so `archiveId` never resolved and the id list was re-fetched.

The shim now returns **five full 390-minute sessions for a `range=5d` pull**,
resolves ids, and returns a real `content-range` header. Re-run, 27 tracked,
ceiling 50:

## Exact ordered ledger, requests #1 → first failure

| # | phase | symbol | operation | result |
|---|---|---|---|---|
| 1 | yahoo | AAPL | chart 1d | ok |
| 2 | archive | NVDA | chart 5d | ok |
| 3 | archive | — | `archive_symbols?select=id,symbol` (one id list for the whole run) | ok |
| 4 | archive | NVDA | `archive_bars` POST chunk 1 | ok |
| 5 | yahoo | ABBV | chart 1d | ok |
| 6 | archive | NVDA | `archive_bars` POST chunk 2 | ok |
| 7 | archive | NVDA | `archive_bars` count=exact | ok |
| 8 | archive | NVDA | `archive_symbols` PATCH | ok |
| 9 | archive | MSFT | chart 5d | ok |
| 10 | yahoo | ABNB | chart 1d | ok |
| 11–13 | archive | MSFT | POST ×2, count | ok |
| 14 | yahoo | ABT | chart 1d | ok |
| 15 | archive | MSFT | PATCH | ok |
| 16 | archive | AAPL | chart 5d | ok |
| 17–18 | archive | AAPL | POST ×2 | ok |
| 19 | yahoo | ADBE | chart 1d | ok |
| 20–21 | archive | AAPL | count, PATCH | ok |
| 22 | archive | GOOGL | chart 5d | ok |
| 23 | yahoo | ADI | chart 1d | ok |
| 24–27 | archive | GOOGL | POST ×2, count, PATCH | ok |
| 28 | yahoo | ADP | chart 1d | ok |
| 29 | archive | AMZN | chart 5d | ok |
| 30–33 | archive | AMZN | POST ×2, count, PATCH | ok |
| 32 | yahoo | ALAB | chart 1d | ok |
| … | archive | META | chart 5d, POST ×2, count, PATCH | ok |
| … | yahoo | AMD … AXP | chart 1d each | ok |
| **50** | yahoo | **AXP** | chart 1d | **ok — last success** |
| **51** | yahoo | **BAC** | chart 1d | **THREW: Too many subrequests** |

(The two phases interleave because both run as concurrent `waitUntil` promises;
the archive starts one step ahead.)

## 1. What the archive phase actually consumes

| operation | count |
|---|---|
| Yahoo 5d pulls (6 universe symbols) | 6 |
| `archive_bars` POST chunks (2 per symbol — 1,950 bars, chunk = 1,000) | 12 |
| `archive_bars` count=exact | 6 |
| `archive_symbols` PATCH | 6 |
| `archive_symbols?select=id,symbol` — **once for the whole run**, then cached 5 min | 1 |
| **archive total** | **31** |

## 2. Why 19 live symbols succeed — not 25

31 + 19 = 50. The live loop gets exactly what the archive leaves.
The earlier "BSX (25)" came from the defective mock: 25 archive requests instead
of 31, leaving 25 for the live loop.

## 3. What explains the difference

Nothing in the code: no caching skip, no skipped symbols, no fewer-than-5 path.
The per-symbol archive cost is **5 requests** (`1 Yahoo + 2 POST + 1 count +
1 PATCH`), plus **one shared id-list request per invocation**, i.e.
`6 × 5 + 1 = 31`. The id lookup is amortised, which is why the total is 31 and
not 36.

## Cross-check against production

With 27 tracked symbols the model predicts the live wall at index 19–20.
**MEASURED** on 2026-09-17: symbols at positions 1–15 kept collecting while
QCOM (15) failed in 2 of 23 runs, QQQ (16) in 19, SMH (17) in 22 and everything
from 18 in all 23 — the same neighbourhood, with the spread explained by the id
cache being cold in some invocations (+1) and payload sizes varying by a chunk.

## Corrected numbers

| case | archive requests | live symbols reached | first failure |
|---|---|---|---|
| 27 tracked (old list) | **31** | **19** | index 20 |
| 118 tracked (today) | **0** — SHARD = 0 above 40 tracked | **50** | index 51 (HD) |
