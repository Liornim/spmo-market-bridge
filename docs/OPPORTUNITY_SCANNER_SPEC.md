Worked for 53s

כן. הפעם הייתי נותן לו מפרט אחד סגור: לסרוק את כל המניות על כל ההיסטוריה שיש, להחליט מה מעניין לקצר ומה מעניין למחיר ארוך, ולהוציא תוכנית פעולה מדויקת ולא הערות כלליות.

יש להוסיף במסך הנרות טאב חדש בשם:

Opportunity Scanner

המטרה היא לסרוק את כל המניות שנבחרו, על בסיס כל ההיסטוריה הזמינה בארכיון, ולהחזיר דירוג של המניות המעניינות ביותר כרגע.

יש לבצע שני ניתוחים נפרדים:

1. SHORT TERM – מניות עם פוטנציאל לתנועה משמעותית בטווח הקצר.
2. LONG TERM PRICE OPPORTUNITY – מניות שהמחיר הנוכחי שלהן נראה אטרקטיבי יחסית להיסטוריית המחיר הקיימת.

אין לחתוך את ההיסטוריה מראש.

אם יש למניה 20 ימים – להשתמש ב-20.

אם יש 200 ימים – להשתמש ב-200.

אם יש כמה שנים – להשתמש בכולן.

מותר להשתמש בתוך הניתוח בחלונות כמו 5D / 20D / 60D וכו', אבל כל ההיסטוריה הזמינה נשארת חלק מה-context.

---

DATA

מקור הנתונים הוא אותו archive שכבר קיים:

symbol
date
time
open
high
low
close
volume

אין צורך במקור מידע נוסף לצורך הסורק הזה.

להשתמש רק בנתונים שקיימים בפועל.

לא להשלים נרות חסרים.

לא ליצור synthetic candles.

לא לבצע forward fill.

לא להפוך missing volume ל-0.

---

PREPARATION

מהנרות הקיימים ליצור פנימית:

- 5-minute candles
- 15-minute candles
- Daily candles

כל החישובים מתבצעים מהנתונים הגולמיים.

Current Price:

ה-close של הנר האחרון שהסתיים.

לא להשתמש בנר שעדיין פתוח כאישור setup.

---

DATA QUALITY

לפני הניתוח של כל symbol לבדוק:

- timestamp אחרון
- gaps משמעותיים
- duplicates
- volume חריג/חסר
- רצפים חשודים של OHLC זהה + volume 0

אם קיימת בעיית נתונים:

data_quality = WARNING

ולהוריד confidence.

אם הבעיה משמעותית:

לא לתת READY.

---

חלק א' – SHORT TERM

המטרה היא לזהות מניה שיש לה כרגע:

- תנועה
- מבנה מתאים
- מספיק upside
- נקודת כניסה מוגדרת
- stop מוגדר
- יחס סיכון/סיכוי טוב

לא מספיק שמניה "חזקה היום".

צריך setup שאפשר לפעול לפיו.

---

SHORT-TERM MARKET STRUCTURE

על 5-minute candles לזהות Swing High / Swing Low.

Swing High:

High גבוה משני הנרות שלפניו ומשני הנרות שאחריו.

Swing Low:

Low נמוך משני הנרות שלפניו ומשני הנרות שאחריו.

מבנה:

UPTREND:
HH + HL

DOWNTREND:
LH + LL

MIXED:
כל מצב אחר.

לבצע גם בדיקת context ב-15m.

---

חוק קריטי

במערכת LONG ONLY:

אם 5m structure עדיין DOWNTREND:

אסור לתת BUY / READY רק בגלל שהמחיר הגיע לתמיכה.

כדי להפוך מניה שנמצאת בירידה להזדמנות קנייה צריך לראות:

1. הירידה נעצרת.
2. אין Lower Low חדש.
3. המחיר עובר מעל ה-Lower High האחרון / local resistance.
4. המחיר מחזיק את ה-reclaim.
5. נוצר Higher Low.
6. רק לאחר מכן אפשר לייצר Entry Trigger.

אם זה עדיין לא קרה:

WATCH.

---

SHORT-TERM SETUPS

יש לזהות בעיקר את ארבעת הסוגים הבאים.

1. BREAKOUT

מניה במבנה חיובי.

יש consolidation/base.

המחיר נמצא מתחת להתנגדות ברורה.

ה-base לא נשבר.

Entry Trigger:

מעל ה-high של ה-base.

---

2. PULLBACK CONTINUATION

המניה במגמת עלייה.

היה pullback.

ה-pullback לא שבר את ה-Higher Low החשוב.

הקונים חוזרים.

נוצר local high חדש.

Entry Trigger:

מעל אותו local high.

---

3. REVERSAL

המניה הייתה ב-DOWNTREND.

הירידה נעצרה.

לא נוצר LL חדש.

