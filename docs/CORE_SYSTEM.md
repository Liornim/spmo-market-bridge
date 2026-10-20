# מערכת CORE — תיעוד מלא (עודכן 14.10.2026, אחרי ביקורת סבב 2; תוספות 20.10.2026 בסעיפים 7 ו־16)

מסמך אחד שמתאר את המערכת כפי שהיא בקוד היום (HEAD `d9a9771`): השיטה, הנתונים, הקוד, הדפים, התזמונים, ההחלטות, הבעיות הידועות וגבולות הידע.

- **אינדקס כל התיעוד והדפים:** [`docs/README.md`](README.md)
- **מילון מונחים (הגדרות מדויקות לפי הקוד):** [`docs/GLOSSARY.md`](GLOSSARY.md)
- **דוח ביקורת סבב 1:** [`docs/audit/AUDIT-2026-10-14.md`](audit/AUDIT-2026-10-14.md). מזהים בצורה `A-xx` מפנים אליו.
- **דוח ביקורת סבב 2:** [`docs/audit/AUDIT-2026-10-14-round2.md`](audit/AUDIT-2026-10-14-round2.md). מזהים בצורה `r2-05#N1` מפנים לדוחות `docs/audit/r2_*.md`.
- עותק בפרויקט "מניות" (`claude/CORE-SYSTEM.md`) — **ישן** (לפני 14.10). הגרסה הקובעת היא זו שבריפו.

**סימון:** עובדה = בקוד או בנתונים; הערכה = מסקנה סבירה; השערה = הסבר אפשרי. מספרי שורות נכונים ל־HEAD `d9a9771`.

---

## 1. השיטה הקפואה (13.10.2026, Claude + ChatGPT, אושרה ע"י נועם) והחלטות 14.10

המקור: `claude/METHOD-frozen-2026-10-13.md` בפרויקט. ההחלטות של 14.10 (סעיף 16) הן חלק מהמפרט.

**סדר ההחלטה:** QUALITY → ALLOCATION → RISK → PRICE → EXECUTION. לעולם לא: מחיר → קנייה → הפסד → "בעצם זו השקעה ארוכה".

| שכבה | הקצאה | מי נכנס | כללים |
|---|---|---|---|
| CORE | 85% (כ־45% VOO/SPY + כ־40% מניות) | Quality = CORE, בלי REVIEW REQUIRED. **חלק המדד: VOO ו־SPY בלבד** (החלטה 4) | 3 מנות 40/30/30 תוך 8 שבועות. Cheap Score משנה רק את קצב המנות: Q3/Q4 שמיש מקדים מנה (החלטה 2), Q2 קצב רגיל, Q1 לא מקדים ולא מבטל. אין סטופ טכני. ירידה → בדיקת תזה, לא מכירה. מותר להחזיק דרך דוח |
| TACTICAL | עד 10% | רק מניות CORE (לא REVIEW REQUIRED — החלטה 5) | עד 3 במקביל. יציאה במוקדם מבין +6%, 20 ימי מסחר, או לפני דוח (BMO או שעה לא ידועה → עד סגירת יום המסחר הקודם; AMC → עד סגירת יום הדוח). דוח קרוב מ־20 יום לא אוסר כניסה, רק מקצר את החלון. **רבעון הזול הוא הקשר בלבד, לא תנאי** (החלטה 3). אין סטופ, אין מיצוע |
| SPECULATIVE | עד 5% | WATCH, NON-CORE, ו־REVIEW REQUIRED (עם דגל) | סטופ 2×ADR60 נקבע לפני הכניסה ולא מורחב. סיכון מתוכנן ≤0.3% מהתיק לעסקה (גאפ יכול להגדיל את ההפסד): גודל = הנמוך מבין 0.3% ÷ מרחק הסטופ לבין התקרה (EXTREME 2%, אחרות 3%). אין מיצוע, אין מעבר ל־CORE, לא עוברים דוח. רבעון הזול — הקשר בלבד |

**ETF מחוץ לשיטה (החלטה 4):** QQQ, SMH, SPMO, XLC, XLF, XLK, XLY, TQQQ, BITX מסומנים `OUTSIDE METHOD` ולא מופיעים בדפי ההחלטה. TQQQ ו־BITX לעולם לא חלק מהמדד.

**תקרת CORE לפי Risk Tier:** LOW/MEDIUM 10%, HIGH 6%, EXTREME 3%. CORE+TACTICAL במניה אחת: עד התקרה +2%. הדרגה קובעת גודל, לא עיתוי ולא איכות. ל־ETF אין תקרת CORE (`core_cap=None`).

**אינדיקטורים טכניים** (SMA, RSI, HH/HL, נפח, breakout, retest): הקשר בלבד. **נרות 5 דקות:** METHOD-frozen קובע "לבחירת רגע הכניסה ל־TACTICAL **בלבד**" (החלטת נועם; לא הוכח יתרון). **פער פתוח:** do-tab מחיל את מצב הנרות גם על SPECULATIVE (A-59, החלטה 4.11).

**בקרה רבעונית בלבד.** CORE מול VOO/SPY. TACTICAL מול Buy&Hold של אותן מניות מאותם מועדים אחרי עלויות; אחרי ≥6 חודשים **וגם** ≥30 עסקאות סגורות — אם מפגר, נסגר והכסף ל־CORE. SPECULATIVE נמדד בנפרד. כללים משתנים רק ברבעון. **כרגע אין יומן עסקאות** (החלטה 1), ולכן אין במערכת נתונים לבקרה הזו, לא מעקב מגבלות תיק (3 TACTICAL / 10%, SPEC 5%) ולא תזכורת יציאה לפוזיציות פתוחות. כל אלה בידי נועם (A-14, A-15).

**נקודות שנקבעו בדיון (13–14.10):**
- ירידה חדה היום אינה סיבה לדרג מניה גבוה — היא סימן לבדוק מה קרה.
- דוח שהתפרסם: "בדיקה אחרי דוח", לא איסור קנייה (מחקר הדוחות חלש — סעיף 14).
- שווי EXPENSIVE לא מבטל CORE; רק UNJUSTIFIABLE משאיר WATCH.
- גודל נקבע פעם אחת (Risk Tier) — לא מקטינים שוב בגלל "זהירות".
- נועם מחליט כמה כסף ומתי; המערכת לא מנהלת אחזקות.
- DATA STALE / EXTERNAL SOURCE REQUIRED מוצגים במפורש ולא חוסמים (החלטה 6). היום TSM, ASML ו־PLD מקבלות ACCELERATE TRANCHE עם הדגל.

**כללים שקיימים בקוד ולא כתובים בשיטה הקפואה** (ממתינים להכרעה):
- **בדיקה אחרי דוח:** מניה שדיווחה ב־3 הסשנים האחרונים וזזה מעל 2×ADR60 — שורת CORE מקבלת THESIS REVIEW, ושורות TACTICAL/SPEC מקבלות NO TRADE עד שהחלון נגמר (`post_report_review`, `state.py:236,247`). הסף 2×ADR60 והחסימה לא בשיטה; החסימה נעלמת לבד אחרי 3 סשנים (A-43, החלטה 4.10). ירידה חריגה **בלי** דוח לא מסומנת (A-44).
- **STATE STALE:** בחבילה ל־CHAT, כשהיום (ET) מאוחר מ־`acted_on_session`, כל ההחלטות הקצרות מסומנות `STATE STALE` (`pkg-tab.html:125,140`). זה כלל בטיחות של הדף, לא של השיטה.

---

## 2. מקורות נתונים והיררכיה

| נושא | מקור קובע | הערות |
|---|---|---|
| דוחות כספיים | **SEC EDGAR בלבד** (`data.sec.gov` companyfacts) | החלטת נועם 13.10: "מה שכתוב שם קדוש". Bigdata.com לא משמש יותר למספרים. לכל חברה `data_status`: OK / DATA STALE / EXTERNAL SOURCE REQUIRED (סעיף 4.4). היום 11 DATA STALE (ABT, C, CB, DUK, KO, MDLZ, NEE, PLD, SO, SPGI, V) ו־2 EXTERNAL (ASML, TSM). הסיבה ל־STALE: companyfacts עצמו מפגר (הדוח האחרון ב־API מאפריל–יולי 2026) — מגבלת סביבה |
| Quality | מסנן EDGAR (ברירת מחדל) + סקירה עסקית | סתירה בין התווית שהסוקר ראה לתווית EDGAR היום → REVIEW REQUIRED (החלטה 5). היום 0 סתירות |
| שווי (Valuation) | הסקירה (נכונה לתאריך הסקירה) + P/E ו־FCF yield יומיים מ־EDGAR ומהמחיר | הסימון מהסקירה מתעדכן רק בסקירה הבאה. P/E ו־FCF yield לא מחושבים ל־ASML/TSM (מטבע EUR/TWD) |
| Risk Tier | `core/risk_engine.csv` (5 שנים, ADR60 נכון ל־30.9.2026) | קפוא עד הסקירה הרבעונית; `tier_today` מחושב לידו מ־ADR60 של היום |
| Cheap Score / רבעון | `core/current_state.json` מהסגירה האחרונה | הקובץ הלילי האחרון גובר תמיד על כל Excel ישן |
| מחירים יומיים | `core/daily.csv.gz` (היסטוריה קפואה עד 2026-10-12) + `core/daily_new.csv` (ימים שנצברו מאז) + Release הנרות הלילי | הנרות מ־Alpaca SIP (DB הנרות); "סגירה" = נר 15:59, לא מחיר הסגירה הרשמי (A-40) |
| אישור פיצולים | Yahoo (chart events), ואם Yahoo נכשל — Alpaca corporate actions דרך ה־Worker (`/xa/alpaca_splits`) | Yahoo מחזיר 429 לרנרים של GitHub, ולכן בפועל Alpaca הוא המקור הראשי. מסלול Alpaca עוד לא הופעל בייצור (`splits.json` ריק) |
| נרות תוך־יומיים חיים | Yahoo (דרך `/bars`) | רק לטאב "מה לעשות היום" |
| דוחות קרובים | `api.nasdaq.com` (לוח דוחות) | תאריך + שעה (pre/after/unknown); תאריך לא מאושר יכול לזוז |
| חדשות | — | אין מנגנון אוטומטי. הדף מסמן THESIS REVIEW, לא מסיק |

---

## 3. הגדרות (תקציר)

