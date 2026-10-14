# CORE review protocol — frozen 2026-10-13 (agreed Claude + ChatGPT + Noam)

CORE means: a business we intend to own 3–5 years, holding through drawdowns typical of its Risk Tier while the business thesis holds. A sharp drop triggers a thesis review, not an automatic sale and not a blind commitment.

## Default and overrides
- The SEC EDGAR screen result (core/screen_sec.csv, numbers in core/sec/<TICKER>.json) is the DEFAULT (owner's decision 13.10: EDGAR is the only source for financial statements; until 14.10 round 1 used the earlier Bigdata-based Excel screen).
- `excel_status` in each review records the screen label the reviewer saw; when the EDGAR label later differs, the stock is REVIEW REQUIRED (no CORE, no TACTICAL; SPECULATIVE allowed) until reviewed again.
- Screen CORE-ELIGIBLE → strong default CORE. Screen WATCH → stays WATCH unless the review justifies a change. Screen NON-CORE → may be promoted ONLY if the screen used a metric unsuitable for this business model, or a data problem is clear. "I like the company" is never a reason.
- Screen CORE-ELIGIBLE may be demoted (to WATCH or NON-CORE) if the review finds a hard red flag or an unjustifiable valuation.
- Every change from the default is an override and needs one clear sentence of reason.

## Hard red flags (any one → not CORE)
Chronic negative FCF without a sound reason · debt that endangers the business · persistent significant dilution · structural decline in revenue/profitability without a convincing turnaround · accounting/governance problems · future depends almost entirely on one speculative event · valuation so extreme it cannot reasonably be justified (→ WATCH, not necessarily NON-CORE).

## Fields to assess (each one short line, facts first, say when something is an estimate)
1. Business quality — competitive advantage, market position.
2. Growth — past (from our data) + forward (guidance / consensus; say which basis).
3. Profitability — with the metric that FITS the sector: bank → ROTCE, CET1, credit quality; insurer → combined ratio / underwriting; retail → low margins normal, look at ROIC, turns, FCF; SaaS → growth + FCF margin + retention; semis → margins, ROIC, cycle, capex, customer concentration; REIT → FFO/AFFO, leverage, occupancy.
4. FCF / cash generation — quality and direction.
5. Balance sheet — debt, cash, funding ability.
6. Capital allocation — buybacks, dividends, M&A, dilution.
7. Cyclicality — EXPLICIT question: are current earnings near a cyclical peak, so valuation looks cheap only because earnings are temporarily high? Answer yes / partly / no with the evidence.
8. Structural risks — regulation, litigation, customer concentration, disruption, single-product dependence.
9. Valuation — can the current price be reasonably justified? Use the fitting metric (forward P/E, EV/EBITDA, EV/FCF, FCF yield, PEG, P/B) vs own history and expected growth. Output one of ATTRACTIVE / FAIR / EXPENSIVE / UNJUSTIFIABLE.

## Output
Final Quality: CORE / WATCH / NON-CORE. No BUY/WAIT column. Price never delays a CORE build (40/30/30 within 8 weeks); only UNJUSTIFIABLE valuation keeps a company at WATCH.
