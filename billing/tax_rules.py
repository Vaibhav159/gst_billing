"""Where a supply is taxed, and under which head.

Kept apart from views and models so both the invoice write paths and the
inward-bills module decide this the same way, and so the rules can be unit
tested without a request.
"""

from decimal import Decimal

# The legal GST rate slabs, as percents. This list is what makes a rate of
# unknown shape resolvable without guessing: no slab is a slab again when
# multiplied by 100, so at most one reading of any value is legal.
#
# The 0.25% diamond/stone slab is the case that mattered. The old heuristic
# everywhere was `value > 1 ? value / 100 : value`, which reads 0.25 as
# "already a fraction" and stores 0.25 — twenty-five percent, a hundred times
# the intended tax. 1% broke the same way (1 is not > 1, so it stored as 100%).
# 25% and 100% are not GST slabs at all, which is precisely why the allowlist
# can recover the intent instead of preserving the corruption.
GST_SLABS = (
    Decimal("0"),
    Decimal("0.25"),
    Decimal("1"),
    Decimal("1.5"),
    Decimal("3"),
    Decimal("5"),
    Decimal("12"),
    Decimal("18"),
    Decimal("28"),
)


def _resolve_percent(value):
    """Return the percent this value must mean, or None if it is off-slab.

    Tries both readings and lets the slab list pick. Decimal compares
    numerically, so 0.030 and 3.000 match their slabs despite the trailing
    zeros the database hands back.
    """
    v = Decimal(str(value))
    if v == 0:
        return Decimal("0")
    for slab in GST_SLABS:
        if v == slab:
            return slab  # already a percent: 0.25, 3, 18
    scaled = v * 100
    for slab in GST_SLABS:
        if scaled == slab:
            return slab  # a stored fraction: 0.0025, 0.03, 0.18
    return None


def normalize_rate(value, assume="percent"):
    """Resolve a rate of either shape to the fraction form the DB stores.

    `assume` only decides off-slab values ("percent" or "fraction") — every
    legal slab is resolved by the allowlist regardless of what it says. Pass
    the shape the call site actually receives.

    Idempotent on all slabs: normalize_rate(normalize_rate(x)) == normalize_rate(x).
    """
    percent = _resolve_percent(value)
    if percent is None:
        v = Decimal(str(value))
        percent = v if assume == "percent" else v * 100
    return percent / 100


def rate_as_percent(stored):
    """Stored rate -> the percent a person, a GSTR table or an export expects.

    Off-slab values are treated as the fraction the column is contracted to
    hold. On-slab values are resolved by the allowlist, so a row still holding
    a pre-fix 0.25 reads back as 0.25% rather than 25%.
    """
    percent = _resolve_percent(stored)
    if percent is None:
        return Decimal(str(stored)) * 100
    return percent


def is_interstate(business, customer):
    """True when the supply crosses state lines (→ IGST), else False (→ CGST+SGST).

    GSTINs are authoritative when both sides have one — the first two digits are
    the state code. Falls back to state_name for B2C / unregistered parties,
    where a GSTIN-only check silently returns "intra" and books CGST+SGST on an
    interstate sale. Unknown on both counts → intra, the safer default for a
    local shop.
    """
    b_gstin = (getattr(business, "gst_number", "") or "").strip()
    c_gstin = (getattr(customer, "gst_number", "") or "").strip()
    if len(b_gstin) >= 2 and len(c_gstin) >= 2:
        return b_gstin[:2] != c_gstin[:2]

    b_state = (getattr(business, "state_name", "") or "").strip().upper()
    c_state = (getattr(customer, "state_name", "") or "").strip().upper()
    if b_state and c_state:
        return b_state != c_state
    return False


def normalize_tax_heads(cgst, sgst, igst, interstate):
    """Re-file a line's tax under the correct head, preserving the total.

    The client computes the split; if it gets the direction wrong the invoice
    total still looks right, so nothing on screen reveals it — but GSTR-1 and
    GSTR-3B report the wrong heads. Keep the amount the user saw, move it to
    the right column.
    """
    total = (cgst or 0) + (sgst or 0) + (igst or 0)
    if interstate:
        return Decimal("0"), Decimal("0"), Decimal(total)
    half = Decimal(total) / 2
    return half, half, Decimal("0")


def state_code(party):
    """Two-digit GST state code for a Business or Customer.

    GSTIN first; otherwise derive it from state_name via the GST_CODE table, so
    unregistered (B2C) parties still get a place of supply. Empty when neither
    is known.
    """
    gstin = (getattr(party, "gst_number", "") or "").strip()
    if len(gstin) >= 2:
        return gstin[:2]

    from billing.models import get_state_code_from_state_name

    name = (getattr(party, "state_name", "") or "").strip().upper()
    if not name:
        return ""
    code = get_state_code_from_state_name(name)
    return f"{int(code):02d}" if code not in ("", None) else ""
