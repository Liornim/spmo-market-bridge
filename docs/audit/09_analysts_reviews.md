# צוות ביקורת 9: אנליסטים ורו"ח, סקירה פונדמנטלית של 120 הסקירות העסקיות

היקף הבדיקה: `core/review/*.json` (120 קבצים), `core/review/REVIEW_PROTOCOL.md`, ומולם `core/screen_sec.csv` (מסנן EDGAR), `core/current_state.json` (P/E ותשואת FCF), `core/core_data.json` (quality_master), `tools/core/state.py`, `tools/core/build_core_data.py`, `tools/core/screen_sec.py` ו־`docs/CORE_SYSTEM.md`.
סקריפטי העבודה נמצאים ב־`scratchpad/a9/` (load.py, px.py). לא שיניתי שום קובץ בריפו.

## 1. סיכום מנהלים

- **עובדה:** הנתון "37 שינויים, כולם העלאות" עדיין נכון: 14 עברו NON-CORE→CORE, 12 עברו NON-CORE→WATCH ו־11 עברו WATCH→CORE. אין אף הורדה, ואף אחת מ־50 החברות שהאקסל סימן CORE לא הורדה. התוצאה: CORE קפץ מ־50 ל־75.
- **עובדה:** כל 120 הסקירות נכתבו מול תווית "Excel" (`excel_status`), שהיא לא תווית ה־EDGAR הנוכחית. ב־**21 מתוך 120** התווית שהסוקר ראה שונה מהתווית של EDGAR היום. מול EDGAR, ב־45 חברות ה־Final שונה מהמסנן: 41 העלאות ו־4 הורדות. הורדה מתחת לתווית המסנן חייבת לפי הפרוטוקול דגל אדום מתועד, וזה לא קרה.
- **עובדה:** שער ה־REVIEW REQUIRED ב־`state.py` נדלק רק כשה־Final הוא CORE. AAPL ו־QCOM, שהם עכשיו CORE-ELIGIBLE ב־EDGAR, מנותבים בשקט ל־SPECULATIVE עם "NO CORE". BLK לא מסומן בכלל, כי ה־state נבנה לפני ריצת המסנן האחרונה.
- **הערכה:** חלק ניכר מנימוקי ההעלאה מתמודדים עם המדד של האקסל (D/E, ROE, הון עצמי שלילי) ולא עם מדד ה־EDGAR שבאמת נכשל (ND/EBITDA וכיסוי ריבית, ROIC ל־STD/UTIL/REIT). בנוסף, ההעלאות של טלקום, נפט ומוליכים־למחצה נשענות על "מחזור" או "זה מודל העסק" במקום על "המדד לא מתאים", ולכן הן מתיחה של הפרוטוקול.
- **עובדה:** עמיתים מטופלים בחוסר עקביות: XOM עלה ל־CORE למרות מחזוריות `yes` ושווי EXPENSIVE, בעוד CVX ו־COP, עם אותה ראיה, נשארו WATCH. T ו־VZ עלו מ־NON-CORE ל־CORE עם צמיחה של 1–1.6% לשנה, בעוד PG, PEP, UNP ו־BMY נשארו WATCH בדיוק בגלל כשל צמיחה אמיתי. DDOG נשאר NON-CORE ו־CRWD עלה ל־WATCH.
- **המלצה:** לבצע מחדש (או לפחות לתעד override מחדש) ב־28 חברות. הרשימה בסעיף 2ב.

## 2. ממצאים

