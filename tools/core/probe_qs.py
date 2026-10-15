"""One-off probe: what Yahoo's upgradeDowngradeHistory holds for a symbol (prints GitHub annotations)."""
import json, sys, urllib.request, datetime as dt
from collections import Counter
W = 'https://spmo-market-bridge.noamharelnim.workers.dev'
for sym in sys.argv[1:]:
    j = json.loads(urllib.request.urlopen(urllib.request.Request(f'{W}/xa/yahoo_qs/{sym}?modules=upgradeDowngradeHistory', headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read())
    h = (((j.get('quoteSummary') or {}).get('result') or [{}])[0].get('upgradeDowngradeHistory') or {}).get('history') or []
    keys = Counter(k for x in h for k in x)
    print(f'::notice::{sym}: {len(h)} entries; fields {dict(keys)}')
    for x in h[:12]:
        x = dict(x); x['date'] = dt.datetime.utcfromtimestamp(x.get('epochGradeDate', 0)).date().isoformat()
        print('::notice::' + sym + ' ' + json.dumps(x))
    if h:
        last = dt.datetime.utcfromtimestamp(h[0].get('epochGradeDate', 0)).date(); first = dt.datetime.utcfromtimestamp(h[-1].get('epochGradeDate', 0)).date()
        withpt = sum(1 for x in h if x.get('currentPriceTarget'))
        print(f'::notice::{sym}: range {first}..{last}; entries with currentPriceTarget: {withpt}')
