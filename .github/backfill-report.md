# supabase-backfill run 26 (push) — 2026-10-07T20:24:58Z

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
    "    at async Object.first (worker.js:33120:21)",
    "    at async migrate (worker.js:32691:18)",
    "    at async ensureSchema (worker.js:32660:3)"
  ],
  "time": "2026-10-07T20:24:53.570Z"
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
    "    at async Object.first (worker.js:33120:21)",
    "    at async migrate (worker.js:32691:18)",
    "    at async ensureSchema (worker.js:32660:3)"
  ],
  "time": "2026-10-07T20:24:54.739Z"
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
    "    at async Object.first (worker.js:33120:21)",
    "    at async migrate (worker.js:32691:18)",
    "    at async ensureSchema (worker.js:32660:3)"
  ],
  "time": "2026-10-07T20:24:56.059Z"
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
    "    at async Object.first (worker.js:33120:21)",
    "    at async migrate (worker.js:32691:18)",
    "    at async ensureSchema (worker.js:32660:3)"
  ],
  "time": "2026-10-07T20:24:57.433Z"
}
[HTTP 500]

##### tools/probe_worker.mjs
/bars build: v297  (2026-10-07 20:23Z) | refreshSymbols: true
symbols: 131 | BITX: true | SOFI: true
```
