# FULL V2 SHADOW INGESTION — DEPLOY SCRIPT

## I cannot run this. You can, in about two minutes.

No outbound network to `api.cloudflare.com` or `workers.dev` from this sandbox,
and no Cloudflare API token. Every command below is ready to paste. I have built
and tested the two pieces that were missing for full-universe shadow mode.

## What I added and tested for this (the only code written today)

| endpoint | purpose | writes |
|---|---|---|
| `GET /v2/symbols/import-from-legacy[?apply=1&tier=live]` | reads the production tracked set from the legacy `symbols` table and mirrors it into `symbols_v2`, reporting the exact diff | `symbols_v2`, `jobs_v2` only — legacy is read |
| `GET /v2/compare[?date=]` | symbol · V2 latest minute · legacy latest minute · difference, plus the bar-count spread across the universe | **nothing** |

Tested on a production-shaped fixture (118 symbols, legacy truncating at symbol
50 exactly as production does), 29 assertions:

```
LEGACY TRACKED COUNT 118 | V2 ACTIVE COUNT 118 | missing 0 | extra 0
compare: 118/118 symbols have data · bar-count spread 0
every symbol is within 2 candles of every other - no positional truncation
P000 v2=11:39 legacy=11:30 diff=9m
P049 v2=11:39 legacy=11:30 diff=9m
P050 v2=11:39 legacy=09:50 diff=109m
P117 v2=11:39 legacy=09:50 diff=109m
```

That is the shape of the answer you are looking for: **zero spread inside V2,
109 minutes of spread inside legacy.**

---

## Pre-deploy checks (the four you asked for)

```bash
# 1. the secret must exist, or every mutating /v2 endpoint is open
wrangler secret list            # expect API_KEY in the list

# 2. migration is additive only — expect "0" and seven *_v2 objects
grep -icE "\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE|INSERT)\b" migrations/0001_v2_schema.sql
grep -oE "CREATE (TABLE|INDEX) IF NOT EXISTS [A-Za-z_0-9]+" migrations/0001_v2_schema.sql

# 3. budget ceiling — expect claimable = 36
grep -n "DEFAULT_BUDGET\|RESERVE =" v2_pipeline.js | head -3

# 4. no V2 writer touches a legacy table — expect no output
grep -nE "(INSERT INTO|UPDATE|DELETE FROM) +(bars|days|symbols|meta|runs|usage|daily_bars|universe_extra|usage_route)\b" v2_pipeline.js v2_routes.js | grep -v _v2
```

## Deploy

```bash
wrangler d1 execute bars-vault --remote --file=migrations/0001_v2_schema.sql
wrangler deploy
```

## Verify immediately

```bash
W=https://spmo-market-bridge.noamharelnim.workers.dev
curl -s $W/status        | head -c 200      # legacy alive
curl -s "$W/day/AAPL?format=json" | head -c 120
curl -s $W/v2/status                         # tracked: 0, "no run yet"
curl -s $W/v2/tick                           # expect 401 without a key
curl -s "$W/v2/tick?key=$KEY"                # expect done 0, budget.used 0 — proves an empty tick costs nothing
```

## Load the real tracked set (no hand-typed list)

```bash
curl -s "$W/v2/symbols/import-from-legacy"                    # PREVIEW first
curl -s "$W/v2/symbols/import-from-legacy?apply=1&tier=live"  # then apply
```
Required in the response: `missing_in_v2: 0`, `extra_in_v2: 0`, and
`v2_active_count == legacy_tracked_count`. The 100-symbol archive universe is
never consulted — the query is `SELECT symbol FROM symbols`.

Then **stop touching it.** The scheduled tick takes over within a minute.

## First ten minutes

```bash
curl -s $W/v2/compare | head -c 3000     # the truncation answer
curl -s $W/v2/status                     # per-symbol freshness, budget line
curl -s $W/v2/accounting                 # max_requests_in_one_execution
```

**What to expect with ~118 symbols and a 36-job budget:** a full cycle takes
**4 minutes**, so a symbol's `latest minute` can legitimately sit up to ~4
minutes behind. **This does not lose candles:** each fetch returns the whole
session so far, so the next visit backfills every minute since the last one. The
number to watch is `v2_bar_count_spread` in `/v2/compare` — it should stay ≤ 2
across the entire universe. If you want tighter latency later, raise `V2_BUDGET`;
the free-plan ceiling is 50, so 45 would give a 3-minute cycle.

## Every 15 minutes

```bash
curl -s $W/v2/compare > snap_$(date +%H%M).json
```
It carries per symbol: expected latest closed minute, V2 latest, bar count,
synthetic count, and how far behind expectation each symbol is.

## Hard stops — act, do not deliberate

| condition | where you see it |
|---|---|
| > 36 external calls in one invocation | `/v2/accounting` → `max_requests_in_one_execution` |
| duplicate claim | two `runs_v2` rows listing the same symbol in the same minute (`symbols` column) |
| duplicate canonical candle | `/v2/canary/<date>` → `duplicate_candles` |
| synthetic overwrote real | `/v2/canary` → any symbol whose `real_bars` falls between two reports |
| V2 wrote a legacy table | grep in the pre-deploy checks; structurally impossible |
| universe-wide provider failure | `/v2/status` → every symbol carrying `last_error` |
| permanently leased jobs | `/v2/canary` → `stuck_leases` |
| queue growing, not draining | `/v2/status` → `jobs_ready` rising across snapshots |
| an unexpected symbol in V2 | `/v2/symbols` vs the legacy list |

**Rollback, tested:**
```bash
curl -s "$W/v2/symbols/remove/$(curl -s $W/v2/symbols | jq -r '.symbols[].symbol' | paste -sd,)?key=$KEY"
# or, to stop scheduling entirely:
#   wrangler.toml -> crons = ["* 13-21 * * *", "*/5 0-1 * * *"] ; wrangler deploy
```
Candles already collected are **not** deleted.

## Freeze for the session

Version deployed today: **v273** (`build-view.mjs` stamp). I will make no
behavioural change to V2 for the rest of the session unless a hard stop fires.

## After close (≥ 16:15 ET) and again tomorrow morning

```bash
curl -s $W/v2/canary/2026-09-23 > canary_2026-09-23_postclose.json
# next morning, before 09:30 ET:
curl -s $W/v2/canary/2026-09-23 > canary_2026-09-23_next_day.json
```

`/v2/canary` already covers every active symbol when no `symbols` parameter is
given, so the full universe is reported without changing anything.

Send me those two files plus one `/v2/compare` snapshot and I will produce the
final report: per symbol expected / real / synthetic / missing / duplicates /
first / last / revisions / legacy count / MATCH / V2_ONLY / LEGACY_ONLY /
DIFFERENT_OHLCV, symbols grouped by latest-minute cutoff, and an explicit verdict
on whether the alphabetical degradation is gone.

## What I did not do

No consumer touched. `/day`, `/board`, Radar, Trader, Scanner, Copy Candles,
downloads and exports all still read legacy. All 13 suites green after today's
additions: legacy 1,455 assertions, V2 371.
