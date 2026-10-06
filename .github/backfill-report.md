# supabase-backfill run 8 (push) — 2026-10-06T21:33:45Z

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
  "time": "2026-10-06T21:33:41.611Z"
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
  "time": "2026-10-06T21:33:42.850Z"
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
  "time": "2026-10-06T21:33:43.976Z"
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
  "time": "2026-10-06T21:33:45.078Z"
}
[HTTP 500]

Error: missing: SUPABASE_URL -- SUPABASE_URL / SUPABASE_KEY are not set (DRY_RUN="false"). Add them as repository secrets, or run with DRY_RUN=1.
    at main (file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/supabase_backfill.mjs:137:11)
    at file:///home/runner/work/spmo-market-bridge/spmo-market-bridge/tools/supabase_backfill.mjs:193:54
    at ModuleJob.run (node:internal/modules/esm/module_job:325:25)
    at async ModuleLoader.import (node:internal/modules/esm/loader:606:24)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)
```
