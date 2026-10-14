# צוות התאמת פיתוח: האם הקוד משקף את מה שסוכם
נבדק: HEAD `c32206b` (14.10.2026 03:14 +0300). הריפו לא שונה. סקריפטים ופלטים נמצאים ב־`scratchpad/dev/`.

## 1. סיכום מנהלים
- **עובדה:** רוב מה שביקשת קיים בקוד: טאב "מה לעשות היום", עמודות מצב, טאב חבילה (8 טבלאות, Excel ו־CSV עם חותמת הורדה, טבלת רענון), טאב רבעונים ויומן עסקאות. חוקי הליבה ב־`state.py` תואמים לשיטה הקפואה: יציאה לפני דוח לפי BMO/AMC/UNKNOWN, Q1 לא חוסם, תקרות לפי Risk Tier, Cheap Score, Risk Engine, וגודל SPEC = min(תקרה, 0.3%/סטופ).
- **עובדה:** יש באג תזמון בלוח הדוחות. `earnings.py` מחלק דוחות ל"אחרון" ו"הבא" לפי תאריך ההרצה ב־UTC, ולא לפי תאריך המצב. בקובץ הנוכחי ASML/BAC/BLK/MS/PGR, שמדווחות ב־14.10, רשומות כ"דיווחה" ו־`next=None`. **הערכה:** דוח AMC ביום המסחר הבא יאבד את חובת היציאה של TACTICAL/SPEC. הסיבה: ריצת הגיבוי ב־08:00 UTC רצה כל בוקר לפני הפתיחה.
- **עובדה:** AAPL ו־QCOM הן WATCH בסקירה, אבל EDGAR מסווג אותן היום CORE-ELIGIBLE. ההחלטה שלהן היא "NO CORE" ואין להן שום דגל REVIEW REQUIRED, לא ב"מה לעשות היום" ולא בטבלת ההחלטה. CHAT ציין במפורש את שתיהן כמקרי REVIEW REQUIRED.
- **עובדה:** טבלת ההחלטה בחבילה היא שורה אחת לכל מניה, וההחלטה שבה היא החלטת CORE בלבד. זה לא הפורמט של CHAT, שבו כל מסלול מקבל שורה. התיעוד (`docs/CORE_SYSTEM.md`) לא מכסה את החבילה, את טאב הרבעונים, את יומן העסקאות ואת בדיקות התקינות, ועדיין כותב שהיומן "עוד לא נבנה".
- **עובדה:** הריפו ציבורי (`gh api` החזיר `private=false`). יומן העסקאות נשמר בו בקומיט, כולל סכום ו־% מהתיק.

## 2. ממצאים