ההגדרות המלאות, עם הפניה לשורת הקוד, ב־[`GLOSSARY.md`](GLOSSARY.md).

- **ADR60** = ממוצע (גבוה − נמוך) / סגירה של אותו יום, על 60 ימים, באחוזים. לא כולל גאפ של הלילה.
- **Risk Tier:** EXTREME אם ADR60 ≥ 4% או maxDD ≤ ‎-70%; HIGH אם ≥ 2.75% או ≤ ‎-50%; MEDIUM אם ≥ 1.6% או ≤ ‎-30%; אחרת LOW. maxDD = הירידה המקסימלית על סגירות מ־10/2021 (מ־`risk_engine.csv`; ל־TQQQ/BITX — מההיסטוריה שלהן).
- **SMA200 עולה** = SMA200 / SMA200 לפני 20 ימים − 1 > 0.
- **DD252** = סגירה / שיא הסגירות של 252 הימים הקודמים (בלי היום) − 1. **DD60** באותו אופן על 60. **D200** = סגירה / SMA200 − 1.
- **Cheap Score** = ממוצע (100 − אחוזון DD252) ו־(100 − אחוזון D200), כל אחוזון מול הערכים **הקודמים של אותה מניה** בלבד (מינימום 252). רבעונים: Q1 ≤ 25 (יקרה לעצמה) < Q2 ≤ 50 < Q3 ≤ 75 < Q4 (זולה לעצמה). **שמיש רק כש־SMA200 עולה.** ההיסטוריה מתחילה ב־10/2022 בערך, כך ש"זולה" פירושו "ביחס ל־4 השנים האחרונות" (הערכה).
- **יום חסר בתוך ההיסטוריה:** 13 ימי־סמל ב־2021–2022 (למשל 2022-03-08 ב־12 סמלים) חסרים במקורות. `state.py:120-125` ממלא יום חסר **בודד** בערך של היום הקודם (`ffill(limit=1)`), אף פעם לא את היום האחרון. בלי זה כל חלון מתגלגל שמכיל את היום הופך NaN, וכ־שנה של ערכי השוואה נמחקת. **הבדל מהמחקר:** המחקר לא מילא את הימים האלה (`r2-04#N3`); ההבדל ב־Cheap Score קטן מ־0.09 נקודות. פער של 2 ימים ומעלה ימולא רק ביומו הראשון (`r2-04#N1`; היום אין כזה).
- **P/E (EDGAR)** = שווי שוק ÷ רווח נקי של 4 רבעונים, רק כש־NI>0. **FCF yield** = (תזרים מפעילות − |capex|, 4 רבעונים) ÷ שווי שוק; None כשאין capex ברבעונים האחרונים, ו־None ל־17 סמלי FIN. **שווי שוק** = סגירה × מניות מדוללות אחרונות ÷ יחס ADR (TSM: 5). כל ה־TTM מיושרים לרבעון האחרון (`secutil.py:27-34,89-106`).

---

## 4. מסנן CORE (מכני, EDGAR)

קוד: `tools/core/screen_sec.py` (נעזר ב־`tools/core/secutil.py`). כללים: `core/CORE_RULES.md` (קפואים 13.10 לפני הניקוד; לא תואמים במלואם לקוד — A-73). פלט: `core/screen_sec.csv` (שורה לחברה: מדדים, PASS/FAIL לכל כלל, `label`, `prev_label`, `changed`, `note`, `balance_date`, `debt_date`, `data_status`).

### 4.1 התקופה הנמדדת
- ברירת מחדל: **TTM** — סכום 4 הרבעונים האחרונים כשהוא חדש מהשנה הכספית האחרונה. FY מופיע כשהשנה נסגרה זה עתה.
- 14 החברות שנמדדות היום על FY: ADP, ASML, C, COST, CSCO, INTU, KLAC, LRCX, MSFT, MU, PANW, PG, SMCI, TSM.
- **"TTM; 3y growth on FY"**: כשהרבעונים לא מגיעים 3 שנים אחורה, ה־TTM נשמר לכל הכללים, וצמיחת 3 השנים ושינוי המניות נמדדים על FY[-4]→FY[-1]. היום: ALAB, ARM, BLK, SHOP.
- **"FY fallback"**: כשאין גם TTM של לפני שנה — הכול על שנים. היום אף חברה.
- ספירת שנים (רווח, FCF חיובי) על 5 השנים הכספיות האחרונות (כולן אם פחות מ־5).

### 4.2 שישה מבחנים ותווית
**STD:** רווחיות (שולי רווח תפעולי ≥10% + רווח ב־4/5 שנים), תזרים (FCF חיובי + 4/5 שנים), תשואה על ההון (ROIC ≥10%, ROIC = רווח תפעולי × 0.79 ÷ (חוב + הון כולל NCI − מזומן)), מאזן (חוב נטו/EBITDA ≤3, כיסוי ריבית ≥5), צמיחה (CAGR 3 שנים ≥3% ושינוי שנתי ≥ ‎-5%), דילול (מניות +≤5% ב־3 שנים, SBC/הכנסות ≤15%).
**FIN** (17 סמלים: JPM BAC WFC C GS MS SCHW SOFI HOOD AXP CB PGR BRK-B BLK BX KKR COIN): רווח בכל השנים; ROE ≥10% על **הון בעלי המניות בלי NCI**; רווח תפעולי = רווח לפני מס (הריבית תפעולית בבנק); תזרים ומאזן n/a (עוברים).
**UTIL/REIT** (DUK, SO, NEE, PLD, AMT): תזרים מפעילות חיובי בכל השנים; חוב/EBITDA ≤6, כיסוי ≥2.
**תווית:** 0 כישלונות = CORE-ELIGIBLE; 1 = WATCH; 2+ = NON-CORE.

### 4.3 הגדרות EDGAR כפי שממומשות
- **מאזן מתאריך אחד** (`screen_sec.py:99-131`): `balance_date` = המאזן האחרון בטווח ‎-100/+10 יום מסוף התקופה הנמדדת (אחרת המאזן האחרון, והערה `BALANCE SHEET STALE`). הון, מזומן והשקעות קצרות נלקחים מאותו תאריך. **חוב:** מבין `debt_total`, `long_term_debt`, Noncurrent+Current (חלק שוטף רק אם בטווח 100 יום), `DebtInstrumentCarryingAmount` — ההגדרה עם הנתון **העדכני ביותר** (עד 400 יום), ובשוויון לפי סדר העדיפות; חוב קצר/CP נוסף אם בטווח 100 יום. אין נתון חוב בכלל → חוב 0 עם הערה `NO RECENT DEBT FIGURE` (16 חברות היום — `r2-02#N3`). חלק מהתגיות כוללות חכירה מימונית (A-52).
- **רווח תפעולי חסר:** STD = רווח לפני מס + ריבית; FIN = רווח לפני מס.
- **D&A** (`:136-146`): TTM של מושג `dna`. אין TTM נקי (Q4 לא נגזר) → ממוצע הרבעונים החיוביים ב־12 החודשים האחרונים × 4 (הערה `D&A estimated from n quarters`; 12 חברות היום — **ידוע:** מערבב תגיות `Depreciation` ו־DDA, `r2-02#N2`). **הפחתת בלתי מוחשיים** (`AmortizationOfIntangibleAssets`) נוספת ל־EBITDA **רק כשכל רבעוני 12 החודשים מתויגים `Depreciation`** (פחת בלבד). היום: ABBV, ABT, ADI, AVGO, IBM, INTC, INTU, MSFT, ORCL, SPGI (`15b1cfe`, אחרי ביקורת סבב 2).
- **מניות מדוללות:** חסרות → רווח נקי ÷ EPS מדולל, אחרת מספר המניות בעמוד השער (dei); בלי שום מספר → דילול נכשל (V, BRK-B — A-50). ערך קטן מ־1e5 → מוכפל ב־1e6 (MCD, `sec_facts.py:187-190`).
- **Sentinels:** ריבית חסרה → כיסוי **999** (עובר; 24 חברות). EBITDA ≤0 עם חוב נטו → **99**. הון מושקע ≤0 עם רווח תפעולי חיובי → ROIC **9.99**.
- **capex חסר:** במסנן FCF = OCF עם הערה `CAPEX NOT REPORTED…` (ב־state וב־P/E זה None — סתירה בתוך החבילה, `r2-03#N1`).

### 4.4 טריות הנתונים (`data_status`, `secutil.py:65-82`)
- `EXTERNAL SOURCE REQUIRED` — ASML, TSM (מגישי 20-F בלי רבעונים ב־XBRL).
- `DATA STALE` — סוף התקופה האחרונה בקובץ ישן ביותר מ־40 יום מהתקופה שמגיש בזמן היה צריך כבר לדווח (רבעון + 45 יום, סוף שנה + 90).
- `NO DATA` — אין תקופה.
- **התווית עדיין מחושבת ומוצגת** לצד הדגל (TSM, KO, SPGI, CB מוצגות CORE-ELIGIBLE). לפי החלטה 6 הדגל גלוי ולא חוסם.

### 4.5 תוצאה ובעיות ידועות
**תוצאה (`screen_sec.csv`, 14.10):** 47 CORE-ELIGIBLE / 42 WATCH / 31 NON-CORE. (סבב 1: 46/42/32; השינויים: ETN → WATCH, ABBV → CORE-ELIGIBLE, KKR → WATCH, MCD → CORE-ELIGIBLE על הסף 2.94.)

**על הסף (3.0):** MCD 2.94, MRSH 2.95, ETN 3.34.

**בעיות ידועות (פירוט בדוח סבב 2, סעיף 3):** GE/HON נכשלות בצמיחה בגלל ערבוב בצירי ספין־אוף (A-19, `r2-01#9`); HON — מניות ו־EPS לא עקביים ב־10-Q האחרון, P/E 8.0 (`r2-01#N3`); D&A מוערך מרבעונים בתגיות מעורבות; חלק שוטף של חוב לא נספר ב־15 חברות (`r2-02#6`); חוב 0 כשאין נתון (`r2-02#N3`); קנס stale תלוי תאריך (AVGO, `r2-01#N2`); ערכים חסרים (V, BRK-B, `int_cov=999`) — החלטה 4.13; `prev_label` תמיד זהה לתווית (`r2-02#N6`).

---

## 5. סקירת Quality (שיפוט עסקי)

