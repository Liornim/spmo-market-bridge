# מילון מונחים — מערכת CORE (עודכן 14.10.2026)

כל הגדרה כאן היא **מה שהקוד עושה בפועל**, עם הפניה לקובץ ולשורה (נכון ל־HEAD של 14.10.2026, אחרי `d2865fa`). כשהקוד שונה מהשיטה הקפואה או מהתיעוד, זה כתוב במפורש, עם מזהה ממצא מ־[`audit/AUDIT-2026-10-14.md`](audit/AUDIT-2026-10-14.md).

מוסכמות: אחוזים בקבצים נשמרים כשבר (0.05 = 5%), חוץ מ־ADR60 ו־maxDD שנשמרים באחוזים. "ימי מסחר" בקוד = ימי חול בלבד, **בלי חגי NYSE** (A-38). כל הקבצים בנתיבים יחסיים לשורש הריפו.

---

## 1. השיטה והשכבות

| מונח | הגדרה | מקור |
|---|---|---|
| **סדר ההחלטה** | QUALITY → ALLOCATION → RISK → PRICE → EXECUTION. איכות קובעת מסלול; הקצאה קובעת שכבה; סיכון קובע גודל; מחיר קובע קצב/תזמון; ביצוע = נרות | METHOD-frozen (פרויקט); CORE_SYSTEM.md §1 |
| **CORE (שכבה)** | 85% מהתיק: כ־45% VOO/SPY וכ־40% מניות שה־Review_final שלהן CORE. בנייה ב־3 מנות 40/30/30 תוך 8 שבועות; אין סטופ; מותר להחזיק דרך דוח | METHOD-frozen |
| **TACTICAL** | עד 10% מהתיק, רק מניות Review_final=CORE, עד 3 במקביל. יציאה במוקדם מבין +6%, 20 ימי מסחר, או לפני דוח (`short_exit_by`). בלי סטופ, בלי מיצוע | METHOD-frozen; state.py:177 (`route`) |
| **SPECULATIVE (SPEC)** | עד 5% מהתיק, מניות WATCH/NON-CORE. סטופ 2×ADR60 שנקבע לפני הכניסה; גודל = min(0.3% ÷ סטופ, תקרה); תקרה EXTREME 2%, אחרות 3%. לא עוברים דוח | METHOD-frozen; do-tab.html:123 |
| **מנה (tranche) / 40/30/30** | בניית פוזיציית CORE בשלוש מנות: 40%, 30%, 30% מהיעד, תוך 8 שבועות. **אין בקוד לוח מנות או מעקב אחריו** (A-14) | METHOD-frozen; pkg-tab.html:63 (שדה `tranche` ביומן) |
| **INDEX / חלק המדד** | ~45% מהתיק ב־VOO/SPY. **בקוד:** כל 11 ה־ETF מקבלים `core_decision='ETF / INDEX'` וב־pkg-tab "חלק מ־45% VOO/SPY" — כולל TQQQ ו־BITX (A-13) | state.py:124,157; pkg-tab.html:120 |
| **ETF** | הקבוצה הקבועה: VOO, SPY, XLF, XLY, QQQ, XLC, XLK, SPMO, SMH, TQQQ, BITX. אין להם Review_final, P/E או דוחות | state.py:124 |
| **CHAT** | ChatGPT, השותף לשיטה. "החבילה ל־CHAT" = טאב `#pkg` ב־`/core` | pkg-tab.html |
| **סקירה רבעונית** | הבקרה היחידה שמותר בה לשנות כללים: CORE מול VOO/SPY; TACTICAL מול B&H אחרי עלויות; SPEC בנפרד | METHOD-frozen |
| **כלל ההפסקה של TACTICAL (kill rule)** | אחרי ≥6 חודשים **וגם** ≥30 עסקאות TACTICAL סגורות: אם TACTICAL מפגר אחרי B&H — נסגר והכסף ל־CORE. **בקוד:** חודשים = (עכשיו − כניסת ה־TACTICAL הסגורה הראשונה) ÷ 30.4 ימים; "מפגר" = סכום `trade_minus_bh` < 0; בלי עלויות (A-46) | pkg-tab.html:208-213 |