| # | חומרה | קובץ:שורה | ממצא | ראיה | המלצה לתיקון |
|---|---|---|---|---|---|
| 1 | קריטי | `core/review/*.json` (שדה `excel_status`), `REVIEW_PROTOCOL.md:5` | הסקירות נעשו מול מסנן שאינו EDGAR. 21 מתוך 120 רואות תווית שונה מהתווית הנוכחית. | **עובדה:** הפרוטוקול מגדיר כ־DEFAULT את `/tmp/claude-0/hist/fund/<TICKER>.json`, כלומר נתוני Bigdata/אקסל. השוואה של `excel_status` מול `screen_sec.csv:label` מראה 21 פערים: AAPL, QCOM (WATCH→CORE); ABBV, AMT, AMZN, BLK, HON, LOW, PLD, SBUX, UBER, UNH, XOM (NON-CORE→WATCH); BSX, GE, NOW, V, WFC (CORE→WATCH); ABT, GILD (WATCH→NON-CORE); MRK (CORE→NON-CORE). בעוד 11 חברות התווית זהה אבל קבוצת הכשלים שונה (סעיף 3). 20 סקירות כותבות במפורש "לפי ה־JSON/Excel". | לבצע מחדש את 21 החברות מול EDGAR (רשימה 2ב), ולעדכן את הפרוטוקול כך שה־DEFAULT יהיה `screen_sec.csv`. |
| 2 | קריטי | `tools/core/state.py:154-161` | REVIEW REQUIRED נדלק רק אם `qual=='CORE'`. כשהשיפור במסנן נוגע לחברה שה־Final שלה אינו CORE, הוא נעלם. | **עובדה:** הסדר בקוד הוא `elif qual != 'CORE': core_dec='NO CORE'` ורק אחריו `elif conflict`. ב־state: AAPL ו־QCOM עם `Excel_label=CORE-ELIGIBLE`, `screen_review_conflict=true`, `core_decision=NO CORE`, `route=SPECULATIVE`. מתוך 20 קונפליקטים רק 12 מגיעים ל־REVIEW REQUIRED. | להציג REVIEW REQUIRED לכל קונפליקט, לפני הבדיקה `qual != 'CORE'`. לפחות AAPL ו־QCOM חייבים סקירה חוזרת: לפי הפרוטוקול CORE מהמסנן מורד רק בגלל דגל אדום קשה או שווי UNJUSTIFIABLE, ו־AAPL הוא EXPENSIVE ו־QCOM הוא FAIR. |
| 3 | גבוה | `core/current_state.json` (BLK), `screen_sec.csv:BLK` | ה־state לא מסונכרן עם המסנן, ולכן BLK לא מסומן לבדיקה. | **עובדה:** ב־state יש `BLK Excel_label=NON-CORE, conflict=false, core_decision=ACCELERATE TRANCHE`, אבל `screen_sec.csv` אומר WATCH (`changed=True`). ה־state נבנה ב־00:06Z ב־14.10 (commit 0915ec1), ו־screen_sec עודכן ב־c32206b בשעה 03:14 +0300 (00:14Z). ה־quality_master ב־core_data.json כן מסמן את BLK (21 דגלים), וה־state מסמן רק 20. | להריץ את state.py מחדש אחרי כל ריצת מסנן (תלות ב־workflow). חפיפה עם צוות הצנרת. |
| 4 | גבוה | `docs/CORE_SYSTEM.md:84` | רשימת "לבדיקה חוזרת" בתיעוד חסרה. | **עובדה:** בתיעוד יש 12 שמות. ב־quality_master יש 21. חסרים AAPL, QCOM, ABT, AMT, AMZN, HON, SBUX, UNH ו־BLK. גם "46/41/33" בשורה 72 התיישן: היום 46/42/32. | לעדכן את התיעוד לפי הרשימה בסעיף 2ב. |
| 5 | גבוה | `review/XOM.json`, `CVX.json`, `COP.json` | חוסר עקביות בין שלוש חברות הנפט. | **עובדה:** XOM עבר NON-CORE→CORE עם `cyclicality: yes`, שווי EXPENSIVE (P/E 21.6, FCF yield 4.3%), והנימוק עצמו מודה ש"הרווחים בשיא מחזורי והשווי יקר על בסיס מנורמל". CVX עבר NON-CORE→WATCH עם `yes`, FAIR (P/E 20.6, FCF 6.4%). COP נשאר WATCH עם `yes`, FAIR (P/E 18.0, FCF 9.9%). הנימוק של XOM ("נמדד בשנה חלשה") סותר את EDGAR: ה־TTM עד 2026-06-30 כבר כולל את רבעון השיא, ועדיין `rev_cagr3=-0.7%`. **הערכה:** XOM זול פחות משני העמיתים בכל מדד. | לסקור את שלוש החברות יחד באותו סטנדרט. **הערכה:** XOM→WATCH, או להסביר בכתב למה XOM שונה. |
| 6 | גבוה | `review/T.json`, `VZ.json`, `TMUS.json` | הקידום NON-CORE→CORE לא עומד בכלל "המדד לא מתאים למודל". | **עובדה:** הכשלים ב־EDGAR: T נכשל ב־returns, balance ו־growth (`rev_cagr3` 1.6%). VZ נכשל באותם שלושה (`rev_cagr3` 1.0%). TMUS נכשל ב־returns ו־balance. הנימוקים אומרים "צמיחה נמוכה היא מאפיין טלקום", וזה לא טענה שהמדד שגוי. באותו זמן PG (2.0%), PEP (2.4%), BMY (2.9%) ו־UNP נשארו WATCH בדיוק בגלל כשל צמיחה "אמיתי". **הערכה:** אחד משני הסטנדרטים שגוי. | להחליט על כלל אחד: או ש"צמיחה נמוכה מבנית" מתקבלת לכולם, או שאף אחד לא מקודם בגללה. **הערכה:** T ו־VZ צריכים לחזור ל־WATCH. TMUS (צמיחה 5.5%) גבולי. |
| 7 | גבוה | `review/ADI.json`, `TXN.json`, `DE.json` | נימוק "שפל מחזורי" מקדם NON-CORE או WATCH ל־CORE, ו־EDGAR סותר אותו. | **עובדה:** ADI נימק "הכשל משפל FY24, וכבר התהפך לשיא הכנסות", אבל ה־TTM עד 2026-08-01 עדיין `rev_cagr3=2.6%` ו־ROIC 10.0%, ו־`cyclicality: partly/yes`, כלומר ליד שיא. TXN נימק "החלון נגמר בשפל", אבל ה־TTM עד 2026-06 כולל Q2 עם +23% ועדיין `cagr3=1.1%`. **הערכה:** מדובר בצמיחה שטוחה משיא לשיא, לא בעיוות מדידה. DE (`cagr3 -7.9%`) הוא באמת בשפל, אבל "מחזור" אינו אחת העילות שהפרוטוקול מתיר לקידום NON-CORE. | ADI ו־DE: לבצע מחדש תחת הכלל המדויק. TXN: לתעד override חדש מול נתוני EDGAR. |
| 8 | גבוה | `review/ABBV.json`, `MCD.json`, `AMT.json`, `PLD.json`, `SO.json`, `DUK.json`, `NEE.json`, `LOW.json`, `SBUX.json` | נימוקי override עוסקים במדד האקסל ולא במדד ה־EDGAR. | **עובדה:** `screen_sec.py:14,144-146`: balance נמדד ב־ND/EBITDA≤3 וכיסוי≥5 (ב־UTIL/REIT: ≤6 וכיסוי≥2). returns נמדד ב־ROIC בכל מחלקה פרט ל־FIN. ABBV נימק "הון עצמי שלילי חשבונאי", אבל EDGAR נכשל ב־ND/EBITDA 3.31, שהוא מינוף אמיתי. MCD נימק "הון שלילי", ו־EDGAR נכשל ב־ND/EBITDA 3.002 (גבולי). AMT, PLD, SO, DUK ו־NEE נימקו "ROE לא מתאים", אבל EDGAR מודד ROIC (4.0–8.5%). LOW ו־SBUX נימקו "הון שלילי", וכשל ה־balance כבר לא קיים ב־EDGAR. **הערכה:** המסקנה של יוטיליטי ו־REIT כנראה מחזיקה גם תחת ROIC. של ABBV לא בטוח. | לכתוב מחדש את שורת ה־reason מול המדד שנכשל ב־EDGAR. ABBV: סקירה חוזרת של המינוף, כולל Apogee. |
| 9 | גבוה | `review/GILD.json`, `MRK.json` | הסוקר ראה CORE או WATCH. EDGAR היום NON-CORE, ואין override מתועד. | **עובדה:** GILD: `op_margin -8.2%`, NI TTM -3.24B, ND/EBITDA = 99 (ערך sentinel כש־EBITDA שלילי). MRK: P/E TTM 113, ROIC 6.8%, ND/EBITDA 4.29. **עובדה:** שתי הסקירות כן מזכירות את חיובי ה־IPR&D (GILD כ־11.2B, MRK כ־14.7B). **הערכה:** המהות כנראה מחזיקה, אבל לפי הפרוטוקול זו עכשיו העלאה מ־NON-CORE ל־CORE שדורשת שורת נימוק. ב־MRK יש גם מינוף אמיתי שעלה (4.3x). | לתעד override פורמלי. ב־MRK לבדוק מחדש את המאזן. |
| 10 | בינוני | `review/AMZN.json`, `UNH.json`, `ABT.json` | Final נמוך מתווית EDGAR. במונחי הפרוטוקול זו הורדה שלא תועדה כ־override. | **עובדה:** AMZN: EDGAR WATCH (רק cash), Final NON-CORE. הנימוק מסתמך גם על "דילול מתמשך", אבל ב־EDGAR `share_chg3=4.3%` עובר את הסף (≤5%). UNH: EDGAR WATCH (profit), Final NON-CORE. יש דגל אדום מתועד (חקירת DOJ), ולכן ההורדה כנראה מוצדקת, אבל `override=false`. ABT: EDGAR NON-CORE, Final WATCH. זו עכשיו העלאה לא מתועדת, ולצידה כשל returns חדש (ROIC 8.1%) שלא נדון. | AMZN: סקירה חוזרת. UNH ו־ABT: לתעד override. |
| 11 | בינוני | `review/BSX.json`, `GE.json`, `NOW.json`, `WFC.json`, `V.json` | ה־Excel אמר CORE ו־EDGAR אומר WATCH. ה־CORE נשמר "כברירת מחדל" בלי לדון בכשל החדש. | **עובדה:** BSX נכשל ב־ROIC 9.05%. NOW נכשל ב־ROIC 8.6%. GE נכשל ב־`cagr3` 1.9%, ובתיעוד: "פיצול Vernova מעוות". WFC נכשל ב־`cagr3` 2.4%. V נכשל בדילול רק משום ש־`share_chg3` ריק ("NO SHARE COUNT IN EDGAR"), והתנאי ב־`screen_sec.py:148` מכשיל ערך חסר. | V: לתקן את המסנן (ערך חסר אינו כשל), לא את הסקירה. BSX, NOW, GE, WFC: להוסיף שורת override (למשל goodwill ו־ROIC, פיצול). |
| 12 | בינוני | `review/DDOG.json` מול `CRWD.json`, `PANW.json`, `PLTR.json` | יחס לא עקבי בתוכנה. | **עובדה:** DDOG (כשלים: profit, balance, dilution; צמיחה 28%; FCF חיובי; EXPENSIVE) נשאר NON-CORE, כי "SBC של 22% הוא עלות אמיתית". CRWD (ארבעה כשלים, ROIC −12%, P/E 6105, UNJUSTIFIABLE) הועלה ל־WATCH, אף שהנימוק שלו אומר גם הוא "SBC אמיתי עם דילול". | **הערכה:** CRWD צריך להישאר NON-CORE, או ש־DDOG צריך לעלות ל־WATCH. כלל אחד ל־SBC. |
| 13 | בינוני | `review/*.json` (valuation) | הקו בין EXPENSIVE ל־UNJUSTIFIABLE לא עקבי, ולפעמים השווי משמש נימוק ל־WATCH למרות שאינו UNJUSTIFIABLE. | **עובדה:** SHOP: P/E 120.6, FCF 1.0% → EXPENSIVE, ונשאר CORE. AMD: 153 → EXPENSIVE. ALAB: 160.8 → EXPENSIVE, אבל הנימוק שלו אומר "תמחור קיצוני". PLTR: 178 → UNJUSTIFIABLE. AVGO: 45.3 / 2.3% → FAIR, בעוד TXN (42.9 / 2.1%) ו־ADI (48 / 2.5%) → EXPENSIVE. ABT: 28.3 / 4.2% → ATTRACTIVE, בעוד PG (23.1 / 4.1%) → EXPENSIVE. **הערכה:** ההבדל נובע משימוש לא אחיד ב־P/E קדימה וב־adjusted EPS (מקור לא־EDGAR). ב־ALAB, AMD, AAPL, MRVL, SBUX, HOOD, RTX ו־PG השווי EXPENSIVE מופיע כחלק מנימוק ה־WATCH, בניגוד ל"רק UNJUSTIFIABLE משאיר WATCH". | להגדיר בסיס מדידה אחד (למשל P/E TTM מ־EDGAR ו־FCF yield מ־EDGAR, ופורוורד רק כתוספת) וסף מפורש ל־UNJUSTIFIABLE. |
| 14 | בינוני | `core/current_state.json` (MCD, HON), `state.py:92-105` | P/E ותשואת FCF שגויים, ולכן אי אפשר להצליב שווי. | **עובדה:** ב־MCD: `pe_ttm=0.0`, `fcf_yield_ttm=46308.88`. ב־EDGAR, `shares_diluted` של MCD מדווח במיליונים (711.1), ולכן שווי השוק יוצא קטן פי 10⁶. ב־HON: `pe_ttm=8.1`. מספר המניות ירד מ־638.4M ל־318.6M ברבעון 2026-06-30, וה־NI של ה־TTM כולל את החברה שלפני הפיצול. הסקירה עצמה כותבת "לא אומת מחיר עדכני". V, BRK-B, TSM ו־ASML: `pe_ttm=NaN`. | סינון שפיות ל־shares (יחידות) בקוד. HON: סקירת שווי חוזרת. חפיפה עם צוות הנתונים. |
| 15 | בינוני | `review/CVX.json`, `MRVL.json`, `ELV.json`, `BRK-B.json`, `COIN.json` | יש כשל EDGAR חדש שהסוקר לא ראה (התווית זהה, קבוצת הכשלים שונה). | **עובדה:** CVX: כשל dilution חדש (+5.3%, הנפקת Hess). MRVL: dilution חדש (+7.0%). ELV: balance חדש. BRK-B: dilution חדש, שהוא ארטיפקט של ערך חסר כמו ב־V. COIN: growth חדש. | CVX ו־MRVL: להוסיף את הכשל לנימוק. ELV ו־COIN: אין השפעה (NON-CORE). BRK-B: תיקון במסנן. |
| 16 | נמוך | `review/*.json` (sources) | מקורות חלשים או לא ניתנים לאיתור. | **עובדה:** 15 סקירות מצטטות רק `https://bigdata.com` כ־URL של tearsheet (AAPL, ABNB, ADBE, ADP, AMZN, ANET, APH, AVGO, AXP, BRK-B, COST, MA, META, V, WMT). 83 מתוך 120 לא מצטטות שום מסמך SEC או EDGAR. ב־19 יש תאריך של חודש בלבד. ל־PM יש מקור אחד בלבד. ABBV מתמחר לפי מחיר מ־7.8.2026 ($246), והסגירה ב־12.10 היא $281.09 (+14%), כך שהמכפיל בפועל גבוה בערך ב־14%. | לדרוש מכל סקירה לפחות מקור ראשי אחד (10-Q, 10-K או 8-K ב־sec.gov) ותאריך מלא. |
| 17 | נמוך | `review/ADI.json`, `MRVL.json`, `HD.json`, `MDLZ.json` (cyclicality) | הערך אינו yes/partly/no נקי. | **עובדה:** ADI ו־MRVL כתבו "partly/yes". HD כתב "yes, אבל בשפל". MDLZ כתב "no (הפוך)". ה־state מפרש את HD כ־`'yes,'`, כלומר "בשיא", אבל הכוונה היא שפל. | לנרמל לערכים חוקיים. ל־HD התשובה הנכונה לשאלת השיא היא "no". |
| 18 | נמוך | `tools/core/screen_sec.py:64-67,159` | `prev_label` מוצג כ"Bigdata screen", אבל בפועל הוא התווית מריצת ה־core_data הקודמת. | **עובדה:** `prev` נקרא מ־`core_data.json['list']`. ב־20 חברות `prev_label` אינו שווה ל־`excel_status` של הסקירה. | לתקן את הטקסט, ולשמור את התווית שהסוקר ראה (`excel_status`) כעמודה נפרדת. |

