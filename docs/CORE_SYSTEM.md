# מערכת CORE — תיעוד מלא (עודכן 14.10.2026, אחרי הביקורת)

מסמך אחד שמתאר את המערכת כפי שהיא בקוד היום: השיטה, הנתונים, הקוד, הדפים, התזמונים, ההחלטות, הבעיות הידועות וגבולות הידע.

- **אינדקס כל התיעוד והדפים:** [`docs/README.md`](README.md)
- **מילון מונחים (הגדרות מדויקות לפי הקוד):** [`docs/GLOSSARY.md`](GLOSSARY.md)
- **דוח הביקורת המאוחד (14.10.2026):** [`docs/audit/AUDIT-2026-10-14.md`](audit/AUDIT-2026-10-14.md). מזהים בצורה `A-xx` במסמך הזה מפנים אליו.
- עותק בפרויקט "מניות" (`claude/CORE-SYSTEM.md`) — **ישן** (לפני 14.10). הגרסה הקובעת היא זו שבריפו.

**סימון:** עובדה = בקוד או בנתונים; הערכה = מסקנה סבירה; השערה = הסבר אפשרי.

---

## 1. השיטה הקפואה (13.10.2026, Claude + ChatGPT, אושרה ע"י נועם)

המקור: `claude/METHOD-frozen-2026-10-13.md` בפרויקט.

**סדר ההחלטה:** QUALITY → ALLOCATION → RISK → PRICE → EXECUTION. לעולם לא: מחיר → קנייה → הפסד → "בעצם זו השקעה ארוכה".

| שכבה | הקצאה | מי נכנס | כללים |
|---|---|---|---|
| CORE | 85% (כ־45% VOO/SPY + כ־40% מניות) | Quality = CORE | 3 מנות 40/30/30 תוך 8 שבועות. Cheap Score משנה רק את קצב המנות: Q3/Q4 (שמיש) מקדים מנה, Q2 קצב רגיל, Q1 לא מקדים ולא מבטל. אין סטופ טכני. ירידה → בדיקת תזה, לא מכירה. מותר להחזיק דרך דוח |
| TACTICAL | עד 10% | רק מניות CORE | עד 3 במקביל. יציאה במוקדם מבין +6%, 20 ימי מסחר, או לפני דוח (BMO → יוצאים ביום המסחר הקודם; AMC → עד סגירת אותו יום; שעה לא ידועה → יום קודם). דוח קרוב מ־20 יום לא אוסר כניסה, רק מקצר את החלון. אין סטופ, אין מיצוע. מעבר ל־CORE רק אם המקום תוכנן מראש; הפסד לעולם לא סיבה |
| SPECULATIVE | עד 5% | WATCH ו־NON-CORE | סטופ 2×ADR60 נקבע לפני הכניסה ולא מורחב. סיכון מתוכנן ≤0.3% מהתיק לעסקה (גאפ יכול להגדיל את ההפסד): גודל = הנמוך מבין 0.3% ÷ מרחק הסטופ לבין התקרה (EXTREME 2%, אחרות 3%). אין מיצוע, אין מעבר ל־CORE, לא עוברים דוח |

**תקרת CORE לפי Risk Tier:** LOW/MEDIUM 10%, HIGH 6%, EXTREME 3%. CORE+TACTICAL במניה אחת: עד התקרה +2%. הדרגה קובעת גודל, לא עיתוי ולא איכות.

**אינדיקטורים טכניים** (SMA, RSI, HH/HL, נפח, breakout, retest): הקשר בלבד. **נרות 5 דקות:** METHOD-frozen קובע "לבחירת רגע הכניסה ל־TACTICAL **בלבד**" (החלטת נועם; לא הוכח יתרון). **פער ידוע:** do-tab מחיל את מצב הנרות גם על שורות SPECULATIVE (A-59, החלטה 4.11).

**בקרה רבעונית בלבד.** CORE מול VOO/SPY. TACTICAL מול Buy&Hold של אותן מניות מאותם מועדים אחרי עלויות; אחרי ≥6 חודשים **וגם** ≥30 עסקאות סגורות — אם מפגר, נסגר והכסף ל־CORE. SPECULATIVE נמדד בנפרד. כללים משתנים רק ברבעון.

**נקודות שנקבעו בדיון (13–14.10):**
- ירידה חדה היום אינה סיבה לדרג מניה גבוה — היא סימן לבדוק מה קרה.
- דוח שהתפרסם: "בדיקה אחרי דוח", לא איסור קנייה (מחקר הדוחות חלש — סעיף 14).
- שווי EXPENSIVE לא מבטל CORE; רק UNJUSTIFIABLE משאיר WATCH.
- גודל נקבע פעם אחת (Risk Tier) — לא מקטינים שוב בגלל "זהירות".
- נועם מחליט כמה כסף ומתי; המערכת לא מנהלת אחזקות (ראו A-14 והחלטה 4.5).

**כללים שקיימים בקוד ולא כתובים בשיטה הקפואה** (ממתינים להכרעה, סעיף 4 בדוח הביקורת):
- do-tab: מועמדות ל־TACTICAL/SPECULATIVE רק כש־Cheap Score Q3/Q4 שמיש (A-11). pkg-tab לא מחיל את התנאי הזה.
- THESIS REVIEW (דוח ב־3 ימי המסחר האחרונים ותנועה מעל 2×ADR60) הופך TACTICAL/SPEC ל־NO TRADE (A-43).
- כל 11 ה־ETF מוצגים בחבילה כ"חלק מ־45% VOO/SPY", כולל TQQQ ו־BITX (A-13).

---

## 2. מקורות נתונים והיררכיה

| נושא | מקור קובע | הערות |
|---|---|---|
| דוחות כספיים | **SEC EDGAR בלבד** (`data.sec.gov` companyfacts) | החלטת נועם 13.10: "מה שכתוב שם קדוש". Bigdata.com לא משמש יותר למספרים. **ידוע:** ל־12 חברות התקופה האחרונה ישנה (A-18) |
| Quality | מסנן EDGAR + סקירה עסקית | סתירה → REVIEW REQUIRED. **ידוע:** היום מוצג רק למניות שהסקירה סימנה CORE (A-08) |
| שווי (Valuation) | הסקירה (נכונה לתאריך הסקירה, 13.10.2026) + P/E ו־FCF yield יומיים מ־EDGAR ומהמחיר | הסימון מהסקירה מתעדכן רק בסקירה הבאה. P/E ו־FCF yield של MCD, VZ, NEE, PLD, COP, TSM שגויים (A-04, A-22, A-23) |
| Risk Tier | `core/risk_engine.csv` (5 שנים, ADR60 נכון ל־30.9.2026) | קפוא עד הסקירה הרבעונית; `tier_today` מחושב לידו מ־ADR60 של היום |
| Cheap Score / רבעון | `core/current_state.json` מהסגירה האחרונה | הקובץ הלילי האחרון גובר תמיד על כל Excel ישן |
| מחירים יומיים | `core/daily.csv.gz` (היסטוריה קפואה עד 2026-10-12) + Release הנרות הלילי | הנרות מ־Alpaca SIP (DB הנרות); "סגירה" = נר 15:59, לא מחיר הסגירה הרשמי (A-40) |
| נרות תוך־יומיים חיים | Yahoo (דרך `/bars`) | רק לטאב "מה לעשות היום" |
| דוחות קרובים | `api.nasdaq.com` (לוח דוחות) | תאריך + שעה (pre/after/unknown); תאריך לא מאושר יכול לזוז |
| חדשות | — | אין מנגנון אוטומטי. הדף מסמן THESIS REVIEW, לא מסיק |

