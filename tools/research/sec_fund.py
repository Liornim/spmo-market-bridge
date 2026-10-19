"""Quarterly fundamentals with filing dates (point-in-time) for every stock in the research universe, 2009+.

Reuses tools/core/sec_facts.py unchanged in logic: SEC_SINCE widens the history window and SEC_EXTRA adds the
balance-sheet lines needed for Piotroski / Altman / NCAV / accruals. Runs in a scratch root so core/sec is untouched.
Output sec_facts.zip (one <SYM>.json per company, same schema as core/sec) + _report_sec_fund.json.
"""
import json, os, subprocess, sys, zipfile, shutil
from common import OUT, report, symbols_file

ETF = {'SPY', 'QQQ', 'DIA', 'IWM', 'MDY', 'RSP', 'VOO', 'TQQQ', 'SMH', 'SPMO', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'GLD', 'SLV',
       'USO', 'DBC', 'UUP', 'EEM', 'EFA', 'VNQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY',
       'MTUM', 'QUAL', 'VLUE', 'USMV', 'SIZE', 'BITX'}
syms = [s for s in symbols_file(os.path.join(OUT, 'universe_symbols.txt')) if s not in ETF]
root = '/tmp/secroot'; shutil.rmtree(root, ignore_errors=True); os.makedirs(root + '/core')
json.dump({'list': {'rows': [[s] for s in syms]}}, open(root + '/core/core_data.json', 'w'))
here = os.path.dirname(os.path.abspath(__file__))
env = {**os.environ, 'SEC_SINCE': '2009-01-01', 'SEC_EXTRA': '1'}
subprocess.run([sys.executable, os.path.join(here, '..', 'core', 'sec_facts.py'), root], env=env, check=True)
rep = json.load(open(root + '/core/sec/_report.json'))
with zipfile.ZipFile(os.path.join(OUT, 'sec_facts.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in os.listdir(root + '/core/sec'): z.write(os.path.join(root, 'core/sec', f), f)
report('sec_fund', {'symbols': len(syms), 'ok': sum(str(v).startswith('ok') for v in rep.values()),
                    'not_ok': {k: v for k, v in rep.items() if not str(v).startswith('ok')}})
