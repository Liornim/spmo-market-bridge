# צוות ביקורת 3 (רואי חשבון, שווי): סבב 2, ביקורת חוזרת אחרי התיקונים

תאריך: 2026-10-14. מצב הריפו: HEAD `041cf98`. השוויתי את קבצי התחום מול `0915ec1`.
הקבצים שנבדקו: `tools/core/secutil.py` (חדש), `tools/core/state.py:186-191, 249-250`, `tools/core/build_core_data.py`, `core/current_state.json` (state 2026-10-13, built 2026-10-14 06:53Z), `core/core_data.json` (built 06:22Z), `core/CORE_list.xlsx`, `core/screen_sec.csv`, `core/sec/*.json` (fetched 2026-10-14).
הסקריפטים של החישוב החוזר נמצאים ב־`scratchpad/a3r2/`.

## 1. סיכום מנהלים

- **עובדה:** ארבעת הממצאים הקריטיים והגבוהים של הצוות מסבב 1 תוקנו: MCD, FCF בלי capex (ב־state ובטבלת הרבעונים), ויחס ה־ADR של TSM. מצאתי חישוב חוזר זהה ל־P/E ול־FCF yield של AAPL, MCD, KO ו־MSFT.
- **עובדה:** סימון DATA STALE / EXTERNAL SOURCE REQUIRED מתפרסם בכל הערוצים: state, Data, quality_master, החבילה, do-tab והטאב "מצב היום". יש 11 מניות במצב DATA STALE ושתיים במצב EXTERNAL.
- **עובדה:** לא נמצאה רגרסיה בדרגה קריטית או גבוהה. נשארו ממצאים בינוניים: עמודת מטבע חסרה, ערכי sentinel מוצגים כמספרים, אין שווי שוק ל־V, ו־FCF=OCF בגיליון Data ובטבלת quality_master, בסתירה לגיליון הרבעונים ול־state.

## 2. סטטוס הממצאים מסבב 1

### קריטי/גבוה

| # סבב 1 | A-xx | חומרה | סטטוס | ראיה |
|---|---|---|---|---|
| 1. MCD: מניות במיליונים | A-04 | קריטי | **תוקן** | `secutil.py:52-53` (אם הערך קטן מ־1e5, מכפילים ב־1e6) ו־`sec_facts.py:187-190` (תיקון במקור). **עובדה:** ב־state יוצא ל־MCD market_cap=167.7B, pe_ttm=19.1, fcf_yield=4.63%. חישוב חוזר: NI TTM 8,787M, P/E 19.1, FCF yield 0.0463, זהה. ב־Raw_EDGAR מספר המניות של MCD הוא 711,100,000. |
| 2. FCF yield כש־capex חסר או ישן | A-22 | גבוה | **תוקן** | `secutil.py:27-34`: TTM מחושב רק מ־4 רבעונים שמסתיימים בתאריך הרבעון האחרון (±12 יום, טווח של עד 380 יום). `secutil.py:99-105`: אם אין capex, FCF=None ומתווספת הערה. **עובדה:** אצל VZ, NEE, PLD ו־COP ה־fcf_yield_ttm=None, עם valuation_note "capex not reported…". |
| 3. FCF בטבלת הרבעונים | A-22 | גבוה | **תוקן** | `build_core_data.py:113-114` מחזיר None כש־`cp_` או `tp` הם None. **עובדה:** ב־`CORE_list.xlsx` בגיליון Quarters, ל־VZ, COP ו־JPM ה־FCF ריק בכל 12 השורות. ב־MCD 2026-06-30 יוצא FCF=1,976, ובחישוב חוזר 2,807−831=1,976. |
| 4. TSM: יחס ADR ומטבע | A-23 | גבוה | **תוקן** (רכיב השווי) | `secutil.py:9` (ADR_RATIO TSM=5), `:95` (חלוקה ביחס), `:96-97` (יחידה שאינה USD מחזירה P/E ו־FCF=None עם הערה). **עובדה:** TSM market_cap=2.31T (445.18×25.93B/5). ל־ASML (1:1) 667.8B. ל־P/E ול־FCF של שתיהן None, עם "reports in TWD/EUR". |
| (בתחום) A-18: TTM ישן בלי סימון | A-18 | גבוה | **תוקן** (לפי החלטה 6) | `secutil.py:65-82` (`data_status`). השדות `state.py:250` fundamentals_status/_end מוצגים ב־`pkg-tab.html:92,116,204`, `do-tab.html:114,176` ו־`core.html:271`. ב־Data וב־quality_master נוספו עמודות "מצב הנתונים". **עובדה:** DATA STALE אצל ABT, C, CB, DUK, KO, MDLZ, NEE, PLD, SO, SPGI ו־V. EXTERNAL SOURCE REQUIRED אצל ASML ו־TSM. ה־P/E שלהן עדיין מחושב מה־TTM הישן, אבל מסומן. |