### 2א. כמותי

- **עובדה:** בין Excel ל־Final יש 37 overrides, וכולם העלאות. ההתפלגות: 14 מ־NON-CORE ל־CORE, 12 מ־NON-CORE ל־WATCH, ו־11 מ־WATCH ל־CORE. הדגל `override` תואם בכל 120 הקבצים לשאלה אם Final שונה מ־excel_status.
- **עובדה:** מול EDGAR היום (46 CORE / 42 WATCH / 32 NON-CORE) ה־Final שונה ב־45 חברות:
  - Final CORE כש־EDGAR אומר NON-CORE (10): ADI, BRK-B, DE, GILD, KKR, MRK, SO, T, TMUS, VZ.
  - Final CORE כש־EDGAR אומר WATCH (21): ABBV, AVGO, BLK, BSX, BX, COST, DUK, GE, ICE, LIN, LOW, MCD, NOW, PLD, TXN, UBER, V, WFC, WM, WMT, XOM.
  - Final WATCH כש־EDGAR אומר NON-CORE (10). Final נמוך מ־EDGAR (4): AAPL, QCOM, AMZN, UNH.
- **עובדה:** שווי מול Final:
  - UNJUSTIFIABLE: 7 חברות. ארבע ב־WATCH, שלוש ב־NON-CORE, אף אחת לא CORE. זה תקין.
  - EXPENSIVE ונשאר CORE: 23 חברות.
  - CORE עם `cyclicality: yes` (סיכון "זול רק בגלל שיא"): CAT, CSCO, KLAC, LRCX, ANET, MU, NVDA, GS, PGR, XOM. רק XOM הוא override. השאר נשארו CORE לפי ברירת המחדל, וזה תקין לפי הפרוטוקול.

