# supabase-backfill run 5 (push) — 2026-10-06T21:20:15Z

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
  "time": "2026-10-06T21:20:09.711Z"
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
  "time": "2026-10-06T21:20:11.195Z"
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
  "time": "2026-10-06T21:20:12.534Z"
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
  "time": "2026-10-06T21:20:13.861Z"
}
[HTTP 500]

Error: symbol list: worker HTTP 500
    at symbolList (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/supabase_backfill.mjs:120:33)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async main (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/supabase_backfill.mjs:129:16)
```