---

## 3. הגדרות (תקציר)

ההגדרות המלאות, עם הפניה לשורת הקוד, ב־[`GLOSSARY.md`](GLOSSARY.md).

- **ADR60** = ממוצע (גבוה − נמוך) / סגירה של אותו יום, על 60 ימים, באחוזים. לא כולל גאפ של הלילה.
- **Risk Tier:** EXTREME אם ADR60 ≥ 4% או maxDD ≤ ‎-70%; HIGH אם ≥ 2.75% או ≤ ‎-50%; MEDIUM אם ≥ 1.6% או ≤ ‎-30%; אחרת LOW. maxDD = הירידה המקסימלית על סגירות מ־10/2021.
- **SMA200 עולה** = SMA200 / SMA200 לפני 20 ימים − 1 > 0.
- **DD252** = סגירה / שיא הסגירות של 252 הימים הקודמים (בלי היום) − 1. **DD60** באותו אופן על 60. **D200** = סגירה / SMA200 − 1.
- **Cheap Score** = ממוצע (100 − אחוזון DD252) ו־(100 − אחוזון D200), כל אחוזון מול הערכים **הקודמים של אותה מניה** בלבד (מינימום 252). רבעונים: Q1 ≤ 25 (יקרה לעצמה) < Q2 ≤ 50 < Q3 ≤ 75 < Q4 (זולה לעצמה). **שמיש רק כש־SMA200 עולה.** ההיסטוריה מתחילה ב־10/2022 בערך, כך ש"זולה" פירושו "ביחס ל־4 השנים האחרונות" (הערכה, דוח 04).
- **P/E (EDGAR)** = סגירה × מניות מדוללות אחרונות ÷ רווח נקי של 4 רבעונים, רק כש־NI>0. **FCF yield** = (תזרים מפעילות − |capex|, 4 רבעונים) ÷ שווי שוק; לא מוצג ל־17 סמלי FIN. **ידוע:** capex חסר נספר כאפס (A-22).

---

## 4. מסנן CORE (מכני, EDGAR)

קוד: `tools/core/screen_sec.py`. כללים: `core/CORE_RULES.md` (קפואים 13.10 לפני הניקוד). פלט: `core/screen_sec.csv` (שורה לחברה: מדדים, PASS/FAIL לכל כלל, `label`, `prev_label`, `changed`, `note`).

**התקופה הנמדדת** (שינוי 14.10, commit `c32206b`):
- ברירת מחדל: **TTM** — סכום 4 הרבעונים האחרונים כשהוא חדש מהשנה הכספית האחרונה (106 חברות). FY מופיע כשהשנה נסגרה זה עתה (אז היא־היא ה־TTM, למשל MSFT, COST, MU).
- **"TTM; 3y growth on FY"**: כשהרבעונים לא מגיעים 3 שנים אחורה, ה־TTM נשמר לכל הכללים, וצמיחת 3 השנים (CAGR) ושינוי המניות ל־3 שנים נמדדים על שנים מלאות FY[-4]→FY[-1]. פעיל היום ל־ALAB, ARM, BLK, SHOP.
- **"FY fallback"**: כשאין מספיק היסטוריה לחלון של שנה ו־3 שנים, הכול נמדד על שנים. כרגע אף חברה לא עוברת במסלול הזה. ASML ו־TSM נמדדות על FY כי אין להן רבעונים ב־EDGAR (20-F); C נמדדת על FY2025 כי אין לה נתון מאוחר יותר (A-18).
- 14 החברות שנמדדות על FY: ADP, ASML, C, COST, CSCO, INTU, KLAC, LRCX, MSFT, MU, PANW, PG, SMCI, TSM.
- ספירת שנים (רווח, FCF חיובי) על 5 השנים הכספיות האחרונות (כולן אם פחות מ־5).

**שישה מבחנים (STD):** רווחיות (שולי רווח תפעולי ≥10% + רווח ב־4/5 שנים), תזרים (FCF חיובי + 4/5 שנים), תשואה על ההון (ROIC ≥10%, ROIC = רווח תפעולי × 0.79 ÷ (חוב + הון − מזומן)), מאזן (חוב נטו/EBITDA ≤3, כיסוי ריבית ≥5), צמיחה (CAGR 3 שנים ≥3% וירידה שנתית ≤5%), דילול (מניות +≤5% ב־3 שנים, SBC/הכנסות ≤15%).
**FIN** (17 סמלים: בנקים, ברוקרים, ביטוח, מנהלי נכסים, בורסת קריפטו): רווח בכל השנים; ROE ≥10%; תזרים ומאזן n/a (עוברים). **UTIL/REIT** (DUK, SO, NEE, PLD, AMT): תזרים מפעילות חיובי בכל השנים; חוב/EBITDA ≤6, כיסוי ≥2.
**תווית:** 0 כישלונות = CORE-ELIGIBLE; 1 = WATCH; 2+ = NON-CORE.

**הגדרות EDGAR כפי שממומשות:** חוב = התגית הראשונה שקיימת (`debt_total` → `long_term_debt` → Noncurrent + Current → `DebtInstrumentCarryingAmount`) + חוב קצר/CP. **שימו לב:** חלק מהתגיות כוללות חכירה מימונית (A-52), כך ש"חוב בלי התחייבויות חכירה" מתקיים רק לגבי חכירה תפעולית. הכנסות בנקים נטו כפי שדווחו. רווח תפעולי חסר = רווח לפני מס + ריבית. מניות מדוללות חסרות = רווח נקי ÷ EPS מדולל, אחרת מספר המניות בעמוד השער (dei). ריבית חסרה → כיסוי 999 (עובר). EBITDA ≤0 עם חוב נטו → 99. הון מושקע ≤0 עם רווח תפעולי חיובי → ROIC 9.99.

**תוצאה (screen_sec.csv, 14.10):** 46 CORE-ELIGIBLE / 42 WATCH / 32 NON-CORE. (13.10: 46/41/33.)

**פערי נתונים ובעיות ידועות במסנן** (פירוט בדוח הביקורת):
- נתוני מאזן לא מיושרים לתאריך → ETN CORE-ELIGIBLE בטעות, MCD נכשלת על הסף (A-05).
- תקופה ישנה: C (FY2025), TSM (FY2024), 10 חברות על Q1/2026 (A-18).
- מיזוג תגיות: BLK (הכנסות חלקיות), GE/HON (ערבוב ספין־אוף → כשל צמיחה) (A-19).
- ABBV: D&A רק פחת → EBITDA נמוך (A-20).
- V, BRK-B: אין מספר מניות → דילול נכשל מכנית (A-50). KKR: ROE על הון כולל NCI (A-51).
- MRK/JNJ/LLY/IBM ועוד: רווח תפעולי מחושב (לפני מס + ריבית).

---

## 5. סקירת Quality (שיפוט עסקי)

