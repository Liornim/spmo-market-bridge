# אינדקס התיעוד והדפים — spmo-market-bridge (עודכן 14.10.2026, אחרי ביקורת סבב 2)

נקודת כניסה אחת לכל התיעוד, הדפים, קבצי הנתונים, הסקריפטים וה־workflows של הפרויקט.
המערכת הפעילה לקבלת החלטות היא **מערכת CORE** (השיטה הקפואה מ־13.10.2026). שאר הרכיבים (ארכיון הנרות, Trader V2, Radar, Scanner) הם התשתית שמתחתיה או ניסויים קודמים.

**להתחיל כאן:**
1. [`CORE_SYSTEM.md`](CORE_SYSTEM.md) — התיעוד המלא של מערכת CORE: השיטה, הנתונים, הדפים, לוח הרענון, יומן ההחלטות, בעיות ידועות.
2. [`GLOSSARY.md`](GLOSSARY.md) — כל המונחים, עם הגדרה מדויקת לפי הקוד.
3. [`audit/AUDIT-2026-10-14-round2.md`](audit/AUDIT-2026-10-14-round2.md) — דוח הביקורת החוזרת (סבב 2, 10 צוותים): סטטוס כל ממצא קריטי/גבוה, ממצאים חדשים, מה תוקן אחרי הביקורת, מה נשאר, וסטטוס 16 ההחלטות.
4. [`audit/AUDIT-2026-10-14.md`](audit/AUDIT-2026-10-14.md) — דוח הביקורת המאוחד של סבב 1 (11 צוותים, 80 ממצאים `A-xx`).

הריפו **ציבורי** (`Liornim/spmo-market-bridge`). כל קובץ בו גלוי לכולם. בגלל זה, ולפי החלטת נועם מ־14.10, יומן העסקאות מושבת: `core/trade_log.json` ריק ו־`POST /core/log` מחזיר 410 (ממצא A-01).
כתובת ה־Worker: `https://spmo-market-bridge.noamharelnim.workers.dev` (מופיעה ב־`tools/set_live_tier.py`).

---

## 1. דפים ו־URL

### 1.1 מערכת CORE

| URL | קובץ מקור | מטרה |
|---|---|---|
| `/core` | `core.html` + `pkg-tab.html` (מוטמעים ב־`view.js`) | רשימת CORE: מסנן EDGAR, סקירות, מצב לילי, חבילה ל־CHAT |
| `/core#state` | core.html | **מצב היום** — current_state לכל 131 הסמלים (42 עמודות), סינון, הורדת CSV |
| `/core#list` | core.html | **רשימה** — תווית מסנן EDGAR, 6 הכללים, Risk Tier, Cheap Score, Quality סופי |
| `/core#review` | core.html | **סקירה** — 120 הסקירות העסקיות |
| `/core#data` | core.html | **נתונים** — המדדים שעליהם נמדד המסנן |
| `/core#quarters` | core.html | **רבעונים** — 12 רבעונים אחרונים לכל חברה, TTM |
| `/core#rules` | core.html | **כללים** — `core/CORE_RULES.md` |
| `/core#raw` | core.html | **נתונים גולמיים** — כל התקופות מ־EDGAR |
| `/core#pkg` | pkg-tab.html | **חבילה ל־CHAT** — 6 טבלאות (decision_table, current_state, earnings_calendar, quality_master, data_health, monthly_snapshot), טבלת רענון, Excel של 8 גיליונות ו־CSV. יומן העסקאות והסקירה הרבעונית מושבתים |
| `/bars` (טאב "מה לעשות היום") | `archive-bars.html` + `do-tab.html` | השיטה מוחלת מכנית: שורה לכל מסלול (CORE, TACTICAL, SPECULATIVE, INDEX ל־VOO/SPY), החלטת CORE, חסימות לפני דוח לפי לוח NYSE, מצב נרות תוך־יומי מ־Yahoo |

נתיבי נתונים של CORE (פירוט: CORE_SYSTEM.md §12):

