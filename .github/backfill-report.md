# supabase-backfill run 24 (push) — 2026-10-07T19:06:42Z

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
    "    at async Object.first (worker.js:33091:21)",
    "    at async migrate (worker.js:32662:18)",
    "    at async ensureSchema (worker.js:32631:3)"
  ],
  "time": "2026-10-07T19:06:37.710Z"
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
    "    at async Object.first (worker.js:33091:21)",
    "    at async migrate (worker.js:32662:18)",
    "    at async ensureSchema (worker.js:32631:3)"
  ],
  "time": "2026-10-07T19:06:38.949Z"
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
    "    at async Object.first (worker.js:33091:21)",
    "    at async migrate (worker.js:32662:18)",
    "    at async ensureSchema (worker.js:32631:3)"
  ],
  "time": "2026-10-07T19:06:40.327Z"
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
    "    at async Object.first (worker.js:33091:21)",
    "    at async migrate (worker.js:32662:18)",
    "    at async ensureSchema (worker.js:32631:3)"
  ],
  "time": "2026-10-07T19:06:41.650Z"
}
[HTTP 500]

##### tools/probe_worker.mjs
/bars build: v295  (2026-10-07 19:04Z) | live tab: true
AAPL: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 338 minutes, last 15:06 ET (now 15:06 ET)
SOFI: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 338 minutes, last 15:06 ET (now 15:06 ET)
TSLA: HTTP 200, 1951 minutes in 7 days, today 2026-10-07: 338 minutes, last 15:06 ET (now 15:06 ET)
```
