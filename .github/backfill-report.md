# supabase-backfill run 12 (push) — 2026-10-06T22:24:32Z

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
  "time": "2026-10-06T22:24:27.742Z"
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
  "time": "2026-10-06T22:24:28.928Z"
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
  "time": "2026-10-06T22:24:30.178Z"
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
  "time": "2026-10-06T22:24:31.326Z"
}
[HTTP 500]

Error: POST archive_symbols?on_conflict=symbol -> HTTP 400 {"code":"23502","details":"Failing row contains (null, AAPL, 0, null, null).","hint":null,"message":"null value in column \"id\" of relation \"archive_symbols\" violates not-null constraint"}
    at req (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/archive_from_bars.mjs:33:49)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async main (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/archive_from_bars.mjs:53:3)
```
