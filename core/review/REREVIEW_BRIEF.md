# Re-review brief (protocol v2) — used by the daily scheduled review

Repo: /home/claude/spmo-market-bridge (do NOT git commit/push; only edit the review JSON files you are assigned).

Read first: core/review/REVIEW_PROTOCOL_v2.md (the rules) and core/review/REVIEW_PROTOCOL.md (v1 fields + red-flag list, still valid).

Data you may use, per ticker T:
- core/review/T.json — the previous review (v1, 13–14.10.2026). Keep its structure.
- core/screen_sec.csv (row T: raw metrics, pass/fail) and core/quality_severity.csv (row T: graded label `new_label`, severity per rule sev_*). The graded label is the v2 DEFAULT.
- core/sec/T.json — EDGAR facts incl. quarterly series (use for D2: last 2 quarters YoY; for U2/U3 corrected numbers).
- core/current_state.json (rows[] with symbol==T: close, pe_ttm, fcf_yield_ttm, market_cap, last_earnings, ADR60) for valuation.
- core/review_queue.json (written by tools/core/review_triggers.py) — why each triggered ticker was re-opened (report date, move, analyst cuts, news).
- Web search / fetch for the newest quarterly report, 8-Ks and material news since the previous review_date (cite URL + date). If a Bigdata.com tool is available you may use it.

How to decide (strict):
1. Start from the default = graded label (CORE-ELIGIBLE->CORE, WATCH->WATCH, NON-CORE->NON-CORE).
2. Upgrade only with U1/U2/U3 per failing rule, each with the corrected number that itself passes the threshold. A failing rule without a valid code keeps failing -> the label stays.
   Practical: re-grade after your corrections — if all failures are corrected -> CORE; if what remains is one near miss (severity 1) -> CORE; otherwise WATCH / NON-CORE by the same severity logic as quality_severity.py (sum<=1 & no 3 -> CORE; any 3 or sum>=4 -> NON-CORE; else WATCH).
3. Downgrade only with D1–D5, each with a number or dated sourced event. Check D2 (last 2 quarters) and D3 for EVERY ticker using EDGAR quarters + the newest report.
4. If the ticker was re-opened by a trigger (report / move / analysts / news), update the factual fields with the new facts (newest quarter numbers, guidance) and decide whether they trigger any code. A price move alone never changes the label.
5. Update `valuation` (ATTRACTIVE / FAIR / EXPENSIVE / UNJUSTIFIABLE + one line with today's numbers). Only UNJUSTIFIABLE affects the label (D5 -> WATCH).
6. Never use: brand, moat, management quality, analyst ratings, price action, "industry characteristics".

Write back core/review/T.json (valid UTF-8 JSON, Hebrew or English text is fine, keep all existing keys) with these keys set/added:
  previous_final (the old final_quality), final_quality, override (true if final != default), override_code (list, [] if none),
  override_evidence (numbers + period + source for every code), reason (one sentence), review_date (today, YYYY-MM-DD),
  review_round "v2", protocol "v2", trigger (the trigger reasons from the queue), sources (append new ones with dates).

Reply with one line per ticker: T: previous -> final (default X; codes ...; key number).

## Weekly-only items ("בדיקה שבועית")
Light check only: search for 8-Ks, guidance changes and material news since review_date. If nothing triggers a code,
change nothing except `review_date` (today) and append to `checks` a line "YYYY-MM-DD weekly: nothing new".
