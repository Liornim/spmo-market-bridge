# CORE screen rules — frozen 2026-10-13 before any company was scored

Data: Bigdata.com tearsheets (provider FMP), annual statements, only fiscal years with report_date ≤ 2026-10-13. "Latest FY" = newest such year. Up to 5 fiscal years.

## Classes
- FIN (banks, brokers, insurers, asset managers, crypto exchange): JPM BAC WFC C GS MS SCHW SOFI HOOD AXP CB PGR BRK-B BLK BX KKR COIN
- UTIL/REIT: DUK SO NEE PLD AMT
- STD: all others

## Criteria (each PASS/FAIL)
STD:
1. PROFIT — latest-FY operating margin ≥ 10% AND net income > 0 in ≥ 4 of the last 5 FY (all years if fewer than 5).
2. CASH — free cash flow > 0 in latest FY AND in ≥ 4 of last 5 FY.
3. RETURNS — ROIC ≥ 10%, ROIC = max(provider TTM ROIC, latest-FY operating income × 0.79 / (total debt + total equity − cash), the latter only when the denominator > 0).
4. BALANCE — (total debt − cash) / EBITDA ≤ 3 in latest FY (net cash passes) AND operating income / interest expense ≥ 5 (interest expense 0 passes).
5. GROWTH — revenue CAGR over the last 3 FY ≥ 3% AND latest-FY revenue ≥ 95% of the prior FY.
6. DILUTION — diluted shares latest FY ≤ 105% of 3 FY earlier AND SBC / revenue ≤ 15%.

FIN: 1 = net income > 0 in every available FY; 2 = n/a (pass); 3 = latest-FY net income / total equity ≥ 10%; 4 = n/a (pass); 5 and 6 as STD.
UTIL/REIT: 2 = operating cash flow > 0 every FY; 4 = net debt / EBITDA ≤ 6 and interest coverage ≥ 2; others as STD.

## Label
- CORE = all 6 pass.
- WATCH = exactly 1 fails → needs a human read of the reason before it can be CORE.
- NON-CORE = 2 or more fail.

## Valuation (information only, does NOT change the label)
- PE_vs_own = provider TTM P/E ÷ median of the company's FY P/E over available years (only positive values).
- Valuation flag: EXPENSIVE if PE_vs_own > 1.3 AND TTM FCF yield < 2%; CHEAP if PE_vs_own < 0.8; else FAIR. n/a if no positive P/E history.

## Price/Risk columns (from our own DB, as of 2026-09-30)
- Risk Tier and position cap from risk_engine.csv (LOW/MEDIUM 10%, HIGH 6%, EXTREME 3%).
- Cheap Score per NEW_PROTOCOL definition on the last DB day; quartile Q1–Q4; SMA200 rising yes/no.

## Known limits
- Analyst estimates are often on an adjusted basis vs GAAP history → shown only, never used.
- TSM in TWD, ASML in EUR — ratios unaffected.
- A mechanical screen does not judge moat, management or guidance; WATCH and borderline CORE need a reading.
- This screen is not backtested (point-in-time fundamentals not available); it is a quality filter, not an edge claim.
