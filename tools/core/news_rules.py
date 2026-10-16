"""Fixed rules for news headlines (no AI): relevance, opinion pieces, duplicates and event type.

relevance  'company'  the company's name or ticker is in the headline
           'general'  it is not (market wrap, sector piece, another company) -> hidden by default
opinion    True for "should you buy / X vs Y / here's why"-type pieces and opinion-heavy outlets -> hidden by default
etype      earnings | analyst | legal | management | deal | contract | capital | other
key        True for types that can change a thesis: earnings, legal, management, deal (and analyst rating changes)
These are keyword rules: they miss some events and mislabel some. Counts of hidden items are always shown.
"""
import re

ALIASES = {
    'GOOGL': ['Google', 'Alphabet'], 'META': ['Meta', 'Facebook', 'Instagram'], 'BRK-B': ['Berkshire'],
    'JPM': ['JPMorgan', 'JP Morgan', 'Chase'], 'BAC': ['Bank of America', 'BofA'], 'C': ['Citigroup', 'Citi'],
    'WFC': ['Wells Fargo'], 'GS': ['Goldman'], 'MS': ['Morgan Stanley'], 'SCHW': ['Schwab'], 'T': ['AT&T'],
    'VZ': ['Verizon'], 'TMUS': ['T-Mobile'], 'KO': ['Coca-Cola', 'Coke'], 'PEP': ['PepsiCo', 'Pepsi'],
    'PG': ['Procter', 'P&G'], 'JNJ': ['Johnson & Johnson', 'J&J'], 'MA': ['Mastercard'], 'V': ['Visa'],
    'HD': ['Home Depot'], 'LOW': ["Lowe's", 'Lowes'], 'MCD': ["McDonald's", 'McDonalds'], 'DIS': ['Disney'],
    'LLY': ['Eli Lilly', 'Lilly'], 'UNH': ['UnitedHealth'], 'ABBV': ['AbbVie'], 'MRK': ['Merck'], 'BMY': ['Bristol'],
    'TSM': ['TSMC', 'Taiwan Semi'], 'ASML': ['ASML'], 'AVGO': ['Broadcom'], 'AMD': ['AMD', 'Advanced Micro'],
    'INTC': ['Intel'], 'MU': ['Micron'], 'NVDA': ['Nvidia'], 'AAPL': ['Apple', 'iPhone'], 'MSFT': ['Microsoft'],
    'AMZN': ['Amazon', 'AWS'], 'TSLA': ['Tesla'], 'NFLX': ['Netflix'], 'CRM': ['Salesforce'], 'NOW': ['ServiceNow'],
    'ORCL': ['Oracle'], 'IBM': ['IBM'], 'CSCO': ['Cisco'], 'ADBE': ['Adobe'], 'INTU': ['Intuit'], 'UBER': ['Uber'],
    'ABNB': ['Airbnb'], 'BKNG': ['Booking'], 'SBUX': ['Starbucks'], 'TJX': ['TJX', 'TJ Maxx'], 'WMT': ['Walmart'],
    'COST': ['Costco'], 'XOM': ['Exxon'], 'CVX': ['Chevron'], 'COP': ['ConocoPhillips'], 'GE': ['GE Aerospace', 'General Electric'],
    'LMT': ['Lockheed'], 'RTX': ['RTX', 'Raytheon', 'Pratt'], 'CAT': ['Caterpillar'], 'DE': ['Deere'], 'HON': ['Honeywell'],
    'UNP': ['Union Pacific'], 'LIN': ['Linde'], 'BLK': ['BlackRock'], 'BX': ['Blackstone'], 'KKR': ['KKR'],
    'SPGI': ['S&P Global'], 'ICE': ['Intercontinental Exchange', 'NYSE parent'], 'CME': ['CME'], 'PGR': ['Progressive'],
    'CB': ['Chubb'], 'AXP': ['American Express', 'Amex'], 'COIN': ['Coinbase'], 'HOOD': ['Robinhood'], 'SOFI': ['SoFi'],
    'PLTR': ['Palantir'], 'CRWD': ['CrowdStrike'], 'PANW': ['Palo Alto'], 'SNOW': ['Snowflake'], 'DDOG': ['Datadog'],
    'SHOP': ['Shopify'], 'APP': ['AppLovin'], 'RBLX': ['Roblox'], 'MSTR': ['MicroStrategy', 'Strategy'],
    'DELL': ['Dell'], 'SMCI': ['Super Micro', 'Supermicro'], 'ANET': ['Arista'], 'MRVL': ['Marvell'], 'ARM': ['Arm Holdings', 'Arm'],
    'QCOM': ['Qualcomm'], 'TXN': ['Texas Instruments'], 'ADI': ['Analog Devices'], 'KLAC': ['KLA'], 'LRCX': ['Lam Research'],
    'APH': ['Amphenol'], 'ETN': ['Eaton'], 'CRDO': ['Credo'], 'ALAB': ['Astera'], 'ISRG': ['Intuitive Surgical'],
    'SYK': ['Stryker'], 'BSX': ['Boston Scientific'], 'MDT': ['Medtronic'], 'ABT': ['Abbott'], 'ELV': ['Elevance'],
    'GILD': ['Gilead'], 'AMGN': ['Amgen'], 'VRTX': ['Vertex'], 'PM': ['Philip Morris'], 'MDLZ': ['Mondelez'],
    'DUK': ['Duke Energy'], 'SO': ['Southern Co', 'Southern Company'], 'NEE': ['NextEra'], 'PLD': ['Prologis'],
    'AMT': ['American Tower'], 'WM': ['Waste Management', 'WM'], 'ADP': ['ADP', 'Automatic Data'], 'FISV': ['Fiserv'],
    'MRSH': ['Marsh'],
}

