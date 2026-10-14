"""NYSE trading calendar: full holidays and 13:00 early closes, by the exchange's published rules.

Rules (NYSE Rule 7.2 and the yearly holiday notices):
  New Year's Day, Martin Luther King Jr. Day (3rd Mon Jan), Washington's Birthday (3rd Mon Feb), Good Friday,
  Memorial Day (last Mon May), Juneteenth (from 2022), Independence Day, Labor Day (1st Mon Sep),
  Thanksgiving (4th Thu Nov), Christmas. A Saturday holiday is observed on Friday, a Sunday holiday on Monday,
  except New Year's Day on a Saturday, which is not observed (Fri 31 Dec stays open).
  Early close 13:00 ET: the day before Independence Day (when a weekday and not itself a holiday),
  the day after Thanksgiving, Christmas Eve (when a weekday).
One-off closures (e.g. national days of mourning) are listed in EXTRA_CLOSED.
"""
import datetime as dt

EXTRA_CLOSED = {'2025-01-09'}  # national day of mourning, President Carter


def _easter(y):
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4; f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30; i = c // 4; k = c % 4; l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451; mo = (h + l - 7 * m + 114) // 31; da = (h + l - 7 * m + 114) % 31 + 1
    return dt.date(y, mo, da)


def _nth(y, m, wd, n):  # n-th weekday (0=Mon) of month; n=-1 last
    if n > 0:
        d = dt.date(y, m, 1); d += dt.timedelta((wd - d.weekday()) % 7); return d + dt.timedelta(7 * (n - 1))
    d = dt.date(y, m + 1, 1) - dt.timedelta(1) if m < 12 else dt.date(y, 12, 31)
    return d - dt.timedelta((d.weekday() - wd) % 7)


def _observed(d, newyear=False):
    if d.weekday() == 5: return None if newyear else d - dt.timedelta(1)
    if d.weekday() == 6: return d + dt.timedelta(1)
    return d


_cache = {}


def holidays(y):
    if y in _cache: return _cache[y]
    h = {_observed(dt.date(y, 1, 1), True), _nth(y, 1, 0, 3), _nth(y, 2, 0, 3), _easter(y) - dt.timedelta(2), _nth(y, 5, 0, -1),
         _observed(dt.date(y, 7, 4)), _nth(y, 9, 0, 1), _nth(y, 11, 3, 4), _observed(dt.date(y, 12, 25))}
    if y >= 2022: h.add(_observed(dt.date(y, 6, 19)))
    h.discard(None)
    h |= {dt.date.fromisoformat(x) for x in EXTRA_CLOSED if x.startswith(str(y))}
    _cache[y] = h
    return h


def _d(x): return x if isinstance(x, dt.date) else dt.date.fromisoformat(str(x)[:10])


def is_session(x):
    d = _d(x); return d.weekday() < 5 and d not in holidays(d.year)


def early_close(x):
    d = _d(x)
    if not is_session(d): return False
    j3 = dt.date(d.year, 7, 3)
    if d == j3 and _observed(dt.date(d.year, 7, 4)) == dt.date(d.year, 7, 4): return True
    if d == _nth(d.year, 11, 3, 4) + dt.timedelta(1): return True
    if d == dt.date(d.year, 12, 24): return True
    return False


def next_session(x, n=1):
    d = _d(x); step = 1 if n > 0 else -1; k = abs(n)
    while k:
        d += dt.timedelta(step)
        if is_session(d): k -= 1
    return d.isoformat()


def prev_session(x, n=1): return next_session(x, -n)


def on_or_after(x):
    d = _d(x)
    while not is_session(d): d += dt.timedelta(1)
    return d.isoformat()


def on_or_before(x):
    d = _d(x)
    while not is_session(d): d -= dt.timedelta(1)
    return d.isoformat()


def sessions_between(a, b):
    """Number of sessions s with a < s <= b (negative if b < a)."""
    a, b = _d(a), _d(b)
    if a == b: return 0
    sign = 1 if b > a else -1
    lo, hi = (a, b) if b > a else (b, a)
    n, d = 0, lo
    while d < hi:
        d += dt.timedelta(1)
        if is_session(d): n += 1
    return sign * n


def sessions(a, b):
    """All session dates a <= s <= b as ISO strings."""
    d, b = _d(a), _d(b); out = []
    while d <= b:
        if is_session(d): out.append(d.isoformat())
        d += dt.timedelta(1)
    return out


def full_bars(x):  # regular-session one-minute bars expected that day
    return 210 if early_close(x) else 390


if __name__ == '__main__':
    for y in (2025, 2026, 2027): print(y, sorted(h.isoformat() for h in holidays(y)))
