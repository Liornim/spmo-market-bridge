"""CORE screen on SEC EDGAR numbers (core/sec/*.json), same frozen rules as core/CORE_RULES.md,
measured on the LATEST period: trailing 4 quarters (TTM) when it is newer than the last fiscal year.

Output: core/screen_sec.csv (one row per stock: metrics, PASS/FAIL per rule, label, previous label).
Run: python tools/core/screen_sec.py [repo_root]
"""
import json, os, sys, glob, datetime
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import secutil

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
TODAY = datetime.date.today().isoformat()
FIN = set('JPM BAC WFC C GS MS SCHW SOFI HOOD AXP CB PGR BRK-B BLK BX KKR COIN'.split())
UTIL = set('DUK SO NEE PLD AMT'.split())
T = dict(opm=.10, niy=4, fcfy=4, roic=.10, nde=3, cov=5, cagr=.03, yoy=-.05, sh=.05, sbc=.15, roe=.10, unde=6, ucov=2)
d = lambda s: datetime.date.fromisoformat(s)

def series(c, key):
    """TTM value at every period end we can build: fiscal years + rolling 4 quarters."""
    node = c.get(key) or {}
    out = {}
    for a in node.get('annual', []):
        if a['end'] <= TODAY: out[a['end']] = a['val']
    q = [x for x in node.get('quarters', []) if x['end'] <= TODAY]
    for i in range(3, len(q)):
        w = q[i - 3:i + 1]
        if (d(w[-1]['end']) - d(w[0]['start'])).days <= 380:
            out.setdefault(w[-1]['end'], sum(x['val'] for x in w))
    return dict(sorted(out.items()))

def at(ser, end, tol=20):
    best = None
    for e, v in ser.items():
        gap = abs((d(e) - d(end)).days)
        if gap <= tol and (best is None or gap < best[0]): best = (gap, v)
    return None if best is None else best[1]

def inst(c, key, end=None):
    arr = [x for x in (c.get(key) or {}).get('instant', []) if x['end'] <= TODAY]
    if not arr: return None
    if end is None: return arr[-1]['val']
    v = [x for x in arr if abs((d(x['end']) - d(end)).days) <= 20]
    return v[-1]['val'] if v else None

def minus_years(end, n):
    e = d(end)
    try: return e.replace(year=e.year - n).isoformat()
    except ValueError: return (e.replace(day=28, year=e.year - n)).isoformat()

def split_adjusted_shares(c):
    """diluted share counts with obvious stock splits removed (ratio between neighbours ~ an integer >= 2)."""
    node = c.get('shares_diluted') or {}
    pts = sorted({x['end']: x['val'] for x in node.get('annual', []) + node.get('quarters', []) if x['end'] <= TODAY}.items())
    if not pts: return {}
    vals = [v for _, v in pts]; adj = [1.0] * len(vals)
    for i in range(1, len(vals)):
        r = vals[i] / vals[i - 1] if vals[i - 1] else 1
        for k in (2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50):
            if abs(r / k - 1) < .06:
                for j in range(i): adj[j] *= k
            if r and abs((1 / r) / k - 1) < .06:
                for j in range(i): adj[j] /= k
    return {e: v * a for (e, v), a in zip(pts, adj)}

prev = {}
cd = json.load(open(os.path.join(ROOT, 'core', 'core_data.json')))
L = cd['list']; iS, iL = L['cols'].index('סימול'), L['cols'].index('תווית')
for r in L['rows']: prev[r[iS]] = r[iL]