| נתיב | מחזיר | הרשאה |
|---|---|---|
| `GET /core/state` | `core/current_state.json` מ־main | פתוח |
| `GET /core/state.csv` | `core/current_state_latest.csv` (כ־`current_state.csv`) | פתוח |
| `GET /core/file/earnings.json` | לוח הדוחות | פתוח |
| `GET /core/file/trade_log.json` | יומן העסקאות (ריק) | **פתוח לקריאה** |
| `GET /core/file/history` · `/core/file/history/state_YYYY-MM-DD.csv` | רשימת צילומי מצב / קובץ אחד | פתוח |
| `POST /core/log` | **410 בלי תנאי** — היומן מושבת (החלטה 1, 14.10; `worker.js:1904`) | — |
| `GET /auth` | האם נדרש מפתח | פתוח |
| `GET /xa/alpaca_splits?symbol=&start=&end=` | אירועי פיצול מ־Alpaca (corporate actions). הגיבוי של `tools/core/yahoo.py` לאישור פיצולים כש־Yahoo מחזיר 429 (`archive_routes.js:387-399`) | פתוח, בלי מטמון |
| `GET /xa/alpaca_daily?symbol=&start=&end=` | נרות יומיים מותאמים לפיצול מ־Alpaca SIP. משמש רק את `fill_gaps.py`, שלא מתוזמן | פתוח, בלי מטמון |

### 1.2 ארכיון הנרות ושאר הדפים

| URL | קובץ מקור | מטרה |
|---|---|---|
| `/bars`, `/archive-bars` | `archive-bars.html` (+ `update-tab.html`, `do-tab.html`) | ארכיון נרות הדקה (Supabase): טאבים נרות דקה, לייב, מחירים יומיים, הורדה מרובה, כיסוי, מה לעשות היום, Opportunity Scanner, עדכון DB, V2 (מוסתר) |
| `/dbcheck` | `db-check.html` | "בדיקת DB" — בדיקת ה־DB של הנרות (Supabase בלבד) |
| `/view`, `/view/<SYM>` | `view.html` (+ engine) | הדף הישן של מניה בודדת (מנוע הייצור) |
| `/radar` | `radar.html` | Radar (מנוע הייצור הישן) |
| `/scan` | `scan.html` | דף הסורק הישן |
| `/data` | `data.html` | עיון ב־DB (D1) מהדפדפן |
| `/db` | `db.html` | מה מאוחסן ב־D1, יומן ריצות, מדי מכסה |
| `/replay` | `replay.html` | Replay של הסורק |
| `/trader-v2`, `/trader-v2/live`, `/trader-v2/radar`, `/trader-v2/qa` | `trader-v2-*.html` | Trader V2 — מנוע ניסיוני, קפוא, בלי מסלול הזמנות |
| `/xa/*` | `archive_routes.js` | נתוני הארכיון לדפים (כולל `/xa/scan`, `/xa/alpaca`, `/xa/alpaca_daily`, `/xa/alpaca_splits`) |
| `/v2/*` | `v2_routes.js` | צנרת V2 |
| `/log`, `/export/<SYM>`, `/mirror` ועוד | `worker.js` | ראו `README.md` בשורש הריפו |

---

## 2. קבצי נתונים ב־`core/`

| קובץ | מי מייצר | מי צורך | מתי מתעדכן |
|---|---|---|---|
| `daily.csv.gz` | ידני (מחקר; זהה ל־`daily_adj.pkl`) | `state.py` | **קפוא עד 2026-10-12** |
| `daily_new.csv` | `state.py` (מצטבר: ימי ה־Release שאחרי ההיסטוריה הקפואה) | `state.py` (נקרא בכל ריצה) | כל ריצת core-state |
| `splits.json` | `state.py` (פיצולים שאושרו + `_checked`) | `state.py` | כל ריצה (מצטבר). היום ריק |
| `current_state.json` | `state.py` | `/core/state`, טאבי מצב היום וחבילה, do-tab, `build_core_data.py` | כל לילה אחרי export + 08:00 UTC |
| `current_state_latest.csv` | `state.py` | `/core/state.csv` | כמו למעלה |
| `history/state_<date>.csv` | `state.py` | `/core/file/history*`, טאב החבילה | כל ריצה (דורס לאותו תאריך) |
| `earnings.json` | `earnings.py` | `state.py`, `/core/file/earnings.json` | כל ריצת core-state (הקובץ הקודם נשמר כשהמקור נכשל) |
| `sec/<T>.json` (120), `sec/_report.json`, `sec/_tags.json` | `sec_facts.py` | `screen_sec.py`, `state.py`, `build_core_data.py` | שבת 09:30 UTC + ידני |
| `screen_sec.csv` | `screen_sec.py` | `state.py`, `build_core_data.py` | שבת, אחרי sec_facts |
| `core_data.json` | `build_core_data.py` | `build-view.mjs` (מוטמע ב־`/core`), `earnings.py`, `state.py` (Review_final), `screen_sec.py` (תווית קודמת) | שבת ובכל עדכון סקירות; נכנס לדף בפריסה (אוטומטית אחרי sec-facts) |
| `CORE_list.xlsx` | `build_core_data.py` | `build-view.mjs` (כפתור "הורד Excel" ב־`/core`) | שבת |
| `review/<T>.json` (120) | ידני (Claude, לפי הפרוטוקול) | `state.py`, `build_core_data.py` | 13.10 (סבב 1, 86 קבצים); 14.10 (סבבים 2 ו־2b, 34 קבצים) |
| `review/REVIEW_PROTOCOL.md` | ידני | הסוקרים | קפוא 13.10; ברירת המחדל עודכנה ל־EDGAR ב־14.10 |
| `risk_engine.csv` | ידני (מחקר) | `state.py` | קפוא (ADR60 של 30.9.2026); רבעוני |
| `CORE_RULES.md` | ידני | `build_core_data.py` (גיליון Rules), טאב כללים | קפוא 13.10 |
| `trade_log.json` | — (מושבת) | `/core/file/trade_log.json` | ריק; לא מתעדכן (החלטה 1) |

