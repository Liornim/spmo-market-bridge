# bars-vault

Persistent 1-minute candle archive for US equities.
Cloudflare Worker + D1 (SQLite) + Cron. Source: Yahoo Finance chart API.

Every bar ever fetched is stored permanently. Reads are served from the
database, never from Yahoo, so upstream outages do not lose history.

| Route | Result |
|---|---|
| `/log` | system log from KV — answers even when D1 is down (`/logtest` writes one entry) |
| `/db` | what is stored: bars and days per symbol, run log, quota meters |
| `/usage` | rows read/written today vs the D1 daily limits |
| `/selfcheck` | per-subsystem health |
| `/book/NVDA` | top-5 bids/asks from the four Cboe venues (`/bookprobe/NVDA` for diagnostics) |
| `/radar` | Market Radar: every tracked symbol ranked by attention, detail sheet, candle copy |
| `/view/NVDA` | phone-first page: chart, table, structure tab (unchanged) |
| `/` | health, tracked symbols, last run |
| `/status` | per-symbol freshness, row counts, recent runs |
| `/days/NVDA` | stored dates with bar counts |
| `/day/NVDA` | CSV of the latest stored day |
| `/day/NVDA/2026-08-31` | CSV of one day (`?format=json` for JSON) |
| `/sync` · `/sync/NVDA` | pull today (all / one) |
| `/backfill/NVDA` | pull the last 5 days |

Unknown symbols requested via `/day/XYZ` are fetched, stored, and tracked from then on.

## Layout
- `worker.js` — the service (no dependencies)
- `db.html` — the database inspector at `/db`; reads only the counter tables so opening it cannot burn the quota it displays
- `radar.html` — Market Radar: attention list, execution plan, auto-refresh, alerts, candle export (separate page; `view.html` untouched)
- `view.html` — the original page (bars tab + structure tab); `view.js` is generated from both pages plus `engine.cjs` by `build-view.mjs` (`npm run build`)
- `layers.cjs` — `analysisPack()` (the full copy-out: raw data plus decision state, one atomic snapshot, every absent field marked NOT AVAILABLE), one ticker snapshot per refresh (`buildTickerState`) with explicit level roles and a blocking contradiction detector (`validateState`), buyer/seller pressure (inferred from candles — this feed has no order book and no tape), multi-day context, time-of-day relative volume, path probability (empirical from the symbol's own history when the sample allows, otherwise a labelled model bias) and the plain-language WHAT NOW block
- `engine.cjs` — structure engine: K=3 swings, HH/HL/LH/LL, window levels, breakout/rejection/failure, structure break, trend change, scoring, ask flag; VWAP, EMA9/20, 20-bar range; `marketContext` (SPY/QQQ/sector) and `bottomLine` (ACTION / trigger / strong / invalidation / confidence — structure first, indicators only move confidence). Pure functions; `engine_test.cjs` covers it including a random-walk noise floor (~3 asks/day balanced)
- `wrangler.toml` — bindings and cron; the dashboard is not the source of truth, this file is
- `pack_test.cjs` — every section and field of the analysis pack, plus the aggregation correctness
- `state_test.cjs` — snapshot consistency, level ordering, every contradiction rule
- `layers_test.cjs` — volume normalisation, daily layer, probability behaviour, calibration honesty
- `plan_test.cjs` — execution-plan state machine, including a bar-by-bar replay of whole sessions
- `trader_qa.cjs` — trader-perspective QA: can the operational questions be answered at every decision point
- `radar_smoke.mjs`, `copy_test.mjs`, `ui_pass2_test.mjs` — run the radar page against a stub DOM: rendering, attention sort, freshness, and every candle-copy option
- `test.mjs` — worker tests against real SQLite via a D1-compatible shim; `npm test`
- `DEPLOY.md` — step-by-step setup (Hebrew)
- `legacy/` — the previous Node bridge (`/market/:symbol`), kept for reference

## Deploy
Connected to Cloudflare Workers Builds: every push to `main` deploys.
Manual: `wrangler deploy`.

## The system log is deliberately not in D1

When the D1 read budget ran out, the service went down and its own run history —
which lived in a D1 table — became unreadable at the same moment. A log inside
the thing it reports on is not a log.

`/log` reads from Workers KV: separate product, separate quota, separate failure
mode, and the route is handled before any D1 call so it answers while the
database is dead. The global error handler writes the failure there, as do cron
failures and quota refusals. Only notable events are recorded, one key per day,
capped, with a write ceiling, because KV free tier allows 1,000 writes a day.

Bind a KV namespace named `LOG` to enable it; without one the Worker runs
normally and `/log` says no namespace is configured.

## Platform budget

D1 free tier: **5,000,000 rows read** and **100,000 rows written** per day, reset
at 00:00 UTC. Every D1 result carries `meta.rows_read`, so the Worker meters
itself, stores the daily total in the `usage` table and exposes it at `/usage`,
in `/status` and in the radar header. Past 80% of the read budget it refuses
`/sync` and `/backfill` with a 429 rather than hitting the wall mid-write.

`test.mjs` counts rows the way D1 counts them — a `COUNT(*)` without a `WHERE`
is charged for the whole table — and asserts that a full trading day of 18
symbols refreshing every minute stays under half the daily budget. Measured:
~21k rows/day, 0.4%. If a future change reintroduces a table scan, the suite
fails before it reaches production.