ה-Lower High האחרון נפרץ.

המחיר החזיק מעליו.

נוצר Higher Low.

Entry Trigger:

מעל ה-high שנוצר לאחר ה-Higher Low.

---

4. BREAKOUT RETEST

הייתה פריצה.

המחיר חזר לרמת הפריצה.

הרמה החזיקה כתמיכה.

נוצר Higher Low.

Entry Trigger:

מעל ה-high המקומי לאחר ה-retest.

---

RELATIVE STRENGTH

אם SPY / QQQ קיימים בנתונים:

להשוות את ביצועי המניה אליהם.

לבדוק:

- session performance
- recent 30-minute performance
- recent 2-hour performance
- recent multi-day performance

מניה שמחזיקה חזק בזמן שהשוק חלש תקבל עדיפות.

אבל Relative Strength לבדו אינו Entry Signal.

---

VOLUME

להשוות volume נוכחי להתנהגות הקודמת של אותה מניה.

עדיפות ל:

- breakout עם expansion ב-volume
- pullback עם volume יורד
- recovery עם volume מתחזק

לא לפסול מניה רק בגלל volume נמוך בדקה אחת.

להסתכל על רצף ולא על נר בודד.

---

VOLATILITY / MOVE POTENTIAL

המטרה אינה רק למצוא setup יפה.

צריך לבדוק שהמניה בכלל מסוגלת לספק תנועה משמעותית.

לחשב מההיסטוריה:

- typical daily range
- recent daily range
- ATR
- intraday range behavior
- מספר הימים שבהם המניה עשתה מהלך משמעותי

לתת עדיפות למניה עם פוטנציאל תנועה אמיתי.

---

SHORT-TERM ENTRY

לכל הזדמנות לתת מחיר אחד בלבד.

לא:

100–102

לא:

around 101

לא:

wait for confirmation

אלא:

BUY IF PRICE >= 101.37

Entry Buffer:

מעל רמת ה-trigger:

max(
0.01,
0.05% מהמחיר
)

לדוגמה:

Breakout level:

101.32

Entry:

101.37

---

SHORT-TERM STOP

ה-stop מבוסס על ה-structure.

לא אחוז קבוע.

Breakout:

מתחת ל-base low / Higher Low.

Pullback:

מתחת ל-Higher Low שאישר את ה-setup.

Reversal:

מתחת ל-Higher Low החדש.

Retest:

מתחת ל-retest low.

להוסיף buffer קטן:

max(
0.01,
0.05% מהמחיר
)

---

RISK

R = Entry - Stop

אם:

R <= 0

העסקה אינה תקפה.

---

TARGETS

לזהות resistance אמיתי מעל המחיר מתוך ההיסטוריה.

צריך להוציא:

Target 1
Target 2

ברירת מחדל:

Target 1 = לפחות 1R.

Target 2 = יעד סביב 2R או resistance משמעותי קודם.

אם resistance משמעותי חוסם את העסקה לפני שיש לפחות 1.5R upside:

לא לתת READY.

להציג גם:

Potential Gain % to Target 1
Potential Gain % to Target 2

---

SHORT-TERM SELL RULES

STOP

אם price <= stop:

SELL 100%

TARGET 1

אם price >= Target 1:

SELL 50%

ולהעביר stop של יתרת הפוזיציה ל-Entry Price.

TARGET 2

אם price >= Target 2:

SELL remaining 50%.

---

FAILED SETUP

אם הייתה כניסה ב-breakout/reclaim ולאחר מכן:

המחיר חוזר מתחת לרמת הפריצה,

והמבנה חוזר להיות שלילי,

יש לסמן:

FAILED_SETUP

ולהמליץ EXIT.

אין צורך להמתין תמיד ל-stop המלא אם הסיבה המקורית לכניסה כבר אינה קיימת.

---

CANCEL BEFORE ENTRY

אם טרם הייתה כניסה והמבנה משתנה:

לבטל את ה-trigger.

לדוגמה:

BUY IF >= 101.37

אבל לפני שהמחיר הגיע ל-101.37 הוא שבר את Higher Low.

התוצאה:

CANCELLED.

לא להמשיך להציג 101.37 ככניסה.

---

SHORT-TERM SCORE

ציון 0–100.

Setup Quality – 25

כמה ה-setup ברור ומוגדר.

Structure – 20

איכות המגמה והשינוי במבנה.

Relative Strength – 15

מול SPY/QQQ.

Volume – 10

איכות השתתפות הקונים.

Move Potential / Volatility – 15

כמה תנועה המניה מסוגלת לעשות בפועל.

Risk / Reward – 15

איכות היחס בין Entry / Stop / Targets.

---

SHORT-TERM STATUS

READY

setup מלא + Entry מוגדר + R:R תקין.

ARMED

