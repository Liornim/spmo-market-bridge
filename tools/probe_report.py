# Formats the three probe captures into something readable in a GitHub issue.
import json

def load(p):
    try:
        return json.load(open(p))
    except Exception as e:
        return {'_unreadable': str(e)[:120]}

acct, stat, legacy = load('/tmp/acct.json'), load('/tmp/stat.json'), load('/tmp/legacy.json')

print('### V2 runs (newest 5)')
if 'runs' in acct:
    for r in acct['runs'][:5]:
        import datetime
        when = datetime.datetime.utcfromtimestamp(r['started_at']).strftime('%m-%d %H:%MZ')
        print(r['id'], when, r['trigger'][:12], '| used', r['used'], '| done', r['jobs_done'],
              '| failed', r['jobs_failed'], '| inserted', r['inserted'],
              '|', r['status'], '| note:', r.get('note'), '| syms:', (r.get('symbols') or '')[:50])
else:
    print(json.dumps(acct)[:300])

print('\n### V2 system')
if 'system' in stat:
    s = stat['system']
    print('tracked', s['tracked'], '| ready', s['jobs_ready'], '| failed', s['jobs_failed'],
          '| stale', s['stale_symbols'], '| oldest_due', s['oldest_due'])
    print('budget:', s['request_budget'], '| market_open', stat['market_open'])
    errs = [x for x in stat['symbols'] if x.get('last_error')][:4]
    for e in errs:
        print('ERR', e['symbol'], str(e['last_error'])[:110])
    syms = stat['symbols']
    if syms:
        print('latest:', [(x['symbol'], x['latest_candle']) for x in syms[:3]],
              '...', [(x['symbol'], x['latest_candle']) for x in syms[-3:]])
else:
    print(json.dumps(stat)[:300])

print('\n### legacy')
if 'symbols' in legacy:
    print('worst_stale_seconds', legacy.get('worst_stale_seconds'))
    for x in legacy['symbols'][:3]:
        print(x['symbol'], 'last_bar', x.get('last_bar_unix'), '| err:', str(x.get('last_error'))[:80])
else:
    print(json.dumps(legacy)[:300])
