# V2 PLATFORM LIMITS

Three columns are kept apart on purpose: what the platform documents, what this
deployment configures, and what was actually observed here. The architecture
reads its budget from configuration, so a plan change moves one number.

| limit | documented | configured here | measured in this deployment |
|---|---|---|---|
| External subrequests per invocation (Workers Free) | 50 | **not set** — `wrangler.toml` has no `[limits]` block | **50.** With 118 tracked symbols, the archive shard disabled and exactly one provider request per symbol, the live loop stops after symbol #50 and #51 throws `Too many subrequests`. Instrumented reproduction in `docs/CUTOFF_PROOF.md` lands on the same boundary |
| Internal binding calls (D1, KV) per invocation | ~1,000 | not set | not reached: the failing runs spend <100 |
| CPU time per invocation | 10 ms typical on Free, burstable | not set | never observed as the failure mode; every failure carried the subrequest message |
| Wall time | unbounded while `waitUntil` promises are pending, subject to the same per-invocation limits | — | `waitUntil` work shares the invocation's subrequest counter (documented, and consistent with the measured boundary) |
| Cron triggers | up to 5 per Worker | 4 (`* 13-21`, `*/5 0-1` legacy; `* 12-22`, `7 2` V2) | both V2 triggers fire independently of legacy |
| D1 rows read / day | 5,000,000 | — | **2,658 (0.1%)** on 2026-09-22 — the store was never the constraint |
| D1 rows written / day | 100,000 | — | 523 (0.5%) |
| D1 statements per `batch()` | large; practical limit is statement size | V2 batches **100** statements | no failures at 100 |
| KV writes / day | 1,000 | — | **exceeded** on 2026-09-22 (Cloudflare alert) while the Worker's own counter read 0 — its counter is per isolate and is a lower bound |
| Supabase REST page size | 1,000 rows/request | archive reads page at 1,000 | 7 pages per symbol at today's history; the nightly publish crosses 50 subrequests because of it |
| Request body size | 100 MB documented | V2 import reads the body directly | untested above a few MB |

## What V2 does with these numbers

- `V2_BUDGET` (env, default **40**) is the working ceiling; `RESERVE = 4` is
  never spent by ordinary work. Nothing is hard-coded to 50.
- A run **claims at most `budget − reserve` jobs**, each costing one provider
  request, so an execution physically cannot reach the platform ceiling.
- If Cloudflare's limit changes, set `V2_BUDGET` and nothing else changes: the
  cycle length becomes `ceil(N / (budget − reserve))` automatically.
- KV is **not used by V2 at all**. The failure mode of a shared event log that
  dies exactly when it is needed is avoided by keeping run history in D1
  (`runs_v2`) and per-request detail in `console.log`.