פרוטוקול: `core/review/REVIEW_PROTOCOL.md`. 120 סקירות: `core/review/<T>.json` (נכתבו 13.10.2026).
- המסנן הוא ברירת המחדל. כל שינוי מתועד בנימוק. NON-CORE עולה רק אם המדד לא מתאים למודל העסקי או שיש בעיית נתונים ברורה. רק שווי UNJUSTIFIABLE משאיר CORE-ELIGIBLE ב־WATCH.
- שדות: איכות, צמיחה, רווחיות במדד המתאים לענף, תזרים, מאזן, הקצאת הון, **שיא מחזורי (שאלה מפורשת)**, סיכונים מבניים, שווי (ATTRACTIVE / FAIR / EXPENSIVE / UNJUSTIFIABLE), דגלים אדומים, מקורות.
- תוצאה: 75 CORE / 31 WATCH / 14 NON-CORE; 37 שינויים מתווית ה־Excel — כולם העלאות.
- **הסקירות נכתבו מול תווית "Excel" (מסנן Bigdata), לא מול מסנן EDGAR** (`excel_status` בכל קובץ; הפרוטוקול עצמו מפנה ל־`/tmp/claude-0/hist/fund/`). ב־21 מתוך 120 התווית שהסוקר ראה שונה מתווית EDGAR היום (A-07).
- **מגבלות שנאמרו במפורש:** הסקירה נוטה להעלות; אין עקביות מלאה בין חברות דומות (XOM/CVX/COP, T/VZ מול PG/PEP, DDOG/CRWD — A-27); 32 ה־NON-CORE האחרונות נסקרו בחיפוש רשת.
- **דגל REVIEW REQUIRED** (`quality_master.review_flag`): 21 חברות שהתווית שהסוקר ראה שונה מתווית EDGAR: AAPL, QCOM, ABBV, AMT, AMZN, BLK, HON, LOW, PLD, SBUX, UBER, UNH, XOM, BSX, GE, NOW, V, WFC, ABT, GILD, MRK.
  - ב־`current_state` מוצג REVIEW REQUIRED כהחלטת CORE רק ל־13 מהן, אלה שהסקירה סימנה CORE: ABBV, BLK, BSX, GE, GILD, LOW, MRK, NOW, PLD, UBER, V, WFC, XOM.
  - 8 האחרות (AAPL, QCOM, AMZN, UNH, ABT, AMT, HON, SBUX) מקבלות NO CORE ומנותבות ל־SPECULATIVE בלי דגל גלוי (A-08).
- רשימת הסקירה החוזרת המומלצת: דוח הביקורת, החלטה 4.8.

---

## 6. צנרת הנתונים ולוח הרענון

### 6.1 Workflows (GitHub Actions)

| Workflow | מתי (UTC בקוד; ישראל בסוגריים) | מה | פלט |
|---|---|---|---|
| `nightly` | cron 21:00/22:00/23:00/01:00/03:00; guard מריץ פעם ביום (≈00:00 ישראל) | Alpaca SIP → `archive_bars` (60 יום), השוואה ותיקון, העתקה ל־`bars`, צוות אימות; FAIL פותח issue | DB הנרות (Supabase), `.github/audit/` |
| `export` | cron 23:30/00:30/01:30/03:30/05:30; guard: פעם לתאריך ישראל, 02–11 ישראל, אחרי שה־nightly סיים | כל נרות הדקה של כל הסמלים, zip | Release `candles-YYYY-MM-DD` (נשמרים 7 אחרונים) |
| `core-state` | `workflow_run` אחרי כל סיום של `export` + גיבוי cron `0 8 * * *` + ידני | `earnings.py` (continue-on-error) → `state.py` | `core/earnings.json`, `core/current_state.json`, `core/current_state_latest.csv`, `core/daily_new.csv`, `core/splits.json`, `core/history/state_<date>.csv` |
| `sec-facts` | שבת 09:30 UTC + ידני (אפשר רשימת tickers) | `sec_facts.py` → `screen_sec.py` → `build_core_data.py` → `build-view.mjs` | `core/sec/*.json`, `core/screen_sec.csv`, `core/core_data.json`, `core/CORE_list.xlsx`, `view.js`, `VERSION` |
| `deploy` | push ל־main שמשנה `worker.js`, `view.js`, `v2_pipeline.js`, `v2_routes.js`, `archive_routes.js`, `wrangler.toml`, `migrations/**` + ידני | `wrangler deploy` | Worker |

**ידוע:**
- commit של `sec-facts` נעשה עם `GITHUB_TOKEN` ולכן **לא** מפעיל את `deploy`. הטאבים המוטמעים ב־`/core` (רשימה, סקירה, נתונים, רבעונים, נתונים גולמיים, quality_master בחבילה) מתעדכנים רק בפריסה הבאה (A-29).
- `core-state` מופעל גם על export שנכשל או דולג (A-37).
- `state.py` נכשל (`sys.exit`) אם ה־Release מתחיל אחרי סוף ההיסטוריה הקפואה (`gap`), ויוצא עם קוד 2 על אי־התאמה מול ההיסטוריה. כיום `daily_new.csv` לא נקרא בחזרה, ולכן הכשל צפוי בסביבות 9.12.2026 (A-06).

### 6.2 טריות כל מאגר

| מאגר | קובץ | מי מייצר | מתי מתעדכן | מי צורך |
|---|---|---|---|---|
| היסטוריה יומית קפואה | `core/daily.csv.gz` | ידני (מחקר); זהה ל־`daily_adj.pkl` | **קפוא עד 2026-10-12** | `state.py` |
| ימים חדשים | `core/daily_new.csv` | `state.py` | כל ריצת core-state | **אף אחד** (A-06) |
| פיצולים שזוהו | `core/splits.json` | `state.py` | כל ריצה (מצטבר, לא נמחק) | `state.py` |
| מצב נוכחי | `core/current_state.json`, `core/current_state_latest.csv` | `state.py` | כל לילה אחרי export (+ 08:00 UTC). **הערכה:** בדרך כלל מוכן 07:00–11:00 ישראל, לפני הפתיחה | `/core/state`, `/core/state.csv`, טאב מצב היום, טאב החבילה, do-tab, `build_core_data.py` |
| צילומי מצב | `core/history/state_<YYYY-MM-DD>.csv` | `state.py` | כל ריצה; ריצה חוזרת לאותו תאריך דורסת (A-66) | `/core/file/history`, טאב החבילה (ספירה בלבד) |
| לוח דוחות | `core/earnings.json` | `earnings.py` | כל ריצת core-state. חלון ‎-25/+75 ימים | `state.py`, `/core/file/earnings.json`, טאב החבילה |
| דוחות EDGAR | `core/sec/<T>.json`, `_report.json`, `_tags.json` | `sec_facts.py` | שבת 09:30 UTC | `screen_sec.py`, `state.py` (`sec_val`), `build_core_data.py` |
| מסנן EDGAR | `core/screen_sec.csv` | `screen_sec.py` | שבת, אחרי sec_facts | `state.py` (`Excel_label`), `build_core_data.py` |
| נתוני דף `/core` | `core/core_data.json`, `core/CORE_list.xlsx` | `build_core_data.py` | שבת; מוטמעים ב־`view.js` רק בבנייה ובפריסה | `build-view.mjs` → `/core` |
| סקירות | `core/review/<T>.json` | ידני (Claude) | 13.10.2026; לפי הפרוטוקול אחרי דוח או אירוע מהותי | `state.py`, `build_core_data.py` |
| Risk Engine | `core/risk_engine.csv` | ידני (מחקר) | קפוא (ADR60 של 30.9.2026); רק בסקירה רבעונית | `state.py` |
| יומן עסקאות | `core/trade_log.json` | `POST /core/log` | בכל שמירה בטופס | `/core/file/trade_log.json`, טאב החבילה |
| כללי המסנן | `core/CORE_RULES.md` | ידני | קפוא 13.10 (לא תואם במלואו לקוד, A-73) | `build_core_data.py` (גיליון Rules) |

