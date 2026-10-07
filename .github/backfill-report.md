# supabase-backfill run 25 (push) — 2026-10-07T19:33:51Z

```
=== GET /
{
  "error": true,
  "where": "worker.fetch",
  "path": "/",
  "message": "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  "stack": [
    "Error: D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:193:19)",
    "    at async cloudflare-internal:d1-api:474:19",
    "    at async Object.all (worker.js:33102:59)",
    "    at async trackedSymbols (worker.js:32833:23)",
    "    at async handle (worker.js:34429:20)"
  ],
  "time": "2026-10-07T19:33:46.418Z"
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
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:193:19)",
    "    at async cloudflare-internal:d1-api:474:19",
    "    at async Object.first (worker.js:33104:21)",
    "    at async migrate (worker.js:32675:18)",
    "    at async ensureSchema (worker.js:32644:3)"
  ],
  "time": "2026-10-07T19:33:48.359Z"
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
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:193:19)",
    "    at async cloudflare-internal:d1-api:474:19",
    "    at async Object.first (worker.js:33104:21)",
    "    at async migrate (worker.js:32675:18)",
    "    at async ensureSchema (worker.js:32644:3)"
  ],
  "time": "2026-10-07T19:33:50.197Z"
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
    "    at D1DatabaseSessionAlwaysPrimary._sendOrThrow (cloudflare-internal:d1-api:193:19)",
    "    at async cloudflare-internal:d1-api:474:19",
    "    at async Object.all (worker.js:33102:59)",
    "    at async handle (worker.js:35769:23)",
    "    at async Object.fetch (worker.js:34216:19)"
  ],
  "time": "2026-10-07T19:33:50.662Z"
}
[HTTP 500]

##### tools/probe_worker.mjs
/bars build: v296  (2026-10-07 19:31Z) | download buttons: true
AAPL: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 365 minutes, last 15:33 ET (now 15:33 ET)
SOFI: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 365 minutes, last 15:33 ET (now 15:33 ET)
TSLA: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 365 minutes, last 15:33 ET (now 15:33 ET)
```
