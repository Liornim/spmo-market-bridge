"""Historical odds for the three routes of the frozen method, as information beside each row of /today.

Question answered: "if I had entered a stock like this one on any day of the last five years and followed the route's
exit rules, how often did it end in a gain, in a loss, and how bad were the bad cases?"  It is a base rate, not a forecast.

Data: core/daily.csv.gz (+ core/daily_new.csv), regular session, split-adjusted, every symbol of the universe, 10/2021 on.
Every stock-day with 60 sessions of history is one entry, at that day's close (today the entry is intraday, near VWAP).
ADR60 is computed point in time (the 60 sessions up to the entry day), the same way state.py does it.

  TACTICAL  exit at +6% (first session whose high reaches entry x 1.06; filled at the open if it gapped above), else at the
            close of session H. No stop. H = 1..20.
  SPECULATIVE  stop at entry x (1 - 2 x ADR60/100) (first session whose low reaches it; filled at the open if it gapped
            below), else the close of session H. No target. H = 1..60.
  CORE      the close 252 sessions later (about 12 months), and whether the path fell 10% or more below the entry first.

Odds are pooled by ADR60 bucket (the stock's own daily range), so a stock is compared with stocks that moved like it.
Known biases, written into the json and the page: today's universe projected back (survivorship, flatters every result);
2021-2026 only (one bull run with the 2022 bear market inside); windows include earnings days, which the short routes
avoid, so the short-route tails are somewhat worse than a route that really exits before reports; overlapping windows
(n counts entries, not independent events); no costs or tax.

Information only: the frozen method does not use these numbers.
Output: core/estimates.json.  Run: python3 tools/core/estimates.py
"""
import json, os, datetime as dt
import numpy as np
import pandas as pd

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EDGES = [0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5, 4.0, 5.0, 99]   # ADR60 buckets, %
TACT_H, SPEC_H, CORE_H, TGT = 20, 60, 252, 0.06


def bucket_names():
    return [f'{EDGES[i]:g}-{EDGES[i + 1]:g}' for i in range(len(EDGES) - 1)]   # '2-2.25', as JS prints numbers


def load():
    d = pd.read_csv(os.path.join(R, 'core', 'daily.csv.gz'))
    n = os.path.join(R, 'core', 'daily_new.csv')
    if os.path.exists(n):
        d = pd.concat([d, pd.read_csv(n).drop(columns=['nbars'], errors='ignore')])
    d = d.drop_duplicates(['symbol', 'date'], keep='last').sort_values(['symbol', 'date'])
    return d


def per_symbol(g):
    o, h, l, c = (g[k].to_numpy(float) for k in ('open', 'high', 'low', 'close'))
    n = len(c)
    rng = pd.Series((h - l) / c).rolling(60).mean().to_numpy() * 100        # ADR60 at each day, point in time
    b = np.digitize(rng, EDGES) - 1                                          # bucket index (nan -> out of range)
    out = {'b': b, 'ok': ~np.isnan(rng), 'n': n}
    # TACTICAL: per entry t, the result for every H (vector of length TACT_H) or nan when the window runs past the data
    tact = np.full((n, TACT_H), np.nan); hit = np.zeros((n, TACT_H), bool)
    spec = np.full((n, SPEC_H), np.nan); stp = np.zeros((n, SPEC_H), bool)
    hold = np.full((n, TACT_H), np.nan)
    core = np.full(n, np.nan); dd10 = np.zeros(n, bool)
    for t in range(59, n - 1):
        e = c[t]; T = e * (1 + TGT); done = None
        for k in range(1, TACT_H + 1):
            j = t + k
            if j >= n: break
            if done is None and h[j] >= T:
                done = (o[j] / e - 1) if o[j] >= T else TGT
            hold[t, k - 1] = c[j] / e - 1
            if done is not None:
                tact[t, k - 1] = done; hit[t, k - 1] = True
            else:
                tact[t, k - 1] = c[j] / e - 1
        s = 2 * rng[t] / 100; S = e * (1 - s); done = None
        for k in range(1, SPEC_H + 1):
            j = t + k
            if j >= n: break
            if done is None and l[j] <= S:
                done = (o[j] / e - 1) if o[j] <= S else -s
            if done is not None:
                spec[t, k - 1] = done; stp[t, k - 1] = True
            else:
                spec[t, k - 1] = c[j] / e - 1
        if t + CORE_H < n:
            core[t] = c[t + CORE_H] / e - 1
            dd10[t] = l[t + 1:t + CORE_H + 1].min() / e - 1 <= -0.10
    out.update(tact=tact, hold=hold, hit=hit, spec=spec, stp=stp, core=core, dd10=dd10)
    return out