---

## 7. `current_state` — עמודות

שורה לכל אחד מ־131 הסמלים (120 מניות + 11 ETF), נכון לסגירה של `date`. קוד: `tools/core/state.py:180-195,227`. אחוזים כשברים (0.05 = 5%), חוץ מ־ADR60 (באחוזים).

| עמודה | משמעות |
|---|---|
| `symbol`, `kind` | סמל; `stock` או `ETF` (VOO, SPY, XLF, XLY, QQQ, XLC, XLK, SPMO, SMH, TQQQ, BITX) |
| `close` | סגירה (נר אחרון של הסשן הרגיל, 15:59) |
| `chg1`, `chg5`, `chg20`, `chg60` | שינוי 1/5/20/60 ימי מסחר (בחבילה: `return_1d/5d/20d/60d`) |
| `SMA20`, `SMA50`, `SMA200`, `dist_SMA20`, `dist_SMA50` | ממוצעים ומרחק מהם |
| `slope200`, `sma200_rising` | SMA200/SMA200 לפני 20 ימים − 1; האם > 0 |
| `DD60`, `DD252`, `D200` | ראו סעיף 3 (D200 = `distance_SMA200` בחבילה) |
| `Cheap_Score`, `Cheap_Quartile`, `cheap_usable` | ראו סעיף 3; `cheap_usable` = יש רבעון וגם SMA200 עולה |
| `quartile_5_sessions_ago`, `quartile_21_sessions_ago` | הרבעון כפי שהיה מחושב לפני 5 ו־21 סשנים (חיתוך הסדרה, בלי look-ahead) — **חדש 14.10** |
| `ADR60`, `stop_2xADR60` | באחוזים; 2×ADR60 כשבר |
| `Risk_Tier`, `core_cap` | דרגה קפואה מ־risk_engine.csv; תקרת CORE לפי הדרגה (מחושב גם ל־ETF — A-13) |
| `tier_today` | הדרגה לפי ADR60 של היום ו־maxDD הקפוא — **חדש 14.10**. מידע בלבד, התקרה נשארת לפי `Risk_Tier` |
| `Excel_label`, `Screen_fails` | (השם היסטורי) תווית **מסנן EDGAR** מ־`screen_sec.csv` והכללים שנכשלו |
| `Review_final` | Quality מהסקירה (CORE/WATCH/NON-CORE); ריק ל־ETF |
| `valuation_review`, `review_reason`, `cyclical_peak` | שווי מהסקירה; נימוק ה־override; המילה הראשונה בשדה cyclicality |
| `pe_ttm`, `fcf_yield_ttm`, `market_cap` | ראו סעיף 3 |
| `next_earnings`, `next_earnings_time`, `earnings_time` | תאריך הדוח הבא; pre/after/unknown; **`earnings_time` = BMO/AMC/UNKNOWN — חדש 14.10** (null כשאין דוח הבא) |
| `days_to_earnings` | ימי מסחר מ־`date` (לא כולל) עד הדוח (כולל). בלי חגים |
| `short_exit_by`, `short_max_hold_days`, `short_blocked` | יום המסחר האחרון שבו מותר להחזיק TACTICAL/SPEC; min(20, ימים עד אז) — 20 כשאין דוח הבא; טקסט חסימה כשנשארו פחות מיום אחד |
| `earnings_status` | **חדש 14.10:** `REPORT NEXT SESSION (BMO/AMC/time unknown)`, `REPORT IN n SESSIONS` (n≤5), `REPORTED ON <date>` (+ `(AMC: reaction next session)`), `REPORTED <date> (after this state)`, `REPORTED <date>` (עד 3 ימים) |
| `last_earnings`, `last_earnings_time`, `move_since_last_report` | הדוח האחרון ותנועת המחיר מאז הסגירה שלפני יום התגובה |
| `screen_review_conflict` | התווית שהסוקר ראה ≠ תווית EDGAR היום |
| `route` | `CORE+TACTICAL` (Review_final=CORE), `SPECULATIVE` (אחרת), `ETF` |
| `core_decision` | לפי הסדר: `ETF / INDEX` → `NO CORE` (לא CORE או UNJUSTIFIABLE) → `THESIS REVIEW` → `REVIEW REQUIRED` → `ACCELERATE TRANCHE` (Q3/Q4 ו־SMA200 עולה) → `NORMAL SCHEDULE` |
| `last_day_complete` | ליום האחרון יש ≥380 נרות דקה |

בנוסף בראש הקובץ: `date`, `built`, `earnings_built`, `history_frozen_to`, `release` ([ראשון, אחרון]), `symbols`, `incomplete`, `overlap_mismatch`, `splits`, `health`.

**מצב היום (14.10, commit `acd9df6`):** תאריך המצב 2026-10-12 (ה־Release של 13.10 עוד לא היה זמין); `health.ok=false` כי `state_is_current=false`. החלטות: NO CORE 45, NORMAL 41, ACCELERATE 21, REVIEW REQUIRED 13, ETF 11.

---

## 8. בדיקות תקינות (`health`)

מחושבות בכל ריצה (`state.py:197-213`) ומוצגות בטבלת DATA_HEALTH בטאב החבילה (`pkg-tab.html:141-166`). OK/WARN/INFO מחושבים בדף.

| בדיקה (שם בדף) | שדה ב־health | תנאי OK | חלק מ־`ok`? |
|---|---|---|---|
| כל 131 הסימולים קיימים | `symbols_in_state`, `symbols_expected` (131 קבוע), `missing_symbols` | שווים ואין חסרים | `missing_symbols` כן |
| המצב מהיום הנכון | `state_date`, `expected_last_session`, `state_is_current` | `state_date ≥ expected_last_session` (יום החול האחרון ב־ET; לפני 18:00 ET — הקודם). בלי חגים (A-38) | כן |
| יום אחרון מלא לכל סימבול | `incomplete_last_day` | ריק (≥380 נרות) | כן |
| אין ימים חסרים (60 ימים) | `missing_days_last_60` | ריק (חוצה־סמלים בלבד) | לא |
| אין סימבול תקוע | `stuck_close_5_sessions` | ריק (סגירה זהה 5 ימים) | כן |
| אין נפח אפס ביום האחרון | `zero_volume_last_day` | ריק | לא |
| נפחים סבירים | `volume_over_5x_avg` | INFO בלבד | לא |
| תנועה יומית מעל 25% | `one_day_move_over_25pct` | ריק | **לא** (A-24) |
| מחירים תואמים להיסטוריה | `overlap_mismatch_vs_history` | ריק (חציון יחס לסמל ≤0.2% — A-25) | כן, ו־exit 2 |
| פיצולים זוהו ותוקנו | `splits_detected_after_history` | INFO | לא |
| אין lookahead ב־Cheap Score | `cheap_score_lookahead` | **מחרוזת קבועה, לא בדיקה** | לא |
| Risk Tier קפוא מול היום | `risk_tier_frozen_vs_today` | INFO (היום: 11 סמלים שונים) | לא |
| לוח דוחות: סימולים שנמצאו | (מ־earnings.json) | ≥100 מתוך 120; מציג ימים שנכשלו | לא (A-16) |
| EDGAR: לכל 120 החברות יש תקופה | (מ־quality_master) | 120 שורות עם `EDGAR_period` | לא (לא בודק גיל — A-18) |
| סקירה: סתירות מסנן↔סקירה | (ספירת REVIEW REQUIRED) | INFO | לא |
| תקין בסך הכול | `ok` | `state_is_current` וגם אין missing/incomplete/stuck/mismatch | — |

