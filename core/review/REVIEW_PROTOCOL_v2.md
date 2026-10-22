# CORE review protocol v2 — closed list of override reasons (draft 22.10.2026, for Noam's approval)
# Blind test 22.10 (30 stocks, 2 runs each): v1 27/30 agree, v2 28/30; the 2 v2 splits (AVGO, DE) came from the two
# ambiguities fixed below (dilution from acquisitions, several codes per stock).

Why: in v1 every one of the 32 overrides was an upgrade, and "the reviewer may change the default with one sentence" let
judgment drift. v2 keeps the v1 fields and red-flag list but closes the reasons a review may change the screen label,
and every change must cite a NUMBER (with source and period). No number -> no change.

## Default
The graded EDGAR screen (core/quality_severity.csv, `new_label`) is the default:
CORE-ELIGIBLE -> CORE · WATCH -> WATCH · NON-CORE -> NON-CORE.

## Allowed UPGRADES (only measurement errors) — the corrected number must itself pass the original threshold
- **U1 Metric does not fit the business model.** Only these substitutions:
  retail / distribution with ROIC >= 15% -> margin rule replaced by ROIC; bank / broker / asset manager -> ROE or ROTCE >= 10%;
  insurer -> combined ratio < 100% in 4 of 5 years; regulated utility -> ROE >= 10%; REIT -> AFFO / Core FFO per share
  growth >= 3%/yr over 3 years, ND/EBITDA <= 6. Cite the substitute number.
- **U2 Data artefact.** Spin-off / merger / divestiture distorting growth (cite pro-forma or continuing-operations growth);
  one-time charge (acquired IPR&D, litigation, impairment — cite the adjusted figure; recurring IPR&D is averaged, std 2b-d);
  missing or wrong EDGAR tag (cite the figure from the 10-K/10-Q); dilution caused by an equity-funded acquisition
  (cite the deal and the share count change SINCE the deal closed, which must be <= 2% a year).
- **U3 Cycle artefact (std 2b-b).** Growth failure only, and only if all three hold: revenue fell >= 10% from a peak near
  the start of the window, CAGR since FY2020 >= 3%, and TTM revenue grew year over year. Cite all three.
Not allowed: brand, moat, "industry characteristics", management quality, analyst ratings, price action, future
product hopes, "structurally low growth is the model" (std 2b-a).

## Allowed DOWNGRADES — each needs a number or a dated, sourced event
- **D1 Cyclical peak.** Operating margin or EPS >= 1.5x its own average of the prior 5 fiscal years AND the industry is
  cyclical (commodities, semicap / memory, autos, housing, industrials, energy). Cite current vs average.
- **D2 Deterioration inside the window.** In the last 2 reported quarters: revenue YoY <= -10%, or operating income YoY
  <= -20%, or operating margin down >= 5 percentage points vs the same quarters a year earlier. Cite the quarters.
- **D3 Hard red flag (v1 list), with evidence:** FCF negative in >= 3 of the last 4 quarters without a disclosed,
  funded investment program; net debt / EBITDA > 4 and rising; share count up > 5% a year (not an equity-funded
  acquisition already in growth); restatement, material weakness, auditor resignation or regulator investigation into
  accounting; controlling-holder / governance abuse documented in filings.
- **D4 Structural event.** A dated, specific event: court ruling or enacted regulation hitting a core segment, loss of a
  customer >= 10% of revenue, guidance cut that the company attributes to a lasting cause. Cite date and source.
- **D5 Valuation UNJUSTIFIABLE -> WATCH.** Cite the metric (forward P/E, EV/FCF, FCF yield) and why growth cannot
  justify it.
Not allowed: general caution, "expensive" (only UNJUSTIFIABLE counts), price drops, analyst downgrades by themselves.

## Re-reviews (after a report, an 8-K, material news or a > 2x ADR move)
The previous final label stands unless a NEW fact since the previous review (date + source) triggers one of U1–U3 or
D1–D5. No new fact -> no change, even if a fresh reading "feels" different.

## Several failures
Every failing rule needs its own code; one code per failure, all listed. A rule left without a code keeps its failure.

## Output (added to each review JSON)
`final_quality`, `override_code` (none, or a list of U1..U3 / D1..D5), `override_evidence` (the number(s), period, source),
`valuation` (ATTRACTIVE / FAIR / EXPENSIVE / UNJUSTIFIABLE), `review_date`, `trigger` (initial / report / 8-K / news / move / weekly).
