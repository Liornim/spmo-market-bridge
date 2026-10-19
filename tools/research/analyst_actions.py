"""Raw analyst action history (every upgrade/downgrade/init/target change Yahoo keeps, years back) per symbol,
through the Worker's /xa/yahoo_qs proxy (Yahoo needs cookie+crumb and rate-limits GitHub's runners).

analyst_scores.py already reads this history to score firms but keeps only aggregates; this saves the rows:
analyst_actions.csv.gz: symbol,date,firm,to_grade,from_grade,action,price_target_action,current_target,prior_target
"""
import os, sys, time, datetime as dt
import pandas as pd
from common import OUT, WORKER, fetch_json, report, symbols_file

syms = symbols_file(sys.argv[1]) if len(sys.argv) > 1 else symbols_file(os.path.join(OUT, 'universe_symbols.txt'))
rows, rep = [], {}
for s in syms:
    try:
        j = fetch_json(f'{WORKER}/xa/yahoo_qs/{s}?modules=upgradeDowngradeHistory', tries=3)
        h = ((j.get('quoteSummary') or {}).get('result') or [{}])[0].get('upgradeDowngradeHistory', {}).get('history', [])
        for x in h:
            rows.append((s, dt.datetime.utcfromtimestamp(x['epochGradeDate']).date().isoformat(), x.get('firm'), x.get('toGrade'),
                         x.get('fromGrade'), x.get('action'), x.get('priceTargetAction'), x.get('currentPriceTarget'), x.get('priorPriceTarget')))
        rep[s] = f'ok {len(h)}'
    except Exception as e:
        rep[s] = 'fail ' + str(e)[:80]
    time.sleep(0.6)
pd.DataFrame(rows, columns=['symbol', 'date', 'firm', 'to_grade', 'from_grade', 'action', 'pt_action', 'target', 'prior_target']) \
  .to_csv(os.path.join(OUT, 'analyst_actions.csv.gz'), index=False, compression='gzip')
report('analyst_actions', {'symbols': len(syms), 'ok': sum(v.startswith('ok') for v in rep.values()), 'rows': len(rows), 'detail': rep})
