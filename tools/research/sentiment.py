"""Positioning / sentiment series, each best-effort (a source that blocks the runner is reported, not fatal).

  short_interest.csv.gz  FINRA consolidated short interest (twice a month) for the universe symbols
  cot_tff.csv.gz         CFTC Traders in Financial Futures (weekly; S&P/Nasdaq/Treasury futures positioning), 2010+
  aaii.csv               AAII weekly bull/bear survey
  naaim.csv              NAAIM exposure index
"""
import io, os, json, time, zipfile, datetime as dt, re
import pandas as pd
from common import OUT, fetch, report, symbols_file

rep = {}
syms = set(symbols_file(os.path.join(OUT, 'universe_symbols.txt')))

# FINRA: public query API, no credentials for this dataset; page by settlement date
try:
    frames = []
    for year in range(2016, dt.date.today().year + 1):
        offset = 0
        while True:
            body = json.dumps({'limit': 5000, 'offset': offset,
                'dateRangeFilters': [{'fieldName': 'settlementDate', 'startDate': f'{year}-01-01', 'endDate': f'{year}-12-31'}],
                'domainFilters': [{'fieldName': 'symbolCode', 'values': sorted(syms)}]}).encode()
            b = fetch('https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest', data=body,
                      headers={'Content-Type': 'application/json', 'Accept': 'text/plain'}, method='POST', tries=3, timeout=120)
            d = pd.read_csv(io.BytesIO(b)) if b.strip() else pd.DataFrame()
            if d.empty: break
            frames.append(d); offset += len(d)
            if len(d) < 5000: break
            time.sleep(0.5)
        print('finra', year, sum(len(f) for f in frames), flush=True)
    si = pd.concat(frames)
    si.to_csv(os.path.join(OUT, 'short_interest.csv.gz'), index=False, compression='gzip')
    rep['finra_short_interest'] = f'ok {len(si)} rows'
except Exception as e:
    rep['finra_short_interest'] = 'fail ' + str(e)[:150]

# CFTC TFF (financial futures), one zip per year
try:
    frames = []
    for y in range(2010, dt.date.today().year + 1):
        try:
            b = fetch(f'https://www.cftc.gov/files/dea/history/fut_fin_txt_{y}.zip', tries=3, timeout=120)
            z = zipfile.ZipFile(io.BytesIO(b)); frames.append(pd.read_csv(z.open(z.namelist()[0]), low_memory=False))
        except Exception as e:
            rep[f'cot_{y}'] = 'fail ' + str(e)[:80]
    cot = pd.concat(frames)
    name_col = [c for c in cot.columns if 'Market_and_Exchange' in c][0]
    cot = cot[cot[name_col].str.contains('S&P 500|NASDAQ|E-MINI|TREASURY|VIX|DOW', case=False, na=False)]
    cot.to_csv(os.path.join(OUT, 'cot_tff.csv.gz'), index=False, compression='gzip')
    rep['cftc_tff'] = f'ok {len(cot)} rows'
except Exception as e:
    rep['cftc_tff'] = 'fail ' + str(e)[:150]

try:
    b = fetch('https://www.aaii.com/files/surveys/sentiment.xls', tries=2)
    open(os.path.join(OUT, 'aaii_sentiment.xls'), 'wb').write(b); rep['aaii'] = f'ok {len(b)} bytes (raw xls)'
except Exception as e:
    rep['aaii'] = 'fail ' + str(e)[:120]

try:
    page = fetch('https://www.naaim.org/programs/naaim-exposure-index/', tries=2).decode('utf-8', 'ignore')
    links = re.findall(r'href="([^"]+\.(?:xlsx|xls|csv))"', page)
    if not links: raise RuntimeError('no data link on the page')
    b = fetch(links[0], tries=2)
    open(os.path.join(OUT, 'naaim' + os.path.splitext(links[0])[1]), 'wb').write(b); rep['naaim'] = f'ok {links[0]}'
except Exception as e:
    rep['naaim'] = 'fail ' + str(e)[:120]
report('sentiment', rep)
