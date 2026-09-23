# V2 3-SYMBOL CANARY — RUNBOOK AND INSTRUMENT

## Status: the canary has NOT run. I cannot run it from here.

Three blockers, stated plainly:

1. **No outbound network.** This sandbox can reach only package registries and
   GitHub; `workers.dev`, `api.cloudflare.com` and `query1.finance.yahoo.com` are
   blocked. I cannot call the live Worker or the provider.
2. **No deploy credentials.** `wrangler deploy` and `wrangler d1 execute` need a
   Cloudflare API token that I do not have and should not have.
3. **Time.** A complete session is 6.5 hours of wall clock; today's opens at
   13:30 UTC. Nothing I do in this environment advances a production clock.

What I did instead: **built the instrument that produces every number you asked
for, and validated it against a full 390-minute simulated session** so that when
you run it, the report is trustworthy rather than improvised afterwards.

---

## 1. What was built

### Per-invocation accounting (`runs_v2`, extended)

Every scheduled invocation now records: `started_at`, `trigger`, `budget`,
`used` (outbound calls), `jobs_done`, `jobs_failed`, `rows_downloaded`,
`candidates`, `inserted`, `revised`, `unchanged`, **`synthetic_inserted`**,
**`kept_real`** (a synthetic blocked from overwriting a real candle),
**`rejected`**, **`partial_responses`**, **`lease_reclaims`**, **`symbols`**
(exactly which symbols that invocation claimed), `status` and `note` (why it
stopped). The tick response additionally returns `queue_depth` and
`symbols_claimed`.

### `GET /v2/canary/<date>` — one read-only report

Per symbol: expected session minutes (calendar-aware), first/last expected
minute, V2 bars, real vs synthetic, missing minutes with a sample, duplicate
minutes, unexpected minutes (a 16:00 row would appear here), non-minute
timestamps, weekend rows, revised bars, total revisions, first/last stored bar,
`first_seen` span, and a `complete` flag that is **not** row-count based.

Legacy comparison per symbol: `MATCH`, `V2_ONLY`, `LEGACY_ONLY`,
`DIFFERENT_OHLCV`, `match_pct`, plus up to 50 differences each carrying both
values, the differing fields, V2's `source`/`first_seen`/`updated_at`/`revisions`
and a `likely_cause`.

Session aggregates: invocations, max outbound in any one, provider calls,
jobs done/failed, inserted/revised, synthetic inserted, kept_real, rejected,
partial responses, lease reclaims, runs stopped for budget, duplicate candles
across the store, stuck leases, current queue depth — and the hard gates
evaluated.

The endpoint writes nothing, anywhere.

### A finding the simulation produced before production could

Comparing raw doubles, **79 identical candles per symbol looked like
differences** — legacy rows carry float artifacts such as `104.21000000000001`
where V2 stores `104.21`. The comparison now judges equality at 4 decimals (the
documented precision of both stores) and reports `float_representation_only`
separately. Without this the first real canary report would have shown ~20%
"mismatch" and wasted a session.

---

## 2. Validation of the instrument (`v2_canary_sim.mjs`, 19 checks)

A full simulated session: AAPL, QQQ, XLY · 390 minutes · one invocation per
minute · two provider 500s, one timeout, one short response, one no-trade minute,
one candle restated by the provider 20 minutes later · a legacy table truncated
the way production truncates (AAPL 390, QQQ 241, XLY 121 rows).

| symbol | expected | V2 | real | synth | missing | dup | revised | legacy | MATCH | V2_ONLY | LEGACY_ONLY | DIFF | match% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AAPL | 390 | 390 | 389 | 1 | 0 | 0 | 1 | 389 | 388 | 1 | 0 | 1 | 99.49 |
| QQQ | 390 | 390 | 389 | 1 | 0 | 0 | 1 | 240 | 239 | 150 | 0 | 1 | 61.28 |
| XLY | 390 | 390 | 389 | 1 | 0 | 0 | 1 | 121 | 120 | 269 | 0 | 1 | 30.77 |

The low match percentages are **legacy truncation**, surfaced as `V2_ONLY`, not
as a V2 defect — exactly the distinction you asked for. The single
`DIFFERENT_OHLCV` per symbol is the restated candle, reported as:

```
time 11:10  fields [close, volume]
V2     c 105.25  v 5000  revisions 1  first_seen 1789657860  updated_at 1789659060
legacy c 105.20  v 1100
likely_cause: provider restated the candle after legacy stored it
```

