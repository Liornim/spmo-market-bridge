# supabase-backfill run 14 (push) — 2026-10-06T22:45:08Z

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
    "    at async Object.all (worker.js:30666:59)",
    "    at async trackedSymbols (worker.js:30397:23)",
    "    at async handle (worker.js:31979:20)"
  ],
  "time": "2026-10-06T22:42:39.910Z"
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
    "    at async Object.first (worker.js:30668:21)",
    "    at async migrate (worker.js:30239:18)",
    "    at async ensureSchema (worker.js:30208:3)"
  ],
  "time": "2026-10-06T22:42:41.440Z"
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
    "    at async Object.first (worker.js:30668:21)",
    "    at async migrate (worker.js:30239:18)",
    "    at async ensureSchema (worker.js:30208:3)"
  ],
  "time": "2026-10-06T22:42:42.954Z"
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
    "    at async Object.first (worker.js:30668:21)",
    "    at async migrate (worker.js:30239:18)",
    "    at async ensureSchema (worker.js:30208:3)"
  ],
  "time": "2026-10-06T22:42:44.475Z"
}
[HTTP 500]

archive_symbols: 0 added (none)
archive_symbols: 129 symbols; copying 118 from bars

## bars -> archive_bars copy
read from bars: 0, sent: 0, skipped (not a canonical session minute): 0

within each symbol's bars span: bars 1003810, archive 1009024
ARCHIVE SHORT for 1 symbols: SPMO: bars 8592 > archive 8578
```