---

## 3. סקריפטים

### 3.1 מערכת CORE (`tools/core/`)

| סקריפט | קלט | פלט | מי מריץ |
|---|---|---|---|
| `sec_facts.py` | SEC companyfacts (`data.sec.gov`) | `core/sec/<T>.json`, `_report.json`, `_tags.json` | `sec-facts.yml` |
| `screen_sec.py` | `core/sec/*.json`, `core_data.json` (תווית קודמת) | `core/screen_sec.csv` | `sec-facts.yml` |
| `build_core_data.py` | `screen_sec.csv`, `sec/`, `review/`, `current_state.json`, `CORE_RULES.md` | `core/core_data.json`, `core/CORE_list.xlsx` | `sec-facts.yml` |
| `earnings.py` | `api.nasdaq.com` (‎-25/+75 ימים מהתאריך בניו יורק, כולל סופי שבוע), `core_data.json` | `core/earnings.json` (כל אירועי הדוח בחלון). לא כותב כש־>20 ימים נכשלו או נמצאו <60 סמלים | `core-state.yml` (timeout 8 דקות, `continue-on-error`) |
| `state.py` | `daily.csv.gz`, `daily_new.csv`, Release הנרות, `splits.json`, `risk_engine.csv`, `core_data.json`, `screen_sec.csv`, `earnings.json`, `review/`, `sec/` | `current_state.json`, `current_state_latest.csv`, `daily_new.csv`, `splits.json`, `history/` | `core-state.yml` |
| `nyse.py` | — (כללי NYSE Rule 7.2 + `EXTRA_CLOSED`) | מודול: חגים, ימים מקוצרים (13:00), `next_session`, `prev_session`, `sessions_between`, `sessions`, `full_bars` | מיובא ע"י `state.py`, `fill_gaps.py`; רשימת החגים 2026–2028 הועתקה ל־`do-tab.html` |
| `secutil.py` | `core/sec/<T>.json` | מודול: TTM מיושר לרבעון האחרון, מניות מדוללות (כולל תיקון מיליונים), `data_status` (OK / DATA STALE / EXTERNAL SOURCE REQUIRED), שווי שוק, P/E, FCF yield, יחס ADR | מיובא ע"י `state.py`, `screen_sec.py` (ה־docstring מזכיר גם את `build_core_data.py`, אבל הוא לא מייבא אותו) |
| `yahoo.py` | Yahoo chart API; ואם נכשל — `/xa/alpaca_splits` ו־`/xa/alpaca_daily` ב־Worker | מודול: `splits()` (אירועי פיצול), `daily()` (נרות יומיים) | `splits()` — `state.py` (אישור פיצולים); `daily()` — רק `fill_gaps.py` |
| `fill_gaps.py` | `daily.csv.gz`, `nyse.py`, `yahoo.daily` | משלים ימים חסרים ב־`daily.csv.gz`, רושם ב־`core/daily_filled.json` | **לא מתוזמן** (הוסר מהצנרת ב־`041cf98`: Alpaca החזיר נרות "שטוחים"). `state.py` ממלא במקום זה יום חסר בודד בערך הקודם |
| `build-view.mjs` (שורש) | כל קבצי ה־HTML, `core/core_data.json`, `core/CORE_list.xlsx` | `view.js`, `VERSION` (מעלה מונה) | `sec-facts.yml`, `deploy.yml`, ידני |

