"""Graded severity for the 6 EDGAR screen rules (Noam's request 22.10.2026).

The screen (screen_sec.py) is pass/fail and every failure counts 1, so ROIC 9.8% and five years of negative FCF weigh
the same. This reads core/screen_sec.csv (no re-fetch) and grades every FAILED rule:
  0 = pass
  1 = near miss  (within ~15% of the threshold, or 1 percentage point for growth; or a data gap, flagged DATA)
  2 = clear fail
  3 = severe     (losses / negative FCF in most years, metric far beyond the threshold)
Label: sum <= 1 and no 3 -> CORE-ELIGIBLE (at most one near miss); any 3 or sum >= 4 -> NON-CORE; else WATCH.
Thresholds for the bands are a judgment call fixed BEFORE looking at which labels change; two exceptions were added
after the first run and are marked below (both fix known metric-fit problems, not individual names).
Output: core/quality_severity.csv
"""
import os, math
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
S = pd.read_csv(os.path.join(ROOT, 'core', 'screen_sec.csv'))


def num(v):
    try:
        v = float(v)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


def low_is_bad(v, thr, near=.85, clear=.6):          # metric must be >= thr
    if v is None: return 1, 'DATA'
    if v >= thr: return 0, ''
    if v >= thr * near: return 1, ''
    if v >= thr * clear: return 2, ''
    return 3, ''


def high_is_bad(v, thr, near=1.15, clear=1.5):       # metric must be <= thr
    if v is None: return 1, 'DATA'
    if v <= thr: return 0, ''
    if v <= thr * near: return 1, ''
    if v <= thr * clear: return 2, ''
    return 3, ''


def years(pos, H, need):                              # positive years out of H
    if H < 5: return (0 if pos == H else 2 if pos >= H - 1 else 3)
    return 0 if pos >= need else 2 if pos == need - 1 else 3


rows = []
for _, r in S.iterrows():
    if pd.isna(r.get('label')): continue
    cls, H = r['cls'], int(r['n_fy'] or 0)
    g = {}; why = {}
    # profit
    if cls == 'FIN':
        g['profit'] = years(int(r['ni_pos_years']), H, H) if H else 1
    else:
        m = num(r['op_margin'])
        a, f = low_is_bad(m, .10) if (m is None or m >= 0) else (3, '')
        # added after the first run (COST/WMT came out NON-CORE): a low margin with a high return on capital is a
        # business model (low margin x high turnover), not weak profitability -> margin counts at most as a near miss
        if (num(r['roic']) or 0) >= .15: a = min(a, 1)
        g['profit'] = max(a, years(int(r['ni_pos_years']), H, 4)); why['profit'] = f
    # cash
    if cls == 'FIN':
        g['cash'] = 0
    elif cls == 'UTIL/REIT':
        g['cash'] = years(int(r['ocf_pos_years']), H, H)
    else:
        fcf, py = num(r['fcf']), int(r['fcf_pos_years'])
        yrs = years(py, H, 4)
        cur = 1 if fcf is None else (0 if fcf > 0 else 2)
        g['cash'] = 3 if (cur == 2 and yrs >= 2) else max(cur, yrs); why['cash'] = 'DATA' if fcf is None else ''
    # returns
    v = num(r['roe']) if cls == 'FIN' else num(r['roic'])
    g['returns'], why['returns'] = low_is_bad(v, .10)
    # added after the first run (PLD/DUK came out NON-CORE): ROIC on book capital does not fit REITs/regulated
    # utilities (review standard 2b-c uses ROE / AFFO per share instead) -> at most a clear fail, never severe
    if cls == 'UTIL/REIT': g['returns'] = min(g['returns'], 2)
    # balance
    if cls == 'FIN':
        g['balance'] = 0
    else:
        nt, ct = (6, 2) if cls == 'UTIL/REIT' else (3, 5)
        nd, cv = num(r['nd_ebitda']), num(r['int_cov'])
        a = 3 if nd is not None and nd >= 99 else high_is_bad(nd, nt)[0]
        g['balance'] = max(a, low_is_bad(cv, ct)[0])
    # growth: percentage points, a single negative 3y CAGR is 2 (often cyclical), 3 only if also falling now
    c3, yy = num(r['rev_cagr3']), num(r['rev_yoy'])
    if c3 is None or yy is None: g['growth'], why['growth'] = 1, 'DATA'
    else:
        a = 0 if c3 >= .03 else 1 if c3 >= .02 else 2
        b = 0 if yy >= -.05 else 2
        g['growth'] = 3 if (c3 < 0 and yy < -.05) else max(a, b)
    # dilution
    s3, sb = num(r['share_chg3']), num(r['sbc_rev'])
    a, fa = high_is_bad(s3, .05, 1.15, 2.0)
    b, fb = high_is_bad(sb, .15, 1.15, 1.67)
    g['dilution'] = max(a, b); why['dilution'] = fa or fb
    # a data gap only counts where the old screen also failed the rule
    for k in g:
        if r['pass_' + k] in (True, 'True'): g[k] = 0
    tot = sum(g.values()); mx = max(g.values())
    lab = 'NON-CORE' if (mx == 3 or tot >= 4) else 'CORE-ELIGIBLE' if tot <= 1 else 'WATCH'
    rows.append(dict(ticker=r['ticker'], cls=cls, old_label=r['label'], new_label=lab, severity=tot, worst=mx,
                     **{'sev_' + k: v for k, v in g.items()},
                     data_flags=';'.join(k for k, f in why.items() if f == 'DATA' and g.get(k))))

out = pd.DataFrame(rows)
out.to_csv(os.path.join(ROOT, 'core', 'quality_severity.csv'), index=False)
print(pd.crosstab(out.old_label, out.new_label, margins=True))
