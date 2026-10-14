# צוות 10, סבב 2: QA, אבטחה ותפעול (בדיקה חוזרת אחרי התיקונים)

תאריך: 2026-10-14. נבדק ב־HEAD `041cf98`, מול סבב 1 ב־`c32206b`. לא שיניתי את הריפו.
**שיטה:**
- `worker.js` רץ ב־Node עם `fetch` מדומה, על `/core/log`, `/core/file/*` ו־`/xa/alpaca_*`.
- Playwright (Chromium headless, רוחב 375, אזור זמן LA) בשלושה מצבים: נתונים אמיתיים, `/core/state`→503, ו־state עם מטען XSS/נוסחה.
- סימולציה של לולאת ה־push עם `-X theirs` בשני ריפו git מקומיים.
- היסטוריית runs, check-runs ו־issues דרך GitHub API.

קבצי הבדיקה נמצאים ב־`scratchpad/audit2/t10/` (wt.mjs, CSV/XLSX שירדו, do375.png). סקריפטי Playwright: `/tmp/claude-0/pw/r2.mjs`, `/tmp/claude-0/pw/r3.mjs`.

## 1. סטטוס הממצאים הקודמים

### קריטי/גבוה (A-01, A-02, A-28, A-29)

| ID (סבב 1) | ממצא | סטטוס | ראיה |
|---|---|---|---|
| A-01 (10#1, קריטי) | יומן העסקאות נכתב לריפו ציבורי | **נדחה בהחלטת בעלים** (אין יומן כרגע) | **עובדה:** הריפו עדיין `public`. ‏`core/trade_log.json` ריק (`{"updated": null, "entries": []}`). ב־UI: `pk-form-box hidden=true`, ואין כפתורי log/quarter (Playwright: 0). `POST /core/log` בלי `API_KEY` מחזיר 503. **שארית:** הנתיב עצמו לא הושבת. כש־`API_KEY` מוגדר, POST עם מפתח מחזיר 200 ועושה PUT ל־`contents/core/trade_log.json` (נבדק ב־Node). ראו N1. |
| A-02 (10#2, גבוה) | `/core/log` פתוח כשאין `API_KEY` | **תוקן** | worker.js:1904. **נבדק:** בלי `API_KEY` מתקבל 503, עם מפתח מוגדר ובלי header מתקבל 401, ועם `X-Api-Key` נכון 200. ההגדרה בפועל של `API_KEY` ב־Worker לא ניתנת לבדיקה מכאן (‏`*.workers.dev` מחזיר CONNECT 403). ‏`?key=` עדיין מתקבל (נמוך, 10#18). |
| A-28 (10#3, גבוה) | מחיקה שקטה של היומן (200 בלי `content`, או JSON פגום) | **לא תוקן בקוד, רדום** בגלל ההחלטה | worker.js:1915 עדיין `catch (e) { /* keep empty */ }`, ו־1912 עדיין `if (cur.status===200 && cur.json.content)`. הנתיב ייחשף ברגע ש־`API_KEY` יוגדר. ראו N1. |
| A-29 (10#4, גבוה) | עדכון EDGAR השבועי לא נפרס | **תוקן** (החלק של deploy). Workers Builds עדיין נכשל | **עובדה:** deploy.yml רץ ב־`workflow_run` אחרי sec-facts ב־06:05Z (`d4c452a`) וב־06:10Z (`8096e73`), שתי הריצות success. **עובדה:** ה־check-run "Workers Builds: spmo-market-bridge" על HEAD `041cf98` הוא `failure`. ההשפעה נמוכה, כי הפריסה עוברת דרך deploy.yml. |

### בינוני (A-31 עד A-37)

| ID | ממצא | סטטוס | ראיה |
|---|---|---|---|
| A-31 (10#5) | Excel חלקי כש־`/core/state` נכשל | **לא תוקן, ועכשיו גרוע יותר** | Playwright, `/core/state`→503: הקובץ `CHAT_package___downloaded_2026-10-14_0956.xlsx` מכיל **3** גיליונות (README, quality_master, method). בסבב 1 היו 5, כי הסרת הלוג הורידה עוד 2. ב־README השורה "מצב נכון לסגירת" ריקה, וההודעה היא "הורד 14/10/2026 09:56 (ישראל)" בלי אזהרה. הקוד ב־pkg-tab.html:340 (`if(!t) return`) לא השתנה. |
| A-32 (10#6) | CSV formula injection | **חלקי.** וקטור הקלט של המשתמש (יומן, `+6% TARGET`) הוסר. ה־escape לא תוקן | pkg-tab.html:316 (`csvOf`) לא השתנה. **נתונים אמיתיים:** 0 תאים שמתחילים ב־`= + - @` ב־6 קובצי ה־CSV. **מטען מוזרק ב־state:** ‏13 תאים `"=HYPERLINK(...)"` ב־dec/state/earn/month. ה־xlsx נקי: 0 תאי נוסחה. החומרה ירדה לנמוך. |
| A-33 (10#7) | לולאת push ירוקה גם כשה־push נכשל | **חלקי** | core-state.yml:53 ו־sec-facts.yml:50 תוקנו. בסימולציה עם קונפליקט modify/delete יצא `push failed`, exit=1. **לא תוקן:** nightly.yml:180, scan.yml:55, hist.yml:48, hist-mirror.yml:36, probe*.yml, r2-setup.yml:32 (הלולאה הישנה). |
| A-34 (10#8) | גודל ה־bundle והדף | **לא תוקן, וגדל** | `CORE_HTML` עכשיו 2,607,653 bytes (בסבב 1: 2,362,940). gzip של worker+view+v2+archive: 1,896,376 bytes (בסבב 1: 1,853,672). **עובדה:** issue #149 מראה "exceeded D1's free tier". **הערכה:** החשבון בתוכנית Free, כך שהמגבלה היא 3MB אחרי דחיסה ונשארו כ־1.1MB. |
| A-35 (10#9) | `/core/state` ו־`/core/file/*` בלי מטמון, כל בקשה עם ה־PAT | **לא תוקן** | worker.js:1876-1899, ‏`H` עם `no-store` (שורה 1659). אין `caches.default`. |
| A-36 (10#10) | זמנים ביומן בלי אזור זמן | **נדחה בהחלטת בעלים** (אין יומן) | |
| A-37 (10#13) | core-state על כל export | **חלקי** | נוסף `if: conclusion=='success'` (core-state.yml:25). אבל export מדווח success גם כשאין חדש: שלוש ריצות export הלילה (02:05, 05:11, 06:20Z) הפעילו כל אחת core-state. **עובדה:** הקומיט `ba2452d` (05:14Z) שינה רק את `current_state.json` ו־`earnings.json`, שורה אחת בכל קובץ (חותמות זמן). |
| A-14 | מעקב אחרי מגבלות התיק | **נדחה בהחלטת בעלים** (תלוי ביומן) | |

## 2. ממצאים חדשים

| # | חומרה | קובץ:שורה | ממצא | ראיה |
|---|---|---|---|---|
| N1 | **בינוני** | worker.js:1901-1935, 1886-1899 | ההחלטה "אין יומן" מומשה רק ב־UI. ה־API של הכתיבה חי, ויופעל ברגע שיוגדר `API_KEY`, כלומר בדיוק הצעד שהומלץ ב־A-02 כדי להגן על נתיבים אחרים. מאותו רגע חוזרים גם A-01 (כתיבה לריפו ציבורי) וגם A-28 (מחיקה שקטה). ‏`/core/file/trade_log.json` גם פתוח לקריאה. | **נבדק:** עם `API_KEY='K'` ו־header נכון מתקבל 200 `{"ok":true,"entries":1}` ונשלח PUT ל־GitHub. גם `{"delete":"nope"}` עם `?key=` מחזיר 200 ועושה commit. **המלצה:** להחזיר 410 בלי תנאי ב־`/core/log` (ואת `trade_log.json` להסיר מה־regex של `/core/file`) עד שתתקבל הכרעה על אחסון פרטי. |
| N2 | **בינוני** (השערה לגבי Alpaca) | tools/core/yahoo.py:49-58; state.py:91-99 | ב־fallback של Alpaca, תשובה **ריקה** נחשבת לאישור "אין פיצול" ונשמרת לצמיתות ב־`splits.json._checked`, כך שלעולם לא תיבדק שוב. ‏`BRK-B` נשלח ל־Alpaca כמו שהוא, אבל Alpaca משתמש ב־`BRK.B`. | **עובדה (Node):** ‏`/xa/alpaca_splits?symbol=BRK-B` מעביר ל־upstream את `symbols=BRK-B`. **עובדה (קוד):** ‏`splits()` מחזיר `[]` כש־`corporate_actions` ריק, ו־state.py רושם `checked[key]='no split'`. **השערה:** ש־Alpaca עונה 200 עם תוצאה ריקה על `BRK-B` (אין מפתחות לבדוק). **ההשפעה:** פיצול אמיתי שמזוהה רק דרך ה־fallback לא יתוקן, והמניה תיראה כירידה של כ־50%, תעבור ל־Q4 ותקבל ACCELERATE. בנוסף, כשגם Alpaca נכשל ההודעה היא "Yahoo unreachable", וזה מטעה. |
| N3 | נמוך-בינוני | archive_routes.js:384-398 | `/xa/alpaca_daily` ו־`/xa/alpaca_splits` פתוחים בלי מפתח ובלי מטמון, ומשתמשים במפתחות Alpaca של הבעלים. ‏`alpaca_daily` כבר לא בשימוש בלילה (fill_gaps הוסר ב־`041cf98`, ואין קריאה ב־workflows). | **נבדק:** הוולידציה תקינה. symbol עובר `validSym`, ותאריכים עוברים `^\d{4}-\d{2}-\d{2}$`. הזרקה `end=...%26feed%3Diex` ו־`symbol=AAPL,MSFT` מחזירות 400. ‏`9999-99-99` עובר את ה־regex (ה־upstream ידחה). **הערכה:** לקוח עוין יכול לכלות את מכסת Alpaca (200 בקשות לדקה בתוכנית החינמית). אז אישור הפיצולים בלילה ייכשל ל־"unconfirmed" (נכשל בגלוי, `ok=false`), וגם תצוגת pre/after ב־`/xa/alpaca` תיפגע. המלצה: להסיר את `alpaca_daily` או להגן עליו ב־`authorized`, ולהוסיף מטמון של כ־1 שעה ל־splits. |
| N4 | נמוך | core-state.yml:53; sec-facts.yml:50 | `-X theirs` ב־rebase דורס בשקט hunks מקבילים של upstream בקבצים שה־bot מבצע להם commit. | **סימולציה:** מפתח דחף `l2→DEV-FIX` ל־view.js, וה־bot דחף `l2→BOT-BUILD`. התוצאה: exit=0, ‏view.js=`BOT-BUILD`, ‏VERSION=`2b`. התיקון של המפתח נעלם מ־view.js. **הערכה:** הדף שבאוויר לא נפגע, כי deploy.yml מריץ `build-view.mjs` מהמקורות. view.js בריפו יוצא לא מסונכרן עד הבנייה הבאה. בקבצי core (‏daily_new.csv, splits.json) קונפליקט ייפתר לטובת ה־bot, ושורות שנוספו במקביל ב־upstream יאבדו. |
| N5 | נמוך | do-tab.html:186-189 | כשנרות היום לא נטענו (Yahoo חסום או נכשל), הסיכום מציג "**השוק סגור**", ובדיקת ה־stale (`today>ACTS && anyLive`) לא תופעל. | **Playwright** (Yahoo→404): ‏`#doSum` = "… נרות השוק סגור · SPY — · QQQ — · 116 סימולים". בזמן מסחר זה מטעה. |

### נבדק ותקין בסבב 2
- **XSS:** הוזרקו `<img src=x onerror=…>` ו־`=HYPERLINK` לשבעה שדות טקסט של AAPL ב־state. ב־`/core` לא נוצר אף `<img>`, ‏`window.__x` נשאר undefined ולא נפתח dialog. ב־do-tab כל אינטרפולציה חדשה עוברת `esc()` (שורות 154-189), ו־`COL[x.dec]` הוא lookup בטבלה.
- **מובייל 375px:** בכל 8 הלשוניות של `/core`, ‏`scrollWidth==375`. ב־do-tab (בתוך `/bars`) ‏375/375, עם 132 שורות ו־116 כרטיסים, ובלי שגיאות JS.
- **הורדות עם נתונים אמיתיים:** 6 קובצי CSV ו־xlsx של 8 גיליונות, 0 תאי נוסחה, וחותמת שעון ישראל תקינה.
- **לולאת ה־push:** כשל אמיתי מסתיים ב־exit 1 (אומת בסימולציה).
- **`workflow_run` של deploy אחרי sec-facts:** בפועל רץ והצליח פעמיים.

## 3. מה נשאר קריטי או גבוה

- **אין ממצא קריטי או גבוה פתוח בתחום של צוות 10.**
- A-01 ו־A-28 נדחו בהחלטת בעלים, כי היומן כבוי. הם יחזרו כקריטי וגבוה ברגע שיוגדר `API_KEY`, כל עוד `/core/log` לא מושבת בקוד (N1).
- הפתוחים בדרגת בינוני: N1, N2, A-31 (Excel חלקי, הורע), A-34 (bundle גדל), A-35, ו־A-33 ב־nightly/scan/hist.

**ספירה של ממצאי סבב 1 בתחום (A-01, 02, 28, 29, 31, 32, 33, 34, 35, 36, 37):**
- תוקנו: 2 (A-02, A-29)
- חלקי: 3 (A-32, A-33, A-37)
- לא תוקנו: 3 (A-31, A-34, A-35)
- נדחו בהחלטת בעלים: 3 (A-01, A-36, ו־A-28 רדום)
- A-14 (מעקב מגבלות התיק) נדחה גם הוא, בנפרד מהספירה.
