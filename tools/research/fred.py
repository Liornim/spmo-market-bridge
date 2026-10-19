"""Macro / rates / credit / volatility series from FRED, via the keyless fredgraph CSV endpoint.

Output fred.csv.gz in long form: series,date,value (+ fred_series.csv describing each id).
Release-date caveat: FRED values are stamped with the observation date, not the publication date. Monthly macro
(CPI, payrolls...) must be lagged to their release in any backtest — the research code applies a 1-month lag.
"""
import io, os, time
import pandas as pd
from common import OUT, fetch, report

SERIES = {
 'VIXCLS': 'VIX close', 'VXVCLS': 'VIX 3-month', 'VXNCLS': 'Nasdaq-100 VIX', 'OVXCLS': 'Oil VIX', 'GVZCLS': 'Gold VIX',
 'DGS3MO': '3M Treasury', 'DGS2': '2Y Treasury', 'DGS5': '5Y Treasury', 'DGS10': '10Y Treasury', 'DGS30': '30Y Treasury',
 'T10Y2Y': '10Y-2Y', 'T10Y3M': '10Y-3M', 'DFII10': '10Y TIPS real yield', 'T10YIE': '10Y breakeven inflation', 'T5YIFR': '5y5y inflation',
 'DFF': 'Fed funds effective', 'DFEDTARU': 'Fed target upper', 'SOFR': 'SOFR',
 'BAMLH0A0HYM2': 'HY OAS', 'BAMLC0A0CM': 'IG OAS', 'BAMLH0A3HYC': 'CCC OAS', 'BAA10Y': 'Baa-10Y', 'AAA10Y': 'Aaa-10Y',
 'NFCI': 'Chicago Fed NFCI', 'ANFCI': 'Adjusted NFCI', 'STLFSI4': 'St. Louis stress index',
 'DTWEXBGS': 'Broad dollar index', 'DEXJPUS': 'JPY per USD', 'DEXUSEU': 'USD per EUR', 'DEXCHUS': 'CNY per USD',
 'DCOILWTICO': 'WTI', 'DCOILBRENTEU': 'Brent', 'DHHNGSP': 'Henry Hub gas', 'PCOPPUSDM': 'Copper (monthly)',
 'ICSA': 'Initial jobless claims', 'CCSA': 'Continuing claims', 'PAYEMS': 'Payrolls', 'UNRATE': 'Unemployment rate',
 'CPIAUCSL': 'CPI', 'CPILFESL': 'Core CPI', 'PCEPILFE': 'Core PCE', 'PPIACO': 'PPI',
 'INDPRO': 'Industrial production', 'RSAFS': 'Retail sales', 'HOUST': 'Housing starts', 'PERMIT': 'Building permits',
 'UMCSENT': 'Michigan sentiment', 'M2SL': 'M2', 'WALCL': 'Fed balance sheet', 'RRPONTSYD': 'Reverse repo', 'WTREGEN': 'Treasury General Account',
 'USREC': 'NBER recession', 'SAHMREALTIME': 'Sahm rule', 'SP500': 'S&P 500 (FRED, 10y)', 'NASDAQCOM': 'Nasdaq composite',
 'WILL5000IND': 'Wilshire 5000', 'CSUSHPINSA': 'Case-Shiller', 'TOTALSL': 'Consumer credit', 'DRCCLACBS': 'Card delinquency',
 'GDP': 'GDP', 'GDPC1': 'Real GDP', 'CP': 'Corporate profits', 'MORTGAGE30US': '30Y mortgage',
}
frames, rep = [], {}
for sid in SERIES:
    try:
        b = None
        for host in ('https://fred.stlouisfed.org/graph/fredgraph.csv?id=', 'https://fred.stlouisfed.org/graph/fredgraph.csv?cosd=1950-01-01&id='):
            try: b = fetch(host + sid, tries=2, timeout=25); break
            except Exception as e_: err = str(e_)
        if b is None: raise RuntimeError(err)
        d = pd.read_csv(io.BytesIO(b))
        d.columns = ['date', 'value']
        d['value'] = pd.to_numeric(d.value, errors='coerce'); d = d.dropna()
        d.insert(0, 'series', sid); frames.append(d)
        rep[sid] = f'ok {len(d)} obs {d.date.min()}..{d.date.max()}'
    except Exception as e:
        rep[sid] = 'fail ' + str(e)[-160:]
        if sum(v.startswith('fail') for v in rep.values()) >= 5 and not any(v.startswith('ok') for v in rep.values()):
            rep['_abort'] = 'first 5 series failed: host unreachable from the runner'; break
    time.sleep(0.5)
(pd.concat(frames) if frames else pd.DataFrame(columns=['series','date','value'])).to_csv(os.path.join(OUT, 'fred.csv.gz'), index=False, compression='gzip')
pd.DataFrame([(k, v) for k, v in SERIES.items()], columns=['series', 'description']).to_csv(os.path.join(OUT, 'fred_series.csv'), index=False)
report('fred', rep)
