# supabase-backfill run 23 (push) — 2026-10-07T18:45:02Z

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
    "    at async Object.all (worker.js:32992:59)",
    "    at async trackedSymbols (worker.js:32723:23)",
    "    at async handle (worker.js:34319:20)"
  ],
  "time": "2026-10-07T18:44:55.584Z"
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
    "    at async Object.first (worker.js:32994:21)",
    "    at async migrate (worker.js:32565:18)",
    "    at async ensureSchema (worker.js:32534:3)"
  ],
  "time": "2026-10-07T18:44:57.563Z"
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
    "    at async Object.first (worker.js:32994:21)",
    "    at async migrate (worker.js:32565:18)",
    "    at async ensureSchema (worker.js:32534:3)"
  ],
  "time": "2026-10-07T18:44:59.435Z"
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
    "    at async Object.first (worker.js:32994:21)",
    "    at async migrate (worker.js:32565:18)",
    "    at async ensureSchema (worker.js:32534:3)"
  ],
  "time": "2026-10-07T18:45:01.346Z"
}
[HTTP 500]

##### tools/probe_worker.mjs
/bars build: v293  (2026-10-07 18:43Z) | live code: true
AAPL: HTTP 200, 1950 minutes in 7 days, today 2026-10-07: 316 minutes, last 14:44 ET (now 14:45 ET)
SOFI: HTTP 200, 1950 minutes in 7 days, today 2026-10-07: 316 minutes, last 14:44 ET (now 14:45 ET)
TSLA: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 317 minutes, last 14:45 ET (now 14:45 ET)
```
