"""Financial years, April to March, as the books and GSTR-1 count them (design §4.4).

One copy for v3's code: v2 carries several inline (views.py, models.py, utils.py, gstr1.py),
which stay as they are.
"""

import re
from datetime import date

from django.utils import timezone
from django.utils.dateparse import parse_date

_LABEL = re.compile(r"^(20\d{2})-(\d{2})$")


def fy_of(day=None):
    """The financial year `day` falls in, as the year it starts: 8 Oct 2026 and 8 Feb 2027 are 2026.

    `day` is a date or an ISO string; None means today in IST.
    """
    if day is None:
        day = timezone.localdate()
    elif isinstance(day, str):
        day = parse_date(day)
    return day.year - (day.month < 4)


def fy_label(start):
    """2026 -> "2026-27"."""
    return f"{start}-{(start + 1) % 100:02d}"


def fy_range(start):
    """2026 -> (1 Apr 2026, 31 Mar 2027)."""
    return date(start, 4, 1), date(start + 1, 3, 31)


def parse_fy(text):
    """"2026-27" -> 2026; None when it isn't a financial year."""
    m = _LABEL.match((text or "").strip())
    if not m or (int(m.group(1)) + 1) % 100 != int(m.group(2)):
        return None
    return int(m.group(1))