**לא נבדק כיום** (מתוך דרישת CHAT ל־DATA_HEALTH): duplicated bars, נרות חסרים חריגים מעבר ליום האחרון, ימים חסרים בכל ההיסטוריה (A-41), גיל לוח הדוחות.

---

## 9. `core/history` — צילומי מצב

- `state.py:214-215` כותב בכל ריצה `core/history/state_<date>.csv` — שורות ה־current_state באותו רגע.
- **ידוע (A-66):** הקובץ נכתב **לפני** הוספת `quartile_5/21_sessions_ago`, ולכן חסרות בו העמודות האלה; ריצה חוזרת לאותו תאריך דורסת אותו (state_2026-10-12.csv עבר 5 commits).
- הרשימה זמינה ב־`/core/file/history`, וקובץ בודד ב־`/core/file/history/state_YYYY-MM-DD.csv`. טאב החבילה מציג רק את מספר הקבצים והאחרון.
- היום יש קובץ אחד (`state_2026-10-12.csv`).

---

## 10. הדפים

### 10.1 `/core` (`core.html` + `pkg-tab.html`)

הדף סטטי: `core_data.json` ו־`CORE_list.xlsx` מוטמעים ב־`view.js` בזמן הבנייה (`build-view.mjs`). המצב הלילי נטען חי מ־`/core/state`. כפתור "הורד Excel" מוריד את `CORE_list.xlsx` המוטמע (גיליונות List, Review, Data, Quarters, Rules, Raw_EDGAR).

| טאב (`#hash`) | מה מוצג | מקור |
|---|---|---|
| מצב היום (`#state`) | current_state, סינון לפי Quality/תווית/דרגה/רבעון/שמיש/SMA200, CSV | `/core/state`, `/core/state.csv` |
| רשימה (`#list`) | תווית מסנן EDGAR, 6 הכללים, סיבת כישלון, תקופה, Risk Tier, Cheap Score, Quality סופי | `core_data.list` |
| סקירה (`#review`) | 120 הסקירות (סטטוס שהסוקר ראה, Final, נימוק, שווי, מחזוריות, מקורות) | `core_data.review` |
| נתונים (`#data`) | המדדים שעליהם נמדד המסנן, שורה לחברה | `core_data.data` |
| רבעונים (`#quarters`) — **חדש 14.10** | 12 הרבעונים האחרונים לכל חברה (1,413 שורות, 118 חברות; ASML ו־TSM בלי רבעונים): הכנסות, צמיחה מול רבעון מקביל (344–384 יום), רווח תפעולי ומרווח, רווח נקי, EPS מדולל, FCF, ו־TTM (סכום 4 רבעונים רצופים, ≤300 יום בין סופי הרבעון הראשון והאחרון) של הכנסות/מרווח/רווח נקי/FCF וצמיחת TTM. Q4 מחושב כשנה פחות 3 רבעונים. **ידוע:** FCF=OCF כשאין capex (A-22), EPS ריק ל־11 חברות (A-21), רבעונים שליליים מתגיות מעורבבות (A-19) | `core_data.quarters` |
| כללים (`#rules`) | `CORE_RULES.md` | `core_data.rules` |
| נתונים גולמיים (`#raw`) | כל תקופה מ־EDGAR מ־2021, ביחידות מלאות | `core_data.raw` |
| חבילה ל־CHAT (`#pkg`) — **חדש 14.10** | סעיף 11 | `/core/state`, `/core/file/*`, `core_data.quality_master` |

**ידוע (A-60):** בטאב מצב היום חסרות SMA20/SMA50, `earnings_time`, `earnings_status`, `tier_today` (קיימות בטאב החבילה); "חושב" מוצג ב־UTC.

### 10.2 `/bars` → טאב "מה לעשות היום" (`do-tab.html`)

`do-tab.html` מוזרק ל־`archive-bars.html` (marker `<!--DO_TAB-->`) ע"י `build-view.mjs`. נטען בלחיצה על `#tabDo`. קורא `/core/state` ונרות דקה של היום מ־Yahoo (`window.__yahooRows`), ומתרענן כל 2 דקות כשהטאב פתוח.

- **שורות:** CORE → שורת CORE + שורת TACTICAL; WATCH/NON-CORE → שורת SPECULATIVE; ETF לא מוצגים (A-69).
- **החלטת CORE:** `core_decision` מהמצב הלילי; בנוסף THESIS REVIEW אם דיווחה ב־3 ימי מסחר אחרונים (כולל דוח מאחרי המצב) וזזה מעל 2×ADR60.
- **TACTICAL/SPECULATIVE:** THESIS REVIEW → NO TRADE; `short_exit_by` שנשאר לו פחות מיום מסחר מהיום (ET) → NO TRADE; לא Q3/Q4 שמיש → NOT A CANDIDATE (כלל לא מאושר, A-11); אחרת מצב הנרות.
- **מצב נרות** (סשן רגיל, בלי הנר שעוד נוצר): אין נרות → WAIT FOR OPEN; לא היום → WAIT FOR OPEN; עלתה מעל סגירת אתמול + ADR60 → DON'T CHASE; פחות מ־30 דקות → WAIT; אין pullback (השפל לא אחרי השיא או טווח < ½ADR) → LIMIT OK; שפל חדש ב־15 דקות → WAIT FOR STABILIZATION; ≥30 דקות בלי שפל + "שפל גבוה יותר" + מעל VWAP → ENTRY NOW; אותו דבר מתחת ל־VWAP → WAIT FOR RECLAIM. **ידוע:** "שפל גבוה יותר" כמעט תמיד מתקיים (A-47); התוויות נראות כאות (A-48).
- **SPECULATIVE** מציג סטופ 2×ADR60 (גם במחיר) וגודל `min(0.3%/סטופ, 2%|3%)`. **לא** מציג תאריך יציאה לפני דוח (A-42).
- **הקשר שוק:** שינוי SPY/QQQ ו"מול SPY" לכל מניה. תנועה חריגה מול השוק → "לבדוק מה קרה, לא סיבה לקנות". כרטיסי הסבר ל־12 המניות הראשונות.
- **מסנן ברירת מחדל** "רק מה שדורש תשומת לב" (לא כולל LIMIT OK — A-61).
- **מגבלות:** כללי הנרות לא נבדקו היסטורית; הדף לא קורא חדשות; לא בודק `state_is_current` (A-39); חגים לא מנוכים; לא מזכיר פוזיציות פתוחות (A-15).

---

## 11. טאב החבילה ל־CHAT (`pkg-tab.html`)

מטרה: כל מה ש־CHAT ביקש (מפרט החבילה) במקום אחד. נרות דקה **לא** בחבילה — ניתנים ידנית מ־`/bars` (הורדה מרובה).

### 11.1 טבלת הרענון ("רוענן לאחרונה")

