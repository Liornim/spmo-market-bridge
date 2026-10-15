"""Daily analyst snapshot for every stock in core/current_state.json (owner's request 15.10.2026).

Source: Yahoo quoteSummary (financialData, earningsTrend, recommendationTrend) through our Worker
(/xa/yahoo_qs/<SYM>; Yahoo needs a cookie+crumb and rate-limits GitHub's runners).

Writes
  core/analysts/<YYYY-MM-DD>.csv   one row per symbol, kept forever: the point-in-time record for a later test
  core/analysts_latest.json        the same rows for the /today page

Information only. The frozen method does not use analyst data (CORE_RULES.md: "shown only, never used").
"""
import json, os, sys, time, datetime as dt, urllib.request, csv
from zoneinfo import ZoneInfo

R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKER = 'https://spmo-market-bridge.noamharelnim.workers.dev'
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}

FIELDS = ['symbol', 'date', 'price', 'target_mean', 'target_median', 'target_high', 'target_low', 'n_analysts',
          'rec_mean', 'rec_key', 'strong_buy', 'buy', 'hold', 'sell', 'strong_sell',
          'eps_cy', 'eps_cy_n', 'eps_cy_7d', 'eps_cy_30d', 'eps_cy_60d', 'eps_cy_90d', 'eps_cy_up7', 'eps_cy_up30', 'eps_cy_down7', 'eps_cy_down30',
          'eps_ny', 'eps_ny_n', 'eps_ny_30d', 'eps_ny_90d', 'eps_ny_up30', 'eps_ny_down30', 'rev_cy', 'rev_ny', 'cy_end', 'ny_end',
          'fresh_mean', 'fresh_median', 'fresh_low', 'fresh_high', 'fresh_n', 'tgt30_raised', 'tgt30_lowered', 'tgt30_new', 'tgt30_kept', 'rating30_up', 'rating30_down', 'last_change', 'fresh_above', 'fresh_below', 'fresh_trim_mean', 'news_n']
FRESH_DAYS = 90


def raw(x):
    if isinstance(x, dict): return x.get('raw')
    return x


def fetch(sym):
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'{WORKER}/xa/yahoo_qs/{sym}?modules=financialData,earningsTrend,recommendationTrend,upgradeDowngradeHistory', headers=UA), timeout=30) as r:
                j = json.loads(r.read())
            res = ((j.get('quoteSummary') or {}).get('result') or [None])[0]
            if res: return res
            last = (j.get('quoteSummary') or {}).get('error') or j.get('error') or 'empty'
        except Exception as e:
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f'{sym}: {last}')