## 2. איכות (Quality) ומסנן EDGAR

| מונח | הגדרה | מקור |
|---|---|---|
| **EDGAR / companyfacts** | ה־API של SEC (`data.sec.gov/api/xbrl/companyfacts/CIK##########.json`). המקור היחיד לדוחות כספיים מאז 13.10 | sec_facts.py:1-14 |
| **מסנן EDGAR (screen)** | 6 כללים מכניים על נתוני EDGAR, לפי `CORE_RULES.md`. פלט `core/screen_sec.csv` | screen_sec.py |
| **CORE-ELIGIBLE** | תווית מסנן: 0 כללים נכשלו. "מועמדת" — CORE סופי רק אחרי סקירה | screen_sec.py:151 |
| **WATCH** | (1) תווית מסנן: בדיוק כלל אחד נכשל. (2) ערך Review_final: לא בבעלות CORE; מסלול SPECULATIVE בלבד | screen_sec.py:151; state.py:177 |
| **NON-CORE** | (1) תווית מסנן: 2 כללים או יותר נכשלו. (2) ערך Review_final; מסלול SPECULATIVE בלבד | screen_sec.py:151 |
| **CORE (Quality)** | ערך Review_final: החברה מאושרת לבעלות 3–5 שנים. מסלול CORE+TACTICAL | state.py:177 |
| **Review_final** | ה־Quality הסופי מהסקירה העסקית (`final_quality` ב־`core/review/<T>.json`), דרך העמודה "Quality סופי (סקירה)" ב־core_data.json. ריק ל־ETF | build_core_data.py:43; state.py:115-116,150 |
| **`Excel_label`** (עמודה ב־current_state) | **שם היסטורי**: מכיל את תווית **מסנן EDGAR** מ־`screen_sec.csv`. בחבילה נקרא `EDGAR_label` | state.py:122,184; pkg-tab.html:96 |
| **`excel_status`** (שדה בקובץ סקירה) | התווית שהסוקר ראה בזמן הסקירה — מסנן ה־Excel/Bigdata הישן, **לא** EDGAR (A-07) | core/review/*.json; state.py:153 |
| **`prev_label`** | התווית מריצת core_data הקודמת (לא בהכרח מה שהסוקר ראה); `changed` = שונה ממנה | screen_sec.py:64-67,152 |
| **EDGAR_label / EDGAR_fails / EDGAR_period / EDGAR_fetched** | בחבילה (quality_master): תווית המסנן; הכללים שנכשלו (בעברית); "`TTM`/`FY` `<end>`"; תאריך השליפה מ־SEC | build_core_data.py:127-128 |
| **REVIEW REQUIRED** | התווית שהסוקר ראה (`excel_status`, CORE-ELIGIBLE=CORE) שונה מתווית EDGAR היום. **שני מקומות:** (1) `review_flag` ב־quality_master — לכל סתירה (21 היום); (2) `core_decision='REVIEW REQUIRED'` ב־current_state — **רק כש־Review_final=CORE** (13 היום), כי `qual != 'CORE'` נבדק קודם (A-08) | build_core_data.py:124-125; state.py:153-154,158,161 |
| **`screen_review_conflict`** | true כשיש סתירה כנ"ל (21 היום) | state.py:154,194 |
| **override** | שינוי של הסוקר מברירת המחדל (התווית שראה), עם נימוק אחד (`reason`). כל 37 ה־overrides היו העלאות | REVIEW_PROTOCOL.md; build_core_data.py:129 |
| **מחלקות: STD / FIN / UTIL/REIT** | FIN (17): JPM BAC WFC C GS MS SCHW SOFI HOOD AXP CB PGR BRK-B BLK BX KKR COIN. UTIL/REIT (5): DUK SO NEE PLD AMT. כל השאר STD | screen_sec.py:12-13,73 |
| **6 הכללים** | `profit` (שולי רווח תפעולי ≥10% + רווח נקי חיובי ב־≥4/5 שנים; FIN: רווח בכל השנים), `cash` (FCF>0 + ≥4/5 שנים; FIN עובר; UTIL: OCF>0 בכל השנים), `returns` (ROIC≥10%; FIN: ROE≥10%), `balance` (ND/EBITDA≤3 וכיסוי ריבית≥5; FIN עובר; UTIL: ≤6 ו־≥2), `growth` (CAGR 3 שנים ≥3% וגם yoy ≥ ‎-5%), `dilution` (שינוי מניות 3 שנים ≤5% וגם SBC/הכנסות ≤15%). ערך חסר = כשל (A-50) | screen_sec.py:14,138-148 |
| **TTM** | Trailing Twelve Months: סכום 4 רבעונים רצופים (≤380 יום מתחילת הראשון לסוף האחרון). במסנן — התקופה הנמדדת כשהיא חדשה מה־FY האחרון | screen_sec.py:17-28,81-82 |
| **FY** | שנה כספית (תקופה של 340–380 יום מ־10-K/20-F/40-F). `latest_kind=FY` כשה־FY הוא התקופה החדשה ביותר (14 חברות) | sec_facts.py:101; screen_sec.py:82 |
| **"TTM; 3y growth on FY"** | (14.10) כשה־TTM של לפני שנה קיים אבל לא של לפני 3 שנים: נשאר TTM, וה־CAGR ושינוי המניות ל־3 שנים נמדדים על FY[-4]→FY[-1]. ALAB, ARM, BLK, SHOP | screen_sec.py:84-86,123-127 |
| **FY fallback** | כשגם ה־TTM של לפני שנה חסר: הכול על שנים. אף חברה כרגע | screen_sec.py:87-89 |
| **`latest_end`, `ttm_end`** | סוף התקופה הנמדדת במסנן. `ttm_end` ב־`sec/<T>.json` נדרס ע"י המושג האחרון בלולאה ואינו אמין (A-22) | screen_sec.py:82; sec_facts.py:162 |
| **Q4 נגזר (derived)** | רבעון רביעי = FY − (Q1+Q2+Q3). גם Q2/Q3 נגזרים מנתוני YTD. **ידוע:** כשהתגיות או הבצירים שונים יוצא רבעון שלילי או אבסורדי (A-19) | sec_facts.py:106-126 |
| **ROIC** | רווח תפעולי × 0.79 ÷ (חוב + הון כולל NCI − מזומן והשקעות קצרות). מכנה ≤0 ורווח חיובי → **9.99** (sentinel) | screen_sec.py:94-95,131 |
| **ROE** (FIN) | רווח נקי ÷ הון כולל NCI (A-51) | screen_sec.py:132 |
| **ND/EBITDA** | (חוב − מזומן) ÷ (רווח תפעולי + D&A). חוב נטו ≤0 → 0; EBITDA ≤0 עם חוב נטו → **99** | screen_sec.py:105,133 |
| **כיסוי ריבית (`int_cov`)** | רווח תפעולי ÷ הוצאות ריבית. ריבית חסרה/0/שלילית → **999** (עובר) | screen_sec.py:134 |
| **חוב (debt)** | התגית הראשונה הזמינה: `debt_total` → `long_term_debt` → Noncurrent+Current → `DebtInstrumentCarryingAmount`, ועוד חוב קצר/CP. לוקח את הנקודה האחרונה של כל תגית בלי יישור תאריכים (A-05); חלק מהתגיות כוללות חכירה מימונית (A-52) | screen_sec.py:96-103 |
| **`share_chg3`** | מניות מדוללות בסוף התקופה ÷ לפני 3 שנים − 1, אחרי ניחוש פיצולים (יחס קרוב למספר שלם). חסר → כשל | screen_sec.py:49-62,121,134 |
| **`sbc_rev`** | SBC ÷ הכנסות של התקופה. SBC חסר = 0 | screen_sec.py:135 |
| **`rev_cagr3`, `rev_yoy`** | צמיחת הכנסות שנתית ממוצעת ל־3 שנים; שינוי מול לפני שנה | screen_sec.py:127-128 |
| **quality_master** | טבלה של 35 עמודות לכל חברה: EDGAR + סקירה (הקובץ ש־CHAT ביקש) | build_core_data.py:117-133 |

## 3. שווי (Valuation)

| מונח | הגדרה | מקור |
|---|---|---|
| **`valuation_review` / `valuation_status`** | המילה הראשונה בשדה `valuation` של הסקירה: ATTRACTIVE / FAIR / EXPENSIVE / UNJUSTIFIABLE. בחבילה ATTRACTIVE מוצג כ־**CHEAP** (מיפוי בדפדפן) | state.py:135; pkg-tab.html:84 |
| **UNJUSTIFIABLE** | שווי שאי אפשר להצדיק. הסיווג היחיד שחוסם CORE (`core_decision='NO CORE'`) | state.py:159 |
| **EXPENSIVE** | יקר אבל ניתן להצדקה. **לא** חוסם CORE | REVIEW_PROTOCOL.md |
| **`pe_ttm`** | סגירה × מספר המניות המדוללות האחרון (רבעוני או שנתי; אחרת dei) ÷ רווח נקי TTM. רק כש־NI>0. **ידוע:** MCD (מניות במיליונים), TSM (ADR ×5), מטבע לא מומר (A-04, A-23) | state.py:88-106 |
| **`fcf_yield_ttm`** | (OCF TTM − |capex TTM|) ÷ שווי שוק. capex חסר נספר 0 (A-22). None ל־FIN | state.py:105,137 |
| **`market_cap`** | סגירה × מניות מדוללות אחרונות (מותאם לפיצולים שזוהו אחרי תאריך הספירה) | state.py:100-102 |
| **`cyclicality` / `cyclical_peak`** | שאלת הסקירה: האם הרווחים ליד שיא מחזורי (yes / partly / no). ב־current_state — המילה הראשונה בלבד (A-77) | state.py:188 |

## 4. מחיר, Cheap Score וסיכון

| מונח | הגדרה | מקור |
|---|---|---|
| **close** | סגירת הנר האחרון של הסשן הרגיל (09:30–15:59 ET) מ־Release הנרות, או מההיסטוריה הקפואה. לא מחיר הסגירה הרשמי (A-40) | state.py:33-36 |
| **`chg1`/`chg5`/`chg20`/`chg60`** (= `return_1d/5d/20d/60d`) | C/C(לפני n ימי מסחר) − 1 | state.py:76-77 |
| **SMA20 / SMA50 / SMA200** | ממוצע פשוט של סגירות על 20/50/200 ימים (בלי `min_periods`: יום חסר מחזיר NaN — A-41) | state.py:73,78 |
| **`dist_SMA20`, `dist_SMA50`** (= `distance_SMA20/50`) | C/SMA − 1 | state.py:187 |
| **D200** (= `distance_SMA200`) | C/SMA200 − 1 | state.py:74 |
| **`slope200`** | SMA200 / SMA200 לפני 20 ימים − 1 | state.py:73 |
| **`sma200_rising` (SMA200 עולה)** | `slope200 > 0` (NaN → false) | state.py:132 |
| **DD252** | C / מקסימום הסגירות של 252 הימים **הקודמים** (בלי היום) − 1 | state.py:74 |
| **DD60** | C / מקסימום הסגירות של 60 הימים הקודמים − 1 | state.py:79 |
| **אחוזון (`lastpct`)** | מיקום הערך של היום מול כל הערכים **הקודמים** של אותה מניה (`bisect_left`, כלומר אחוז הערכים הקטנים ממש). דורש ≥252 ערכים קודמים (`len<253 → NaN`) | state.py:108-111 |
| **Cheap Score** | ממוצע של (100 − אחוזון DD252) ו־(100 − אחוזון D200). גבוה = זולה ביחס לעצמה | state.py:130 |
| **רבעון זול (Cheap_Quartile)** | Q1 ≤ 25 < Q2 ≤ 50 < Q3 ≤ 75 < Q4. Q4 = הזולה ביותר לעצמה, Q1 = היקרה ביותר | state.py:131 |
| **שמיש (`cheap_usable`, usable)** | יש רבעון **וגם** SMA200 עולה. רק כך נבדק במחקר. רבעון לא שמיש לא מאיץ ולא מסמן מועמדות | state.py:182 |
| **`quartile_5_sessions_ago`, `quartile_21_sessions_ago`** | הרבעון שהיה מחושב לפני 5 / 21 סשנים (הסדרה נחתכת ב־t−k; בלי look-ahead) | state.py:217-227 |
| **ADR60** | ממוצע (High − Low) / Close של אותו יום על 60 ימים, ×100 (באחוזים). לא כולל גאפ לילי. בחבילה `ADR60_pct` | state.py:75 |
| **`stop_2xADR60`** | 2 × ADR60 ÷ 100 (שבר). מרחק הסטופ ל־SPECULATIVE; מחיר הסטופ = מחיר × (1 − stop) | state.py:183; do-tab.html:123,127 |
| **maxDD** | הירידה המקסימלית מהשיא על **סגירות** מ־10/2021, באחוזים (שלילי). עמודה ב־`risk_engine.csv` | core/risk_engine.csv |
| **Risk Tier (`Risk_Tier`)** | הדרגה הקפואה מ־`risk_engine.csv` (עמודה `tier`, ADR60 של 30.9.2026): EXTREME אם ADR60≥4 או maxDD≤‎-70; HIGH אם ≥2.75 או ≤‎-50; MEDIUM אם ≥1.6 או ≤‎-30; אחרת LOW. משתנה רק בסקירה רבעונית. קובע גודל, לא איכות | state.py:113,133,183 |
| **`tier_today`** | אותו כלל, עם ADR60 של היום ו־maxDD הקפוא. מידע בלבד. לסמל בלי שורה ב־risk_engine (TQQQ, BITX) maxDD=0 (A-13) | state.py:172-176 |
| **`core_cap` (תקרת CORE)** | LOW/MEDIUM 10%, HIGH 6%, EXTREME 3%, לפי Risk_Tier הקפוא. מחושב גם ל־ETF שיש להם דרגה (VOO=10%, A-13). CORE+TACTICAL באותה מניה: +2% (לא מוצג) | state.py:125,184 |
| **look-ahead** | שימוש במידע שלא היה זמין ביום ההחלטה. Cheap Score החי נקי ממנו (נבדק). LONG_EDGE במחקר לא (A-09) | — |

## 5. החלטות (`core_decision` ו־do-tab)

### 5.1 `core_decision` (לילי, state.py:157-163) — הסדר קובע

| ערך | מתי |
|---|---|
| **ETF / INDEX** | הסמל ב־ETF |
| **NO CORE** | Review_final ≠ CORE, **או** שווי UNJUSTIFIABLE |
| **THESIS REVIEW** | הדוח האחרון ב־3 ימי המסחר האחרונים (`bdays(last, date) ≤ 3`) **ו**־|`move_since_last_report`| > 2×ADR60. אומר "לבדוק את הדוח", לא מה המסקנה |
| **REVIEW REQUIRED** | `screen_review_conflict` (רק כשהגענו לכאן, כלומר Review_final=CORE) |
| **ACCELERATE TRANCHE** | Q3 או Q4 **ו**־SMA200 עולה: מותר להקדים את המנה הבאה. (התמיכה המחקרית ב־Q3 וב־MEDIUM חסרה — A-10) |
| **NORMAL SCHEDULE** | כל השאר (כולל Q1, Q2, ו־Q3/Q4 לא שמישים): לפי לוח המנות. Q1 לא חוסם |

### 5.2 מסלול (`route`)

| ערך | מתי | מקור |
|---|---|---|
| **CORE+TACTICAL** | Review_final=CORE | state.py:177 |
| **SPECULATIVE** | כל מניה אחרת (WATCH, NON-CORE, לא נסקרה) | state.py:177 |
| **ETF** | ETF | state.py:177 |

### 5.3 החלטות TACTICAL/SPEC ב"מה לעשות היום" (do-tab.html:100-128)

| ערך | מתי |
|---|---|
| **NO TRADE** | THESIS REVIEW (כולל דוח מאחרי המצב שהתנועה החיה בו >2×ADR60), או שנשאר פחות מיום מסחר מהיום (ET) עד `short_exit_by` |
| **NOT A CANDIDATE** | הרבעון אינו Q3/Q4 שמיש. **כלל שאינו בשיטה הקפואה** (A-11) |
| אחרת | מצב הנרות (5.4) |

### 5.4 מצבי נרות (do-tab.html:76-89) — הסדר קובע

| ערך | תנאי |
|---|---|
| **WAIT FOR OPEN** | אין נרות להיום, או שהנרות אינם מהיום (שוק סגור) |
| **DON'T CHASE** | המחיר האחרון ≥ סגירת המצב × (1 + ADR60) |
| **WAIT** | פחות מ־30 נרות דקה בסשן |
| **LIMIT OK** | אין pullback היום: השפל לא אחרי השיא, או השיא−השפל < ½ × ADR60 במחיר. "אם רוצים — Limit סביב VWAP" |
| **WAIT FOR STABILIZATION** | שפל חדש ב־15 הדקות האחרונות; או ≥15 דקות בלי שפל חדש כשתנאי ENTRY NOW / WAIT FOR RECLAIM עוד לא מתקיימים (פחות מ־30 דקות, או בלי "שפל גבוה יותר") |
| **ENTRY NOW** | ≥30 דקות מאז השפל, "שפל גבוה יותר", ומחיר ≥ VWAP. מתבטל בשפל חדש. **לא נבדק היסטורית** (A-48) |
| **WAIT FOR RECLAIM** | כמו ENTRY NOW אבל מתחת ל־VWAP |
| **VWAP** | Σ(typical price × volume) ÷ Σvolume על נרות הסשן הרגיל של היום; typical = (H+L+C)/3 |
| **"שפל גבוה יותר" (`higherLow`)** | המינימום של 5 נרות הדקה האחרונים > שפל היום. אחרי ≥30 דקות מהשפל מתקיים כמעט תמיד (A-47) |

## 6. דוחות (earnings)

| מונח | הגדרה | מקור |
|---|---|---|
| **BMO** | Before Market Open. Nasdaq `time-pre-market` → `pre` → BMO. יציאה: יום המסחר **הקודם** לדוח | earnings.py:14; state.py:141,191 |
| **AMC** | After Market Close. `time-after-hours` → `after` → AMC. יציאה: עד סגירת **יום הדוח** | earnings.py:14; state.py:141,191 |
| **UNKNOWN** | כל ערך שעה אחר → `unknown` → UNKNOWN. יציאה: יום המסחר הקודם (כמו BMO). בחישוב התגובה מטופל כמו BMO (A-68) | earnings.py:34; state.py:141,147 |
| **`next_earnings` / `last_earnings`** | מתוך חלון ‎-25/+75 ימים קלנדריים מ"היום" של ההרצה: `last` = הדוח האחרון בתאריך ≤ היום, `next` = הראשון בתאריך > היום. **"היום" = תאריך UTC של השרת** — דוח של הסשן הבא נרשם `last` (A-03). סופי שבוע לא נשלפים (A-56) | earnings.py:18-44 |
| **`days_to_earnings`** | ימי מסחר מתאריך המצב (לא כולל) עד הדוח (כולל) | state.py:83-84,139 |
| **`short_exit_by`** | יום המסחר האחרון שבו מותר להחזיק TACTICAL/SPEC לפני הדוח: AMC → תאריך הדוח; אחרת → יום החול הקודם (`busday_offset -1`) | state.py:141 |
| **`short_max_hold_days`** | min(20, ימי מסחר מתאריך המצב עד `short_exit_by`); 20 כשאין דוח הבא — **בלי אזהרה** (A-17) | state.py:143,190 |
| **`short_blocked`** | טקסט "report too close…" כשנשארו פחות מיום מסחר (מתאריך המצב) עד `short_exit_by` | state.py:178-179 |
| **`earnings_status`** | `REPORT NEXT SESSION (BMO|AMC|time unknown)` — הדוח ביום החול שאחרי תאריך המצב; `REPORT IN n SESSIONS` — n≤5; `REPORTED ON <date>` — הדוח בתאריך המצב (+ `(AMC: reaction next session)`); `REPORTED <date> (after this state)` — הדוח אחרי תאריך המצב (התגובה עוד לא במצב); `REPORTED <date>` — עד 3 ימי מסחר אחורה. ה־REPORTED גובר | state.py:165-171 |
| **flag (בלוח הדוחות בחבילה)** | `REPORT TOMORROW` (status מכיל "NEXT SESSION"); `REPORTED TODAY` (status מתחיל ב־REPORTED ו־last ≥ תאריך המצב); `WITHIN 5 SESSIONS` (days_to_earnings ≤ 5) | pkg-tab.html:105 |
| **`move_since_last_report`** | סגירת המצב ÷ הסגירה שלפני יום התגובה − 1. יום התגובה = יום הדוח (BMO/UNKNOWN) או יום החול שאחריו (AMC). None אם התגובה אחרי תאריך המצב | state.py:144-149 |
| **בדיקת תזה (THESIS REVIEW)** | ראו 5.1. הסף 2×ADR60 לא כתוב בשיטה הקפואה (A-43) | state.py:156,160 |

## 7. מצב לילי, נתונים ותקינות

| מונח | הגדרה | מקור |
|---|---|---|
| **current_state / המצב הלילי** | שורה לכל אחד מ־131 הסמלים, נכון לסגירה האחרונה בנתונים. "ה־Q הרשמי של היום = מהסגירה הקודמת" | state.py; CORE_SYSTEM.md §7 |
| **`date` (תאריך המצב, `LASTD`)** | היום האחרון בנתונים (היסטוריה + Release) | state.py:71,80 |
| **`expected_last_session`** | יום החול האחרון לפי שעון ניו יורק: אם עכשיו לפני 18:00 ET — יום החול הקודם, אחרת היום. בלי חגים | state.py:200 |
| **`state_is_current`** | `date ≥ expected_last_session` | state.py:212 |
| **`health.ok`** | `state_is_current` וגם אין `missing_symbols`, `incomplete_last_day`, `stuck_close_5_sessions`, `overlap_mismatch` | state.py:213 |
| **`last_day_complete` / incomplete** | ליום האחרון יש ≥380 נרות דקה (ימים מקוצרים ייכשלו — A-38) | state.py:72 |
| **היסטוריה קפואה (`history_frozen_to`)** | `core/daily.csv.gz` — יומי, סשן רגיל, מותאם לפיצולים, עד 2026-10-12 | state.py:26-27 |
| **Release (`candles-YYYY-MM-DD`)** | GitHub Release לילי עם zip של כל נרות הדקה (`candles_part*.csv`), מ־`export.yml`. נשמרים 7 אחרונים; מכיל ~58 ימים | export.yml |
| **`release`** | [היום הראשון, היום האחרון] ב־Release ששימש | state.py:37,230 |
| **`overlap_mismatch`** | סמלים שבהם **חציון** היחס close(Release)/close(היסטוריה) בימי החפיפה חורג ב־>0.2%. גורם ל־exit 2 (A-25) | state.py:43-46,235 |
| **פיצול שזוהה (`splits`)** | יחס סגירה(t−1)/פתיחה(t) בטווח 6% ממקדם ברשימה (2,3,4,5,8,10,15,20,25,30,40,50) ויחס >1.5. מחלק את כל המחירים שלפני התאריך. נשמר לצמיתות ב־`splits.json` (A-24) | state.py:49-60,63-68 |
| **`core/history`** | צילום `state_<date>.csv` בכל ריצה (לפני הוספת עמודות הרבעון הקודם; דורס) | state.py:214-215 |
| **DATA_HEALTH** | טבלת הבדיקות בחבילה (16 שורות) | pkg-tab.html:141-166; CORE_SYSTEM.md §8 |
| **monthly snapshot** | ספירות והתפלגויות מהמצב האחרון והיומן. דיווח בלבד | pkg-tab.html:167-193 |

## 8. יומן עסקאות וסקירה רבעונית

| מונח | הגדרה | מקור |
|---|---|---|
| **trade log** | `core/trade_log.json` = `{updated, entries:[…]}`. רשומה לכל עסקה או החלטה (כולל SKIP/HOLD). נכתב רק דרך `POST /core/log`. **בריפו ציבורי** (A-01) | worker.js:1901-1935 |
| **שדות רשומה** | id, route, symbol, action (BUY/SELL/SKIP/HOLD), decision_time, decision_price, candle_condition, fill_time, fill_price, amount_usd, pct_of_portfolio, tranche, stop_price, exit_time, exit_price, exit_reason (+6% TARGET / 20 DAYS / BEFORE EARNINGS / STOP / THESIS BROKEN / OTHER), spy_at_entry, notes, logged_at. זמנים בלי אזור זמן (A-36) | pkg-tab.html:53-69,194 |
| **`spy_at_entry`** | סגירת SPY במצב הלילי, ממולא אוטומטית ב־BUY אם ריק | pkg-tab.html:274 |
| **`trade_return`** | יציאה ÷ כניסה − 1; לעסקה פתוחה — סגירת המצב ÷ כניסה − 1. כניסה = fill_price או decision_price | pkg-tab.html:203-204 |
| **`buy_hold_same_stock_to_today`** | סגירת המצב ÷ כניסה − 1 (עד היום, לא עד היציאה) | pkg-tab.html:204 |
| **`trade_minus_bh`, `trade_minus_spy`** | ההפרשים בין העסקה ל־B&H ול־SPY מאז הכניסה | pkg-tab.html:204,206 |
| **API_KEY** | סוד ב־Worker. בלעדיו `POST /core/log` מחזיר 503 (מ־14.10); עם מפתח שגוי 401. נשלח ב־`X-API-Key` או `?key=` | worker.js:1667-1671,1904-1905 |
| **GH_TOKEN / GH_REPO** | ה־PAT והריפו שה־Worker משתמש בהם לקריאת קבצי `core/` ולכתיבת היומן | worker.js:1877-1880 |

## 9. מחקר

| מונח | הגדרה | מקור |
|---|---|---|
| **Discovery / Validation / Holdout** | שלוש תקופות במחקר: גילוי, אימות, ותקופה סגורה שנפתחת פעם אחת | `/tmp/claude-0/hist/exp2/NEW_PROTOCOL.md` (לא בריפו) |
| **LONG_EDGE** | מדד הניסוי LONG: תשואת המניה מול SPY ל־252 יום, פחות הממוצע של אותה מניה באותה שנה קלנדרית. ה־baseline כולל ימים שלפני האירוע → look-ahead (A-09) | `exp2/long.py` (לא בריפו) |
| **survivorship** | היקום הוא רשימת המניות של היום; מניות שנכשלו ונעלמו לא בנתונים. ב־LONG מטה לטובת קניית ירידות | דוחות 04, 08 |
| **שיטת המבנה** | LL → HL → breakout → retest; נכשלה (אין יתרון מול כניסה אקראית) | `claude/audit-structure-method-5y.md` |
| **Bigdata / ה־Excel** | מקור הנתונים הקודם (Bigdata.com) והמסנן שנבנה עליו. הוחלף ב־EDGAR ב־13.10; הסקירות עדיין נשענות עליו (A-07) | `claude/finding-sec-vs-bigdata-2026-10-13.md` |