### בינוני/נמוך (לשלמות התמונה)

| # | סטטוס | ראיה |
|---|---|---|
| 5. אין עמודת מטבע ב־Data, Raw ו־quality_master (חלק מ־A-23) | **לא תוקן** | **עובדה:** בגיליון Data של TSM מופיעות "הכנסות (מיליון)"=2,894,307.7 ו־FCF=870,170.6, שניהם ב־TWD. ASML מופיעה ב־EUR. כרגע ליד הנתונים יש עמודה "EXTERNAL SOURCE REQUIRED" שמקטינה את הסיכון. `build_core_data.py:46` |
| 6. גיל ה־TTM לא מוצג | **תוקן** | ראו A-18 למעלה. |
| 7. ערכי sentinel ‏999/9.99/99 (חלק מ־A-49) | **לא תוקן** | **עובדה:** ב־core_data, ‏int_cov=999 ב־24 שורות, roic=9.99 ב־3, ו־nd_ebitda=99 ב־2, גם ב־Data וגם ב־quality_master. `screen_sec.py:170,173` |
| 8. אין שווי שוק ל־V ול־BRK-B (חלק מ־A-50) | **לא תוקן** (מסומן במפורש) | **עובדה:** valuation_note="no share count". ה־fallback של NI/EPS קיים (`secutil.py:54-58`), אבל ל־V ול־BRK-B אין eps_diluted, ו־`dei_shares_outstanding.instant` ריק (ריבוי סוגי מניות). V מסומנת CORE / NORMAL SCHEDULE בלי P/E. |
| 9. מספר מניות ממוצע מול מספר מניות למועד | לא תוקן | PANW: ‏764M מול dei של 818M. |
| 10. `ttm_end` נדרס | **תוקן** | `sec_facts.py:198` משתמש ב־`ttm_end_by_concept`. **עובדה:** ב־0 קבצים נשאר `ttm.ttm_end` ישן. |
| 11. מיפוי ATTRACTIVE→CHEAP בדפדפן | ללא שינוי (לא נדרש) | — |
| 12. state ו־core_data לא מסונכרנים | תקין כרגע | ה־state נבנה ב־06:53Z, אחרי core_data (06:22Z). את התיקון המבני (סדר ה־workflows) לא בדקתי, זה בתחום צוות 10. |
| 13. פורמט `#,##0;(#,##0);-` מציג 0 כ־"-" | לא תוקן | `build_core_data.py:147` |
| 14. אין עמודות form ו־unit ב־Raw_EDGAR | לא תוקן | העמודות ב־`core_data.raw.cols` לא כוללות unit ו־form. |
| 15. תקרת CORE מוצגת גם ל־WATCH ול־NON-CORE | לא תוקן | `build_core_data.py:41` |

## 3. ממצאים חדשים

