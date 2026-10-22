"""Which risk measures predict the FUTURE loss of a holder?  (22.10.2026, Noam: is NVDA riskier than CRDO?)

Universe: the 120 stocks in core/daily.csv.gz (ETFs excluded), 2021-10 .. 2026-10. Sample every 21 sessions.
Predictors at t (trailing data only, no look-ahead):
  adr      ADR60 (mean (H-L)/C, 60 sessions)                       -- the measure we already use
  corr     correlation of daily returns with SPY, 252 sessions
  idio     residual (non-market) daily vol, 252 sessions, % per day
  worst21  worst 21-session return in the trailing 252
  maxdd    max drawdown on closes from the start of the data to t   -- the measure we already use
Outcomes:
  fdd126   max drawdown over the next 126 sessions (from the close at t)
  loss1y   1 if the return over the next 252 sessions < -20%
Method: per date, cross-sectional Spearman correlation; then the same after removing what adr already explains
(rank-residual). Mean over dates with a t-stat on NON-OVERLAPPING dates only (every 6th sample for 126d, every 12th
for 252d).  Caveats: one market regime (2022 bear then bull), today's survivors only, few independent periods.
"""
import os, sys
import numpy as np, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = pd.read_csv(os.path.join(ROOT, 'core', 'daily.csv.gz'))
ETF = {'VOO', 'SPY', 'QQQ', 'SMH', 'SPMO', 'TQQQ', 'BITX', 'XLC', 'XLF', 'XLK', 'XLY'}
C = D.pivot(index='date', columns='symbol', values='close').sort_index()
H = D.pivot(index='date', columns='symbol', values='high').reindex(C.index)
L = D.pivot(index='date', columns='symbol', values='low').reindex(C.index)
R = C.pct_change()
spy = R['SPY']
stocks = [s for s in C.columns if s not in ETF]
rng = ((H - L) / C)[stocks]
dates = C.index


def at(i):
    rows = []
    w = R.iloc[i - 251:i + 1]
    m = w['SPY']
    for s in stocks:
        x = w[s]
        ok = x.notna() & m.notna()
        if ok.sum() < 200 or pd.isna(C[s].iloc[i]): continue
        b = np.cov(x[ok], m[ok])[0, 1] / m[ok].var()
        res = x[ok] - b * m[ok]
        c = C[s].iloc[:i + 1].dropna()
        r21 = (C[s].iloc[i - 251:i + 1] / C[s].shift(21).iloc[i - 251:i + 1] - 1).min()
        row = dict(date=dates[i], sym=s, adr=rng[s].iloc[i - 59:i + 1].mean() * 100,
                   corr=x[ok].corr(m[ok]), idio=res.std() * 100, worst21=r21 * 100,
                   maxdd=(c / c.cummax() - 1).min() * 100)
        p0 = C[s].iloc[i]
        f = C[s].iloc[i:i + 127].dropna()
        if len(f) >= 120: row['fdd126'] = (f / f.cummax() - 1).min() * 100
        if i + 252 < len(dates) and pd.notna(C[s].iloc[i + 252]): row['loss1y'] = float(C[s].iloc[i + 252] / p0 - 1 < -.20)
        rows.append(row)
    return rows


idx = list(range(251, len(dates) - 1, 21))
P = pd.DataFrame([r for i in idx for r in at(i)])
P.to_csv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'core', 'risk_panel.csv'), index=False)

# sign convention: higher predictor = riskier.  corr: test both directions by reporting raw sign.
pred = {'adr': 1, 'idio': 1, 'corr': 1, 'worst21': -1, 'maxdd': -1}
out = []
for y, step in (('fdd126', 6), ('loss1y', 12)):
    yy = -1 if y == 'fdd126' else 1                   # make "more loss" positive
    per = []
    for d, g in P.dropna(subset=[y]).groupby('date'):
        if len(g) < 60: continue
        t = (g[y] * yy).rank()
        ra = g['adr'].rank()
        resid = t - np.polyval(np.polyfit(ra, t, 1), ra)
        rec = {'date': d}
        for k, sg in pred.items():
            pk = (g[k] * sg).rank()
            rec[k] = t.corr(pk)
            if k != 'adr':
                pr = pk - np.polyval(np.polyfit(ra, pk, 1), ra)
                rec[k + '|adr'] = resid.corr(pr)
        per.append(rec)
    per = pd.DataFrame(per).set_index('date')
    for col in per.columns:
        s = per[col].dropna()
        ind = s.iloc[::step]
        tt = ind.mean() / (ind.std(ddof=1) / np.sqrt(len(ind))) if len(ind) > 2 else np.nan
        out.append(dict(outcome=y, predictor=col, mean_rank_corr=round(s.mean(), 3), n_dates=len(s),
                        n_indep=len(ind), t_indep=round(tt, 2), share_positive=round((s > 0).mean(), 2)))
print(pd.DataFrame(out).to_string(index=False))