פרוטוקול: `core/review/REVIEW_PROTOCOL.md`. 120 סקירות: `core/review/<T>.json`.
- **ברירת המחדל היא מסנן EDGAR** (`core/screen_sec.csv`; עודכן 14.10). כל שינוי הוא override עם נימוק אחד. NON-CORE עולה רק אם המדד לא מתאים למודל העסקי או שיש בעיית נתונים ברורה. רק שווי UNJUSTIFIABLE משאיר CORE-ELIGIBLE ב־WATCH.
- שדות: איכות, צמיחה, רווחיות במדד המתאים לענף, תזרים, מאזן, הקצאת הון, **שיא מחזורי (שאלה מפורשת)**, סיכונים מבניים, שווי (ATTRACTIVE / FAIR / EXPENSIVE / UNJUSTIFIABLE), דגלים אדומים, מקורות. בסקירות סבב 2: גם `review_round`, `default_source`, `previous_final`, `review_date`.
- **`excel_status`** = התווית שהסוקר ראה. בסקירות סבב 1 (86 קבצים) זו תווית מסנן Bigdata; בסקירות סבב 2 ו־2b (34 קבצים) — תווית EDGAR. היום כל 120 זהות לתווית EDGAR (השם מטעה — `r2-09#N9`).

### 5.1 סבבי הסקירה

| סבב | תאריך | מה | מול |
|---|---|---|---|
| 1 | 13.10 | 120 חברות | תווית Excel (Bigdata) — A-07 |
| 2 | 14.10 (`b941442`) | 25 החברות שהיו REVIEW REQUIRED (התווית שהסוקר ראה ≠ EDGAR) | מסנן EDGAR |
| 2b | 14.10 (`d9a9771`) | 12 חברות בבדיקת עקביות: T, VZ, TMUS, ADI, TXN, DE, SO, DUK, NEE, AMT, PLD, GILD | מסנן EDGAR, תקן מפורש לכל שאלה |

**התקנים של סבב 2b** (מופיעים בשדה `reason` ובשדות הנלווים בקבצים; אין להם עדיין קובץ הגדרה נפרד, והפרוטוקול לא עודכן בהם):
- **(a) צמיחה נמוכה מבנית:** כלל הצמיחה חל על כל ענף, כולל טלקום, כמו על PG/PEP/BMY/UNP שנשארו WATCH. "מאפייני ענף" אינם סיבה לעקוף אותו.
- **(b) "שפל מחזורי":** כשל צמיחה מנוטרל רק כש־EDGAR מראה ארטיפקט מחזורי — החלון מתחיל ליד שיא ויש בו ירידה, CAGR מ־FY20 עד TTM ≥3%, ו־YoY חיובי.
- **(c) REIT ויוטיליטי מפוקחות:** ROIC על הון בספרים מוחלף במדד הענפי — יוטיליטי: ROE ≥10%; REIT: צמיחת AFFO / Core FFO למניה ≥3% לשנה; יחד עם ND/EBITDA ≤6.
- **(d) IPR&D:** IPR&D שחוזר לא מאופס אלא ממוצע (רווח תפעולי ממוצע FY22–TTM).

**תוצאות סבב 2b:** T, VZ, TMUS: CORE → **NON-CORE** (a). ADI: CORE → **WATCH** (b; כשל ROIC נשאר). TXN, DE: נשארו CORE (b; ב־DE גם זרוע המימון). SO: נשארה CORE (c + b). DUK: CORE → **WATCH** (c; ROE 9.4%). NEE: נשארה WATCH (c; המאזן 6.45 נכשל). AMT: נשארה CORE "גבולי" (c; AFFO/מניה 3.3%; מתבטל אם ב־27.10 ההנחיה תרד או המינוף יעלה מעל 5x). PLD: נשארה CORE (c; Core FFO/מניה 4.0%). GILD: CORE → **WATCH** (d).

**סבב 2 וסבב 2b לא עברו ביקורת חוזרת** של צוות 9 אחרי שנכתבו (סבב 2 כן נבדק בדוח `r2_09`, סבב 2b לא).

### 5.2 מצב היום
- **Quality סופי:** 67 CORE / 38 WATCH / 15 NON-CORE. 32 overrides מברירת המחדל, כולם העלאות (עובדה).
- **REVIEW REQUIRED:** 0 (אין סתירה בין `excel_status` לתווית EDGAR באף חברה).
- **מגבלות שנאמרו במפורש:** הסקירה נוטה להעלות; עוגני עקביות מעגליים (NOW, QCOM, KKR, BLK — `r2-09#N6`); 9 סקירות סבב 1 ראו קבוצת כשלים שונה מזו של EDGAR, בלי דגל (`r2-09#N3`); ETN CORE על override שנשען על מספר שהמסנן לא משחזר (`r2-09#N4`); נתונים חיצוניים בסבב 2b (AFFO, FFO, ROE, ריבית זרוע המימון של DE) לא אומתו בביקורת.

### 5.3 REVIEW REQUIRED — המנגנון
- `state.py:230-231`: `conflict` = התווית שהסוקר ראה (`excel_status`, CORE-ELIGIBLE = CORE) שונה מתווית EDGAR היום.
- סתירה → `core_decision='REVIEW REQUIRED'` (נבדק **לפני** NO CORE), `route='SPECULATIVE'`, `review_required=true`. בדפים: "אין CORE ואין TACTICAL עד סקירה חדשה", ושורת SPECULATIVE בלבד עם הדגל.
- `quality_master.review_flag` = REVIEW REQUIRED לפי אותה השוואה מול `screen_sec.csv` (`build_core_data.py:123-125`).

---

## 6. צנרת הנתונים ולוח הרענון

### 6.1 Workflows (GitHub Actions)

| Workflow | מתי (UTC בקוד; ישראל בסוגריים) | מה | פלט |
|---|---|---|---|
| `nightly` | cron 21:00/22:00/23:00/01:00/03:00; guard מריץ פעם ביום (≈00:00 ישראל) | Alpaca SIP → `archive_bars` (60 יום), השוואה ותיקון, העתקה ל־`bars`, צוות אימות; FAIL פותח issue | DB הנרות (Supabase), `.github/audit/` |
| `export` | cron 23:30/00:30/01:30/03:30/05:30; guard: פעם לתאריך ישראל, 02–11 ישראל, אחרי שה־nightly סיים | כל נרות הדקה של כל הסמלים, zip | Release `candles-YYYY-MM-DD` (נשמרים 7 אחרונים) |
| `core-state` | `workflow_run` אחרי `export` **שהסתיים success** + גיבוי cron `0 8 * * *` + ידני. timeout ל־job: 30 דקות | הורדת ה־Release החדש → `earnings.py` (`continue-on-error`, timeout 8 דקות) → `state.py` → commit (rebase `-X theirs`, 5 ניסיונות, `exit 1` אם ה־push נכשל) | `core/earnings.json`, `core/current_state.json`, `core/current_state_latest.csv`, `core/daily_new.csv`, `core/splits.json`, `core/history/state_<date>.csv` |
| `sec-facts` | שבת 09:30 UTC + ידני (אפשר רשימת tickers). timeout 30 דקות | `sec_facts.py` → `screen_sec.py` → `build_core_data.py` → `build-view.mjs` → commit | `core/sec/*.json`, `core/screen_sec.csv`, `core/core_data.json`, `core/CORE_list.xlsx`, `view.js`, `VERSION` |
| `deploy` | push ל־main שמשנה `worker.js`, `view.js`, `v2_pipeline.js`, `v2_routes.js`, `archive_routes.js`, `wrangler.toml`, `migrations/**`; **`workflow_run` אחרי `sec-facts` שהסתיים success**; ידני | `wrangler deploy` | Worker |

**ידוע:**
- export שה־guard שלו דילג מסתיים success, ולכן core-state רץ שוב ובונה מאותו Release ומייצר commit (A-37, `r2-05#N4`).
- `state.py` לא רץ בסוף `sec-facts`; תווית EDGAR החדשה נכנסת למצב הלילי רק בריצת core-state הבאה (A-30).
- Release שמתקן close ב־0.5% ומעלה ליום שכבר ב־`daily_new.csv` → mismatch, exit 2, אין commit, והמצב נתקע עד תיקון ידני של `daily_new.csv`. אין issue אוטומטי (`r2-05#N3`).
- `-X theirs` ב־rebase דורס בשקט עריכה ידנית מקבילה באותם קבצים, כולל `splits.json` (`r2-05#N5`, `r2-10#N4`).
- `tools/core/fill_gaps.py` **לא מתוזמן** (הוסר מהצנרת ב־`041cf98`, אחרי ש־Alpaca החזיר נרות "שטוחים" לימים החסרים). הקובץ נשאר בריפו בלי שימוש.

### 6.2 `state.py` — הזרימה
1. קורא את `daily.csv.gz` ואת `daily_new.csv` (ימים אחרי ההיסטוריה הקפואה).
2. ממיר את נרות הדקה של ה־Release (09:30–15:59) לנרות יומיים. דקות כפולות נספרות (`duplicate_minute_bars_in_release`).
3. אם ה־Release מתחיל אחרי הסשן הבא של ההיסטוריה (קפואה + שנצברה) → `sys.exit('gap…')`.
4. **בדיקת חפיפה יום־יום** (`:55-68`): close של ה־Release מול ההיסטוריה; סטייה >0.5% ביום כלשהו = mismatch (exit 2), חוץ ממקרה של פיצול לפני סוף ההיסטוריה הקפואה (יחס קבוע, >20%, כל הימים השונים לפני כל התקינים) → `history_presplit_adjusted` (היום APH).
5. **צבירה:** ימי ה־Release שאחרי ההיסטוריה הקפואה מחליפים/מוסיפים ל־`daily_new.csv` (ה־Release גובר בחפיפה).
6. **פיצולים** (`:77-108`): פער לילי `close(t-1)/open(t)` מחוץ ל־(0.83, 1.2) הוא מועמד. אישור רק ממקור (`yahoo.splits`: Yahoo, ואז Alpaca דרך ה־Worker, אירוע בטווח ±4 ימים). פער שנראה כיחס פיצול נקי ואין אישור, ועברו פחות מ־5 סשנים → `no split (recheck)`, נבדק שוב בכל ריצה ומוריד את `ok`. אחרת → `no split` סופי. פיצול מאושר מחלק את המחירים שלפני התאריך ומכפיל את הנפח.
7. מילוי יום חסר בודד בתוך ההיסטוריה (סעיף 3).
8. מדדים, דוחות, Quality, החלטות, health, שמירה (סעיפים 7–9).