setup כמעט מוכן וה-trigger ברור, אבל התנאי הסופי עדיין לא הופעל.

WATCH

מניה מעניינת אבל חסר חלק מהותי.

AVOID

אין כרגע setup טוב.

---

חלק ב' – LONG TERM PRICE OPPORTUNITY

זהו ניתוח מחיר בלבד.

אין לטעון:

"Fundamentally cheap"

"Undervalued company"

"Strong business"

כי אין כאן מידע פונדמנטלי.

המטרה היא:

לזהות מניה שהמחיר הנוכחי שלה נראה אטרקטיבי ביחס להיסטוריית המחירים שיש לנו.

---

USE ALL HISTORY

להשתמש בכל ה-Daily history שקיים.

לא לדרוש 252 ימים.

אין minimum קבוע שרירותי.

אם קיימת פחות היסטוריה, לציין:

history_days

ולהוריד confidence בהתאם.

לא למחוק את המניה מהסריקה.

---

LONG-TERM PRICE POSITION

לחשב על כל ההיסטוריה הזמינה:

Period High
Period Low
Current Price
Median Price
Average Price
Price Percentile
Drawdown From Period High
Distance From Period Low

בנוסף להסתכל על:

5D
20D
60D
120D

כאשר קיימים.

כל ההיסטוריה משמשת context.

התקופות האחרונות מקבלות יותר חשיבות להבנת מצב המחיר עכשיו.

---

PRICE PERCENTILE

להציג באיזה percentile המחיר הנוכחי נמצא בתוך ההיסטוריה הזמינה.

לדוגמה:

12th percentile

פירוש:

המחיר הנוכחי נמוך מרוב המחירים שנראו בתקופה.

ככל שה-percentile נמוך יותר:

המחיר מעניין יותר מבחינת מחיר בלבד.

אבל:

percentile נמוך לבדו אינו מספיק.

---

HISTORICAL SUPPORT

לזהות אזורי מחיר שבהם בעבר:

- נוצרו lows מספר פעמים
- הופיעו reversals
- המחיר נשאר/consolidated
- הופיע volume משמעותי

לתת עדיפות לרמות שנבדקו מספר פעמים.

---

UPSIDE / DOWNSIDE

לכל מניה לחשב:

Downside to nearest strong support

מול:

Upside to nearest meaningful resistance

ומול:

Upside to historical median / major recovery level

מניה מעניינת יותר כאשר:

Potential Upside גדול משמעותית מה-downside לרמת תמיכה משמעותית.

---

FALLING RISK

להפריד בין:

"מחיר אטרקטיבי"

לבין:

"האם היא עדיין נופלת חזק".

להוציא:

LOW
MEDIUM
HIGH

הערכת Falling Risk תשתמש ב:

- recent slope
- lower highs / lower lows
- acceleration of decline
- volume on down moves
- distance from moving averages
- frequency of new lows

מניה יכולה להיות:

BUY NOW

עם:

Falling Risk = HIGH

זה לא סותר.

---

LONG-TERM ACTION

להוציא אחד מ:

BUY NOW
BUY LOWER
WATCH
NOT INTERESTING

---

BUY NOW

אם המחיר הנוכחי כבר נמצא באזור אטרקטיבי מספיק:

Action:

BUY NOW

Buy Price:

Current Price

לדוגמה:

BUY NOW AT 84.73

---

BUY LOWER

אם המניה מעניינת אבל התמיכה המשמעותית נמצאת מעט מתחת למחיר:

Action:

BUY IF PRICE <= X

מחיר אחד.

לדוגמה:

BUY IF PRICE <= 81.40

לא לתת טווח.

---

LONG-TERM BUY PRICE

המחיר צריך להיגזר מ:

- strong historical support
- previous reversal level
- price cluster
- downside/upside relationship

אם Current Price כבר בתוך אותו אזור:

BUY NOW.

אם לא:

BUY LOWER.

---

LONG-TERM TARGETS

להוציא:

Target 1
Target 2

Target 1:

ה-resistance / recovery level המשמעותי הראשון.

Target 2:

רמת resistance גבוהה יותר / previous major high / upper historical value area.

להציג:

Upside % to Target 1
Upside % to Target 2

---

LONG-TERM INVALIDATION

לתת מחיר שממנו התמונה הטכנית נעשית פחות אטרקטיבית באופן משמעותי.

לא stop קטן בסגנון Day Trade.

להשתמש ב:

major historical support / structural low.

להוציא:

REVIEW / EXIT IF PRICE <= X

---

LONG-TERM SCORE

0–100.

Current Price Attractiveness – 30

מיקום המחיר ביחס להיסטוריה.

Drawdown / Discount – 20

כמה המניה ירדה מהרמות הגבוהות שלה.

Historical Support – 20

איכות התמיכה באזור המחיר.

Upside vs Downside – 20

