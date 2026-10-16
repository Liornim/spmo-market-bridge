"""Score the research firms (banks/brokers) that publish ratings and price targets on our stocks, and a weighted target per stock.

Data: Yahoo upgradeDowngradeHistory (every rating/target action per firm, years back) through the Worker; our split-adjusted
daily closes (core/daily.csv.gz, from 2021-10) plus split events from Yahoo (targets are published in the prices of their day,
so a target set before a split is divided by the split ratio).

Per firm (all our stocks together):
  target accuracy  for each target at least 12 months old: |target / price 12 months later - 1|. median_abs_err: lower = better.
                   bias = median(target / price 12 months later - 1): above 0 = the firm's targets run too high.
  rating calls     after an upgrade (or downgrade): the stock's move minus SPY's over the next 63 sessions (~3 months).
                   hit63 = share of calls that went the called way. edge63 = mean excess after upgrades - after downgrades.
  score 0-100      (1 - median_abs_err) x 100: target accuracy only, the same scale for every firm. reliable = >= 20 scored targets.
                   Rating-call results (hit63, edge63) are shown beside it, not mixed in: most firms have too few calls.
Per stock: weighted target = each firm's latest target from the last 90 days, weight = recency (half-life 45 days) x
  (score / 50 for a reliable firm, 1 otherwise).

Information only: the frozen method does not use analyst data. Firm level, not the individual analyst.
"""
import json, os, sys, time, math, datetime as dt, urllib.request, statistics as stt
import pandas as pd

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKER = 'https://spmo-market-bridge.noamharelnim.workers.dev'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}