### 6.3 טריות כל מאגר

| מאגר | קובץ | מי מייצר | מתי מתעדכן | מי צורך |
|---|---|---|---|---|
| היסטוריה יומית קפואה | `core/daily.csv.gz` | ידני (מחקר); זהה ל־`daily_adj.pkl` | **קפוא עד 2026-10-12** | `state.py` |
| ימים חדשים (מצטבר) | `core/daily_new.csv` | `state.py` | כל ריצת core-state | `state.py` (נקרא בכל ריצה) |
| פיצולים | `core/splits.json` (`{"SYM": [[date, factor]], "_checked": {...}}`) | `state.py` | כל ריצה (מצטבר) | `state.py`. היום ריק |
| מצב נוכחי | `core/current_state.json`, `core/current_state_latest.csv` | `state.py` | כל לילה אחרי export (+ 08:00 UTC). **הערכה:** בדרך כלל מוכן 07:00–11:00 ישראל, לפני הפתיחה | `/core/state`, `/core/state.csv`, טאב מצב היום, טאב החבילה, do-tab, `build_core_data.py` |
| צילומי מצב | `core/history/state_<YYYY-MM-DD>.csv` | `state.py` | כל ריצה; ריצה חוזרת לאותו תאריך דורסת | `/core/file/history`, טאב החבילה (ספירה בלבד) |
| לוח דוחות | `core/earnings.json` | `earnings.py` | כל ריצת core-state. חלון ‎-25/+75 ימים קלנדריים מהתאריך בניו יורק. נשמר הקובץ הקודם אם >20 ימים נכשלו או נמצאו <60 סמלים | `state.py`, `/core/file/earnings.json`, טאב החבילה |
| דוחות EDGAR | `core/sec/<T>.json`, `_report.json`, `_tags.json` | `sec_facts.py` | שבת 09:30 UTC | `screen_sec.py`, `state.py` (דרך `secutil`), `build_core_data.py` |
| מסנן EDGAR | `core/screen_sec.csv` | `screen_sec.py` | שבת, אחרי sec_facts | `state.py` (`Excel_label`, `Screen_fails`, `conflict`), `build_core_data.py` |
| נתוני דף `/core` | `core/core_data.json`, `core/CORE_list.xlsx` | `build_core_data.py` | שבת, ובכל עדכון סקירות; מוטמעים ב־`view.js` בבנייה ונפרסים אחרי sec-facts | `build-view.mjs` → `/core`; `state.py` (Review_final), `earnings.py` ו־`screen_sec.py` (רשימת הסמלים) |
| סקירות | `core/review/<T>.json` | ידני (Claude) | 13.10 (סבב 1), 14.10 (סבבים 2 ו־2b) | `state.py`, `build_core_data.py` |
| Risk Engine | `core/risk_engine.csv` | ידני (מחקר) | קפוא (ADR60 של 30.9.2026); רק בסקירה רבעונית | `state.py` |
| יומן עסקאות | `core/trade_log.json` | — (הנתיב סגור) | **מושבת** (החלטה 1); הקובץ ריק | `/core/file/trade_log.json` (פתוח לקריאה) |
| כללי המסנן | `core/CORE_RULES.md` | ידני | קפוא 13.10 (A-73) | `build_core_data.py` (גיליון Rules) |

---

## 7. `current_state` — עמודות

שורה לכל אחד מ־131 הסמלים (120 מניות + 11 ETF), נכון לסגירה של `date`. קוד: `tools/core/state.py:185-265,306-307`. אחוזים כשברים (0.05 = 5%), חוץ מ־ADR60 (באחוזים).

**שדות בראש הקובץ:** `date` (סשן המצב, `LASTD`), `acted_on_session` (הסשן שבו פועלים לפיו = סשן ה־NYSE הבא אחרי `date`), `earnings_built`, `health`, `built`, `history_frozen_to`, `release` ([ראשון, אחרון]), `symbols`, `incomplete`, `overlap_mismatch`, `splits`, `rows`.

| עמודה | משמעות |
|---|---|
| `symbol`, `kind`, `etf_role` | סמל; `stock` או `ETF`; ל־ETF: `INDEX` (VOO, SPY) או `OUTSIDE METHOD` (השאר); null למניות |
| `close` | סגירה (נר אחרון של הסשן הרגיל, 15:59) |
| `chg1`, `chg5`, `chg20`, `chg60` | שינוי 1/5/20/60 ימי מסחר (בחבילה: `return_1d/5d/20d/60d`) |
| `SMA20`, `SMA50`, `SMA200`, `dist_SMA20`, `dist_SMA50` | ממוצעים ומרחק מהם |
| `slope200`, `sma200_rising` | SMA200/SMA200 לפני 20 ימים − 1; האם > 0 |
| `DD60`, `DD252`, `D200` | ראו סעיף 3 |
| `Cheap_Score`, `Cheap_Quartile`, `cheap_usable` | ראו סעיף 3; `cheap_usable` = יש רבעון וגם SMA200 עולה |
| `quartile_5_sessions_ago`, `quartile_21_sessions_ago` | הרבעון כפי שהיה מחושב לפני 5 ו־21 סשנים (חיתוך הסדרה, בלי look-ahead) |
| `ADR60`, `stop_2xADR60` | באחוזים; 2×ADR60 כשבר |
| `Risk_Tier`, `core_cap` | דרגה קפואה מ־risk_engine.csv; תקרת CORE לפי הדרגה. None ל־ETF |
| `tier_today` | הדרגה לפי ADR60 של היום ו־maxDD הקפוא (או מההיסטוריה כשאין). מידע בלבד |
| `Excel_label`, `Screen_fails` | (השם היסטורי) תווית **מסנן EDGAR** מ־`screen_sec.csv` והכללים שנכשלו |
| `Review_final` | Quality מהסקירה (CORE/WATCH/NON-CORE); ריק ל־ETF |
| `review_required`, `screen_review_conflict` | אותו ערך: התווית שהסוקר ראה ≠ תווית EDGAR היום |
| `valuation_review`, `review_reason`, `cyclical_peak` | שווי מהסקירה; נימוק הסקירה; המילה הראשונה בשדה cyclicality |
| `pe_ttm`, `fcf_yield_ttm`, `market_cap`, `valuation_note` | ראו סעיף 3; הערה כשלא חושב (למשל "capex not reported…", "reports in TWD…", "no share count", "shares tagged in millions, scaled") |
| `fundamentals_status`, `fundamentals_end` | `OK` / `DATA STALE` / `EXTERNAL SOURCE REQUIRED` / `NO DATA`, וסוף התקופה האחרונה ב־EDGAR. null ל־ETF |
| `next_earnings`, `next_earnings_time`, `earnings_time` | הדוח הבא שהתגובה אליו עוד לא במחירים; pre/after/unknown; BMO/AMC/UNKNOWN. דוח בסוף שבוע או בחג ממופה לסשן הבא, BMO |
| `days_to_earnings` | סשני NYSE מ־`date` (לא כולל) עד יום הדוח (כולל) |
| `short_exit_by` | הסשן האחרון שבו מותר להחזיק TACTICAL/SPEC: AMC → יום הדוח; BMO/UNKNOWN → הסשן הקודם |
| `short_max_hold_days` | min(20, סשנים מ־`acted_on_session` עד `short_exit_by` כולל); 0 אם `short_exit_by` כבר עבר; 20 כשאין דוח הבא |
| `short_blocked` | טקסט חסימה כשנשאר לכל היותר סשן אחד (`hold ≤ 1`): "report … exit by …, no new short-term entry" |
| `earnings_status` | ראו GLOSSARY §6. כולל `NEXT REPORT DATE NOT IN THE CALENDAR…` כשאין דוח הבא ועברו יותר מ־40 סשנים מהדוח האחרון |
| `last_earnings`, `last_earnings_time`, `move_since_last_report` | הדוח האחרון שהתגובה אליו כבר במחירים; התנועה מהסגירה שלפני יום התגובה עד `close` |
| `post_report_review` | true כשהתגובה לדוח האחרון ב־3 הסשנים האחרונים (כולל `date`) ו־|`move_since_last_report`| > 2×ADR60. לכל מניה (`15b1cfe`) |
| **נוספו 20.10.2026** (שום עמודה קודמת לא שונתה או הוסרה) | |
| `SMA150`, `dist_SMA150`, `sma150_rising` | ממוצע 150 סגירות; מרחק ממנו; שיפוע 20 ימים > 0 |
| `RSI2` | RSI(2) בהחלקת Wilder על סגירות |
| `index_rsi2_accelerate` | ב־VOO/SPY בלבד: SPY מעל SMA200 וגם RSI(2) של SPY < 10 → מקדימים את מנת המדד הבאה (החלטה 20.10) |
| `vol60_d`, `vol_fcst_20d` | תנודתיות יומית close-to-close של 60 ימים; תחזית GARCH(1,1) (variance targeting, התאמה בחיפוש רשת על 1,000 התשואות האחרונות) לתנודתיות היומית הממוצעת ב־20 הסשנים הבאים |
| `ADR_fwd`, `stop_fwd`, `tier_fwd` | ADR60 × `vol_fcst_20d` ÷ `vol60_d` (באחוזים); 2×ADR_fwd כשבר — **הסטופ של SPECULATIVE מ־20.10**; הדרגה לפי ADR_fwd (מידע; `Risk_Tier` הקפוא לא השתנה) |
| `post_report_direction`, `post_report_blocks_short` | `up`/`down` כש־`post_report_review`; חוסם TACTICAL/SPECULATIVE רק כשהכיוון למטה (החלטה 20.10) |
| `ytd_return`, `tax_loss_window`, `tax_loss_candidate` | תשואה מתחילת השנה; האם 18.12–10.1; מועמדת = ירדה מעל 20% מתחילת השנה ותשואת דצמבר מתחת לחציון הרשימה (ב־1–10.1 נמדד לפי 20.12) |
| `rev_yoy_last_q`, `rev_yoy_prev_q`, `sales_accel` | צמיחת הכנסות שנתית ברבעון האחרון ובקודם (EDGAR); האצה = עלייה מעל 5 נקודות, תקפה עד 140 יום מסוף הרבעון |
| `route` | `CORE+TACTICAL` (Review_final=CORE ואין סתירה), `SPECULATIVE` (כל מניה אחרת), `ETF` |
| `core_decision` | לפי הסדר (`state.py:233-238`): ETF → `INDEX (45%)` (VOO/SPY) או `OUTSIDE METHOD`; סתירה → `REVIEW REQUIRED`; Review_final ≠ CORE או שווי UNJUSTIFIABLE → `NO CORE`; דוח אחרון ב־3 סשנים ותנועה >2×ADR60 → `THESIS REVIEW`; Q3/Q4 ו־SMA200 עולה → `ACCELERATE TRANCHE`; אחרת `NORMAL SCHEDULE` |
| `last_day_complete` | ליום האחרון יש לפחות `full_bars − 10` נרות דקה (380 ביום רגיל, 200 ביום מקוצר) |

