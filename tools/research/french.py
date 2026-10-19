"""Kenneth R. French Data Library: factor and portfolio returns back to 1926 (daily from 1926/1963).

Downloads the zipped CSVs as they are and repacks them into one french.zip (raw files, untouched),
so the research code parses them itself and nothing is lost in translation.
"""
import io, os, zipfile, time
from common import OUT, fetch, report

BASE = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/'
FILES = [
 'F-F_Research_Data_Factors_daily_CSV.zip', 'F-F_Research_Data_Factors_CSV.zip',
 'F-F_Research_Data_5_Factors_2x3_daily_CSV.zip', 'F-F_Research_Data_5_Factors_2x3_CSV.zip',
 'F-F_Momentum_Factor_daily_CSV.zip', 'F-F_Momentum_Factor_CSV.zip',
 'F-F_ST_Reversal_Factor_daily_CSV.zip', 'F-F_LT_Reversal_Factor_daily_CSV.zip',
 '10_Portfolios_Prior_12_2_Daily_CSV.zip', '10_Portfolios_Prior_1_0_Daily_CSV.zip',
 'Portfolios_Formed_on_ME_Daily_CSV.zip', 'Portfolios_Formed_on_BE-ME_Daily_CSV.zip',
 'Portfolios_Formed_on_OP_Daily_CSV.zip', 'Portfolios_Formed_on_INV_Daily_CSV.zip',
 'Portfolios_Formed_on_BETA_CSV.zip', 'Portfolios_Formed_on_VAR_CSV.zip', 'Portfolios_Formed_on_RESVAR_CSV.zip',
 'Portfolios_Formed_on_AC_CSV.zip', 'Portfolios_Formed_on_NI_CSV.zip', 'Portfolios_Formed_on_D-P_CSV.zip',
 'Portfolios_Formed_on_E-P_CSV.zip', 'Portfolios_Formed_on_CF-P_CSV.zip',
 '12_Industry_Portfolios_daily_CSV.zip', '49_Industry_Portfolios_daily_CSV.zip', '49_Industry_Portfolios_CSV.zip',
 '25_Portfolios_5x5_Daily_CSV.zip',
]
rep = {}
with zipfile.ZipFile(os.path.join(OUT, 'french.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in FILES:
        try:
            b = fetch(BASE + f, tries=3, timeout=120)
            with zipfile.ZipFile(io.BytesIO(b)) as zi:
                for n in zi.namelist(): z.writestr(n, zi.read(n))
            rep[f] = f'ok {len(b)} bytes'
        except Exception as e:
            rep[f] = 'fail ' + str(e)[:100]
        time.sleep(0.5)
report('french', rep)