כמה upside קיים לעומת downside.

Recent Behavior – 10

האם הירידה מתמתנת / מתייצבת או מאיצה.

Falling Risk מוצג בנפרד ואינו מוחק אוטומטית Price Opportunity.

---

RANKING

חובה לבצע ranking בין כל המניות.

לא לנתח כל מניה בבידוד בלבד.

להחזיר:

Short-Term Rank

ו:

Long-Term Rank

בנפרד.

המטרה היא לענות:

אם אני יכול להתמקד רק ב-5 מניות עכשיו – באילו?

---

אין חובה למצוא הזדמנות

לא לייצר recommendation רק כדי למלא Top 10.

אם יש:

0 READY

זה תקין.

אם רק 3 מניות מעניינות לטווח ארוך:

להציג 3.

---

SCREEN REPORT

להציג שני אזורים.

SHORT TERM OPPORTUNITIES

עמודות:

Rank
Symbol
Status
Score
Current Price
Setup
Entry Price
Stop Price
Target 1
Target 2
Potential %
R:R
Why

---

LONG TERM PRICE OPPORTUNITIES

עמודות:

Rank
Symbol
Status
Score
Current Price
Buy Price
History Days
Price Percentile
Drawdown From High
Falling Risk
Target 1
Target 2
Upside %
Invalidation Price
Why

---

WHY

Why חייב להיות ספציפי ומבוסס מספרים.

לא:

Strong stock.

לא:

Looks cheap.

דוגמה Short Term:

"5m structure changed from LH/LL to reclaim + HL. Entry trigger is 0.4% above current price. Relative strength vs QQQ is positive. Target 2 provides 2.1R and 3.7% upside."

דוגמה Long Term:

"Current price is in the 18th percentile of the available history, 22.6% below the period high and 3.8% above a support zone that produced three previous reversals. Upside to the first major resistance is 11.4%."

---

EXPORT

להוסיף כפתור:

Export Opportunity Report

להוציא שני CSV files.

---

FILE 1

opportunity_scan_all.csv

שורה אחת לכל symbol שנבדק.

עמודות בדיוק בסדר הבא:

scan_time
symbol
history_start
history_end
history_days
last_bar_time
current_price
data_quality_status

short_term_rank
short_term_status
short_term_score
short_term_setup
short_term_structure_5m
short_term_structure_15m
short_term_relative_strength
short_term_volume_state
short_term_move_potential
short_term_entry_action
short_term_entry_price
short_term_stop_price
short_term_target_1
short_term_target_1_pct
short_term_target_2
short_term_target_2_pct
short_term_risk_per_share
short_term_rr_target_1
short_term_rr_target_2
short_term_cancel_condition
short_term_exit_condition
short_term_why
short_term_why_not_ready

long_term_rank
long_term_status
long_term_score
long_term_buy_action
long_term_buy_price
long_term_price_percentile
long_term_period_high
long_term_period_low
long_term_drawdown_from_high_pct
long_term_distance_from_low_pct
long_term_support_price
long_term_falling_risk
long_term_target_1
long_term_target_1_pct
long_term_target_2
long_term_target_2_pct
long_term_invalidation_price
long_term_why

---

FILE 2

opportunity_candidates.csv

אותו מבנה עמודות.

אבל לכלול רק:

Short Term:
READY
ARMED

או Long Term:
BUY NOW
BUY LOWER

למיין קודם לפי:

Short-Term READY
Short-Term Score descending

ולאחר מכן:

Long-Term Score descending.

---

EMPTY VALUES

אם נתון אינו רלוונטי:

להשאיר blank/null.

לא לרשום 0 במקום missing.

---

NO HIDDEN DECISIONS

אם המערכת נתנה:

READY

או:

BUY NOW

אני חייב להיות מסוגל להבין מה-CSV:

- למה
- באיזה מחיר
- מה ה-trigger
- איפה stop/invalidation
- כמה upside
- מה היעדים
- מה מבטל את ההמלצה

---

FINAL OUTPUT

בסיום כל Scan להציג Summary:

Scanned: X
Short-Term READY: X
Short-Term ARMED: X
Short-Term WATCH: X
Long-Term BUY NOW: X
Long-Term BUY LOWER: X
Data Warnings: X

ומתחת:

Top 5 Short-Term

ו:

Top 5 Long-Term Price Opportunities.

המערכת לא צריכה לנסות להיות אופטימית.

המטרה היא למצוא את המניות שבהן כרגע יש יתרון ברור לעומת שאר המניות, ולא רק מניות שאפשר להמציא עליהן סיפור.זה המבנה שהייתי משתמש בו כרגע. הוא גם נותן לנו אחר כך אפשרות לקחת את ה־CSV ולבדוק בעצמנו אם הסורק באמת בוחר את המניות הנכונות, במקום להסתמך רק על המסך.