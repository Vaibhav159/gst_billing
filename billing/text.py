"""How v3's endpoints write values: money, timestamps, people, words (part 1 API contract, section 0).

The words mirror web/src/core/format.ts, so a bill reads the same from the server and the screen.
"""

import re

from django.utils import timezone


def stamp(moment):
    """An aware datetime as ISO 8601 in IST ("2026-10-08T10:42:05.123456+05:30"), or None."""
    return timezone.localtime(moment).isoformat() if moment else None


def person(user):
    """{"id", "name"} for a user (the full name, else the username), or None."""
    if user is None:
        return None
    return {"id": user.pk, "name": user.get_full_name() or user.username}


def money(value):
    """Money as the API sends it: a decimal string with exactly 2 places, half-up ("87083.21")."""
    from billing.tax_rules import to_paise

    return str(to_paise(value))


def day_text(day):
    """A date as the screens write it: "30 Sep 2026" (web/src/core/format.ts date())."""
    return f"{day.day:02d} {day.strftime('%b')} {day.year}"


def percent(rate):
    """A stored GST rate as the percent the API sends: 0.03 -> "3", 0.0025 -> "0.25" (slab-aware)."""
    from billing.tax_rules import rate_as_percent

    return format(rate_as_percent(rate).normalize(), "f")


def inr(value):
    """Money as the screens write it: "₹2,65,740.48", Indian grouping (web/src/core/format.ts inr())."""
    from billing.tax_rules import to_paise

    paise = int(to_paise(value) * 100)
    rupees, rest = divmod(abs(paise), 100)
    digits = str(rupees)
    if len(digits) > 3:
        digits = re.sub(r"\B(?=(\d{2})+(?!\d))", ",", digits[:-3]) + "," + digits[-3:]
    return f"{'−' if paise < 0 else ''}₹{digits}.{rest:02d}"


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
         "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n):
    return _ONES[n] if n < 20 else _TENS[n // 10] + (f" {_ONES[n % 10]}" if n % 10 else "")


def _words(n):
    if n == 0:
        return "Zero"
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1000)
    hundred, rest = divmod(n, 100)
    parts = [f"{_words(crore)} Crore" if crore else "", f"{_two(lakh)} Lakh" if lakh else "",
             f"{_two(thousand)} Thousand" if thousand else "", f"{_ONES[hundred]} Hundred" if hundred else "",
             _two(rest) if rest else ""]
    return " ".join(p for p in parts if p)


def in_words(value):
    """An amount in words, Indian system, to the paisa, exactly as web/src/core/format.ts amountInWords:
    87083.21 -> "Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only"."""
    from billing.tax_rules import to_paise

    rupees, paise = divmod(abs(int(to_paise(value) * 100)), 100)
    return f"{_words(rupees)} Rupees{f' and {_two(paise)} Paise' if paise else ''} Only"
