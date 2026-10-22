"""Continuous risk score (proposal 22.10.2026) -- replaces the 4 frozen tiers for SIZING NEW BUYS.

Research (tools/core/risk_research.py, core/risk_panel_dd.csv; 120 stocks, 2021-12..2026-04, every 21 sessions):
  * ADR60 ranks the next-6-month drawdown well (mean rank corr 0.63, positive on every date).
  * Past max drawdown adds something on 2022-10+ data but the sign FLIPS once 2022 is in the training set
    -> unstable, not used for sizing.
  * Worst past month adds nothing beyond ADR60.
  * Correlation with SPY does not change the 6-month drawdown, but stocks that move with the market had fewer
    1-year losses worse than -20% (rank corr -0.08, negative on ~85% of dates, only 4 independent years)
    -> shown as information ("moves with the market / on its own"), NOT used for sizing.
Model: 10th-percentile 6-month drawdown = -(9.82 + 8.70 x ADR60)  (quantile regression, ADR only).
  Out of sample (trained to 2023-06 / 2023-12) the breach rate was 13% / 17% vs 10% target: slightly optimistic.
  Median 6-month drawdown = -(3.83 + 5.77 x ADR60).
Cap for a NEW buy: position size so that the bad case costs <= 2.5% of the portfolio, max 10%.
ADR60 is today's (nightly), so the score moves every day; existing positions are never force-sold by it.
Output: core/risk_score.csv
"""
import os
import numpy as np, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUDGET, MAXCAP = 2.5, 10.0
S = pd.read_csv(os.path.join(ROOT, 'core', 'current_state_latest.csv'))
D = pd.read_csv(os.path.join(ROOT, 'core', 'daily.csv.gz'))
R = D.pivot(index='date', columns='symbol', values='close').sort_index().pct_change().iloc[-252:]
corr = R.corrwith(R['SPY'])
OLDCAP = {'LOW': 10, 'MEDIUM': 10, 'HIGH': 6, 'EXTREME': 3}

rows = []
for _, r in S.iterrows():
    a = r['ADR60']
    if pd.isna(a): continue
    etf = r.get('route') == 'ETF'
    bad = -(9.82 + 8.70 * a); med = -(3.83 + 5.77 * a)
    c = corr.get(r['symbol'], np.nan)
    rows.append(dict(symbol=r['symbol'], ADR60=round(a, 2), bad6m=round(bad, 1), med6m=round(med, 1),
                     cap_new=None if etf else round(min(MAXCAP, BUDGET / -bad * 100), 1),
                     tier_old=r.get('Risk_Tier'), cap_old=None if etf else OLDCAP.get(r.get('Risk_Tier')),
                     corr_spy=round(c, 2) if pd.notna(c) else None,
                     market_link=None if pd.isna(c) else 'moves with market' if c >= .6 else 'mixed' if c >= .45 else 'moves on its own'))
out = pd.DataFrame(rows).sort_values('bad6m')
out.to_csv(os.path.join(ROOT, 'core', 'risk_score.csv'), index=False)
print(out.to_string(index=False))
