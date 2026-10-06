# supabase-backfill run 15 (push) — 2026-10-06T23:06:14Z

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
    "    at async Object.all (worker.js:32066:59)",
    "    at async trackedSymbols (worker.js:31797:23)",
    "    at async handle (worker.js:33388:20)"
  ],
  "time": "2026-10-06T23:05:57.264Z"
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
    "    at async Object.first (worker.js:32068:21)",
    "    at async migrate (worker.js:31639:18)",
    "    at async ensureSchema (worker.js:31608:3)"
  ],
  "time": "2026-10-06T23:05:58.585Z"
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
    "    at async Object.first (worker.js:32068:21)",
    "    at async migrate (worker.js:31639:18)",
    "    at async ensureSchema (worker.js:31608:3)"
  ],
  "time": "2026-10-06T23:05:59.940Z"
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
    "    at async Object.first (worker.js:32068:21)",
    "    at async migrate (worker.js:31639:18)",
    "    at async ensureSchema (worker.js:31608:3)"
  ],
  "time": "2026-10-06T23:06:01.359Z"
}
[HTTP 500]

AAPL: HTTP 200 rows=11310
0
0 truncated=false lines=11310 first=2026-08-26,09:30 last=2026-10-06,15:59
ALAB: HTTP 200 rows=10140
0
0 truncated=false lines=10140 first=2026-08-31,09:30 last=2026-10-06,15:59
SPY: HTTP 200 rows=11167
0
0 truncated=false lines=11167 first=2026-08-26,09:30 last=2026-10-06,15:59
WMT: HTTP 200 rows=10140
0
0 truncated=false lines=10140 first=2026-08-28,09:30 last=2026-10-05,15:59
{
  "rows": [
    {
      "symbol": "AAPL",
      "date": "2026-10-06",
      "open": 332.305,
      "high": 334.38,
      "low": 330.62,
      "close": 333.66,
      "volume": 19365875,
      "bars": 390,
      "first": "09:30",
      "last": "15:59",
      "source": "minutes",
      "complete": true,
      "provider": null
    },
    {
      "symbol": "AAPL",
      "date": "2026-10-05",
      "open": 332.795,
      "high": 336.19,
      "low": 331.65,
      "close": 333.13,
      "volume": 21529650,
      "bars": 390,
      "first": "09:30",
      "last": "15:59",
      "source": "minutes",
      "complete": true,
      "provider": null
    }
  ],
  "count": 2,
  "note": "archive only: agg
archive-bars page HTTP 200 size 65893
```
