# supabase-backfill run 22 (push) — 2026-10-07T09:16:21Z

```
=== GET /
{
  "error": true,
  "where": "worker.fetch",
  "path": "/",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.all (worker.js:32920:59)",
    "    at async trackedSymbols (worker.js:32651:23)",
    "    at async handle (worker.js:34247:20)"
  ],
  "time": "2026-10-07T09:16:13.348Z"
}
[HTTP 500]

=== GET /status
{
  "error": true,
  "where": "worker.fetch",
  "path": "/status",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.first (worker.js:32922:21)",
    "    at async migrate (worker.js:32493:18)",
    "    at async ensureSchema (worker.js:32462:3)"
  ],
  "time": "2026-10-07T09:16:14.774Z"
}
[HTTP 500]

=== GET /table/symbols
{
  "error": true,
  "where": "worker.fetch",
  "path": "/table/symbols",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.first (worker.js:32922:21)",
    "    at async migrate (worker.js:32493:18)",
    "    at async ensureSchema (worker.js:32462:3)"
  ],
  "time": "2026-10-07T09:16:16.139Z"
}
[HTTP 500]

=== GET /usage
{
  "error": true,
  "where": "worker.fetch",
  "path": "/usage",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:188:19)",
    "    at async cloudflare-internal:d1-api:497:19",
    "    at async Object.first (worker.js:32922:21)",
    "    at async migrate (worker.js:32493:18)",
    "    at async ensureSchema (worker.js:32462:3)"
  ],
  "time": "2026-10-07T09:16:17.434Z"
}
[HTTP 500]

##### tools/probe_worker.mjs
/bars -> 200 | build: v292  (2026-10-07 09:12Z) | reads /xa/index: true | D1 route /bars/index: false | scanner tab: true | update tab: true
/auth -> 200 { "key_required": false, "note": "API_KEY secret not set: write routes are open" }
/xa/index -> 200 { "symbols": [ "AAPL", "ABBV", "ABNB", "ABT", "ADBE", "ADI", "ADP", "ALAB", "AMD", "AMGN", "AMT", "AMZN", "ANET", "APH", "APP", "ARM", "ASML", "AVGO", "AXP", "B
/xa/days/SOFI -> 200 { "symbol": "SOFI", "days": [ { "date": "2026-10-06", "bars": 390, "first": "09:30", "last": "15:59", "revisions": 0, "source": "archive" }, { "date": "2026-10-
/xa/update/status -> 200 { "request": { "request_id": "u1791363577", "requested_at": "2026-10-07T08:59:37Z", "symbols": [ "SOFI" ], "days": 30, "by": "claude retry (scoped)" }, "done": 
/health -> 500 { "error": true, "where": "worker.fetch", "path": "/health", "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a p
```
