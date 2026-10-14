"""Earnings calendar for the /core stocks -> core/earnings.json.

Source: Nasdaq's public earnings calendar (api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD), one request per
calendar day from 10 days back to 75 days ahead. For each of our symbols keeps the last report on or before today and
the next one after today, with the time of day Nasdaq gives: 'pre' (before the open), 'after' (after the close) or
'unknown'. Dates are the company's announced/expected dates as Nasdaq lists them; an unconfirmed date can move.
"""
import json, os, sys, time, datetime, urllib.request

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(ROOT, 'core', 'earnings.json')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
TIME = {'time-pre-market': 'pre', 'time-after-hours': 'after'}

cd = json.load(open(os.path.join(ROOT, 'core', 'core_data.json')))
ours = {r[0].replace('-', '.') : r[0] for r in cd['list']['rows']}   # BRK-B is BRK.B at Nasdaq
today = datetime.date.today()
seen, fails = {}, []
for k in range(-25, 76):
    d = today + datetime.timedelta(days=k)
    if d.weekday() >= 5: continue
    url = f'https://api.nasdaq.com/api/calendar/earnings?date={d.isoformat()}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                rows = ((json.loads(r.read()).get('data') or {}).get('rows')) or []
            break
        except Exception as e:
            rows = None; time.sleep(2 * (attempt + 1))
    if rows is None: fails.append(d.isoformat()); continue
    for x in rows:
        s = ours.get((x.get('symbol') or '').upper())
        if s: seen.setdefault(s, []).append((d.isoformat(), TIME.get(x.get('time'), 'unknown'), x.get('fiscalQuarterEnding')))
    time.sleep(0.35)

out = {'built': datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%MZ'), 'source': 'api.nasdaq.com earnings calendar',
       'window': [(today - datetime.timedelta(days=25)).isoformat(), (today + datetime.timedelta(days=75)).isoformat()],
       'failed_days': fails, 'symbols': {}}
for s, lst in seen.items():
    lst.sort()
    past = [x for x in lst if x[0] <= today.isoformat()]; fut = [x for x in lst if x[0] > today.isoformat()]
    out['symbols'][s] = {'last': past[-1][0] if past else None, 'last_time': past[-1][1] if past else None,
                         'next': fut[0][0] if fut else None, 'next_time': fut[0][1] if fut else None}
json.dump(out, open(OUT, 'w'), indent=0)
print(f"earnings: {len(out['symbols'])} of {len(ours)} symbols found, {len(fails)} failed days")
if len(fails) > 30: sys.exit(1)
