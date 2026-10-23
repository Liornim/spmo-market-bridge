"""Cyclical peak by the numbers (decision 23.10.2026) -> core/cyclical.json.

For every stock, from the quarterly SEC series in core/sec/<T>.json (revenue and operating income; pretax or net
income when a filer reports no operating income, e.g. banks):
  m4    = operating margin of the last 4 quarters (sum / sum)
  base  = median of the rolling 4-quarter margin before the last year
  swing = at some point the rolling margin was <= 0 or fell to half of its earlier peak (the business HAS had winters)
  stable8 = the last 8 single-quarter margins vary little (st.dev <= 15% of their mean)
Label:
  PEAK      m4 >= 1.5 x base, and swing, and not stable8   -> "at a cyclical peak"
  NEW LEVEL m4 >= 1.5 x base, and stable8                 -> high but steady for 2 years: not counted as a peak
  HIGH      m4 >= 1.5 x base, no swing in the history      -> not counted as a peak (no history of a winter)
  NORMAL    otherwise
  NO DATA   fewer than 12 quarters (foreign filers, filers without a quarterly operating figure)
turning = PEAK and the single-quarter margin fell 2 quarters in a row (first sign the season is ending).
Information only, used for the display-only quality tier. Runs in sec-facts after the screen.
"""
import json, os, statistics as st, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'


def label(t):
    try:
        c = json.load(open(os.path.join(ROOT, 'core', 'sec', t + '.json')))['concepts']
    except Exception:
        return {'label': 'NO DATA', 'why': 'אין קובץ SEC'}
    rv = {x['end']: x['val'] for x in (c.get('revenue') or {}).get('quarters', [])}
    src = next((c[k] for k in ('operating_income', 'pretax_income', 'net_income') if (c.get(k) or {}).get('quarters')), None)
    if not rv or not src:
        return {'label': 'NO DATA', 'why': 'אין נתונים רבעוניים ב־SEC'}
    oi = {x['end']: x['val'] for x in src['quarters']}
    ks = sorted(k for k in rv if k in oi and rv[k])
    if len(ks) < 12:
        return {'label': 'NO DATA', 'why': f'רק {len(ks)} רבעונים'}
    roll = [sum(oi[k] for k in ks[i - 3:i + 1]) / sum(rv[k] for k in ks[i - 3:i + 1]) for i in range(3, len(ks))]
    m4 = roll[-1]
    base = st.median(roll[:-4]) if len(roll) > 8 else st.median(roll[:-1])
    pk = [max(roll[:i + 1]) for i in range(len(roll))]
    swing = any(r <= 0 or (p > 0 and r <= 0.5 * p) for r, p in zip(roll, pk))
    q = [oi[k] / rv[k] for k in ks]
    l8 = q[-8:]
    stable8 = st.mean(l8) > 0 and st.pstdev(l8) <= 0.15 * st.mean(l8)
    high = base > 0 and m4 >= 1.5 * base
    lab = 'PEAK' if high and swing and not stable8 else 'NEW LEVEL' if high and stable8 else 'HIGH' if high else 'NORMAL'
    turning = lab == 'PEAK' and q[-1] < q[-2] < q[-3]
    return {'label': lab, 'm4': round(m4, 4), 'base': round(base, 4), 'ratio': round(m4 / base, 2) if base > 0 else None,
            'swing': swing, 'stable8': stable8, 'turning': turning, 'quarters': len(ks), 'last_q': ks[-1],
            'metric': 'operating' if src is c.get('operating_income') else 'pretax' if src is c.get('pretax_income') else 'net',
            'q8': [round(x, 4) for x in q[-8:]]}


def main():
    cd = json.load(open(os.path.join(ROOT, 'core', 'core_data.json')))
    syms = [r[0] for r in cd['list']['rows']]
    rows = {s: label(s) for s in syms}
    from collections import Counter
    print(Counter(r['label'] for r in rows.values()), 'PEAK:', [s for s, r in rows.items() if r['label'] == 'PEAK'])
    json.dump({'built': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y-%m-%d %H:%MZ'), 'rule': __doc__.split('Label:')[1].split('Information')[0].strip(),
               'rows': rows}, open(os.path.join(ROOT, 'core', 'cyclical.json'), 'w'), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