OPINION_PUB = {'zacks', 'motley fool', 'the motley fool', 'simply wall st.', 'simply wall st', '24/7 wall st.', 'wall st 24/7',
               'investorplace', 'gurufocus', 'gurufocus.com', 'insider monkey', 'marketbeat', 'tipranks', 'trefis', 'validea', 'stocknews.com'}
OPINION_RX = re.compile(r"\bvs\.?\b|\bversus\b|which (stock|is|one)|better buy|should you|buy,? sell,? or hold|is it time|"
                        r"is .{0,40}\b(a buy|a bargain|fully priced|undervalued|overvalued)|stocks? to (buy|watch|own)|top .{0,30}calls|"
                        r"here'?s why|what you need to know|(out|under)performs broader market|(beats|lags) market|dividend (stock|king)s?|"
                        r"how to (earn|make|turn)|\bpassive income\b|\bmillionaire\b|\bforever\b|\bbillionaire\b|could (soar|crash|double)|\?$", re.I)

TYPES = [
    ('insider', r"insider (sold|sells|bought|buys|selling|buying)|\bsold shares\b|\bbought shares\b|form 4"),
    ('capital', r"dividend|buyback|repurchase|stock split|\boffering\b|\bnotes due\b|\bbond sale\b"),
    ('earnings', r"\bearnings\b|\bresults\b|\bquarter(ly)?\b|\bQ[1-4]\b|\brevenue\b|\bEPS\b|\bguidance\b|\boutlook\b|\bforecast\b|\bprofit\b|\bbeats?\b|\bmiss(es)?\b|\bsales\b"),
    ('analyst', r"upgrade|downgrade|price target|\binitiat|\breiterat|\brating\b|overweight|underweight|outperform|underperform|equal[- ]weight|\bneutral\b"),
    ('legal', r"lawsuit|\bsues?\b|\bsued\b|\bprobe\b|investigat|\bSEC\b|\bFTC\b|\bDOJ\b|antitrust|\bfined?\b|settle|\brecall\b|regulator|\bcourt\b|\bjudge\b|subpoena|class action"),
    ('management', r"steps? down|resign|appoint|\bnames? .{0,30}(CEO|CFO|chief|president|chair)|(new|interim) (CEO|CFO|chief)|succe(ssor|ssion)|\bretir|ousted|\bfired\b|departs|to lead\b"),
    ('deal', r"acqui|\bmerger?\b|\bbuyout\b|takeover|\bto buy\b|\bdeal\b|spin[- ]?off|divest|\bstake\b|\bbid\b"),
    ('contract', r"contract|\baward|\border(s)?\b|\bwins?\b|partnership|agreement|\bpact\b|\bselected\b"),
]
TYPES = [(k, re.compile(v, re.I)) for k, v in TYPES]
KEY = {'earnings', 'legal', 'management', 'deal'}


def names(sym, long_name=None):
    n = list(ALIASES.get(sym, []))
    if long_name:
        core = re.sub(r"[,.]?\s+(Inc|Incorporated|Corporation|Corp|Company|Co|Ltd|Limited|plc|PLC|N\.V|NV|S\.A|SE|Holdings?|Group|Class [AB])\b.*$", '', long_name).strip()
        if len(core) >= 3: n.append(core)
    return [x for x in n if x]


ROUNDUP_RX = re.compile(r"stock market today|stocks? (that|making|moving|to watch)|biggest (movers|gainers|losers)|\bmovers\b|, and more\b|explain today|"
                        r"premarket|pre-market movers|midday movers|wall street.{0,20}(today|this week)|top (gainers|losers)", re.I)


def relevant(title, sym, nm):
    t = title or ''
    if ROUNDUP_RX.search(t) or t.count(',') >= 3: return False
    if len(sym) >= 2 and re.search(r'(?<![A-Za-z])\$?' + re.escape(sym.replace('-', '.')) + r'(?![A-Za-z])', t): return True
    if len(sym) >= 2 and re.search(r'\(' + re.escape(sym) + r'\)', t): return True
    return any(re.search(r'(?<![A-Za-z])' + re.escape(x) + r'(?![a-z])', t, re.I if len(x) > 4 else 0) for x in nm)


def opinion(title, publisher):
    """Opinion pattern in the headline, or an opinion-heavy outlet unless the headline reports an event (rating, earnings, deal...)."""
    if OPINION_RX.search(title or ''): return True
    return (publisher or '').strip().lower() in OPINION_PUB and etype(title) in ('other', 'insider')


def etype(title):
    for k, rx in TYPES:
        if rx.search(title or ''): return k
    return 'other'


def norm(t):
    return set(re.findall(r'[a-z0-9]+', (t or '').lower())) - {'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'as', 'is', 'its', 'with', 'at', 'by'}


def duplicate(title, seen):
    a = norm(title)
    for b in seen:
        if a and b and len(a & b) / len(a | b) >= 0.6: return True
    seen.append(a)
    return False