def summ(r, flag=None, base=None):
    m = ~np.isnan(r)
    r = r[m]
    if len(r) < 200: return None
    o = {'n': int(len(r)), 'p_gain': round(float((r > 0).mean()), 4), 'p_loss': round(float((r < 0).mean()), 4),
         'mean': round(float(r.mean()), 5), 'median': round(float(np.median(r)), 5),
         'p10': round(float(np.percentile(r, 10)), 5), 'p90': round(float(np.percentile(r, 90)), 5)}
    if flag is not None: o['p_flag'] = round(float(flag[m].mean()), 4)
    if base is not None: o['hold_mean'] = round(float(base[m].mean()), 5)
    return o


def main():
    d = load()
    names = bucket_names()
    acc = {k: {i: [] for i in range(len(names))} for k in ('tact', 'hold', 'hit', 'spec', 'stp', 'core', 'dd10')}
    syms = [s for s in d.symbol.unique()]
    for s in syms:
        g = d[d.symbol == s]
        if len(g) < 120: continue
        x = per_symbol(g)
        for i in range(len(names)):
            m = x['ok'] & (x['b'] == i)
            for k in acc: acc[k][i].append(x[k][m])
    res = {'tactical': {}, 'speculative': {}, 'core': {}}
    for i, nm in enumerate(names):
        if not acc['core'][i]: continue
        T = np.concatenate(acc['tact'][i]); H = np.concatenate(acc['hit'][i]); B = np.concatenate(acc['hold'][i])
        S = np.concatenate(acc['spec'][i]); P = np.concatenate(acc['stp'][i])
        C = np.concatenate(acc['core'][i]); D = np.concatenate(acc['dd10'][i])
        if len(T) == 0: continue
        res['tactical'][nm] = {str(k + 1): summ(T[:, k], H[:, k], B[:, k]) for k in range(TACT_H)}
        res['speculative'][nm] = {str(k + 1): summ(S[:, k], P[:, k]) for k in range(SPEC_H)}
        res['core'][nm] = summ(C, D)
    out = {'built': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%MZ'), 'from': str(d.date.min()), 'to': str(d.date.max()),
           'symbols': int(d.symbol.nunique()), 'edges': EDGES, 'target': TGT,
           'fields': {'p_gain': 'share of entries that ended above the entry', 'p_loss': 'ended below', 'p_flag':
                      'tactical: reached +6% (exited there) · speculative: hit the stop · core: fell 10%+ below the entry on the way',
                      'mean': 'average result', 'hold_mean': 'tactical: average of simply holding the same entries for the same sessions (what the +6% cap is compared with)', 'p10': '10th percentile (the bad 10%)', 'n': 'entries (overlapping windows)'},
           'biases': ['survivorship: today\'s universe projected back', 'one period 2021-2026', 'windows include earnings days',
                      'overlapping windows', 'no costs or tax', 'entry at the close, not intraday'],
           'note': 'Base rates of the route rules at any entry day; information only, not used by the method.'}
    out.update(res)
    p = os.path.join(R, 'core', 'estimates.json')
    json.dump(out, open(p, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('wrote', p, os.path.getsize(p), 'bytes')
    for nm in names:
        t = res['tactical'].get(nm, {}).get('20'); c = res['core'].get(nm)
        if t and c:
            print(f"ADR {nm:9} TACT20 n={t['n']:6} hit={t['p_flag']:.2f} gain={t['p_gain']:.2f} loss={t['p_loss']:.2f} mean={t['mean']*100:+.2f}% hold={t['hold_mean']*100:+.2f}% p10={t['p10']*100:+.1f}% | CORE n={c['n']:6} up={c['p_gain']:.2f} med={c['median']*100:+.1f}% p10={c['p10']*100:+.1f}% dd10={c['p_flag']:.2f}")


if __name__ == '__main__':
    main()
