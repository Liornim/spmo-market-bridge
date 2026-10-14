"""Earnings calendar for the /core stocks -> core/earnings.json.

Source: Nasdaq's public earnings calendar (api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD), one request per
calendar day (weekends included: some companies report on a Saturday) from 100 days back to 75 days ahead. For each of
our symbols keeps every report date in the window ('events'), with the time of day Nasdaq gives: 'pre' (before the open), 'after' (after the close) or
'unknown'. Dates are the company's announced/expected dates as Nasdaq lists them; an unconfirmed date can move.
"""
import json, os, sys, time, datetime, urllib.request
from zoneinfo import ZoneInfo

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(ROOT, 'core', 'earnings.json')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
TIME = {'time-pre-market': 'pre', 'time-after-hours': 'after'}

cd = json.load(open(os.path.join(ROOT, 'core', 'core_data.json')))
ours = {r[0].replace('-', '.'): r[0] for r in cd['list']['rows']}   # BRK-B is BRK.B at Nasdaq
# the exchange's date, not the runner's UTC date (the nightly runs around midnight UTC = evening in New York)
today = datetime.datetime.now(ZoneInfo('America/New_York')).date()
prev = json.load(open(OUT)) if os.path.exists(OUT) else {}
seen, fails = {}, []
consecutive = 0
for k in range(-100, 76):   # 100 days back: the last report of every company, to estimate the next one
    d = today + datetime.timedelta(days=k)
    url = f'https://api.nasdaq.com/api/calendar/earnings?date={d.isoformat()}'
    if consecutive >= 8:   # the source is down or blocking: stop instead of running past the job's time limit
        fails.append(d.isoformat()); continue
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12) as r:
                rows = ((json.loads(r.read()).get('data') or {}).get('rows')) or []
            break
        except Exception as e:
            rows = None; time.sleep(2 * (attempt + 1))
    if rows is None:
        consecutive += 1
        fails.append(d.isoformat())
        # keep what the previous run knew about this day rather than dropping it
        for s, v in (prev.get('symbols') or {}).items():
            for ev in v.get('events', []):
                if ev[0] == d.isoformat(): seen.setdefault(s, []).append(tuple(ev))
        continue
    consecutive = 0
    for x in rows:
        s = ours.get((x.get('symbol') or '').upper())
        if s: seen.setdefault(s, []).append((d.isoformat(), TIME.get(x.get('time'), 'unknown'), x.get('fiscalQuarterEnding')))
    time.sleep(0.35)

n_days = 176
if len(fails) > 35:
    # a blocked or broken source must not wipe the calendar: keep the previous file and fail the step loudly
    sys.exit(f'earnings: {len(fails)} of {n_days} days failed, previous earnings.json kept')
if len(seen) < 60:
    # a source that answers but lists (almost) nobody is broken too
    sys.exit(f'earnings: only {len(seen)} of {len(ours)} symbols found, previous earnings.json kept')
out = {'built': datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%MZ'), 'source': 'api.nasdaq.com earnings calendar',
       'ny_date': today.isoformat(),
       'window': [(today - datetime.timedelta(days=100)).isoformat(), (today + datetime.timedelta(days=75)).isoformat()],
       'failed_days': fails, 'not_found': sorted(set(ours.values()) - set(seen)), 'symbols': {}}
for s, lst in seen.items():
    lst = sorted(set(lst))
    # last/next relative to the New York date (state.py re-derives both relative to the session it describes)
    past = [x for x in lst if x[0] < today.isoformat()]; fut = [x for x in lst if x[0] >= today.isoformat()]
    out['symbols'][s] = {'events': [list(x[:2]) for x in lst],
                         'last': past[-1][0] if past else None, 'last_time': past[-1][1] if past else None,
                         'next': fut[0][0] if fut else None, 'next_time': fut[0][1] if fut else None}
json.dump(out, open(OUT, 'w'), indent=0)
print(f"earnings: {len(out['symbols'])} of {len(ours)} symbols found, {len(fails)} failed days, not found: {out['not_found']}")