def targets(res, day):
    """Per-firm price targets from upgradeDowngradeHistory.
    fresh_*: each firm's latest target dated within FRESH_DAYS (stale targets left out).
    tgt30_*: target actions in the last 30 days (Raises / Lowers / Announces=new / Maintains=kept); rating30_*: up/downgrades."""
    h = ((res.get('upgradeDowngradeHistory') or {}).get('history') or [])
    d0 = dt.date.fromisoformat(day)
    ev = []
    for x in h:
        try: d = dt.datetime.fromtimestamp(int(x.get('epochGradeDate') or 0), dt.timezone.utc).date()
        except Exception: continue
        ev.append((d, x))
    ev.sort(key=lambda t: t[0])
    latest = {}
    for d, x in ev:
        pt = x.get('currentPriceTarget') or 0
        if pt and pt > 0 and (d0 - d).days <= FRESH_DAYS: latest[x.get('firm')] = (d, pt)
    pts = sorted(p for _, p in latest.values())
    out = dict(fresh_n=len(pts), _pts=pts)
    if pts:
        n = len(pts); med = pts[n // 2] if n % 2 else (pts[n // 2 - 1] + pts[n // 2]) / 2
        out.update(fresh_mean=round(sum(pts) / n, 2), fresh_median=round(med, 2), fresh_low=pts[0], fresh_high=pts[-1])
    a30 = [x for d, x in ev if 0 <= (d0 - d).days <= 30]
    act = lambda k: sum(1 for x in a30 if (x.get('priceTargetAction') or '').lower() == k)
    out.update(tgt30_raised=act('raises'), tgt30_lowered=act('lowers'), tgt30_new=act('announces'), tgt30_kept=act('maintains'),
               rating30_up=sum(1 for x in a30 if x.get('action') == 'up'), rating30_down=sum(1 for x in a30 if x.get('action') == 'down'))
    if ev: out['last_change'] = ev[-1][0].isoformat()
    recent = [dict(date=d.isoformat(), firm=x.get('firm'), action=x.get('action'), to=x.get('toGrade'), frm=x.get('fromGrade'),
                   pt_action=x.get('priceTargetAction'), pt=x.get('currentPriceTarget'), pt_prior=x.get('priorPriceTarget'))
              for d, x in ev if (d0 - d).days <= FRESH_DAYS]
    return out, recent[::-1]


def parse(sym, res, day):
    fd = res.get('financialData') or {}
    row = dict(symbol=sym, date=day, price=raw(fd.get('currentPrice')), target_mean=raw(fd.get('targetMeanPrice')),
               target_median=raw(fd.get('targetMedianPrice')), target_high=raw(fd.get('targetHighPrice')),
               target_low=raw(fd.get('targetLowPrice')), n_analysts=raw(fd.get('numberOfAnalystOpinions')),
               rec_mean=raw(fd.get('recommendationMean')), rec_key=fd.get('recommendationKey'))
    rt = ((res.get('recommendationTrend') or {}).get('trend') or [])
    cur = next((t for t in rt if t.get('period') == '0m'), None)
    if cur:
        for k, f in (('strong_buy', 'strongBuy'), ('buy', 'buy'), ('hold', 'hold'), ('sell', 'sell'), ('strong_sell', 'strongSell')):
            row[k] = cur.get(f)
    for t in ((res.get('earningsTrend') or {}).get('trend') or []):
        p = t.get('period'); ee = t.get('earningsEstimate') or {}; tr = t.get('epsTrend') or {}; rv = t.get('epsRevisions') or {}; re_ = t.get('revenueEstimate') or {}
        if p == '0y':
            row.update(eps_cy=raw(ee.get('avg')), eps_cy_n=raw(ee.get('numberOfAnalysts')), eps_cy_7d=raw(tr.get('7daysAgo')),
                       eps_cy_30d=raw(tr.get('30daysAgo')), eps_cy_60d=raw(tr.get('60daysAgo')), eps_cy_90d=raw(tr.get('90daysAgo')),
                       eps_cy_up7=raw(rv.get('upLast7days')), eps_cy_up30=raw(rv.get('upLast30days')),
                       eps_cy_down7=raw(rv.get('downLast7Days', rv.get('downLast7days'))), eps_cy_down30=raw(rv.get('downLast30days')),
                       rev_cy=raw(re_.get('avg')), cy_end=t.get('endDate'))
        elif p == '+1y':
            row.update(eps_ny=raw(ee.get('avg')), eps_ny_n=raw(ee.get('numberOfAnalysts')), eps_ny_30d=raw(tr.get('30daysAgo')),
                       eps_ny_90d=raw(tr.get('90daysAgo')), eps_ny_up30=raw(rv.get('upLast30days')), eps_ny_down30=raw(rv.get('downLast30days')),
                       rev_ny=raw(re_.get('avg')), ny_end=t.get('endDate'))
    t, recent = targets(res, day)
    row.update(t); row['_recent'] = recent
    pts = t.pop('_pts', [])
    if pts and row.get('price'):
        row['fresh_above'] = sum(1 for p in pts if p > row['price']); row['fresh_below'] = sum(1 for p in pts if p < row['price'])
    if len(pts) >= 5:
        k = max(1, len(pts) // 10); tr = sorted(pts)[k:-k]; row['fresh_trim_mean'] = round(sum(tr) / len(tr), 2)
    return row


def get(path):
    with urllib.request.urlopen(urllib.request.Request(WORKER + path, headers=UA), timeout=30) as r:
        return json.loads(r.read())


def daily_closes(sym):
    """{date: close} for ~6 months from Yahoo via the Worker (today's close included after the session)."""
    j = get(f'/xa/yahoo_d/{sym}?range=6mo'); res = j['chart']['result'][0]
    off = res['meta'].get('gmtoffset', -14400); q = res['indicators']['quote'][0]
    return {dt.datetime.fromtimestamp(t + off, dt.timezone.utc).date().isoformat(): c for t, c in zip(res.get('timestamp') or [], q['close']) if c is not None}


def news(sym, closes, spy, day, days=14):
    """Recent headlines (English, as published) with the stock's reaction on the session they hit:
    stock change vs the previous close, and minus SPY's change. Published after 16:00 NY or on a non-session day -> next session."""
    j = get(f'/xa/yahoo_news/{sym}')
    out = []; sess = sorted(closes)
    d0 = dt.date.fromisoformat(day)
    for n in (j.get('news') or []):
        rel = [x.upper() for x in (n.get('relatedTickers') or [])]
        if rel and sym.upper() not in rel and sym.replace('-', '.').upper() not in rel: continue
        t = dt.datetime.fromtimestamp(int(n.get('providerPublishTime') or 0), ZoneInfo('America/New_York'))
        if (d0 - t.date()).days > days: continue
        d = t.date().isoformat()
        hit = next((x for x in sess if x > d or (x == d and t.hour < 16)), None)
        ch = sp = None
        if hit and sess.index(hit) > 0:
            p = sess[sess.index(hit) - 1]; ch = closes[hit] / closes[p] - 1
            if hit in spy and p in spy: sp = spy[hit] / spy[p] - 1
        out.append(dict(time=t.strftime('%Y-%m-%d %H:%M'), title=n.get('title'), publisher=n.get('publisher'), link=n.get('link'),
                        session=hit, move=None if ch is None else round(ch, 4), vs_spy=None if ch is None or sp is None else round(ch - sp, 4)))
    return out[:8]


def main():
    st = json.load(open(os.path.join(R, 'core', 'current_state.json')))
    syms = [r['symbol'] for r in st['rows'] if r.get('kind') != 'ETF']
    only = [s.upper() for s in sys.argv[1:]]
    if only: syms = [s for s in syms if s in only] or only
    day = dt.datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    rows, fails = [], []
    try: spy = daily_closes('SPY')
    except Exception: spy = {}
    for s in syms:
        try: rows.append(parse(s, fetch(s), day))
        except Exception as e: fails.append(f'{s}: {str(e)[:120]}'); print('fail', s, e, flush=True); continue
        try:
            cl = daily_closes(s); rows[-1]['_news'] = news(s, cl, spy, day); rows[-1]['news_n'] = len(rows[-1]['_news'])
        except Exception as e: print('news fail', s, e, flush=True)
        time.sleep(0.6)
    print(f'{len(rows)} ok, {len(fails)} failed', flush=True)
    if only:
        for r in rows: print('::notice::' + json.dumps({k: r.get(k) for k in ['symbol','price','news_n','fresh_above','fresh_below','fresh_trim_mean','target_mean','fresh_mean','fresh_median','fresh_low','fresh_high','fresh_n','n_analysts','tgt30_raised','tgt30_lowered','tgt30_new','tgt30_kept','rating30_up','rating30_down','last_change']}))
        for r in rows:
            for n in (r.get('_news') or [])[:4]: print('::notice::' + r['symbol'] + ' NEWS ' + json.dumps(n))
        for x in fails: print('::warning::' + x)
        return
    if len(rows) < 0.6 * len(syms):
        print('::error::too many failures, files not written'); sys.exit(1)
    os.makedirs(os.path.join(R, 'core', 'analysts'), exist_ok=True)
    with open(os.path.join(R, 'core', 'analysts', f'{day}.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); [w.writerow({k: r.get(k) for k in FIELDS}) for r in rows]
    json.dump({'date': day, 'built': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%MZ'), 'source': 'Yahoo quoteSummary via Worker',
               'note': 'information only; not used by the frozen method', 'failed': fails,
               'rows': {r['symbol']: r for r in rows}}, open(os.path.join(R, 'core', 'analysts_latest.json'), 'w'), indent=0)
    if fails: print('::warning::analysts failed for ' + ', '.join(x.split(':')[0] for x in fails))


if __name__ == '__main__':
    main()