### 3.2 ארכיון הנרות (`tools/`)

| סקריפט | מטרה |
|---|---|
| `archive_sync.mjs` | `archive_bars` (סשן רגיל) = Alpaca SIP; כותב רק הבדלים |
| `ext_sync.mjs` | pre/after-market מ־Alpaca → `archive_ext_bars` |
| `bars_from_archive.mjs` | טבלת `bars` ← ארכיון ל־7 הסשנים האחרונים |
| `bars_trim.mjs` | שומר את `bars` על 7 סשנים בדיוק |
| `archive_from_bars.mjs` | העתקת `bars` לארכיון (בלי מחיקה) |
| `archive_audit.mjs` | ביקורת מלאה של `archive_bars` |
| `qa_count_check.mjs`, `qa_accuracy_check.mjs` | בדיקות ספירה ודיוק בלתי תלויות (מול Alpaca) |
| `nightly_verdict.mjs` | PASS/FAIL של הריצה הלילית |
| `db_prune.mjs` | מוחק ימים ישנים (ברירת מחדל 58) רק אם קובץ ההיסטוריה ב־R2 זהה |
| `export_all.mjs` | כל הנרות כ־CSV ל־Release הלילי |
| `hist_build.mjs`, `hist_verify.mjs`, `hist_mirror.mjs` | קבצי היסטוריה חודשיים ב־R2, אימות, ומראה ל־Release "history" |
| `register_symbols.mjs`, `names_sync.mjs` | רישום סמלים חדשים; שמות חברות → `data/names.json` |
| `supabase_backfill.mjs` | מילוי Supabase מ־Yahoo (7 ימים) |
| `load_test_raw.mjs` | בדיקת עומס של הורדה מרובה |
| `probe_*.mjs`, `probe_*.py`, `inventory*.py`, `set_live_tier.py` | בדיקות חד־פעמיות ודיווח (Alpaca/Yahoo/Worker/דף) |
| `tools/scanner/` | Opportunity Scanner (`run_scan.mjs`, `engine.mjs`, בדיקות) |

---

## 4. Workflows (`.github/workflows/`)

| Workflow | טריגר | מה עושה | פלט |
|---|---|---|---|
| `core-state.yml` | אחרי `export` שהסתיים success (`workflow_run`), cron `0 8 * * *` UTC, ידני. timeout 30 דקות | `earnings.py` (8 דקות, `continue-on-error`) → `state.py` → commit (`exit 1` אם ה־push נכשל) | `core/current_state.*`, `earnings.json`, `daily_new.csv`, `splits.json`, `history/` |
| `sec-facts.yml` | שבת 09:30 UTC, ידני | `sec_facts.py` → `screen_sec.py` → `build_core_data.py` → `build-view.mjs` | `core/sec/`, `screen_sec.csv`, `core_data.json`, `CORE_list.xlsx`, `view.js`, `VERSION`. הפריסה נעשית ע"י `deploy.yml` (`workflow_run`). `state.py` לא רץ כאן (A-30) |
| `deploy.yml` | push ל־main של `worker.js`/`view.js`/`v2_*.js`/`archive_routes.js`/`wrangler.toml`/`migrations/**`; אחרי `sec-facts` שהסתיים success (`workflow_run`); ידני (מצבי probe/diagnose/inventory) | `wrangler deploy` | Worker |
| `nightly.yml` | cron 21/22/23/01/03 UTC (≈00:00 ישראל), push של `.github/nightly-request.json` | Alpaca → ארכיון, בדיקות, verdict; FAIL → issue | Supabase, `.github/audit/` |
| `export.yml` | cron 23:30/00:30/01:30/03:30/05:30 UTC (פעם לתאריך ישראל) | כל הנרות → zip | Release `candles-YYYY-MM-DD` (7 אחרונים) |
| `hist.yml` | push של `.github/hist-request.json`, ידני | בניית קבצי היסטוריה ב־R2 ואימות | R2 |
| `hist-mirror.yml` | אחרי `hist`/`nightly`, ידני | מראה של R2 ל־Release "history" | Release |
| `scan.yml` | push של `.github/scan-request.json`, ידני | Opportunity Scanner | `scan/latest.json` + CSV |
| `supabase-backfill.yml` | ידני | מילוי Supabase מ־Yahoo | Supabase |
| `probe.yml`, `probe-page.yml`, `r2-setup.yml` | push של קובץ בקשה / ידני | בדיקות קריאה בלבד; הקמת R2 | commit של תוצאות |

