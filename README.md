# bars-vault

Persistent 1-minute candle archive for US equities.
Cloudflare Worker + D1 (SQLite) + Cron. Source: Yahoo Finance chart API.

Every bar ever fetched is stored permanently. Reads are served from the
database, never from Yahoo, so upstream outages do not lose history.

| Route | Result |
|---|---|
| `/` | health, tracked symbols, last run |
| `/status` | per-symbol freshness, row counts, recent runs |
| `/days/NVDA` | stored dates with bar counts |
| `/day/NVDA` | CSV of the latest stored day |
| `/day/NVDA/2026-08-31` | CSV of one day (`?format=json` for JSON) |
| `/sync` · `/sync/NVDA` | pull today (all / one) |
| `/backfill/NVDA` | pull the last 5 days |

Unknown symbols requested via `/day/XYZ` are fetched, stored, and tracked from then on.

## Layout
- `worker.js` — the service (single file, no dependencies)
- `wrangler.toml` — bindings and cron; the dashboard is not the source of truth, this file is
- `test.mjs` — 43 tests against real SQLite via a D1-compatible shim; `npm test`
- `DEPLOY.md` — step-by-step setup (Hebrew)
- `legacy/` — the previous Node bridge (`/market/:symbol`), kept for reference

## Deploy
Connected to Cloudflare Workers Builds: every push to `main` deploys.
Manual: `wrangler deploy`.