| # | חומרה | קובץ:שורה | ממצא | ראיה | המלצה |
|---|---|---|---|---|---|
| 1 | קריטי | tools/core/earnings.py:18,42 | המיון ל"אחרון/הבא" נעשה לפי `datetime.date.today()` של ההרצה (UTC), לא לפי תאריך המצב או יום המסחר הבא. | **עובדה:** `core/earnings.json` נבנה ב־2026-10-14 00:06Z, ובו ASML/BAC/BLK/MS/PGR רשומות `last=2026-10-14, next=None`. הרצה חוזרת של state.py עליו נתנה ל־ASML `earnings_status="REPORTED 2026-10-14 (after this state)"` ו־`short_exit_by=None`, במקום "REPORT IN 2 SESSIONS" ויציאה ב־10-13. ב־core-state.yml:13 יש cron גיבוי `0 8 * * *` שרץ בכל בוקר לפני הפתיחה ומקמט (built משתנה בכל ריצה). **הערכה:** דוח AMC של אותו יום ייראה כ"דוח שעבר". ב־do-tab ה־TACTICAL/SPEC לא ייחסם ולא יוצג "לצאת עד הסגירה", כלומר החזקה דרך דוח, וזה מנוגד לשיטה. כרגע אין בקובץ מקרה AMC חי. | לסווג `next` כדוח שתאריכו ≥ יום המסחר שאחרי תאריך המצב, ולשמור תמיד גם את הדוח הקרוב מהיום והלאה. לחלופין להעביר ל־earnings.py את תאריך המצב כפרמטר. |
| 2 | גבוה | tools/core/state.py:158-161 | סדר הבדיקות `qual!='CORE'` → NO CORE לפני `conflict` מסתיר את REVIEW REQUIRED מכל מניה שאינה CORE. | **עובדה:** `screen_review_conflict=True` אצל 20 מניות, אבל `core_decision=REVIEW REQUIRED` רק אצל 12. AAPL ו־QCOM: Review_final=WATCH, Excel_label=CORE-ELIGIBLE, core_decision=NO CORE, route=SPECULATIVE. גם ABT/AMT/AMZN/HON/SBUX/UNH מוסתרות. ב־quality_master יש 21 דגלים, אבל ב־CORE_SYSTEM.md §5 מופיעות רק 12. CHAT: "אם הם סותרים... REVIEW REQUIRED (AAPL/QCOM/BSX/NOW/WFC)". | להציג REVIEW REQUIRED גם למניות WATCH/NON-CORE: עמודה נפרדת, או החלטה "NO CORE · REVIEW REQUIRED". בדו־טאב ובטבלת ההחלטה לסמן ש־SPEC בלבד עד סקירה חוזרת. |
| 3 | גבוה | pkg-tab.html:132-139 | טבלת ההחלטה אינה בפורמט של CHAT: שורה אחת למניה, `decision` הוא core_decision בלבד, `Intraday` הוא הטקסט הקבוע "ידני מנרות דקה", ו־`Today` הוא שינוי הסגירה של יום המצב. | **עובדה:** `rows=rs.map(r=>[...r.core_decision, entryCond(r)])`, בלי פיצול לשורת CORE ושורת TACTICAL. למניות SPEC כתוב בעמודת decision "NO CORE" במקום החלטת SPEC (WAIT/ENTRY/NOT A CANDIDATE). הפיצול למסלולים קיים רק ב־do-tab. | לייצר שורה לכל מסלול (CORE/TACTICAL/SPECULATIVE) עם החלטה למסלול, באותה לוגיקה כמו do-tab, כדי ששני הדפים יתנו אותה תשובה. |
| 4 | גבוה | repo + worker.js:1902 | יומן העסקאות (`amount_usd`, `pct_of_portfolio`, מחירים) נכתב בקומיט ל־`core/trade_log.json` בריפו ציבורי. בנוסף, `POST /core/log` פתוח לכתיבה כש־`API_KEY` לא מוגדר. | **עובדה:** `gh api repos/Liornim/spmo-market-bridge` → `private=false, visibility=public`. `authorized()` (worker.js:1668) מחזיר true כשאין API_KEY. היומן ריק כרגע. לא ניתן היה לבדוק אם API_KEY מוגדר ב־Worker. | לשמור את היומן ב־KV/D1/Supabase או בריפו פרטי. לחייב API_KEY בנתיב הזה גם כשהוא לא מוגדר (fail closed). |
| 5 | בינוני | do-tab.html:123-127; pkg-tab.html:129-130 | ב־SPECULATIVE לא מוצג תאריך היציאה לפני דוח. הכלל "לא עוברים דוח" נאכף רק כשהדוח בסשן הבא. | **עובדה:** `sneed` בשורה 127 כולל סטופ וגודל, בלי `exitBy`. ב־pkg כתוב "דוח קרוב, לשקול לא להיכנס" רק כש־`days_to_earnings<=1`, וגם זה בלשון רכה. מניית SPEC עם דוח בעוד 3 ימים מקבלת ENTRY בלי לציין שחייבים לצאת ב־exitBy. | להוסיף לשורת SPEC "יציאה לכל המאוחר <short_exit_by> (לפני דוח)", כמו ב־TACTICAL. |
| 6 | בינוני | do-tab.html:102,119,126 מול pkg-tab.html:121-126 | do-tab מציע TACTICAL/SPEC רק כשהרבעון Q3/Q4 ושמיש. pkg-tab מציע TACTICAL לכל מניית CORE. השיטה הקפואה (METHOD-frozen) לא כוללת תנאי Q3/Q4 ל־TACTICAL. | **עובדה:** `cand=usable&&(q==='Q3'||q==='Q4')` ב־do-tab. ב־entryCond אין בדיקת רבעון. התנאי מתועד ב־CORE_SYSTEM.md §7, אבל לא ב־METHOD-frozen-2026-10-13 ולא ביומן ההחלטות §10. **הערכה:** זה כלל שנוסף בקוד ולא אושר כחלק מהשיטה. | שנועם יחליט אם Q3/Q4 הוא תנאי ל־TACTICAL. אחרי ההחלטה ליישם זהה בשני הדפים ולרשום ביומן ההחלטות. |
| 7 | בינוני | state.py:156-160; do-tab.html:111,117,124 | THESIS REVIEW (דוח ב־3 ימים אחרונים ותנועה מעל 2×ADR60) הופך את TACTICAL/SPEC ל־NO TRADE למשך 3 ימי מסחר, ואין דרך לסמן "בדקתי". | **עובדה:** `if(d==='THESIS REVIEW'){td='NO TRADE'}`, וב־pkg: "TACTICAL אסור עד סיום הבדיקה". יומן ההחלטות (14.10) קובע "דוח = בדיקה ולא איסור". הסף 2×ADR60 לא מופיע בשיטה הקפואה. | לשנות ל־"REVIEW FIRST" עם אפשרות סימון ידני, או לתעד ביומן ההחלטות שזה כלל מאושר. |
| 8 | בינוני | core/current_state.json (committed) | הקובץ שבקומיט נוצר בגרסת קוד אחרת. לפי הקוד הנוכחי, `health.ok` אמור להיות false. | **עובדה:** בקובץ אין `state_is_current`, ויש `ok:true` עם `state_date=2026-10-12` מול `expected_last_session=2026-10-13`. הרצה חוזרת של state.py הנוכחי על אותם נתונים נתנה `ok=False, state_is_current=False`. בנוסף, המצב החי מפגר ביום מסחר (10-12 במקום 10-13). | להריץ את core-state מחדש. לוודא שה־Release של 10-13 קיים (שייך לצוות הנתונים). |
| 9 | בינוני | pkg-tab.html:199-217 | הסקירה הרבעונית חלקית: אין ניכוי עלויות, אין השוואת CORE מול VOO/SPY, ואין סיכום SPECULATIVE נפרד. B&H מחושב עד היום, לא עד מועד היציאה. | **עובדה:** בסיכום (S) יש רק שורות TACTICAL. אין שדה עמלות בטופס. `bh=now/ent-1`. השיטה: "TACTICAL מול B&H... אחרי עלויות; CORE מול VOO/SPY; SPECULATIVE בנפרד". כלל ההפסקה (≥6 חודשים וגם ≥30 סגורות) מיושם נכון. | להוסיף שדה עלות/עמלה, סיכום CORE מול SPY לפי `spy_at_entry` וסיכום SPEC. לתעד את בחירת B&H "עד היום". |
| 10 | בינוני | core/core_data.json (data) / tools/core/sec_facts.py | מסנן TTM לא עדכני ב־10 חברות אמריקאיות: הרבעון האחרון ב־EDGAR הוא 2026-03-31, וב־C הוא 2025-12-31 (מוצג FY). | **עובדה:** ל־CB, SPGI, DUK, PLD, V, ABT, MDLZ, NEE, SO, ההכנסות והרווח הרבעוניים ב־`core/sec/ABT.json` מסתיימים ב־2026-03-31. ב־`C.json` הרבעון האחרון הוא 2025-12-31 (fetched 2026-10-13). **השערה:** החילוץ מפספס את ה־10-Q של Q2 2026 (כנראה בגלל בחירת תגית או מסגרת). TSM FY2024 ו־ASML מתועדים כ־20-F. | להעביר לצוות הנתונים. להוסיף ל־DATA_HEALTH בדיקה "תקופה אחרונה ישנה מ־~135 יום". |
| 11 | בינוני | docs/CORE_SYSTEM.md | התיעוד לא כולל את טאב החבילה, טאב הרבעונים, `/core/file/*`, `POST /core/log`, `core/history` ובדיקות התקינות. §11 עדיין אומר שרישום עסקאות "עוד לא נבנה". | **עובדה:** קומיט התיעוד `b609056` קודם לקומיט `c32206b` שהוסיף את כל אלה. ב־§7 רשומים לטאבים של /core: מצב היום, רשימה, סקירה, נתונים, כללים, נתונים גולמיים, בלי "רבעונים" ובלי "חבילה". | לעדכן §6–§8 ו־§11 ואת עותק הפרויקט `claude/CORE-SYSTEM.md`. |
| 12 | בינוני | pkg-tab.html:120; state.py:124 | כל 11 ה־ETF, כולל TQQQ (פי 3) ו־BITX (ביטקוין פי 2), מקבלים "חלק מ־45% VOO/SPY: מנות 40/30/30". | **עובדה:** `if(r.kind==='ETF') return 'חלק מ־45% VOO/SPY...'`. ל־TQQQ ול־BITX אין Risk_Tier (None). **הערכה:** ממונפים אינם "חלק המדד של CORE". | להגביל את מסלול המדד ל־VOO/SPY (ואולי QQQ), ולסמן ממונפים/סקטוריאליים בנפרד. |
| 13 | נמוך | core.html:271-273 | בטאב "מצב היום" של /core חסרות עמודות SMA20 ו־SMA50 (יש רק מרחק). שעת הדוח מוצגת גולמית (pre/after/unknown) ולא כ־BMO/AMC. אין עמודות earnings_status ו־tier_today. אין date בכל שורה (התאריך מופיע בכותרת). | **עובדה:** ה־spec כולל `dist_SMA20`, `dist_SMA50` ו־`next_earnings_time`, אבל לא `SMA20`/`SMA50`/`earnings_time`. בחבילה (T_state) כל העמודות של CHAT קיימות. | להוסיף את 4 העמודות. להציג `earnings_time`. |
| 14 | נמוך | do-tab.html:72-73,86 | "שפל גבוה יותר" לא נבדק באמת: `l5` הוא המינימום של 5 נרות הדקה האחרונים (ההערה בקוד אומרת "5-minute lows of last 30 minutes"). כשעברו ≥30 דקות מהשפל, התנאי כמעט תמיד מתקיים. | **עובדה:** `tail=rows.slice(-5)` של נרות 1m. | לממש HL על נרות 5m (שפל 5m אחרון > שפל 5m קודם > שפל היום), או לתקן את התיעוד. |
| 15 | נמוך | do-tab.html:136 | מצב LIMIT OK (מותר להיכנס ב־Limit) לא נכלל ב־"רק מה שדורש תשומת לב", שמסומן כברירת מחדל, ולכן מועמדות TACTICAL כאלה מוסתרות. גם הערת הדף (שורה 46) לא מזכירה LIMIT OK. | **עובדה:** הרשימה ב־`attention` לא כוללת 'LIMIT OK'. | להוסיף את LIMIT OK לרשימה ולהערה. |
| 16 | נמוך | do-tab.html:150 | כרטיסי ההסבר החופשי נוצרים רק ל־12 המניות הראשונות. | **עובדה:** `shown.slice(0,12)`. | כרטיס לכל שורה מוצגת, או "הצג עוד". |
| 17 | נמוך | pkg-tab.html:125 מול state.py:179 | אי־עקביות בדוח AMC בסשן הבא: state.py לא חוסם (hold_days=1, אפשר לצאת עד הסגירה), אבל pkg כותב "TACTICAL: לא להיכנס" כש־dte≤1. | **עובדה:** בהרצה מבוקרת, AAPL עם AMC 10-13 קיבלה `short_blocked=None, exit_by=2026-10-13`. | ליישר את הלוגיקה (pkg להשתמש ב־`short_blocked`). |
| 18 | נמוך | state.py:141; do-tab.html:58 | ספירת ימי מסחר בלי חגים. דוח BMO ביום ששי 27.11 ייתן exit_by=26.11 (Thanksgiving). | **עובדה:** `np.busday_offset('2026-11-27',-1)` → 2026-11-26. כרגע אין דוח כזה בקובץ. מתועד כמגבלה. | להעביר `holidays=` של NYSE ל־numpy ול־JS. |
| 19 | נמוך | הדפים | תקרת CORE+TACTICAL (+2%) והמגבלה של עד 3 TACTICAL במקביל או 10% לא מוצגות בשורות. הן מופיעות רק בגיליון method. | **עובדה:** `core_cap` מציג רק את תקרת הדרגה. | להוסיף לשורת TACTICAL "תקרה משותפת: core_cap+2%". |