Session totals: 401 invocations, 1,197 provider calls, **max 3 outbound per
invocation**, 6 failed jobs (the injected faults), 3 synthetic inserts, 3
revisions, 0 lease reclaims, queue max 3 → **final 0**, duplicate candles 0,
stuck leases 0. **All seven legacy tables byte-identical** (row counts and
checksums) after the entire session.

---

## 3. How to run the canary

```bash
# 1. schema (additive; every object is *_v2)
wrangler d1 execute bars-vault --file=migrations/0001_v2_schema.sql

# 2. deploy (adds two V2 cron triggers; legacy triggers unchanged)
wrangler deploy

# 3. confirm legacy is unaffected
curl -s .../status | head -c 400
curl -s ".../day/AAPL?format=json" | head -c 200

# 4. BEFORE snapshot of legacy tables — keep the output
wrangler d1 execute bars-vault --command \
 "SELECT 'bars' t, COUNT(*) rows, SUM(unix) ck FROM bars
  UNION ALL SELECT 'days', COUNT(*), COUNT(*) FROM days
  UNION ALL SELECT 'symbols', COUNT(*), COUNT(*) FROM symbols
  UNION ALL SELECT 'meta', COUNT(*), COUNT(*) FROM meta
  UNION ALL SELECT 'runs', COUNT(*), MAX(id) FROM runs
  UNION ALL SELECT 'usage', COUNT(*), COUNT(*) FROM usage
  UNION ALL SELECT 'daily_bars', COUNT(*), COUNT(*) FROM daily_bars"

# 5. enrol exactly three symbols, before the open
curl -s ".../v2/symbols/add/AAPL,QQQ,XLY?tier=live&key=$KEY"

# 6. one manual tick to prove the path end to end
curl -s ".../v2/tick?key=$KEY"
#    expect: done 3, budget.used 3 / safe 36

# 7. during the session, sample a few times
curl -s ".../v2/status"
curl -s ".../v2/accounting"

# 8. after 16:15 ET, let restatements settle, then the report
curl -s ".../v2/canary/$(date +%F)" > canary_report.json

# 9. AFTER snapshot — must equal step 4 apart from legacy's own activity
#    (rerun the step-4 command)
```

**Isolation caveat, stated honestly:** legacy keeps running during the canary, so
its tables *will* change. That is legacy's own activity, not V2's. The proof that
V2 wrote nothing is structural, not statistical: V2's only writes are to `*_v2`
tables (one `fetch` site, all SQL in `v2_pipeline.js`/`v2_routes.js` targets
`*_v2`), and the byte-identical result in the simulation is what that looks like
when legacy is idle. To make it observable in production, compare
`MAX(rowid)`/`MAX(updated_at)` in `bars` against legacy's own cron timestamps:
any V2-caused write would appear at a V2 cron minute for a canary symbol.

---

## 4. Hard gates — stop the canary if any fails

| gate | where to read it |
|---|---|
| external calls per invocation ≤ 36 | `/v2/canary` → `run_accounting.max_outbound` |
| duplicate job claims = 0 | two runs never list the same symbol at the same minute (`runs_v2.symbols`) |
| duplicate canonical candles = 0 | `/v2/canary` → `duplicate_candles` |
| synthetic overwriting real = 0 | `run_accounting.kept_real` is the count of blocked attempts; the store never shows a real row turned synthetic |
| legacy writes = 0 | step 4/9 snapshots + the structural argument above |
| stuck leases = 0 | `/v2/canary` → `stuck_leases` |
| unbounded queue growth = 0 | `queue_depth_now` at session end, and `/v2/status` → `jobs_ready` during |

---

## 5. What the canary will and will not prove

| category | what the report will show |
|---|---|
| V2 INGESTION STABILITY | invocations, failures, retries, lease reclaims, budget headroom |
| V2 DATA COMPLETENESS | per-minute presence against the calendar, not row counts |
| V2 DATA CORRECTNESS | duplicates, non-minute rows, 16:00 rows, synthetic provenance, revisions |
| V2 PROVIDER PARITY | **partial.** Each difference carries V2's `source`, `first_seen`, `updated_at` and `revisions`, which distinguishes "provider restated it later" and "V2 carried it forward" from "unexplained". It does **not** archive the raw provider response, so an `unexplained` difference stays unexplained unless Workers Logs are captured for that minute. Adding a raw-response archive would be a second production architecture, which you ruled out |
| LEGACY ISOLATION | snapshots plus the structural argument |
| BUDGET SAFETY | max outbound per invocation across the whole session |

---

## 6. What I need from you

1. Run steps 1–9 above on a trading day.
2. Send me `canary_report.json` plus the two snapshot outputs.

I will then produce the final canary report in the exact format you specified,
with a separate verdict per category, and no general PASS.