| שורה | נכון ל־ | רוענן (שעון ישראל) | תדירות | מקור |
|---|---|---|---|---|
| מצב נוכחי (נרות יומיים) | `state.date` | `state.built` | כל לילה אחרי ייצוא הנרות + 08:00 UTC | נרות שמורים |
| לוח דוחות | חלון earnings | `earnings.built` | כל לילה | api.nasdaq.com |
| Quality Master — מסנן EDGAR | `edgar_fetched` | `core_data.built` | כל שבת | SEC EDGAR |
| Quality Master — סקירה עסקית | `reviews_date` (2026-10-13) | — | ידני, רבעוני | דוחות + חדשות |
| טבלת החלטה / תמונה חודשית | `state.date` | `state.built` | נגזר מהמצב | חישוב בדף |
| DATA_HEALTH | `health.state_date` | `health.checked` | כל לילה | state.py |
| יומן עסקאות | מספר רשומות | `log.updated` | בכל שמירה | core/trade_log.json |
| צילומי מצב | הקובץ האחרון | מספר קבצים | כל לילה | core/history |
| נרות דקה | — | ידני | לפי צורך | /bars |
| הדף נטען | עכשיו | עכשיו | | |

### 11.2 שמונה הטבלאות

| טבלה (CSV / גיליון) | עמודות | הערות |
|---|---|---|
| `decision_table` | Rank, Symbol, Quality, route, Risk (+ "היום X" כש־tier_today שונה), Valuation (ATTRACTIVE→CHEAP), Cheap (רבעון, ציון, שמיש/לא), Today (`chg1` של יום המצב), Earnings (`earnings_status`), Intraday (טקסט קבוע "ידני מנרות דקה"), decision (`core_decision`), entry condition | מיון: THESIS → REVIEW → ACCELERATE → NORMAL → ETF → NO CORE, ובתוך קבוצה לפי Cheap Score שמיש. **שורה אחת למניה**, לא שורה לכל מסלול; חסימת דוח מול תאריך המצב (A-12); ETF = "חלק מ־45% VOO/SPY" (A-13) |
| `current_state_<date>` | symbol, date, close, SMA20, SMA50, SMA200, slope200, distance_SMA20, distance_SMA50, distance_SMA200 (=D200), DD60, DD252, D200, Cheap_Score, Cheap_Quartile, cheap_usable, sma200_rising, ADR60_pct, Risk_Tier, tier_today, stop_2xADR60, core_cap, return_1d/5d/20d/60d, quartile_5/21_sessions_ago, kind, route, EDGAR_label, Review_final, core_decision, valuation_status, pe_ttm, fcf_yield_ttm, market_cap, next_earnings_date, earnings_time, days_to_earnings, earnings_status, last_day_complete | כל עמודות החובה של CHAT |
| `earnings_calendar` | symbol, next_earnings_date, earnings_time, days_to_earnings, status, flag, short_exit_by, last_earnings_date, last_earnings_time, move_since_last_report, route, Review_final | מניות בלבד, ממוין לפי ימים לדוח. `flag`: REPORT TOMORROW (status "NEXT SESSION"), REPORTED TODAY (status "REPORTED" ו־last ≥ תאריך המצב), WITHIN 5 SESSIONS. **ידוע:** סיווג last/next שגוי (A-03) |
| `quality_master` | symbol, name, EDGAR_label, EDGAR_fails, EDGAR_period, EDGAR_fetched, Review_final, review_flag, valuation_status, review_date, cyclicality, thesis, override, override_reason, red_flags, structural_risks, growth_note, profitability_note, fcf_note, balance_note, capital_allocation_note, revenue_m, rev_cagr3, rev_yoy, op_margin, net_income_m, fcf_m, roic, roe, nd_ebitda, int_cov, share_chg3, sbc_rev, data_notes, sources (35) | נבנה ב־`build_core_data.py:117-133`. `review_flag`=REVIEW REQUIRED ל־21. סכומים במיליונים **במטבע הדיווח** (A-23). 999/99/9.99 הם sentinels (A-49) |
| `data_health` | check, status (OK/WARN/INFO), value, details | סעיף 8 |
| `monthly_snapshot_<YYYY-MM>` | section, item, value, details | ספירות Quality, תווית EDGAR, מסלול, Risk Tier קפוא ושל היום, רבעונים (כולם ושמישים), החלטות CORE; שינויי רבעון ב־21 וב־5 סשנים; ביצועי CORE (ממוצע שווה משקל של 75 מניות CORE, ל־20 ו־60 ימים, עם חציון ו־SPY); עסקאות החודש מהיומן. **דיווח בלבד, לא קלט להחלטה** |
| `trade_log` | id, route, symbol, action, decision_time, decision_price, candle_condition, fill_time, fill_price, amount_usd, pct_of_portfolio, tranche, stop_price, exit_time, exit_price, exit_reason, spy_at_entry, notes, logged_at | סעיף 11.4 |
| `quarterly_review` | route, symbol, entry_time, entry_price, exit_price, status, exit_reason, calendar_days, trade_return, buy_hold_same_stock_to_today, trade_minus_bh, spy_since_entry, trade_minus_spy + שורות סיכום | רק BUY. סיכום TACTICAL: סגורות, ניצחונות, תשואה ממוצעת, B&H ממוצע, הפרש, חודשים מאז TACTICAL ראשונה, כלל ההפסקה (≥6 חודשים **וגם** ≥30 סגורות; מתקיים אם סכום ההפרשים <0). **חסר:** עלויות, CORE מול SPY, סיכום SPEC; B&H עד היום ולא עד היציאה (A-46) |

### 11.3 הורדות

- **CSV לכל טבלה:** `<name>__downloaded_YYYY-MM-DD_HHMM.csv` (שעון ישראל), UTF-8 עם BOM, CRLF. למשל `current_state_2026-10-12__downloaded_2026-10-14_0321.csv`. **ידוע:** אין הגנה מ־CSV injection (A-32).
- **Excel של כל החבילה:** `CHAT_package_<state date>__downloaded_YYYY-MM-DD_HHMM.xlsx`, נבנה בדפדפן עם SheetJS 0.18.5 מ־cdnjs. 10 גיליונות: README (שעת הורדה, תאריך מצב, טבלת הרענון, רשימת גיליונות, יחידות), decision_table, current_state, earnings_calendar, quality_master, data_health, monthly_snapshot, trade_log, quarterly_review, method (כללי השיטה). **ידוע:** אם `/core/state` נכשל יורד Excel חלקי בלי אזהרה (A-31).
- **`/core/state.csv`** (מטאב מצב היום) — `current_state_latest.csv` כמו שהוא, בשם קבוע `current_state.csv`.

### 11.4 יומן עסקאות — טופס, API ואחסון

**הטופס** (מוצג רק כשטבלת "יומן עסקאות" פתוחה): מסלול (CORE/TACTICAL/SPECULATIVE/NO TRADE), סימבול (חובה, מומר לאותיות גדולות), פעולה (BUY/SELL/SKIP/HOLD), זמן החלטה, מחיר בזמן החלטה, מצב נרות בזמן החלטה, זמן ביצוע, מחיר ביצוע, סכום ($), % מהתיק, מנה (1 (40%) / 2 (30%) / 3 (30%)), סטופ (SPEC), זמן יציאה, מחיר יציאה, סיבת יציאה (+6% TARGET / 20 DAYS / BEFORE EARNINGS / STOP / THESIS BROKEN / OTHER), SPY בכניסה (ב־BUY מתמלא אוטומטית מסגירת SPY במצב), הערות. "ערוך" טוען שורה לטופס; סגירת עסקה = עריכה והוספת יציאה; "מחק" דורש לחיצה שנייה. **ידוע:** זמנים נשמרים בלי אזור זמן (A-36); עריכה דורסת `logged_at` (A-79).