## 3. צ'קליסט הבקשות של נועם

**1. טאב "מה לעשות היום" ב־/bars: בוצע ברובו (PARTIAL קל).**
- **עובדה:** `do-tab.html` מוזרק ל־`archive-bars.html:1646` דרך `build-view.mjs:60-61`, נמצא בתוך view.js, ונפתח מכפתור `#tabDo` (archive-bars.html:122,1506).
- מסלולים: למניית CORE יש שורת CORE ושורת TACTICAL. WATCH/NON-CORE מקבלות רק SPECULATIVE (שורות 113-128). TACTICAL אינו מוצע למניות שאינן CORE (תקין).
- שתי השאלות מנוסחות בכרטיסים: CORE "3–5 שנים", TACTICAL "עד N ימי מסחר" (שורה 156).
- עמודות: #, מניה, Quality, מסלול, Risk, Cheap/שווי (מאוחדות), דוח (תאריך ולא ימים), היום, מול SPY, מחיר, מצב כרגע (=Intraday), מה צריך (=entry condition), החלטה. Valuation ו־Cheap מאוחדים לעמודה אחת.
- הסבר חופשי: רק ל־12 מניות (ממצא 16).

**2. עמודות חסרות בטאב המצב של /core: חלקי.** בטאב מצב היום ב־/core חסרים SMA20, SMA50, earnings_time (בפורמט BMO/AMC) ו־date לכל שורה (ממצא 13). קיימים: return_1d/5d/20d/60d, DD60, distance_SMA20/50, D200 (=distance_SMA200), Cheap, quartile, usable, ADR60, Risk_Tier, דוח הבא, ימים, valuation, cyclical, Review_final ו־EDGAR label. thesis, review_date ו־override_reason נמצאים ב־quality_master בחבילה, לא בטאב המצב. בחבילה (T_state) כל עמודות CHAT קיימות.