---

## 5. מסמכים

### 5.1 מערכת CORE (ריפו)

| מסמך | תוכן |
|---|---|
| [`docs/CORE_SYSTEM.md`](CORE_SYSTEM.md) | התיעוד המלא (מקור קובע) |
| [`docs/GLOSSARY.md`](GLOSSARY.md) | מילון מונחים |
| [`docs/README.md`](README.md) | האינדקס הזה |
| [`docs/audit/AUDIT-2026-10-14-round2.md`](audit/AUDIT-2026-10-14-round2.md) | **דוח ביקורת סבב 2:** סטטוס A-01..A-29, ממצאים חדשים, תיקונים אחרי הביקורת (לא נבדקו מחדש), מה נשאר קריטי/גבוה, סטטוס 16 ההחלטות. צוות 8 לא הורץ (החלטה 7) |
| `docs/audit/r2_00_dev_conformance.md` … `r2_10_qa_security_ops.md` | 10 דוחות סבב 2 (00, 01, 02, 03, 04, 05, 06, 07, 09, 10), כפי שנכתבו |
| [`docs/audit/AUDIT-2026-10-14.md`](audit/AUDIT-2026-10-14.md) | דוח ביקורת סבב 1: 80 ממצאים, החלטות נדרשות, מה תקין, מה לא נבדק |
| `docs/audit/00_dev_conformance.md` (סבב 1) | צוות פיתוח — התאמת הקוד לשיטה ולמפרט CHAT |
| `docs/audit/01_cpa_edgar_extraction.md` | רו"ח — חילוץ EDGAR |
| `docs/audit/02_cpa_screen_rules.md` | רו"ח/אשראי — מסנן האיכות |
| `docs/audit/03_cpa_valuation_outputs.md` | רו"ח/שווי — P/E, FCF yield, פלטים |
| `docs/audit/04_econ_cheap_risk.md` | כלכלנים — Cheap Score ו־Risk Engine |
| `docs/audit/05_data_pipeline.md` | QA נתונים — צנרת הנרות |
| `docs/audit/06_traders_earnings_exits.md` | סוחרים — דוחות ויציאות |
| `docs/audit/07_traders_decision_sizing.md` | סוחרים/סיכוני תיק — החלטות וגודל |
| `docs/audit/08_econ_research_claims.md` | אקונומטריקה — טענות המחקר |
| `docs/audit/09_analysts_reviews.md` | אנליסטים — 120 הסקירות |
| `docs/audit/10_qa_security_ops.md` | QA — אבטחה ותפעול |
| `core/CORE_RULES.md` | כללי המסנן (קפואים 13.10; לא תואמים במלואם לקוד — A-73) |
| `core/review/REVIEW_PROTOCOL.md` | פרוטוקול הסקירה העסקית (ברירת המחדל: מסנן EDGAR, `core/screen_sec.csv`). תקני העקביות (a)–(d) של סבב 2b עוד לא נכתבו בו — הם בקבצי הסקירה ובסעיף 5.1 של CORE_SYSTEM.md |

### 5.2 מערכת CORE (פרויקט "מניות" ב־claude.ai)

