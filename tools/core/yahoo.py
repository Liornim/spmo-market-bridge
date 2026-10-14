"""Daily bars and split events for the nightly job: Yahoo first, then Alpaca through our Worker
(Yahoo answers GitHub's runners with HTTP 429 often; the Worker reaches Alpaca with its own keys).

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


WORKER = 'https://spmo-market-bridge.noamharelnim.workers.dev'


def _worker(path):
    with urllib.request.urlopen(urllib.request.Request(WORKER + path, headers=UA), timeout=40) as r:
        return json.loads(r.read())


def _yahoo_splits(sym, d0, d1):
    """[(date, factor)] with factor = numerator/denominator (2.0 for 2-for-1, 0.1 for 1-for-10)."""
    res = chart(sym, d0, d1)
    out = []
    for v in ((res.get('events') or {}).get('splits') or {}).values():
        d = dt.datetime.fromtimestamp(v['date'], dt.timezone.utc).date().isoformat()
        if v.get('denominator'): out.append((d, v['numerator'] / v['denominator']))
    return sorted(out)


def splits(sym, d0, d1):
    """[(date, factor)]; raises only when neither source answered."""
    try: return _yahoo_splits(sym, d0, d1)
    except Exception as e1:
        try:
            j = _worker(f"/xa/alpaca_splits?symbol={sym.replace('-', '.')}&start={d0}&end={d1}")
            ca = j.get('corporate_actions') or {}
            out = [(x['ex_date'], float(x['new_rate']) / float(x['old_rate'])) for k in ('forward_splits', 'reverse_splits') for x in (ca.get(k) or [])]
            return sorted(out)
        except Exception as e2:
            raise RuntimeError(f'yahoo: {str(e1)[:60]}; alpaca: {str(e2)[:60]}')


def daily(sym, d0, d1):
    try: return _yahoo_daily(sym, d0, d1)
    except Exception as e1:
        try:
            d1p = (dt.date.fromisoformat(d1) + dt.timedelta(days=1)).isoformat()
            j = _worker(f"/xa/alpaca_daily?symbol={sym.replace('-', '.')}&start={d0}&end={d1p}")
            out = {}
            for b in (j.get('bars') or {}).get(sym.replace('-', '.'), []):
                out[b['t'][:10]] = dict(open=b['o'], high=b['h'], low=b['l'], close=b['c'], volume=b['v'], source='alpaca daily (split-adjusted)')
            return out
        except Exception as e2:
            raise RuntimeError(f'yahoo: {str(e1)[:60]}; alpaca: {str(e2)[:60]}')


def _yahoo_daily(sym, d0, d1):
    res = chart(sym, d0, d1, events='')
    q = res['indicators']['quote'][0]; out = {}
    for i, ts in enumerate(res.get('timestamp') or []):
        d = dt.datetime.fromtimestamp(ts + res['meta'].get('gmtoffset', -14400), dt.timezone.utc).date().isoformat()
        if q['close'][i] is not None:
            out[d] = dict(open=q['open'][i], high=q['high'][i], low=q['low'][i], close=q['close'][i], volume=q['volume'][i])
    return out