**3. טאב חבילה, כל פריט ב־spec:**

| פריט ב־CHAT_package_spec | מכוסה? | הערה |
|---|---|---|
| נרות 1m לכל 131 (symbol,date,time,OHLCV), היום + 5 ימים | חלקי (מכוון) | לא בחבילה. קישור ל־/bars, שבו יש הורדה מרובת סימולים (archive-bars.html:847-854) |
| Current State: 18 עמודות חובה | כן | T_state:92-98. distance_SMA200=D200, ADR60 בשם `ADR60_pct` |
| return_1d/5d/20d/60d | כן | |
| הוספת next_earnings_date/earnings_time/days_to_earnings ל־current_state | כן | |
| לוח דוחות symbol,next_earnings_date,earnings_time(BMO/AMC/UNKNOWN),days_to_earnings | כן, אבל השיוך שגוי בגלל ממצא 1 | יש גם דגלי REPORT TOMORROW / REPORTED TODAY / WITHIN 5 |
| כללי יציאה AMC/BMO/UNKNOWN; דוח קרוב לא אוסר | כן ב־state.py (נבדק בהרצה) | ממצאים 1 ו־17 |
| Quality Master: symbol, EDGAR_label, Review_final, valuation_status, review_date, cyclicality, thesis, override_reason + פונדמנטלים | כן | 35 עמודות. CHEAP/FAIR/EXPENSIVE/UNJUSTIFIABLE (ATTRACTIVE→CHEAP) |
| REVIEW REQUIRED כש־EDGAR וסקירה סותרים | חלקי | `review_flag` ב־QM, אבל מוסתר בהחלטות של מניות שאינן CORE (ממצא 2) |
| UNJUSTIFIABLE חוסם CORE, EXPENSIVE לא חוסם | כן | state.py:159. אין כרגע מניית CORE עם UNJUSTIFIABLE |
| DATA_HEALTH שבועי: 131 סימולים, ימים חסרים, נרות חסרים חריגים, splits, volumes, duplicated bars, סימול תקוע, מחיר לא מתואם, מצב מהיום הנכון, lookahead, Risk tier bug | חלקי | אין בדיקת duplicated bars. "נרות חסרים" נבדק רק ביום האחרון (≥380 נרות). lookahead הוא מחרוזת קבועה ולא בדיקה. השאר קיים ורץ כל לילה |
| תמונה חודשית: ספירות CORE/WATCH/NON-CORE, Risk dist, quartiles, שינויי Q, ביצועי CORE, עסקאות TACTICAL/SPEC | כן | ביצועי CORE = ממוצע שווה משקל של המניות, לא של התיק בפועל (מוצהר) |
| סקירה רבעונית: CORE מול VOO/SPY, TACTICAL מול B&H מאותו יום, SPEC, ≥6 חודשים וגם ≥30 עסקאות | חלקי | ממצא 9 |
| טבלת החלטה בפורמט Rank…entry condition, כמה שורות למניה לפי מסלול | חלקי | ממצא 3 |
| מינימום 4 קבצים (bars, current_state, earnings_calendar, quality_master) | כן (3 ב־CSV/Excel, bars ידני) | quality_master ב־CSV ובגיליון Excel, לא כקובץ xlsx נפרד |
| הורדת Excel של הכל | כן | SheetJS 0.18.5 מ־cdnjs, 10 גיליונות כולל README ו־method |
| "רוענן לאחרונה" לכל מאגר | כן, למעט סקירה עסקית ("—") ונרות | טבלת `pk-fresh` |
| תאריך ושעה של הורדת ה־Excel | כן | בשם הקובץ `__downloaded_YYYY-MM-DD_HHMM` ובשורה "הורד ב־" ב־README. גם ל־CSV |

