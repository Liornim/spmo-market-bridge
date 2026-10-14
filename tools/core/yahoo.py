"""Small Yahoo Finance chart client (daily bars and split events), used only from GitHub Actions.

Yahoo's daily OHLC is split-adjusted (not dividend-adjusted), the same convention as core/daily.csv.gz.
"""
import json, time, datetime as dt, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}


def chart(sym, d0, d1, events='split'):
    p1 = int(dt.datetime.fromisoformat(d0).replace(tzinfo=dt.timezone.utc).timestamp())
    p2 = int((dt.datetime.fromisoformat(d1) + dt.timedelta(days=1)).replace(tzinfo=dt.timezone.utc).timestamp())
    last = None
    for host in ('query1', 'query2'):
        url = f'https://{host}.finance.yahoo.com/v8/finance/chart/{sym}?period1={p1}&period2={p2}&interval=1d&events={events}'
        for i in range(2):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                    return json.loads(r.read())['chart']['result'][0]
            except Exception as e:
                last = e; time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'yahoo {sym}: {last}')


def splits(sym, d0, d1):
    """[(date, factor)] with factor = numerator/denominator (2.0 for 2-for-1, 0.1 for 1-for-10)."""
    res = chart(sym, d0, d1)
    out = []
    for v in ((res.get('events') or {}).get('splits') or {}).values():
        d = dt.datetime.fromtimestamp(v['date'], dt.timezone.utc).date().isoformat()
        if v.get('denominator'): out.append((d, v['numerator'] / v['denominator']))
    return sorted(out)


def daily(sym, d0, d1):
    res = chart(sym, d0, d1, events='')
    q = res['indicators']['quote'][0]; out = {}
    for i, ts in enumerate(res.get('timestamp') or []):
        d = dt.datetime.fromtimestamp(ts + res['meta'].get('gmtoffset', -14400), dt.timezone.utc).date().isoformat()
        if q['close'][i] is not None:
            out[d] = dict(open=q['open'][i], high=q['high'][i], low=q['low'][i], close=q['close'][i], volume=q['volume'][i])
    return out
