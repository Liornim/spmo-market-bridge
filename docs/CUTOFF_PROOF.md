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