**מצב היום (`current_state.json` של `d9a9771`):** `date` 2026-10-13, `acted_on_session` 2026-10-14, `health.ok=true`. `core_decision`: NO CORE 53, NORMAL SCHEDULE 46, ACCELERATE TRANCHE 20, THESIS REVIEW 1 (JNJ), INDEX (45%) 2, OUTSIDE METHOD 9. `route`: CORE+TACTICAL 67, SPECULATIVE 53, ETF 11. `short_blocked`: ASML, BAC, BLK, MRSH, MS, PGR, PLD, SCHW, TSM. `post_report_review`: C, JNJ.

---

## 8. בדיקות תקינות (`health`)

מחושבות בכל ריצה (`state.py:266-295`) ומוצגות בטבלת DATA_HEALTH בטאב החבילה (`pkg-tab.html:156-187`, 22 שורות). OK/WARN/INFO מחושבים בדף.

| בדיקה (שם בדף) | שדה ב־health | תנאי OK | חלק מ־`ok`? |
|---|---|---|---|
| כל 131 הסימולים קיימים | `symbols_in_state`, `symbols_expected` (131 קבוע), `missing_symbols` | שווים ואין חסרים | `missing_symbols` כן |
| המצב מהיום הנכון | `state_date`, `acted_on_session`, `expected_last_session`, `state_is_current` | `state_date ≥ expected_last_session` (לפי לוח NYSE: בסשן לפני 18:00 ET — הסשן הקודם; בסשן אחרי 18:00 — היום; ביום סגור — הסשן האחרון) | כן |
| יום אחרון מלא לכל סימבול | `incomplete_last_day`, `full_day_bars_expected` | ריק | כן |
| אין ימים חסרים (60 סשנים, לפי לוח NYSE) | `missing_days_last_60` | ריק | כן |
| אין סימבול תקוע | `stuck_close_5_sessions` | ריק (סגירה זהה 5 ימים) | כן |
| אין נפח אפס ביום האחרון | `zero_volume_last_day` | ריק | לא |
| נפחים סבירים | `volume_over_5x_avg` | INFO בלבד | לא |
| תנועה יומית מעל 25% | `one_day_move_over_25pct` | ריק (WARN בדף) | **לא** |
| מחירים תואמים להיסטוריה | `overlap_mismatch_vs_history` | ריק (סטייה יומית ≤0.5%) | כן, ו־exit 2 |
| פיצולים שאושרו ותוקנו | `splits_confirmed_after_history` | INFO | לא |
| מועמדי פיצול שלא אושרו | `split_candidates_unconfirmed` | ריק (כולל `no split (recheck)` ו־"Yahoo unreachable") | כן |
| פערים גדולים שנבדקו ואינם פיצול | `large_gaps_checked_no_split` | INFO | לא |
| היסטוריה שכבר מותאמת לפיצול | `history_presplit_adjusted` | INFO | לא |
| אין נרות דקה כפולים | `duplicate_minute_bars_in_release` | ריק | כן |
| לוח הדוחות טרי (עד 36 שעות) | `earnings_calendar_built`, `earnings_calendar_age_hours`, `earnings_calendar_fresh`, `earnings_failed_days`, `earnings_not_found` | גיל ≤36 שעות | `earnings_calendar_fresh` כן; `earnings_not_found` לא |
| נתוני דוחות עדכניים (EDGAR) | `fundamentals_not_ok` | ריק (WARN בדף; היום 13) | לא |
| אין lookahead ב־Cheap Score | `cheap_score_lookahead` | **מחרוזת קבועה, לא בדיקה** | לא |
| Risk Tier קפוא מול היום | `risk_tier_frozen_vs_today` | INFO | לא |
| לוח דוחות: סימולים שנמצאו | (מ־`earnings.json`) | ≥100 מתוך 120 | לא |
| EDGAR: לכל 120 החברות יש תקופה | (מ־quality_master) | 120 שורות עם `EDGAR_period` | לא |
| סקירה: סתירות מסנן↔סקירה | (ספירת REVIEW REQUIRED) | INFO | לא |
| תקין בסך הכול | `ok` | `state_is_current` וגם `earnings_calendar_fresh`, ואין missing_symbols / incomplete / stuck / mismatch / unconfirmed / כפולים / ימים חסרים | — |

שדה נוסף שלא מוצג בדף: `interior_one_day_gaps_carried_forward` (היום 13). **לא נבדק כיום:** מספר ימי החפיפה בין ה־Release להיסטוריה (`r2-05#N7`), ספירת סמלים מול רשימה (`symbols_expected` קבוע).

---

## 9. `core/history` — צילומי מצב

- `state.py:308-309` כותב בכל ריצה `core/history/state_<date>.csv` — שורות ה־current_state, **אחרי** הוספת `quartile_5/21_sessions_ago`.
- ריצה חוזרת לאותו תאריך דורסת את הקובץ (A-66), כך שזה לא צילום נקודתי של הריצה הראשונה.
- הרשימה זמינה ב־`/core/file/history`, וקובץ בודד ב־`/core/file/history/state_YYYY-MM-DD.csv`. טאב החבילה מציג רק את מספר הקבצים והאחרון.
- היום יש שני קבצים: `state_2026-10-12.csv`, `state_2026-10-13.csv`.

---

## 10. הדפים

### 10.1 `/core` (`core.html` + `pkg-tab.html`)

הדף סטטי: `core_data.json` ו־`CORE_list.xlsx` מוטמעים ב־`view.js` בזמן הבנייה (`build-view.mjs`). המצב הלילי נטען חי מ־`/core/state`. כפתור "הורד Excel" מוריד את `CORE_list.xlsx` המוטמע (6 גיליונות: List, Review, Data, Quarters, Rules, Raw_EDGAR).

| טאב (`#hash`) | מה מוצג | מקור |
|---|---|---|
| מצב היום (`#state`) | 42 עמודות מ־current_state (כולל REVIEW REQUIRED, נתוני דוחות, SMA20/50, שעת דוח, מצב דוח, יציאה קצרה); סינון לפי Quality/תווית/דרגה/רבעון/שמיש/SMA200; CSV | `/core/state`, `/core/state.csv` |
| רשימה (`#list`) | תווית מסנן EDGAR, 6 הכללים, סיבת כישלון, תקופה, Risk Tier, Cheap Score, Quality סופי | `core_data.list` |
| סקירה (`#review`) | 120 הסקירות | `core_data.review` |
| נתונים (`#data`) | המדדים שעליהם נמדד המסנן, כולל `data_status` ו־`balance_date` | `core_data.data` |
| רבעונים (`#quarters`) | 12 הרבעונים האחרונים לכל חברה (ASML ו־TSM בלי רבעונים): הכנסות, צמיחה מול רבעון מקביל, רווח תפעולי ומרווח, רווח נקי, EPS מדולל, FCF (ריק כשאין capex), ו־TTM | `core_data.quarters` |
| כללים (`#rules`) | `CORE_RULES.md` | `core_data.rules` |
| נתונים גולמיים (`#raw`) | כל תקופה מ־EDGAR, ביחידות מלאות | `core_data.raw` |
| חבילה ל־CHAT (`#pkg`) | סעיף 11 | `/core/state`, `/core/file/*`, `core_data.quality_master` |

**ידוע (A-60):** בטאב מצב היום חסרות `tier_today`, `route`, `etf_role`, `post_report_review`, `acted_on_session`; "חושב" מוצג ב־UTC.

### 10.2 `/bars` → טאב "מה לעשות היום" (`do-tab.html`)

`do-tab.html` מוזרק ל־`archive-bars.html` (marker `<!--DO_TAB-->`) ע"י `build-view.mjs`. נטען בלחיצה על הטאב. קורא `/core/state` ונרות דקה של היום מ־Yahoo (`window.__yahooRows`), ומתרענן כל 3 דקות כשהטאב פתוח.