rows = []
for f in sorted(glob.glob(os.path.join(ROOT, 'core', 'sec', '*.json'))):
    if os.path.basename(f).startswith('_'): continue
    j = json.load(open(f)); t = j['ticker']; c = j['concepts']
    cls = 'FIN' if t in FIN else 'UTIL/REIT' if t in UTIL else 'STD'
    rev = series(c, 'revenue'); ni = series(c, 'net_income'); ocf = series(c, 'operating_cash_flow'); cap = series(c, 'capex')
    oi = series(c, 'operating_income'); pre = series(c, 'pretax_income'); ie = series(c, 'interest_expense')
    dna = series(c, 'dna'); sbc = series(c, 'sbc')
    fy = [a['end'] for a in (c.get('revenue') or {}).get('annual', []) if a['end'] <= TODAY][-5:]
    row = dict(ticker=t, cls=cls, prev_label=prev.get(t), n_fy=len(fy), note='')
    if not rev or len(fy) < 3:
        row['note'] = 'not enough SEC history'; rows.append(row); continue
    L_end = max(rev)  # latest period: TTM or fiscal year, whichever is newer
    row['latest_end'] = L_end; row['latest_kind'] = 'FY' if L_end in fy else 'TTM'
    R0, R1, R3 = at(rev, L_end), at(rev, minus_years(L_end, 1), 40), at(rev, minus_years(L_end, 3), 40)
    g3 = None  # 3-year growth window measured on fiscal years when quarters do not reach back 3 years
    if R1 is not None and R3 is None and len(fy) >= 4:
        g3 = (fy[-4], fy[-1]); R3 = None; row['note'] += 'TTM; 3y growth on FY ' + fy[-4][:4] + '-' + fy[-1][:4] + '; '
    elif R1 is None or R3 is None:  # quarterly history too thin (foreign filers): measure on fiscal years
        L_end = fy[-1]; row['latest_end'] = L_end; row['latest_kind'] = 'FY'; row['note'] += 'FY fallback; '
        R0, R1, R3 = at(rev, L_end), at(rev, fy[-2]), (at(rev, fy[-4]) if len(fy) >= 4 else None)
    o = at(oi, L_end)
    if o is None and at(pre, L_end) is not None:
        if cls == 'FIN': o = at(pre, L_end); row['note'] += 'op.income=pretax (financial: interest is operating); '
        else: o = at(pre, L_end) + (at(ie, L_end) or 0); row['note'] += 'op.income=pretax+interest; '
    n0 = at(ni, L_end); cf0 = at(ocf, L_end); cp0 = at(cap, L_end)
    if cf0 is not None and cp0 is None: row['note'] += 'CAPEX NOT REPORTED FOR THIS PERIOD: FCF = operating cash flow; '
    fcf0 = (cf0 - abs(cp0 or 0)) if cf0 is not None else None
    # balance sheet: every item from ONE date, the latest balance sheet at (or just before) the measured period
    bs_dates = sorted({x['end'] for k in ('equity', 'equity_incl_nci', 'total_assets') for x in (c.get(k) or {}).get('instant', []) if x['end'] <= TODAY})
    near = [e for e in bs_dates if -100 <= (d(e) - d(L_end)).days <= 10]
    BS = near[-1] if near else (bs_dates[-1] if bs_dates else L_end)
    if not near: row['note'] += f'BALANCE SHEET STALE ({BS}); '
    row['balance_date'] = BS
    def latest(k, max_age=400):   # (date, value) of the newest instant at or before the balance-sheet date
        arr = [x for x in (c.get(k) or {}).get('instant', []) if x['end'] <= (d(BS) + datetime.timedelta(10)).isoformat()]
        if not arr: return None, None
        x = arr[-1]
        return (x['end'], x['val']) if (d(BS) - d(x['end'])).days <= max_age else (None, None)
    eq = inst(c, 'equity', BS); eqn = inst(c, 'equity_incl_nci', BS) or eq
    cash = (inst(c, 'cash', BS) or 0) + (inst(c, 'short_term_investments', BS) or 0)
    # debt excluding operating leases: the definition with the most recent figure (10-Qs often report only some tags)
    cands = []
    for pr, k in enumerate(('debt_total', 'long_term_debt')):
        e_, v_ = latest(k)
        if e_: cands.append((e_, -pr, v_, k))
    e_, v_ = latest('long_term_debt_noncurrent'); e2, v2 = latest('ltd_lease_noncurrent')
    if e_ or e2:
        en = e_ or e2; vn = v_ if e_ else v2
        ec, vc = latest('debt_current'); ec2, vc2 = latest('ltd_lease_current')
        cur = vc if ec and abs((d(ec) - d(en)).days) <= 100 else (vc2 if ec2 and abs((d(ec2) - d(en)).days) <= 100 else 0)
        cands.append((en, -2, vn + (cur or 0), 'noncurrent+current'))
    e_, v_ = latest('debt_instrument_carrying')
    if e_: cands.append((e_, -3, v_, 'instrument carrying'))
    if cands:
        dd_, _, debt, how = max(cands)
        if how == 'instrument carrying': row['note'] += 'debt=instrument carrying; '
        if (d(BS) - d(dd_)).days > 100: row['note'] += f'debt as of {dd_} (no newer figure); '
        row['debt_date'] = dd_
    else:
        debt = 0; dd_ = BS; row['note'] += 'NO RECENT DEBT FIGURE (debt counted as 0); '
    es, vs = latest('short_term_borrowings')
    if es and (d(BS) - d(es)).days <= 100: debt += vs or 0
    if at(ie, L_end) is None: row['note'] += 'NO INTEREST TAG; '
    da = at(dna, L_end) or 0
    if (c.get('dna') or {}).get('tag', '').endswith(':Depreciation') and at(series(c, 'amortization'), L_end):
        da += at(series(c, 'amortization'), L_end); row['note'] += 'EBITDA adds amortization of intangibles (D&A tag is depreciation only); '
    ebitda = (o + da) if o is not None else None
    i0 = at(ie, L_end)
    sh = split_adjusted_shares(c)
    if not sh:  # no diluted-share tag: implied from net income / diluted EPS
        eps = c.get('eps_diluted') or {}
        imp = {}
        for x in eps.get('annual', []) + eps.get('quarters', []):
            n_ = (c.get('net_income') or {})
            for y in n_.get('annual', []) + n_.get('quarters', []):
                if y['end'] == x['end'] and y.get('start') == x.get('start') and x['val']: imp[x['end']] = y['val'] / x['val']
        c = dict(c, shares_diluted={'annual': [{'end': e, 'val': v} for e, v in sorted(imp.items())], 'quarters': []}); sh = split_adjusted_shares(c)
        if sh: row['note'] += 'shares=NI/EPS; '
    if not sh:  # last resort: shares outstanding from the filing cover page (dei), not diluted
        pts = {x['end']: x['val'] for x in (c.get('dei_shares_outstanding') or {}).get('instant', [])}
        if pts: c = dict(c, shares_diluted={'annual': [{'end': e, 'val': v} for e, v in sorted(pts.items())], 'quarters': []}); sh = split_adjusted_shares(c); row['note'] += 'shares=cover-page outstanding; '
    if not sh: row['note'] += 'NO SHARE COUNT IN EDGAR (dilution cannot be measured); '
    sh0 = at(sh, L_end, 40) if sh else None; sh3 = at(sh, minus_years(L_end, 3), 60) if sh else None
    ni_years = [at(ni, e) for e in fy]; fcf_years = [((at(ocf, e) or 0) - abs(at(cap, e) or 0)) if at(ocf, e) is not None else None for e in fy]
    if g3:
        a3, b3 = at(rev, g3[0]), at(rev, g3[1])
        cagr = (b3 / a3) ** (1 / 3) - 1 if a3 and b3 and a3 > 0 and b3 > 0 else None
        if sh: s_a, s_b = at(sh, g3[0], 40), at(sh, g3[1], 40); sh0, sh3 = (s_b, s_a) if s_a and s_b else (sh0, sh3)
    row.update(revenue=R0, rev_cagr3=cagr if g3 else ((R0 / R3) ** (1 / 3) - 1 if R0 and R3 and R3 > 0 and R0 > 0 else None),
               rev_yoy=R0 / R1 - 1 if R0 and R1 else None, op_margin=o / R0 if o is not None and R0 else None,
               net_income=n0, ni_pos_years=sum(1 for v in ni_years if v and v > 0), fcf=fcf0,
               fcf_pos_years=sum(1 for v in fcf_years if v and v > 0), ocf_pos_years=sum(1 for e in fy if (at(ocf, e) or 0) > 0),
               roic=(o * .79 / (debt + (eqn or 0) - cash) if (debt + (eqn or 0) - cash) > 0 else (9.99 if o > 0 else None)) if o is not None and eqn is not None else None,
               roe=n0 / (eq or eqn) if n0 is not None and (eq or eqn) and (eq or eqn) > 0 else None, net_debt=debt - cash,
               nd_ebitda=(debt - cash) / ebitda if ebitda and ebitda > 0 else (0 if debt - cash <= 0 else 99),
               int_cov=(o / i0 if o is not None and i0 and i0 > 0 else 999), share_chg3=sh0 / sh3 - 1 if sh0 and sh3 else None,
               sbc_rev=abs(at(sbc, L_end) or 0) / R0 if R0 else None)
    ok = lambda v: v is not None and not (isinstance(v, float) and np.isnan(v))
    H = len(fy); f_ = {}
    if cls == 'FIN': f_['profit'] = row['ni_pos_years'] == H
    else: f_['profit'] = ok(row['op_margin']) and row['op_margin'] >= T['opm'] and (row['ni_pos_years'] >= T['niy'] if H >= 5 else row['ni_pos_years'] == H)
    if cls == 'FIN': f_['cash'] = True
    elif cls == 'UTIL/REIT': f_['cash'] = row['ocf_pos_years'] == H
    else: f_['cash'] = ok(fcf0) and fcf0 > 0 and (row['fcf_pos_years'] >= T['fcfy'] if H >= 5 else row['fcf_pos_years'] == H)
    f_['returns'] = (ok(row['roe']) and row['roe'] >= T['roe']) if cls == 'FIN' else (ok(row['roic']) and row['roic'] >= T['roic'])
    if cls == 'FIN': f_['balance'] = True
    elif cls == 'UTIL/REIT': f_['balance'] = row['nd_ebitda'] <= T['unde'] and row['int_cov'] >= T['ucov']
    else: f_['balance'] = row['nd_ebitda'] <= T['nde'] and row['int_cov'] >= T['cov']
    f_['growth'] = ok(row['rev_cagr3']) and ok(row['rev_yoy']) and row['rev_cagr3'] >= T['cagr'] and row['rev_yoy'] >= T['yoy']
    f_['dilution'] = ok(row['share_chg3']) and row['share_chg3'] <= T['sh'] and ok(row['sbc_rev']) and row['sbc_rev'] <= T['sbc']
    fails = [k for k, v in f_.items() if not v]
    row.update({('pass_' + k): v for k, v in f_.items()}, fails=';'.join(fails),
               label='CORE-ELIGIBLE' if not fails else 'WATCH' if len(fails) == 1 else 'NON-CORE')
    row['changed'] = row['label'] != row['prev_label']
    row['data_status'] = secutil.data_status(t, c, TODAY)
    rows.append(row)

S = pd.DataFrame(rows)
S.to_csv(os.path.join(ROOT, 'core', 'screen_sec.csv'), index=False)
ok_rows = S[S.label.notna()]
print('screened', len(ok_rows), 'of', len(S), '| labels', ok_rows.label.value_counts().to_dict(), '| changed vs Bigdata screen', int(ok_rows.changed.sum()))
print(ok_rows[ok_rows.changed][['ticker', 'prev_label', 'label', 'fails', 'latest_kind', 'note']].to_string(index=False))
print(S[S.label.isna()][['ticker', 'note']].to_string(index=False))