| # | חומרה | קובץ:שורה | ממצא | ראיה | המלצה |
|---|---|---|---|---|---|
| N1 | בינוני | `screen_sec.py:98` → `build_core_data.py:46,127` | חוסר עקביות בתוך אותה חבילה: בגיליון Data ובטבלת quality_master (`fcf_m`) ה־FCF שווה ל־OCF כשאין capex. באותו זמן בגיליון Quarters ובשדה fcf_yield_ttm ב־state הערך הוא None. הבעיה הייתה קיימת גם קודם. מה שהתיקון שינה הוא שעכשיו יש הערה. | **עובדה:** בגיליון Data של VZ, ‏FCF=38,799, וזה בדיוק ה־OCF, עם הערה "CAPEX NOT REPORTED…: FCF = operating cash flow". גם NEE 12,330, PLD 5,136, COP 21,925, ABNB ו־APP. אצל JPM ‏FCF=-162,534 (בנק). **הערכה:** אין שינוי תווית ידוע, כי VZ ו־NEE הן NON-CORE ו־PLD ו־COP הן WATCH. ABNB ו־APP הן CORE-ELIGIBLE, אבל ה־capex שלהן קטן. | ב־Data וב־quality_master לפרסם FCF=None כשאין capex, כמו ב־state. לפיננסיות לפרסם "n/a". |
| N2 | נמוך | `secutil.py:101` | P/E מתפרסם גם כשהרווח קרוב לאפס, ובמקרה של הפסד מתפרסם None בלי הסבר. | **עובדה:** CRWD 6,061.9 (NI TTM ‏45M), PANW 988.0, DDOG 592.0, TSLA 349.2. אצל GILD, INTC, MSTR, RBLX, SNOW ו־COIN ה־pe=None, ושדה valuation_note ריק. המספרים עצמם נכונים מבחינה חשבונית, וחישבתי אותם מחדש. | מעל P/E של 100, או כש־NI≤0, לפרסם "NM" עם valuation_note ("loss" / "near-zero earnings"). |
| N3 | נמוך | `state.py:192` מול `secutil.py:105` | למניות פיננסיות מוצגת סיבה שגויה להיעדר FCF yield. | **עובדה:** אצל JPM, BAC, MS, WFC, CB, HOOD, KKR ו־COIN ה־valuation_note הוא "capex not reported…", אבל ה־FCF yield מבוטל בשבילן בכל מקרה בגלל FINSET. אצל AXP, GS, C, PGR, SCHW, BLK, BX ו־SOFI ה־FCF ריק ואין שום הסבר. | אם המניה ב־FINSET, הערה אחידה: "FCF not meaningful for financials". |
| N4 | נמוך | `secutil.py:52`, `sec_facts.py:190` | בדיקת הסבירות של מספר המניות בודקת רק סף (פחות מ־1e5), ולא משווה ל־NI/EPS כפי שהומלץ. מקרה של יחידה באלפים לא ייתפס. | **עובדה:** מצב נוכחי: אצל 116 מניות מספר המניות נמצא בטווח ±15% מ־NI/EPS. CRWD ו־KLAC חורגות בגלל פיצול, וה־dei אחרי הפיצול מאשר את המספר. לכן אין היום ערך שגוי. זה סיכון שנשאר, לא באג פעיל. | להוסיף בדיקה של shares≈NI/EPS בטווח 0.8–1.25, ואם הבדיקה נכשלת, `valuation_note`. |
| N5 | נמוך (לצוותים 1 ו־2) | `sec_facts.py:90` | בחירת היחידה "לפי התקופה האחרונה" נעלה מושגי חוב של מגישי USD על EUR. | **עובדה:** אצל BRK-B, ‏debt_total = DebtAndCapitalLeaseObligations ב־EUR, עם נתון אחרון מ־2024-09-30. כתוצאה, ב־screen נרשם "NO RECENT DEBT FIGURE (debt counted as 0)" וחוב נטו של ‎-41.4B. אצל TMUS ‏debt_instrument_carrying ב־EUR (4.8B), אבל הוא לא נבחר. אין שינוי תווית: BRK-B היא NON-CORE בגלל profit ו־dilution. | אצל מגיש שה־revenue שלו ב־USD, לנעול את היחידה של מושגי הכסף על USD. |

**תצפית (לא ממצא, החלטת בעלים):** TSM ו־ASML (EXTERNAL SOURCE REQUIRED) וכן PLD (DATA STALE) מקבלות core_decision=ACCELERATE TRANCHE. גם CB, DUK, KO, SO, SPGI ו־V מקבלות NORMAL SCHEDULE. הסימון מוצג, כפי שקובעת החלטה 6. **השערה:** ייתכן שהבעלים ירצה שנתונים ישנים או חיצוניים לא יאיצו מנה עד שהנתונים יאומתו. זו החלטה ולא באג.

## 4. מה נבדק ונמצא תקין

- **עובדה:** חישוב חוזר עצמאי של P/E ו־FCF yield (מחיר × מניות מדוללות אחרונות, ‏NI/OCF/capex של 4 הרבעונים האחרונים) ל־AAPL (39.0 / 2.72%), MCD (19.1 / 4.63%), KO (28.4 / 3.23%) ו־MSFT (30.3 / 1.65%) יצא זהה לגמרי. גם ל־XOM, PANW, CRWD, SMCI, DUK, NVDA ו־GOOGL הקלטים מיושרים לאותו רבעון אחרון.
- **עובדה:** כל המושגים שאינם ב־USD נמצאים רק אצל ASML, TSM, BRK-B (חוב) ו־TMUS (חוב), כך שאין ADR או מטבע זר נוספים שלא טופלו בשווי.
- **עובדה:** אין FCF yield גדול מ־20% או קטן מ־‎-20%, פרט ל־SMCI ‏(‎-25.6%). אצל SMCI זה נובע מ־OCF רבעוני של ‎-6,615M, שמופיע ב־EDGAR. אין P/E קטן מ־3.
- **עובדה:** הלוגיקה של `data_status` (`expected_latest`, כלומר רבעון + 45 יום, או סוף שנה + 90, וסף של 40 יום) נותנת היום תוצאות סבירות. בדקתי גם תאריכים עתידיים (ינואר, פברואר, נובמבר) ולא מצאתי סימון STALE שגוי ברבעונים פיסקליים לא קלנדריים.
- **עובדה:** `CORE_list.xlsx` (commit מ־2026-10-14 09:23) תואם ל־core_data.json בגיליונות Data ו־Quarters.

## 5. מה לא ניתן היה לבדוק

- נכונות המספרים עצמם מול דוחות החברות. לדוגמה, OCF רבעוני של NVDA ‏(50.3B ואחריו 24.1B שנגזר מ־YTD) ו־NI של GOOGL ב־Q2/2026 ‏(112B). אין לי גישת רשת ל־EDGAR. האחריות כאן של צוות 1.
- סדר ההרצה המבני בין sec-facts ל־core-state (צוות 10).