def get(path):
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(WORKER + path, headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e; time.sleep(2 * (i + 1))
    raise RuntimeError(last)


def main():
    st = json.load(open(os.path.join(R, 'core', 'current_state.json')))
    syms = [r['symbol'] for r in st['rows'] if r.get('kind') != 'ETF']
    only = [s.upper() for s in sys.argv[1:] if s.upper() != 'ALL']
    if only: syms = [s for s in syms if s in only]
    d = pd.read_csv(os.path.join(R, 'core', 'daily.csv.gz'), usecols=['symbol', 'date', 'close'])
    px = {s: g.set_index('date')['close'] for s, g in d.groupby('symbol')}
    spy = px['SPY']; dates = list(spy.index)
    pos = {x: i for i, x in enumerate(dates)}
    today = dt.date.today()

    def idx_on_or_before(day):
        lo, hi = 0, len(dates) - 1
        if day < dates[0]: return None
        while lo < hi:
            m = (lo + hi + 1) // 2
            if dates[m] <= day: lo = m
            else: hi = m - 1
        return lo

    tgt_rows, call_rows, fresh = [], [], {}
    for s in syms:
        try:
            h = ((get(f'/xa/yahoo_qs/{s}?modules=upgradeDowngradeHistory')['quoteSummary']['result'] or [{}])[0]
                 .get('upgradeDowngradeHistory') or {}).get('history') or []
        except Exception as e:
            print('history fail', s, e, flush=True); continue
        try:
            res = get(f'/xa/yahoo_d/{s}?range=5y')['chart']['result'][0]
            splits = [(dt.datetime.fromtimestamp(v['date'], dt.timezone.utc).date().isoformat(), v['numerator'] / v['denominator'])
                      for v in ((res.get('events') or {}).get('splits') or {}).values() if v.get('denominator')]
        except Exception as e:
            print('splits fail', s, e, flush=True); splits = []
        p = px.get(s)
        for x in h:
            day = dt.datetime.fromtimestamp(int(x.get('epochGradeDate') or 0), dt.timezone.utc).date()
            ds = day.isoformat(); firm = (x.get('firm') or '').strip()
            if not firm: continue
            adj = 1.0
            for sd, f in splits:
                if sd > ds: adj *= f
            pt = (x.get('currentPriceTarget') or 0) / adj if adj else 0
            if (today - day).days <= 90 and pt > 0:
                cur = fresh.setdefault(s, {}).get(firm)
                if cur is None or cur[0] < ds: fresh[s][firm] = (ds, pt)
            if p is None: continue
            i0 = idx_on_or_before(ds)
            if i0 is None or dates[i0] not in p.index: continue
            p0 = p[dates[i0]]
            # target accuracy, 12 months on
            if pt > 0:
                i1 = idx_on_or_before((day + dt.timedelta(days=365)).isoformat())
                if i1 is not None and (day + dt.timedelta(days=365)).isoformat() <= dates[-1] and dates[i1] in p.index:
                    if 0.33 < pt / p0 < 3:
                        a1 = p[dates[i1]]
                        tgt_rows.append(dict(firm=firm, sym=s, date=ds, err=pt / a1 - 1, implied=pt / p0 - 1, realized=a1 / p0 - 1))
            # rating calls: the call is made around day; measure from the previous close to 63 sessions later, minus SPY
            if x.get('action') in ('up', 'down') and i0 >= 1 and i0 + 63 < len(dates):
                a, b = dates[i0 - 1], dates[i0 + 63]
                if a in p.index and b in p.index:
                    ex = (p[b] / p[a] - 1) - (spy[b] / spy[a] - 1)
                    call_rows.append(dict(firm=firm, sym=s, date=ds, action=x['action'], ex63=ex))
        time.sleep(0.4)

    T = pd.DataFrame(tgt_rows); C = pd.DataFrame(call_rows)
    firms = {}
    for f in sorted(set(T.firm if len(T) else []) | set(C.firm if len(C) else [])):
        t = T[T.firm == f] if len(T) else T; c = C[C.firm == f] if len(C) else C
        o = dict(n_targets=int(len(t)), n_stocks=int(t.sym.nunique()) if len(t) else 0, n_calls=int(len(c)))
        if len(t):
            o['median_abs_err'] = round(float(t.err.abs().median()), 4); o['bias'] = round(float(t.err.median()), 4)
            o['dir_hit'] = round(float(((t.implied > 0) == (t.realized > 0)).mean()), 3)
        if len(c):
            hit = ((c.action == 'up') & (c.ex63 > 0)) | ((c.action == 'down') & (c.ex63 < 0))
            o['hit63'] = round(float(hit.mean()), 3)
            up, dn = c[c.action == 'up'].ex63, c[c.action == 'down'].ex63
            o['ex_up63'] = round(float(up.mean()), 4) if len(up) else None; o['ex_down63'] = round(float(dn.mean()), 4) if len(dn) else None
            if len(up) and len(dn): o['edge63'] = round(float(up.mean() - dn.mean()), 4)
        # one scale for every firm: target accuracy only (rating-call results are shown next to it, often too few to score)
        o['score'] = round(max(0.0, 1 - o['median_abs_err']) * 100, 1) if 'median_abs_err' in o else None
        o['reliable'] = o['n_targets'] >= 20
        firms[f] = o

    stocks = {}
    for s, fm in fresh.items():
        num = den = 0.0; lst = []
        for f, (ds, pt) in fm.items():
            age = (today - dt.date.fromisoformat(ds)).days
            w_rec = 0.5 ** (age / 45)
            fo = firms.get(f) or {}
            w_acc = (fo['score'] / 50) if fo.get('reliable') and fo.get('score') else 1.0
            w = w_rec * w_acc; num += w * pt; den += w
            lst.append(dict(firm=f, date=ds, target=round(pt, 2), w=round(w, 3), score=fo.get('score'), reliable=fo.get('reliable', False)))
        stocks[s] = dict(w_target=round(num / den, 2) if den else None, n=len(lst), firms=sorted(lst, key=lambda z: -z['w']))

    out = dict(built=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%MZ'), price_data=f'{dates[0]}..{dates[-1]}',
               n_targets_scored=int(len(T)), n_calls_scored=int(len(C)),
               method=__doc__.strip(), firms=firms, stocks=stocks)
    if only:
        top = sorted([(k, v) for k, v in firms.items() if v.get('reliable')], key=lambda kv: -(kv[1]['score'] or 0))[:8]
        print('::notice::' + json.dumps(dict(targets=len(T), calls=len(C), firms=len(firms), top=top))[:3500])
        for s in syms[:3]: print('::notice::' + s + ' ' + json.dumps(stocks.get(s))[:1500])
        return
    json.dump(out, open(os.path.join(R, 'core', 'analyst_scores.json'), 'w'), indent=0)
    print(f'{len(T)} targets, {len(C)} calls, {len(firms)} firms')


if __name__ == '__main__':
    main()