- **שורות:** מסלול CORE+TACTICAL → שורת CORE + שורת TACTICAL; כל מניה אחרת (WATCH, NON-CORE, REVIEW REQUIRED) → שורת SPECULATIVE; VOO/SPY → שורת INDEX (`INDEX SCHEDULE`, מנות לפי לוח). שאר ה־ETF לא מוצגים.
- **החלטת CORE:** `core_decision` מהמצב הלילי; THESIS REVIEW גם כשהדף מזהה דוח אחרי המצב שהתנועה החיה בו מעל 2×ADR60, או כש־`post_report_review`.
- **ימי החזקה וחסימה** (`do-tab.html:111-115`): כשהיום הוא `acted_on_session` — מהמצב (`short_max_hold_days`); אחרת מחושב מהיום לפי לוח חגי NYSE 2026–2028 (זהה ל־`nyse.py`), ו־+1 רק אם היום סשן. חסום אם `short_exit_by` עבר או נשאר לכל היותר סשן אחד.
- **TACTICAL:** THESIS REVIEW → NO TRADE; חסום → NO TRADE ("חייבים להיות בחוץ עד סגירת X"); אחרת מצב הנרות, עם "יציאה: +6% / N ימי מסחר" ותאריך היציאה לפני הדוח. רבעון הזול — הקשר בלבד.
- **SPECULATIVE:** בדיקה אחרי דוח → NO TRADE; חסום → NO TRADE ("לא מחזיקים SPECULATIVE דרך דוח"); אחרת מצב הנרות, עם סטופ 2×ADR60 (גם במחיר), גודל `min(0.3%/סטופ, 2%|3%)` ותאריך היציאה לפני הדוח.
- **מצב נרות** (סשן רגיל, בלי הנר שעוד נוצר): אין נרות → WAIT FOR OPEN; לא היום → WAIT FOR OPEN; עלתה מעל סגירת המצב + ADR60 → DON'T CHASE; פחות מ־30 דקות → WAIT; אין pullback (השפל לא אחרי השיא או טווח < ½ADR) → LIMIT OK; שפל חדש ב־15 דקות → WAIT FOR STABILIZATION; ≥30 דקות בלי שפל + "שפל גבוה יותר" + מעל VWAP → ENTRY NOW; אותו דבר מתחת ל־VWAP → WAIT FOR RECLAIM. **ידוע:** "שפל גבוה יותר" כמעט תמיד מתקיים (A-47); התוויות נראות כאות (A-48); אין מצב "NO DATA" (A-71).
- **הקשר שוק:** שינוי SPY/QQQ ו"מול SPY" לכל מניה. תנועה חריגה מול השוק → "לבדוק מה קרה, לא סיבה לקנות". כרטיס הסבר לכל מניה שמוצגת בטבלה.
- **מסנן ברירת מחדל** "רק מה שדורש תשומת לב": ACCELERATE, THESIS, ENTRY NOW, WAIT*, DON'T CHASE, WAIT FOR OPEN, LIMIT OK, ו־REVIEW REQUIRED. **לא כולל** את שורות INDEX (`r2-07#N6`).
- **מצב לא עדכני:** באנר אדום "המצב הלילי לא עדכני" כש־`health.state_is_current=false` או כשהיום (ET) מאוחר מ־`acted_on_session`, גם בלי נרות חיים. ההחלטות עצמן לא מסומנות STATE STALE (בשונה מהחבילה); החסימות מחושבות מול היום. בלי נרות מוצג "השוק סגור" גם בזמן מסחר (`r2-10#N5`).
- **מגבלות:** כללי הנרות לא נבדקו היסטורית; הדף לא קורא חדשות; לא מזכיר פוזיציות פתוחות (A-15); יציאה ביום מקוצר (27.11, 24.12) לא מציינת שהסגירה ב־13:00 (`r2-06#N5`).

---

## 11. טאב החבילה ל־CHAT (`pkg-tab.html`)

מטרה: כל מה ש־CHAT ביקש (מפרט החבילה) במקום אחד. נרות דקה **לא** בחבילה — ניתנים ידנית מ־`/bars` (הורדה מרובה). **יומן העסקאות והסקירה הרבעונית מושבתים** (החלטה 1): הפונקציות `T_log`/`T_quarter` והטופס קיימים בקוד, אבל אין להם כפתור, והטופס לא נגיש.

### 11.1 טבלת הרענון ("רוענן לאחרונה", `pkg-tab.html:302-318`)

| שורה | נכון ל־ | רוענן (שעון ישראל) | תדירות | מקור |
|---|---|---|---|---|
| מצב נוכחי (נרות יומיים) | `state.date` | `state.built` | כל לילה אחרי ייצוא הנרות + 08:00 UTC | נרות שמורים |
| לוח דוחות | חלון earnings | `earnings.built` | כל לילה | api.nasdaq.com |
| Quality Master — מסנן EDGAR | `edgar_fetched` | `core_data.built` | כל שבת | SEC EDGAR |
| Quality Master — סקירה עסקית | `reviews_date` (2026-10-14) | — | ידני, רבעוני | דוחות + חדשות |
| טבלת החלטה / תמונה חודשית | `state.date` | `state.built` | נגזר מהמצב | חישוב בדף |
| DATA_HEALTH | `health.state_date` | `health.checked` | כל לילה | state.py |
| צילומי מצב | הקובץ האחרון | מספר קבצים | כל לילה | core/history |
| נרות דקה | — | ידני | לפי צורך | /bars |
| הדף נטען | עכשיו | עכשיו | | |

### 11.2 שש הטבלאות

| טבלה (CSV / גיליון) | עמודות | הערות |
|---|---|---|
| `decision_table` | Rank, Symbol, Quality (או `REVIEW REQUIRED (Final → EDGAR …)` / `INDEX ETF`), route, Risk (+ "היום X" כש־tier_today שונה), Valuation (ATTRACTIVE→CHEAP, + `fundamentals_status` כשאינו OK), Cheap (רבעון, ציון, שמיש/לא), Today (`chg1`), Earnings (`earnings_status`), Intraday (טקסט קבוע "ידני מנרות דקה"), decision, entry condition | **שורה לכל מסלול:** CORE → שורת CORE (`core_decision`, תנאי, דגלים, והערה "דוח …: CORE מותר להחזיק דרך דוח" כש־`days_to_earnings ≤ 1`) + שורת TACTICAL; אחרת שורת SPECULATIVE (סטופ, גודל, ו־"REVIEW REQUIRED: אין CORE ואין TACTICAL" כשרלוונטי); VOO/SPY → שורת `INDEX (45%)`. **החלטה קצרה** (TACTICAL/SPEC), לפי הסדר: היום (ET) > `acted_on_session` → `STATE STALE`; `post_report_review` → NO TRADE; `short_blocked` → NO TRADE; אחרת `CANDLES NEEDED`. מיון: THESIS → REVIEW REQUIRED → ACCELERATE → NORMAL → INDEX → NO CORE, ובתוך קבוצה לפי Cheap Score שמיש |
| `current_state_<date>` | symbol, date, close, SMA20, SMA50, SMA200, slope200, distance_SMA20, distance_SMA50, distance_SMA200 (=D200), DD60, DD252, D200, Cheap_Score, Cheap_Quartile, cheap_usable, sma200_rising, ADR60_pct, Risk_Tier, tier_today, stop_2xADR60, core_cap, return_1d/5d/20d/60d, quartile_5/21_sessions_ago, kind, etf_role, route, review_required, fundamentals_status, fundamentals_end, valuation_note, EDGAR_label, Review_final, core_decision, valuation_status, pe_ttm, fcf_yield_ttm, market_cap, next_earnings_date, earnings_time, days_to_earnings, earnings_status, short_exit_by, short_max_hold_days, short_blocked, acted_on_session, last_day_complete | כל עמודות החובה של CHAT |
| `earnings_calendar` | symbol, next_earnings_date, earnings_time, days_to_earnings, status, flag, short_exit_by, last_earnings_date, last_earnings_time, move_since_last_report, route, Review_final | מניות בלבד, ממוין לפי ימים לדוח. `flag`: `REPORT TODAY` (status "must already be out" או "REPORTED AFTER CLOSE"), `REPORT TOMORROW` ("exit short-term positions by the close"), `REPORTED RECENTLY`, `NO DATE IN CALENDAR`, `WITHIN 5 SESSIONS` |
| `quality_master` | 36 עמודות: symbol, name, EDGAR_label, EDGAR_fails, EDGAR_period, **data_status**, EDGAR_fetched, Review_final, review_flag, valuation_status, review_date, cyclicality, thesis, override, override_reason, red_flags, structural_risks, growth_note, profitability_note, fcf_note, balance_note, capital_allocation_note, revenue_m, rev_cagr3, rev_yoy, op_margin, net_income_m, fcf_m, roic, roe, nd_ebitda, int_cov, share_chg3, sbc_rev, data_notes, sources | נבנה ב־`build_core_data.py:118-133`. סכומים במיליונים **במטבע הדיווח** (אין עמודת מטבע). 999/99/9.99 הם sentinels. `fcf_m` = OCF כשאין capex (`r2-03#N1`) |
| `data_health` | check, status (OK/WARN/INFO), value, details | סעיף 8 |
| `monthly_snapshot_<YYYY-MM>` | section, item, value, details | ספירות Quality, תווית EDGAR, מסלול, Risk Tier קפוא ושל היום, רבעונים (כולם ושמישים), החלטות CORE; שינויי רבעון ב־21 וב־5 סשנים; ביצועי מניות מסלול CORE (שווה משקל, 20 ו־60 ימים, חציון, VOO, SPY ופער מול VOO); REVIEW REQUIRED; נתוני דוחות לא עדכניים; "אין יומן עסקאות כרגע". **דיווח בלבד, לא קלט להחלטה** |

### 11.3 הורדות
- **CSV לכל טבלה** (6 כפתורים): `<name>__downloaded_YYYY-MM-DD_HHMM.csv` (שעון ישראל), UTF-8 עם BOM, CRLF. **ידוע:** אין escape לתאים שמתחילים ב־`= + - @` (A-32; בנתונים האמיתיים אין כאלה).
- **Excel של כל החבילה:** `CHAT_package_<state date>__downloaded_YYYY-MM-DD_HHMM.xlsx`, נבנה בדפדפן עם SheetJS 0.18.5 מ־cdnjs. **8 גיליונות:** README (שעת הורדה, תאריך מצב, "לשימוש בסשן" + אזהרה כשהמצב לא עדכני, טבלת הרענון, רשימת גיליונות, יחידות), decision_table, current_state, earnings_calendar, quality_master, data_health, monthly_snapshot, method (כללי השיטה). **ידוע:** אם `/core/state` נכשל יורד Excel של 3 גיליונות (README, quality_master, method) בלי אזהרה (A-31); גיליון `method` לא כולל את החלטות 14.10 (`r2-00#N5`).
- **`/core/state.csv`** (מטאב מצב היום) — `current_state_latest.csv` כמו שהוא, בשם קבוע `current_state.csv`.

### 11.4 יומן עסקאות — מושבת
- `POST /core/log` מחזיר **410** בלי תנאי (`worker.js:1902-1904`, `15b1cfe`): "the trade log is disabled (decision 14.10…)". קוד הכתיבה ל־GitHub נשאר אחרי ה־return, ואינו נגיש.
- `GET /core/file/trade_log.json` פתוח לקריאה; הקובץ `core/trade_log.json` ריק (`{"updated": null, "entries": []}`).
- הריפו **ציבורי**: אם יוחלט להפעיל יומן, צריך קודם אחסון פרטי (A-01, A-28 חוזרים אחרת).

---

## 12. נתיבי Worker של CORE