**API:**
- `GET /core/file/trade_log.json` — פתוח לקריאה בלי מפתח. אם הקובץ לא זמין מחזיר `{updated:null, entries:[]}`.
- `POST /core/log` עם `{"entry": {...}}` (הוספה; עם `id` קיים = עדכון) או `{"delete": "<id>"}`. מפתח ב־header `X-API-Key` (או `?key=`).
  - בלי `API_KEY` מוגדר ב־Worker → **503** (סגור; שינוי `d2865fa`, 14.10). מפתח שגוי → 401. בלי `GH_TOKEN`/`GH_REPO` → 503.
  - מפתחות מותרים `^[a-z_0-9]{1,40}$`; מחרוזות נחתכות ל־2,000 תווים; `id` אוטומטי `t<base36 timestamp>`; `logged_at` = עכשיו; `updated` של הקובץ = עכשיו.
  - כתיבה: commit ל־`core/trade_log.json` ב־main דרך GitHub Contents API ("core: trade log entry/delete"), עד 3 ניסיונות על 409/422.
- הדף שואל `/auth`; אם נדרש מפתח, מבקש אותו פעם אחת ושומר ב־sessionStorage.

**אחסון:** `core/trade_log.json` בריפו **הציבורי** `Liornim/spmo-market-bridge` — כל רשומה גלויה לכולם ונשארת בהיסטוריית git (A-01, **קריטי**). אין לרשום עסקאות אמיתיות עד הכרעה 4.1. **ידוע:** קובץ פגום או גדול מ־1MB → היומן נמחק בשקט (A-28).

---

## 12. נתיבי Worker של CORE (`worker.js:1874-1937`)

| נתיב | מה | הרשאה |
|---|---|---|
| `GET /core` | הדף (`CORE_HTML` מתוך view.js) | פתוח |
| `GET /core/state` | `core/current_state.json` מ־main דרך GitHub API (או raw.githubusercontent אם אין GH_TOKEN). 503 אם לא זמין | פתוח |
| `GET /core/state.csv` | `core/current_state_latest.csv`, מצורף כ־`current_state.csv` | פתוח |
| `GET /core/file/<name>` | רק `earnings.json`, `trade_log.json`, `history` (רשימת קבצים), `history/state_YYYY-MM-DD.csv` (regex מעוגן) | פתוח |
| `POST /core/log` | יומן עסקאות (סעיף 11.4) | `API_KEY` חובה |
| `GET /auth` | `{key_required}` | פתוח |

כל התגובות `Cache-Control: no-store`; כל קריאה פונה ל־GitHub API עם ה־PAT (A-35).

---

## 13. קבצים בריפו

`core/` — CORE_RULES.md, CORE_list.xlsx, core_data.json, current_state.json, current_state_latest.csv, daily.csv.gz, daily_new.csv, splits.json, risk_engine.csv, earnings.json, screen_sec.csv, trade_log.json, history/, sec/ (120 קבצי EDGAR + `_tags.json`, `_report.json`), review/ (120 סקירות + REVIEW_PROTOCOL.md).
`tools/core/` — sec_facts.py, screen_sec.py, build_core_data.py, state.py, earnings.py.
דפים: core.html, pkg-tab.html, do-tab.html, archive-bars.html; `build-view.mjs` מטמיע אותם ב־view.js.
אינדקס מלא: [`README.md`](README.md).

**קוד המחקר** (בסיס סעיף 14) **לא בריפו**: הוא נמצא רק בתיקייה זמנית של sandbox, `/tmp/claude-0/hist/` (A-26).

---

## 14. מה המחקר הראה (5 שנים, 129 מניות) — בסיס השיטה, אחרי ביקורת צוות 8

| ממצא | ניסוח מקורי | סטטוס אחרי הביקורת |
|---|---|---|
| **שיטת המבנה** (LL→HL→breakout→retest) | אין יתרון מול כניסה אקראית באותו יום (‎-$1.56 לעסקה, CI [‎-4.22, +1.09]) | **נתמך** (שוחזר). survivorship מטה לטובת השיטה, אז הכישלון חזק עוד יותר |
| **8 משפחות תזמון** | רק אחת (F7) עברה Discovery ונכשלה ב־Validation | **נתמך**. ("F8 breakout מזיק" כנראה מנופח בחלקו — לא לצטט) |
| **SWING** (דירוג Ridge, 20 יום) | נכשל; אין טריגר TACTICAL מוכח | **נתמך** (D10−D1 ב־Validation ‎-1.60%) |
| **LONG Cheap Score: Q4 > Q1** | Q4 עדיף על Q1 בכל התקופות כולל holdout (+9.1%), מדגם קטן, מרוכז ב־HIGH/EXTREME → overlay בלבד | **שנוי במחלוקת / לא הוכח.** ה־Verdict הרשמי היה INCONCLUSIVE. המדד LONG_EDGE מנכה ממוצע של אותה מניה באותה שנה כולל ימים **לפני** האירוע (look-ahead). עם baseline מימים שאחרי האירוע ההפרש מתהפך ב־Discovery+Validation. בתשואה גולמית ומול SPY, Q4 לא ניצח את Q1 באף תקופה (holdout: Q4 ‎-22.0% מול SPY, Q1 ‎+3.1%). Q4: n=5/19/17 באשכולות זמן; CI holdout ‎[+0.07, +19.0]; ב־MEDIUM Q4=Q1; Q3 לא עדיף על Q2. survivorship מטה בדיוק לטובת הכלל (A-09, A-10) |
| **ירידה חדה** | אחרי נרמול לתנודתיות אין קפיצה חזרה (‎-0.15% ל־10 ימים) | **ניסוח מוחלש:** אין ראיה לקפיצה חזרה, **וגם לא נשללה** (SE ~0.5–0.6%; n=384 ימי־מניה חופפים). המסקנה המעשית (ירידה ≠ סיבה לקנות) סבירה |
| **ירידה מתונה ב־pre** (0.5–1σ) | ‎+0.12% עד הסגירה — קטן מהעמלה | נתמך; לא בשימוש |
| **דוחות** (25 מניות, 490 דוחות) | תנועה ממוצעת 5.1% ביום התגובה; אחרי ירידה >8% — ‎-1.2% ל־5 ימים, ‎-1.75% ל־42 ימים → אזהרה, לא כלל | **נתמך כחלש** (n=49, t≈-1.8 ל־5 ימים, t≈-0.9 ל־42). תנודה ביום הדוח (5.05% מול 1.35%) — **חזק**, ומצדיק יציאה לפני דוח |
| **ליבה+טקטי 2022–2026** | טקטי ≈ החזקה אחרי מס; סטופים פגעו | **נבדקו כללים אחרים** (יעד +5%, טריגר מומנטום, 40 מניות שנבחרו בדיעבד). כללי ה־TACTICAL הקפואים (+6%/20 יום/בלי טריגר) **לא נבדקו** |
| **Bigdata מול EDGAR** | 90% מהערכים זהים ב־1%; הפערים בעיקר הגדרות | 90.2% מ־4,444 זוגות — נכון, אבל לא הושוו חוב, מזומן, ריבית, SBC ו־EBITDA, ו־**20 מתוך 120 תוויות השתנו** במעבר |
| **כלל ההפסקה של TACTICAL** | — | **הערכה (צוות 8):** אחרי 30 עסקאות ה־SE כ־1.35% לעסקה, פי 3–4 מכל הבדל שנמדד; ההכרעה תיקבע ברובה ע"י רעש. החלטה 4.15 |