### 2ב. סקירות שצריך לבצע מחדש

| חברה | סיבה | עדיפות |
|---|---|---|
| AAPL | EDGAR היום CORE-ELIGIBLE (כשל הצמיחה שהסוקר ראה כבר לא קיים). השווי EXPENSIVE ולא UNJUSTIFIABLE, ולכן לפי הפרוטוקול ברירת המחדל היא CORE. היום מנותב בשקט ל־SPECULATIVE. | גבוהה |
| QCOM | כמו AAPL. EDGAR CORE-ELIGIBLE, השווי FAIR. | גבוהה |
| XOM | עמיתים (#5): `cyclicality yes` ו־EXPENSIVE, והנימוק "שנה חלשה" סותר את ה־TTM. | גבוהה |
| CVX, COP | לסקור יחד עם XOM. ב־CVX יש כשל dilution חדש. | גבוהה |
| T, VZ | צמיחה של 1–1.6% אינה "מדד לא מתאים" (#6). | גבוהה |
| TMUS | כמו T ו־VZ, אבל צמיחה 5.5%, ולכן גבולי. | בינונית |
| ADI | "שפל" מול `cagr3` 2.6% ב־TTM ליד שיא (#7). | גבוהה |
| DE | עילה של מחזור אינה עילה לקידום NON-CORE. | בינונית |
| TXN | נימוק "שפל" נסתר ב־TTM. צריך override מחדש. | בינונית |
| ABBV | הנימוק עוסק ב־D/E. EDGAR נכשל ב־ND/EBITDA 3.31. | גבוהה |
| GILD | EDGAR NON-CORE (profit, returns, balance). צריך override פורמלי. | גבוהה |
| MRK | EDGAR NON-CORE (returns, balance; ND/EBITDA 4.29). צריך override פורמלי ובדיקת מינוף. | גבוהה |
| AMZN | Final NON-CORE מתחת ל־EDGAR WATCH. חלק מהנימוק (דילול) נסתר ב־EDGAR. | בינונית |
| UNH | Final מתחת ל־EDGAR. לתעד override עם דגל DOJ. | נמוכה |
| ABT | EDGAR NON-CORE. Final WATCH זו העלאה לא מתועדת, ויש כשל ROIC חדש. | בינונית |
| BLK | EDGAR WATCH (dilution). הנימוק דן ב־ROE שכבר עובר. לא מסומן ב־state. | בינונית |
| BSX, NOW | כשל ROIC חדש ב־EDGAR. להוסיף שורת override. | נמוכה |
| GE, WFC | כשל צמיחה חדש ב־EDGAR. להוסיף override (GE: פיצול). | נמוכה |
| LOW, PLD, UBER, AMT, HON, SBUX | הכשל שהנימוק דן בו כבר לא קיים ב־EDGAR. לעדכן את הנימוק מול הכשל הנוכחי (LOW ו־HON: growth; PLD ו־AMT: ROIC; UBER ו־SBUX: profit). | נמוכה |
| MCD | הנימוק עוסק ב"הון שלילי". EDGAR נכשל ב־ND/EBITDA 3.002 (גבולי). | נמוכה |
| SO, DUK, NEE | הנימוק עוסק ב־ROE, ו־EDGAR מודד ROIC. המסקנה כנראה מחזיקה (הערכה). | נמוכה |
| CRWD או DDOG | ליישב (#12). | בינונית |
| ALAB | הנימוק אומר "תמחור קיצוני" אבל התווית EXPENSIVE, והשווי משמש נימוק ל־WATCH. | נמוכה |
| HON | השווי לא אומת (נאמר בסקירה עצמה), וה־P/E של 8.1 במערכת אינו בר־השוואה. | בינונית |
| MRVL | כשל dilution חדש לא נדון. | נמוכה |
| V, BRK-B | לתקן את המסנן (ערך חסר מכשיל dilution), לא את הסקירה. | נמוכה (קוד) |

## 3. מה נבדק ונמצא תקין

- **עובדה:** כל 120 הקבצים כוללים את כל השדות (`business_quality`, `growth`, `profitability`, `fcf`, `balance_sheet`, `capital_allocation`, `cyclicality`, `structural_risks`, `valuation`, `red_flags`, `final_quality`, `override`, `reason`, `sources`), ואף שדה אינו ריק. לכל סקירה יש בין 1 ל־6 מקורות.
- **עובדה:** בכל השדות `valuation` מתחיל באחת מארבע התוויות החוקיות. ההתפלגות: 59 FAIR, 38 EXPENSIVE, 16 ATTRACTIVE, 7 UNJUSTIFIABLE.
- **עובדה:** הדגל `override` עקבי לחלוטין עם הפער בין Final ל־excel_status, ולכל override יש נימוק כתוב.
- **עובדה:** אף UNJUSTIFIABLE לא סומן CORE (CRWD, PANW, PLTR, ARM ב־WATCH; INTC, MSTR, TSLA ב־NON-CORE).
- **עובדה:** ה־Final בכל 120 הקבצים זהה ל־`Review_final` ב־current_state.json וב־quality_master.
- **עובדה:** רוב המחירים שמופיעים בטקסט השווי קרובים לסגירה של 12.10 (בטווח של ±5% ב־24 מתוך 28 שזוהו). החריגים: ABBV (+14%), ALAB (+8%), NEE (−7.6%) ו־SO (−5.4%).
- **עובדה:** טענות "FCF חיובי בכל 5 השנים" (ASML, BMY, CVX, JNJ, KLAC, LMT, LOW, MRVL, TSM, XOM) תואמות ל־`fcf_pos_years=5` ב־EDGAR. MDLZ: הסקירה אומרת "FCF יציב 3.0–3.6B", וב־EDGAR ה־TTM הוא 2.58B, כלומר נמוך מהטווח (הבדל קטן).
- **עובדה:** בבנקים העקביות סבירה: C נשאר WATCH (ROE 6.7%, צווי consent), ו־JPM, BAC, GS, MS, SCHW, AXP הם CORE לפי המסנן. COST ו־WMT עלו מ־WATCH ל־CORE בעילת "מרווח לא מתאים לקמעונאות", וזו עילה חוקית לפי סעיף 3 בפרוטוקול. KKR ו־BX נימקו ב־GAAP מאוחד או בהמרת יחידות, ושני הנימוקים סבירים.
- **עובדה:** התיעוד (`CORE_SYSTEM.md:82`) כבר מודה בנטייה להעלות ובפער בין CVX ל־XOM. הממצאים כאן מכמתים ומרחיבים את זה.

## 4. מה לא ניתן היה לבדוק ולמה

- **אמינות הטענות החיצוניות** (קונצנזוס EPS, הנחיות, "מלחמת ארה"ב־ישראל–איראן", "סגירת מצר הורמוז", חקירת DOJ ב־UNH, סכומי IPR&D). אין גישת רשת ל־SEC או Bigdata מה־sandbox. הן מסומנות כמקור חיצוני ולא אומתו. אלה **השערות** מבחינתי, לא עובדות.
- **adjusted EPS ומכפילי פורוורד:** לא ניתנים להצלבה מול EDGAR, שמכיל רק GAAP.
- **ROTCE ו־CET1 לבנקים, combined ratio למבטחות, AFFO ל־REIT:** אינם ב־`core/sec/*.json`, ולכן לא נבדקו מספרית.
- **P/E ל־V, BRK-B, TSM, ASML:** חסר ב־state (אין מספר מניות, או דיווח IFRS או שנתי בלבד), ולכן לא נבדקה עקביות תווית השווי שלהן.
- **ההגדרות של ROIC ו־ROE באקסל המקורי** (`/tmp/claude-0/hist/fund`): הקבצים לא קיימים בריפו, ולכן אי אפשר לשחזר בדיוק מה הסוקר ראה מעבר ל־`excel_status` ול־`excel_fails`.