**4. תיעוד: חלקי.** CORE_SYSTEM.md מכסה את השיטה, ההגדרות, המסנן, הסקירה, הצנרת ואת do-tab. **לא מכסה** את טאב החבילה, טאב הרבעונים, Trade log API, `/core/file`, בדיקות התקינות ואת `core/history`, והוא סותר את הקוד ("עוד לא נבנה"; 12 REVIEW REQUIRED מול 20–21). השינויים האחרונים לא תועדו (ממצא 11).

**5. TTM במקום שנתי + תצוגת רבעונים: בוצע, עם חריגי נתונים.** 106 TTM ו־14 FY. מתוך ה־FY, 11 הם "שנה שנסגרה זה עתה" (שקול ל־TTM), ושלושה הם ASML/TSM (20-F) ו־C. טאב רבעונים קיים: 1,413 שורות ל־118 חברות, 12 רבעונים, Q4 מחושב וגם TTM. יוצאי דופן: C ועוד 9 חברות שתקופת ה־TTM שלהן מיושנת (ממצא 10).

## 4. מה נבדק ונמצא תקין
- **יציאה לפני דוח (state.py:141):** נבדק בהרצה מבוקרת על נרות סינתטיים ועל earnings.json מותאם. AMC בסשן הבא: exit_by=אותו יום, לא חסום. BMO: היום הקודם, חסום. UNKNOWN: היום הקודם, חסום. BMO בעוד 2 סשנים: exit_by=10-13, max_hold=1. דוח בעוד 5 ימים: מותר, החלון מתקצר. **עובדה.**
- **Q1 לא חוסם CORE:** Q1 ו־Q2 מקבלים NORMAL SCHEDULE. ACCELERATE רק ב־Q3/Q4 עם SMA200 עולה (state.py:162). **עובדה.**
- **Cheap Score:** אחוזון מול ערכים קודמים בלבד (`v[:-1]`), ≥252 ערכים קודמים (`len(v)<253 → nan`), DD252 בלי היום, `cheap_usable = q and slope200>0`. גבולות הרבעונים ≤25/≤50/≤75. **עובדה.**
- **Risk Engine (`tier_today`):** הספים 4/2.75/1.6 ו־−70/−50/−30 תואמים, ב־% כמו ב־risk_engine.csv. Risk_Tier נשאר קפוא מהקובץ. **עובדה.**
- **תקרות:** CAP של LOW/MED 10%, HIGH 6%, EXTREME 3%. SPEC: `min(0.003/(2×ADR60), EXTREME?2%:3%)` (do-tab:123). הסטופ במחיר הוא `price×(1−2×ADR60)`. **עובדה.**
- **TACTICAL רק ל־CORE, ו־WATCH/NON-CORE רק SPEC:** do-tab:113-128, state.py:177. **עובדה.**
- **מצבי נרות** (do-tab:76-89) תואמים לתיאור ב־CORE_SYSTEM §7, למעט ממצא 14. **עובדה.**
- **Worker:** `/core/state(.csv)` קורא מהריפו דרך GitHub API. `/core/file/*` מוגבל ב־regex לרשימה סגורה, בלי path traversal. `POST /core/log` כולל ניסיון חוזר על 409/422, סינון מפתחות `^[a-z_0-9]{1,40}$` וחיתוך ל־2,000 תווים. **עובדה.**
- **הזרקה:** do-tab ו־pkg-tab נמצאים ב־view.js (build-view.mjs:60-61,72). **עובדה.**
- **שחזור:** הרצה חוזרת של state.py על ההיסטוריה הקפואה שחזרה את כל הערכים המספריים (Cheap, quartile, SMA, ADR, tier) של הקובץ שבקומיט. נמצאו שני סוגי הבדלים: שדות הדוחות (ממצא 1) ו־BLK, ש־screen_sec.csv שלה השתנה אחרי בניית המצב. **עובדה.**
- **כלל ההפסקה של TACTICAL:** `months>=6 && tac.length>=30` רק על עסקאות סגורות. **עובדה.**

## 5. מה לא ניתן היה לבדוק ולמה
- האם `API_KEY` מוגדר ב־Worker החי: אין גישה ל־Cloudflare.
- התנהגות do-tab מול נרות Yahoo חיים: אין דפדפן או רשת לשוק. הלוגיקה נבדקה מקריאת הקוד בלבד.
- הסיבה לרבעונים החסרים ב־EDGAR (ממצא 10): אין גישה ל־SEC מהסביבה. ההשערה היא בעיית תגית או מסגרת ב־sec_facts.py.
- האם ה־Release של 10-13 קיים: מצב היום מפגר ביום, וזה שייך לצוות הנתונים.
- state.py רץ על נרות "דקה" סינתטיים (נר אחד ליום מתוך daily.csv.gz), ולכן לא נבדקו `nbars≥380` וזיהוי פיצולים על נתוני אמת.