**ריבוי השוואות:** התוכנית הריצה עשרות עד מאות השוואות (מבנה, 8 משפחות, SWING, LONG, 108 תאים בטבלת תשואות עבר, pre-dip, דוחות, ליבה+טקטי); התוצאה החיובית היחידה (LONG) עברה בקושי ונוסחה רבע שעה אחרי ש־F5 הדומה נכשל.

**מגבלות כלליות:** יקום של היום (survivorship); אין דוחות כספיים point-in-time, ולכן המסנן לא נבדק לאחור (CORE_RULES). קוד המחקר לא מגורסן (A-26).

---

## 15. בעיות ידועות (מתוך הביקורת)

הרשימה המלאה (80 פריטים) בדוח הביקורת. כאן הפריטים שמשפיעים ישירות על השימוש היומי:

| נושא | מה לדעת בזמן שימוש | ID |
|---|---|---|
| יומן עסקאות | בריפו ציבורי; סגור לכתיבה עד שמוגדר `API_KEY`; לא לרשום עסקאות אמיתיות | A-01, A-02, A-28 |
| דוחות AMC | ביום דוח AMC (וגם ליל BMO) המערכת עלולה להציג "REPORTED" ולא לחסום. לבדוק את תאריך הדוח ידנית לפני כל TACTICAL/SPEC | A-03 |
| דוח בלי תאריך | ADBE, AVGO, ORCL, COST, MU מקבלות 20 ימים בלי אזהרה | A-17 |
| פוזיציות פתוחות | אין תזכורת לצאת לפני דוח | A-15 |
| P/E ו־FCF yield | MCD (0.0 / 46,308), VZ/NEE/PLD/COP (FCF מנופח), TSM (שווי ×5), 12 חברות על תקופה ישנה — לא להסתמך | A-04, A-18, A-22, A-23 |
| תוויות | ETN (צריכה WATCH), ABBV/GE/HON/KKR/V (כנראה נמוכות מדי), MCD על הסף | A-05, A-19, A-20, A-50, A-51 |
| REVIEW REQUIRED | AAPL/QCOM ועוד 6 לא מסומנות; GE ועוד מקבלות TACTICAL ב־do-tab | A-08, A-45 |
| טבלת ההחלטה | לא שורה לכל מסלול; כשהמצב מפגר — מציעה TACTICAL ביום הדוח | A-12 |
| ETF | TQQQ/BITX מוצגות כחלק המדד; VOO "תקרה 10%" | A-13 |
| שני הדפים | do-tab ו־pkg-tab נותנים הוראות שונות ל־TACTICAL (שער Q3/Q4, REVIEW REQUIRED) | A-11, A-45 |
| מצב לא עדכני | do-tab לא בודק `state_is_current`; "היום" יכול להיות שינוי של יומיים | A-39 |
| חגים | ספירת ימים וגבולות יציאה בלי חגי NYSE | A-38 |
| פיצולים | פיצול 3:2/7:1 לא מזוהה; נפילה של 50% תיחשב פיצול | A-24 |
| היסטוריה | המצב הלילי ייעצר בסביבות 9.12.2026 אם לא יתוקן | A-06 |
| פריסה | עדכון EDGAR השבועי לא מגיע לטאבים המוטמעים עד פריסה ידנית | A-29 |
| Excel החבילה | יכול לרדת חלקי בלי אזהרה | A-31 |

---

## 16. יומן החלטות

- 13.10 — השיטה הוקפאה (TACTICAL 10%, מעבר ל־CORE רק במקום מתוכנן, כלל עצירה 6 חודשים וגם 30 עסקאות).
- 13.10 — SPECULATIVE: EXTREME עד 2%, אחרות 3%.
- 13.10 — מסנן מכני + סקירה; CORE-ELIGIBLE במקום CORE למסנן.
- 13.10 — WATCH נסחרת רק כ־SPECULATIVE.
- 13.10 — נרות 5 דקות לביצוע TACTICAL (נועם); אין ניהול אחזקות.
- 13.10 — SEC EDGAR מקור יחיד לדוחות.
- 14.10 — Q3 וגם Q4 מקדימות מנה; TACTICAL מותר גם כשהדוח קרוב מ־20 ימים (רק יוצאים לפניו); דוח = בדיקה ולא איסור.
- 14.10 — דף "מה לעשות היום" בטאב של /bars.
- 14.10 — טאב "חבילה ל־CHAT" ב־/core: 8 טבלאות (decision_table, current_state, earnings_calendar, quality_master, data_health, monthly_snapshot, trade_log, quarterly_review), טבלת רענון, Excel ו־CSV עם חותמת זמן הורדה (שעון ישראל).
- 14.10 — יומן עסקאות והחלטות: טופס בטאב החבילה, `POST /core/log`, שמירה ב־`core/trade_log.json` (מיקום האחסון ממתין להחלטה 4.1).
- 14.10 — טאב "רבעונים" ב־/core (12 רבעונים לכל חברה, TTM).
- 14.10 — המסנן: TTM נשמר גם כשהרבעונים לא מגיעים 3 שנים אחורה; צמיחת 3 שנים ושינוי מניות על שנים מלאות (ALAB, ARM, BLK, SHOP).
- 14.10 — current_state: עמודות `earnings_time` (BMO/AMC/UNKNOWN), `earnings_status`, `tier_today`, `quartile_5_sessions_ago`, `quartile_21_sessions_ago`; `health` עם `state_is_current`; צילומי מצב ב־`core/history`.
- 14.10 — ביקורת של 11 צוותים (פיתוח, רו"ח ×3, כלכלנים ×2, QA ×2, סוחרים ×2, אנליסטים). דוח מאוחד: `docs/audit/AUDIT-2026-10-14.md`.
- 14.10 — `POST /core/log` סגור כשאין `API_KEY` (בעקבות ממצא צוות 10; commit `d2865fa`).
- 14.10 — טענת LONG Q4>Q1 מסומנת בתיעוד "שנויה במחלוקת / לא הוכחה" (ממצא צוות 8). הכלל עצמו (Q3/Q4 מקדימים מנה) לא שונה — ממתין להחלטה 4.2.

## 17. פתוח

החלטות שממתינות לנועם (פירוט ואפשרויות: דוח הביקורת, סעיף 4):
1. איפה לשמור את יומן העסקאות (4.1); להגדיר `API_KEY`.
2. Q3 מקדים מנה? (4.2) · שער Q3/Q4 ל־TACTICAL/SPEC ב־do-tab (4.3) · רשימת ETF כולל TQQQ/BITX (4.4).
3. מגבלות תיק במערכת (4.5) · REVIEW REQUIRED למניות שאינן CORE (4.6) ול־TACTICAL (4.7).
4. סקירה חוזרת: 11 בעדיפות גבוהה, ~30 בסך הכול (4.8).
5. THESIS REVIEW: חוסם או "REVIEW FIRST", והרחבה לירידות בלי דוח (4.10) · נרות גם ל־SPEC (4.11) · תוויות הנרות (4.12).
6. לסקירה הרבעונית: ערכים חסרים ו־ROE ב־FIN (4.13), כללי מגזר (4.14), סף לכלל ההפסקה (4.15), Risk Tier על ADR60 של יום אחד (4.16).

תיקוני קוד פתוחים: כל ממצאי "באג" בדוח הביקורת, בעדיפות A-03, A-04, A-05, A-06, A-12, A-15–A-17, A-28, A-29. בנוסף: חגי מסחר בספירת ימים (A-38); מנגנון חדשות (אין); העברת קוד המחקר לריפו (A-26).