| מסמך | תוכן |
|---|---|
| `claude/METHOD-frozen-2026-10-13.md` | נוסח השיטה הקפואה |
| `claude/CORE-SYSTEM.md`, `claude/AUDIT-2026-10-14.md`, `claude/GLOSSARY.md`, `claude/DOCS-INDEX.md` | עותקים בפרויקט — **ייתכן שאינם מעודכנים**; הגרסה הקובעת היא זו שבריפו |
| `claude/CORE-list-2026-10-13.md`, `claude/CORE-review-round1-2026-10-13.md` | רשימת CORE והסבב הראשון של הסקירות |
| `claude/exp-long-swing-2026-10-13.md` | ניסויי LONG ו־SWING (בסיס Cheap Score; LONG שנוי במחלוקת — A-09) |
| `claude/audit-structure-method-5y.md` | ביקורת שיטת המבנה על 5 שנים |
| `claude/state-table-8-families-risk-engine.md` | 8 משפחות התזמון ו־Risk Engine |
| `claude/finding-past-return-effect-5y.md` | השפעת תשואת עבר |
| `claude/finding-sec-vs-bigdata-2026-10-13.md` | השוואת EDGAR מול Bigdata |
| `claude/how-to-get-all-candles.md`, `claude/bars-vault-nightly-and-scanner.md` | הוראות נתוני הנרות והסורק |

### 5.3 קוד ונתוני המחקר — **לא מגורסנים** (A-26)

קוד המחקר שעליו נשענת השיטה **לא נמצא בריפו**. הוא קיים רק בתיקייה זמנית של sandbox:
`/tmp/claude-0/hist/` (כ־1.1GB): `exp2/` (long.py, LONG_REPORT.md, SWING_REPORT.md, NEW_PROTOCOL.md + sha256, long_events.pkl), `audit/` (audit_code.py, stats2.py, gate3*), `struct5y.py`, `lb5.py`, `lb6.py`, `core.py`, `earn*.py`, `pre5.py`, `daily_adj.pkl`, `fund/` (נתוני ה־Excel שמולם נכתבו סקירות סבב 1), `state/`. **לא תוקן בסבב 2** (אין `research/` בריפו).
**סיכון:** התיקייה יכולה להיעלם עם ה־sandbox, ואז אי אפשר לשחזר את טענות המחקר (CORE_SYSTEM.md §14). המלצה: להעביר ל־`research/` בריפו (קוד, פרוטוקולים עם hash, קבצי אירועים ופלטים; בלי pickles גדולים).

### 5.4 תשתית הנרות, D1, V2 ו־Trader (ריפו)

| מסמך | תוכן |
|---|---|
| `README.md` (שורש) | bars-vault: הנתיבים הישנים של ה־Worker |
| `DEPLOY.md` (שורש) | הוראות פריסה |
| `docs/ARCHITECTURE_QA_CURRENT_STATE.md` | ארכיטקטורה — 50 שאלות, מהקוד |
| `docs/AUDIT_PLAN.md`, `docs/AUDIT_LOG.md`, `docs/CHANGELOG_AUDIT.md` | תוכנית, יומן ותיקוני הביקורת הקודמת (D1/KV/Trader, checkpoint v248) |
| `docs/CANDLE_DATA_CONTRACT.md` | חוזה נתוני הנרות |
| `docs/CONSISTENCY_REPORT.md` | דוח עקביות |
| `docs/COST_ACCOUNTING.md`, `docs/SUBREQUEST_ACCOUNTING.md` | עלויות ו־subrequests |
| `docs/CRON_FAILURE_CHAIN.md`, `docs/CUTOFF_PROOF.md` | שרשרת כשלי ה־cron ולמה העדכונים נעצרים |
| `docs/D1_ARCHITECTURE.md`, `docs/D1_QUERY_INVENTORY.md`, `docs/KV_ARCHITECTURE.md` | D1 ו־KV |
| `docs/DATA_FLOW.md`, `docs/DATA_FORENSICS.md`, `docs/EXECUTION_ORDER_AND_STORES.md` | זרימת נתונים, פורנזיקה, סדר ביצוע ושתי טבלאות Supabase |
| `docs/QUANTITATIVE_FACTS.md` | עובדות כמותיות על מצב הייצור |
| `docs/OPPORTUNITY_SCANNER_SPEC.md` | מפרט הסורק |
| `docs/TRADER_DATA_FLOW.md` | זרימת הנתונים של Trader V2 |
| `docs/UI_ACTION_DATA_LINEAGE.md`, `.csv` | מיפוי פעולות UI לנתונים |
| `docs/V2_*.md` (13 קבצים) | ארכיטקטורה, חוזה נרות, canary, hardening, מיגרציה, מגבלות פלטפורמה, recovery, request accounting, shadow deploy, ולידציה של V2 |
| `docs/audit/*.mjs`, `sql_sites.txt`, `ui_inventory.json` | סקריפטים ופלטים של הביקורת הקודמת (D1/UI) |