| נתיב | מה | הרשאה |
|---|---|---|
| `GET /core` | הדף (`CORE_HTML` מתוך view.js) (`worker.js:1939`) | פתוח |
| `GET /core/state` | `core/current_state.json` מ־main דרך GitHub API (או raw.githubusercontent אם אין GH_TOKEN). 503 אם לא זמין (`:1876-1884`) | פתוח |
| `GET /core/state.csv` | `core/current_state_latest.csv`, מצורף כ־`current_state.csv` | פתוח |
| `GET /core/file/<name>` | רק `earnings.json`, `trade_log.json`, `history` (רשימת קבצים), `history/state_YYYY-MM-DD.csv` (regex מעוגן, `:1886-1899`) | פתוח |
| `POST /core/log` | **410** — היומן מושבת (`:1902-1904`) | — |
| `GET /auth` | `{key_required}` (`:1942`) | פתוח |
| `GET /xa/alpaca_splits?symbol=&start=&end=` | אירועי פיצול מ־Alpaca corporate actions, מועבר כמו שהוא (`archive_routes.js:387-399`). משמש את `yahoo.splits` כש־Yahoo נכשל. הסמל עובר `validSym`, התאריכים `YYYY-MM-DD`; `BRK-B` נשלח מהצנרת כ־`BRK.B` | פתוח (בלי מפתח ובלי מטמון — `r2-10#N3`) |
| `GET /xa/alpaca_daily?symbol=&start=&end=` | נרות יומיים מותאמים לפיצול מ־Alpaca SIP (אותו בלוק). משמש את `yahoo.daily`, שאין לו היום קורא מתוזמן (רק `fill_gaps.py`) | פתוח (כנ"ל) |

כל התגובות `Cache-Control: no-store`; כל קריאה ל־`/core/state` ו־`/core/file/*` פונה ל־GitHub API עם ה־PAT (A-35).

---

## 13. קבצים בריפו

`core/` — CORE_RULES.md, CORE_list.xlsx, core_data.json, current_state.json, current_state_latest.csv, daily.csv.gz, daily_new.csv, splits.json, risk_engine.csv, earnings.json, screen_sec.csv, trade_log.json (ריק), history/, sec/ (120 קבצי EDGAR + `_tags.json`, `_report.json`), review/ (120 סקירות + REVIEW_PROTOCOL.md).

`tools/core/`:
| קובץ | תפקיד |
|---|---|
| `sec_facts.py` | שליפה מ־SEC companyfacts → `core/sec/<T>.json` |
| `screen_sec.py` | המסנן המכני → `core/screen_sec.csv` |
| `build_core_data.py` | `core/core_data.json` + `core/CORE_list.xlsx` |
| `secutil.py` | עזרים משותפים ל־`state.py` ו־`screen_sec.py`: TTM מיושר לרבעון האחרון, מניות מדוללות (כולל תיקון מיליונים), `data_status`, שווי שוק/P/E/FCF yield, יחס ADR |
| `nyse.py` | לוח NYSE: חגים (לפי כללי Rule 7.2 + סגירות חד־פעמיות), ימים מקוצרים (13:00), `next_session`/`prev_session`/`sessions_between`/`sessions`/`full_bars` |
| `yahoo.py` | נרות יומיים ואירועי פיצול: Yahoo, ואם נכשל — Alpaca דרך ה־Worker (`/xa/alpaca_daily`, `/xa/alpaca_splits`) |
| `earnings.py` | לוח הדוחות מ־Nasdaq → `core/earnings.json` |
| `state.py` | המצב הלילי, health, צילומי מצב |
| `fill_gaps.py` | השלמת ימים חסרים ב־`daily.csv.gz` מ־Yahoo/Alpaca. **לא מתוזמן** מאז `041cf98`; נשאר בריפו |

דפים: core.html, pkg-tab.html, do-tab.html, archive-bars.html; `build-view.mjs` מטמיע אותם ב־view.js.
אינדקס מלא: [`README.md`](README.md).

**קוד המחקר** (בסיס סעיף 14) **לא בריפו**: הוא נמצא רק בתיקייה זמנית של sandbox, `/tmp/claude-0/hist/` (A-26, לא תוקן).

---

## 14. מה המחקר הראה (5 שנים, 129 מניות) — בסיס השיטה, אחרי ביקורת צוות 8 (סבב 1)

צוות 8 לא הורץ בסבב 2. לפי החלטה 7 (14.10), בעיית LONG Q4>Q1 היא חולשה בהערכת המחקר ולא באג בייצור; הסימונים כאן נשארים.

| ממצא | ניסוח מקורי | סטטוס אחרי הביקורת |
|---|---|---|
| **שיטת המבנה** (LL→HL→breakout→retest) | אין יתרון מול כניסה אקראית באותו יום (‎-$1.56 לעסקה, CI [‎-4.22, +1.09]) | **נתמך** (שוחזר). survivorship מטה לטובת השיטה, אז הכישלון חזק עוד יותר |
| **8 משפחות תזמון** | רק אחת (F7) עברה Discovery ונכשלה ב־Validation | **נתמך**. ("F8 breakout מזיק" כנראה מנופח בחלקו — לא לצטט) |
| **SWING** (דירוג Ridge, 20 יום) | נכשל; אין טריגר TACTICAL מוכח | **נתמך** (D10−D1 ב־Validation ‎-1.60%) |
| **LONG Cheap Score: Q4 > Q1** | Q4 עדיף על Q1 בכל התקופות כולל holdout (+9.1%), מדגם קטן, מרוכז ב־HIGH/EXTREME → overlay בלבד | **שנוי במחלוקת / לא הוכח.** ה־Verdict הרשמי היה INCONCLUSIVE. LONG_EDGE מנכה ממוצע של אותה מניה באותה שנה כולל ימים **לפני** האירוע (look-ahead). עם baseline מימים שאחרי האירוע ההפרש מתהפך ב־Discovery+Validation. בתשואה גולמית ומול SPY, Q4 לא ניצח את Q1 באף תקופה (holdout: Q4 ‎-22.0% מול SPY, Q1 ‎+3.1%). Q4: n=5/19/17 באשכולות זמן; ב־MEDIUM Q4=Q1; Q3 לא עדיף על Q2 (A-09, A-10). הכלל (Q3/Q4 מקדימים מנה) נשאר בהחלטה 2 |
| **ירידה חדה** | אחרי נרמול לתנודתיות אין קפיצה חזרה (‎-0.15% ל־10 ימים) | **ניסוח מוחלש:** אין ראיה לקפיצה חזרה, **וגם לא נשללה** (SE ~0.5–0.6%). המסקנה המעשית (ירידה ≠ סיבה לקנות) סבירה |
| **ירידה מתונה ב־pre** (0.5–1σ) | ‎+0.12% עד הסגירה — קטן מהעמלה | נתמך; לא בשימוש |
| **דוחות** (25 מניות, 490 דוחות) | תנועה ממוצעת 5.1% ביום התגובה; אחרי ירידה >8% — ‎-1.2% ל־5 ימים, ‎-1.75% ל־42 ימים → אזהרה, לא כלל | **נתמך כחלש** (n=49). תנודה ביום הדוח (5.05% מול 1.35%) — **חזק**, ומצדיק יציאה לפני דוח |
| **ליבה+טקטי 2022–2026** | טקטי ≈ החזקה אחרי מס; סטופים פגעו | **נבדקו כללים אחרים** (יעד +5%, טריגר מומנטום, 40 מניות שנבחרו בדיעבד). כללי ה־TACTICAL הקפואים **לא נבדקו** |
| **Bigdata מול EDGAR** | 90% מהערכים זהים ב־1% | 90.2% מ־4,444 זוגות — נכון, אבל לא הושוו חוב, מזומן, ריבית, SBC ו־EBITDA, ו־20 מתוך 120 תוויות השתנו במעבר |
| **כלל ההפסקה של TACTICAL** | — | **הערכה (צוות 8):** אחרי 30 עסקאות ה־SE כ־1.35% לעסקה; ההכרעה תיקבע ברובה ע"י רעש. החלטה 4.15 (לסקירה הרבעונית) |

**ריבוי השוואות:** התוכנית הריצה עשרות עד מאות השוואות; התוצאה החיובית היחידה (LONG) עברה בקושי.
**מגבלות כלליות:** יקום של היום (survivorship); אין דוחות כספיים point-in-time, ולכן המסנן לא נבדק לאחור. קוד המחקר לא מגורסן (A-26). הייצור ממלא 13 ימים חסרים שהמחקר לא מילא (סעיף 3).

---

## 15. בעיות ידועות

הרשימה המלאה: [`AUDIT-2026-10-14-round2.md`](audit/AUDIT-2026-10-14-round2.md) (סעיפים 3 ו־6). כאן מה שמשפיע ישירות על השימוש היומי.

### 15.1 גבוה
| נושא | מה לדעת בזמן שימוש | מזהה |
|---|---|---|
| קוד המחקר | לא בריפו; אי אפשר לשחזר את §14 אם ה־sandbox נעלם | A-26 |
| מגבלות תיק | אין מונה ל־3 TACTICAL / 10%, SPEC 5%, תקרה +2%, לוח מנות. היום 20 ACCELERATE ו־67 שורות TACTICAL — האכיפה כולה בידי נועם | A-14 (החלטה 1) |
| פוזיציות פתוחות לפני דוח | אין תזכורת. `short_exit_by` של כל מניה מוצג, אבל המערכת לא יודעת מה מוחזק | A-15 (החלטה 1) |
| תיקונים שלא נבדקו | גבולות הזמן של לוח הדוחות, בדיקה חוזרת של פיצולים, STATE STALE בחבילה, הפחתה ב־EBITDA, סקירות 2b — נכנסו אחרי ביקורת סבב 2 | סעיף 5 בדוח סבב 2 |

### 15.2 בינוני
| נושא | מה לדעת | מזהה |
|---|---|---|
| פיצולים | פיצול שאף מקור לא מאשר 5 סשנים נרשם "אין פיצול" לצמיתות, והמניה תיראה כנפילה (Q4 → ACCELERATE). לבדוק כל פער לילי ≥17% ב־`large_gaps_checked_no_split`. `one_day_move_over_25pct` לא מוריד את `ok` | A-24, `r2-05#N1`, `#N2` |
| מצב תקוע | תיקון מחיר ב־Release ליום שכבר נצבר עוצר את הבנייה (exit 2) עד תיקון ידני של `daily_new.csv` | `r2-05#N3` |
| דוח בלי תאריך | האזהרה רק אחרי 40 סשנים מהדוח האחרון (COST, MU בנובמבר) | A-17, `r2-06#N4` |
| ימים מקוצרים | 27.11 ו־24.12: "עד סגירת X" בלי לציין 13:00 | `r2-06#N5` |
| do-tab במצב לא עדכני | באנר בלבד; ההחלטות לא מסומנות STATE STALE | A-39 |
| בדיקה אחרי דוח | חוסמת TACTICAL/SPEC 3 סשנים ונעלמת לבד; ירידה בלי דוח לא נבדקת (VZ) | A-43, A-44 (החלטה 4.10) |
| מספרי EDGAR | GE/HON (צמיחה), HON (מניות/EPS, P/E 8.0), ETN/AMGN/BMY (D&A מוערך), חוב 0 ב־16 חברות, FCF=OCF בגיליון Data | A-19, `r2-01#N3`, `r2-02#N2`, `#N3`, `r2-03#N1` |
| סקירות | ETN CORE על override שלא משוחזר; עוגני עקביות מעגליים; 9 סקירות עם קבוצת כשלים שונה | `r2-09#N3`, `#N4`, `#N6` |
| Excel החבילה | יורד חלקי (3 גיליונות) בלי אזהרה כש־`/core/state` נכשל | A-31 |
| נתיבי Alpaca | `/xa/alpaca_*` פתוחים בלי מפתח ובלי מטמון; ניצול מכסה יכשיל את אישור הפיצולים | `r2-10#N3` |
| גודל ה־bundle | `CORE_HTML` 2.61MB; כ־1.1MB מרווח עד 3MB (הערכה, אם החשבון Free) | A-34 |

---

## 16. יומן החלטות

- 13.10 — השיטה הוקפאה (TACTICAL 10%, מעבר ל־CORE רק במקום מתוכנן, כלל עצירה 6 חודשים וגם 30 עסקאות).
- 13.10 — SPECULATIVE: EXTREME עד 2%, אחרות 3%.
- 13.10 — מסנן מכני + סקירה; CORE-ELIGIBLE במקום CORE למסנן.
- 13.10 — WATCH נסחרת רק כ־SPECULATIVE.
- 13.10 — נרות 5 דקות לביצוע TACTICAL (נועם); אין ניהול אחזקות.
- 13.10 — SEC EDGAR מקור יחיד לדוחות.
- 14.10 — Q3 וגם Q4 מקדימות מנה; TACTICAL מותר גם כשהדוח קרוב מ־20 ימים (רק יוצאים לפניו); דוח = בדיקה ולא איסור.
- 14.10 — דף "מה לעשות היום" בטאב של /bars; טאב "חבילה ל־CHAT" ב־/core; טאב "רבעונים".
- 14.10 — המסנן: TTM נשמר גם כשהרבעונים לא מגיעים 3 שנים אחורה (ALAB, ARM, BLK, SHOP).
- 14.10 — ביקורת סבב 1 (11 צוותים). דוח: `docs/audit/AUDIT-2026-10-14.md`.
- 14.10 — `POST /core/log` סגור כשאין `API_KEY` (`d2865fa`).
- **14.10 — שבע החלטות הבעלים:**
  1. **אין יומן עסקאות כרגע.** מעקב מגבלות תיק ותזכורת לפוזיציות פתוחות — לא ממומשים (תלויים ביומן).
  2. **Q3 ממשיך להקדים מנת CORE** (כלל קפוא; ייבחן בסקירה הרבעונית).
  3. **Q3/Q4 לא שער ל־TACTICAL/SPECULATIVE;** הרבעון הקשר בלבד שם.
  4. **רק VOO/SPY הם חלק המדד;** QQQ/SMH/XLK/XLF ושאר ה־ETF מחוץ לשיטה; TQQQ ו־BITX לעולם לא.
  5. **REVIEW REQUIRED:** אין CORE ואין TACTICAL עד סקירה חדשה; SPECULATIVE מותר עם דגל ברור.
  6. **ASML/TSM וחברות עם נתוני EDGAR ישנים:** `DATA STALE` / `EXTERNAL SOURCE REQUIRED` גלוי, בלי fallback שקט.
  7. **LONG Q4>Q1** היא חולשה בהערכת המחקר, לא באג בייצור של Cheap Score.
- 14.10 — תיקוני סבב 1 (`502e0e1` ו־`411fc25`): דוחות לפי סשן (לוח NYSE, BMO/AMC, תאריך ניו יורק, בלי מחיקה בכשל); צבירת `daily_new.csv`; פיצול רק באישור מקור; בדיקת חפיפה יום־יום; EDGAR: יחידות, קנס לתגיות ישנות, Q4/YTD מאותה תגית (או סביר ⅓×–3×), מניות MCD, מאזן מתאריך אחד, רווח תפעולי ב־FIN, ROE על הון בלי NCI, הפחתה ב־EBITDA, DATA STALE / EXTERNAL; REVIEW REQUIRED לכל מניה; INDEX = VOO/SPY; בלי שער Q3/Q4; שורה לכל מסלול; deploy אחרי sec-facts; workflows נכשלים כשה־push נכשל.
- 14.10 — סקירות סבב 2 (`b941442`): 25 חברות מול EDGAR; הפרוטוקול: ברירת המחדל = `core/screen_sec.csv`; המסנן: D&A מוערך מרבעונים כשאין TTM נקי.
- 14.10 — Worker: `/xa/alpaca_daily`, `/xa/alpaca_splits`; הצנרת עוברת ל־Alpaca כש־Yahoo מחזיר 429 (`ea7fc00`).
- 14.10 — 13 הנרות שהושלמו מ־Alpaca בוטלו (נרות "שטוחים"); `state.py` ממלא יום חסר בודד בערך הקודם; `fill_gaps.py` הוסר מהצנרת (`041cf98`).
- 14.10 — ביקורת סבב 2 (10 צוותים; צוות 8 לא הורץ — החלטה 7). דוח: `docs/audit/AUDIT-2026-10-14-round2.md`.
- 14.10 — תיקונים אחרי סבב 2 (`15b1cfe`, לא נבדקו מחדש): בדיקה חוזרת של מועמדי פיצול ביחס נקי (5 סשנים); `BRK.B` ל־Alpaca; לוח הדוחות מוגבל בזמן (12 שניות, 2 ניסיונות, עצירה אחרי 8 כשלים רצופים, 8 דקות לשלב, 30 ל־job) ובכיסוי (<60 סמלים → הקובץ הקודם נשמר); `POST /core/log` → 410; הפחתה רק כשה־D&A הוא פחת בלבד; בחבילה: STATE STALE, `post_report_review` לכל מניה, הערת דוח בשורת CORE; ב־do-tab: חגי NYSE בספירת ימים, באנר מצב לא עדכני גם בלי נרות.
- 14.10 — סבב סקירות 2b (`d9a9771`, לא נבדק מחדש): 12 חברות, תקנים (a)–(d) (סעיף 5.1). T, VZ, TMUS → NON-CORE; ADI, DUK, GILD → WATCH; TXN, DE, SO, AMT, PLD נשארו CORE; NEE נשארה WATCH.
- **20.10 — החלטת נועם: יישום ממצאי מחקר השיטות (19–20.10) בשיטה**, מחוץ לסקירה הרבעונית ובמפורש לבקשתו. בסיס: `claude/finding-*` ו־`methods_backtest_results_2026-10-20.xlsx` (בדיקה על מניות S&P לפי הרכב המדד בכל תאריך, IS 2016–20 / OOS 2021–26; SPY 1993+).
  1. **סטופ SPECULATIVE = 2×ADR_fwd** (תחזית GARCH במקום הטווח של 60 ימים בלבד). עדות: GARCH ניצח תנודתיות היסטורית מחוץ למדגם (SPY ‎-24% QLIKE, t 4.3; 5 מניות ‎-4% עד ‎-18%); טווח יומי (כמו ADR60) היה גרוע מתנודתיות היסטורית (t ‎-3.6). תחזית טובה יותר **לא** שיפרה תשואה — רק את דיוק הסיכון. `stop_2xADR60` נשאר ומוצג; תרחישי הדף נשארו על ADR60 (כך נבדקו).
  2. **מנת מדד מוקדמת כש־RSI(2) של SPY < 10 מעל SMA200.** עדות: B+ (t 4.7 IS, 2.8 OOS); אחרי תיקון כניסה בפתיחה למחרת ≈1.5. משנה רק עיתוי בתוך 8 השבועות.
  3. **אחרי דוח שזז מעל 2×ADR60 למעלה — TACTICAL/SPECULATIVE לא נחסמים** (למטה — כמו קודם). CORE THESIS REVIEW לא השתנה. עדות: PEAD t 2.0 OOS, האצת מכירות t 2.1/2.1 (B/B+).
  4. **דגלים בלי סמכות:** האצת הכנסות (M184, B+), חלון מכירות מס 18.12–10.1 (M484, B+, 226 עסקאות ב־OOS), ממוצע 150, RSI(2).
  - אף אחד מאלה לא שרד תיקון לריבוי בדיקות (FDR) חוץ מתחזית התנודתיות. כלל ה־TACTICAL עצמו (+6% / 20 ימים / לפני דוח) עדיין לא נבדק היסטורית.

## 17. פתוח

**החלטות שממתינות לנועם** (פירוט: דוח סבב 2, סעיף 4):
1. THESIS REVIEW / בדיקה אחרי דוח: חוסם או "REVIEW FIRST"; הרחבה לירידות בלי דוח (4.10).
2. נרות גם ל־SPEC (4.11); תוויות הנרות (4.12).
3. סקירות שנשארו מהרשימה (4.8): CRWD/DDOG, CVX, MRVL, BRK-B, ETN, עוגני עקביות, כלל IPR&D אחיד; ולרשום את התקנים (a)–(d) ב־`REVIEW_PROTOCOL.md`.
4. לסקירה הרבעונית: Q3 מקדים מנה (4.2), ערכים חסרים (4.13), כללי מגזר (4.14), סף לכלל ההפסקה (4.15), Risk Tier על ADR60 של יום אחד (4.16).
5. אם יוחלט להפעיל יומן: אחסון פרטי (4.1), ואז מגבלות תיק ותזכורות (4.5).

**תיקוני קוד ותפעול פתוחים:** ביקורת חוזרת (סבב 3) של `15b1cfe` ו־`d9a9771`; העברת קוד המחקר לריפו (A-26); "סגירה 13:00" בימים מקוצרים; סף 30 סשנים לאזהרת "אין תאריך"; פיצול כפול ומצב תקוע בצנרת; ממצאי EDGAR בדוח סבב 2 (סעיף 3.2); גיליון `method` עם החלטות 14.10; Excel חלקי; הגנה ומטמון ל־`/xa/alpaca_*`; מנגנון חדשות (אין).
