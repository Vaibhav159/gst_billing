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
    Decimal("0.1"),  # merchant exports
    Decimal("0.25"),
    Decimal("1"),
    Decimal("1.5"),
    Decimal("3"),
    Decimal("5"),
    Decimal("12"),
    Decimal("18"),
    Decimal("28"),
    Decimal("40"),  # de-merit slab, in force since 22 Sep 2025
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
        # A stored fraction can never exceed 1, so anything above 1 is a
        # percent whatever the caller assumed. Without this an off-slab 7%
        # arriving as 7 under assume="fraction" was stored as 700%.
        percent = v if (v > 1 or assume == "percent") else v * 100
    return percent / 100


def rate_as_percent(stored):
    """Stored rate -> the percent a person, a GSTR table or an export expects.

    Off-slab values are treated as the fraction the column is contracted to
    hold. On-slab values are resolved by the allowlist, so a row still holding
    a pre-fix 0.25 reads back as 0.25% rather than 25%.
    """
    percent = _resolve_percent(stored)
    if percent is None:
        v = Decimal(str(stored))
        # Above 1 it cannot be a fraction: it is a percent stored verbatim.
        return v if v > 1 else v * 100
    return percent


def is_interstate(business, customer):
    """True when the supply crosses state lines (→ IGST), else False (→ CGST+SGST).

    GSTINs are authoritative when both sides have one — the first two digits are
    the state code. Falls back to state_name for B2C / unregistered parties,
    where a GSTIN-only check silently returns "intra" and books CGST+SGST on an
    interstate sale. Unknown on both counts → intra, the safer default for a
    local shop.
    """
    # Each side resolves to a state code the same way state_code() does —
    # GSTIN prefix first, state_name second — so the head this decides and
    # the place of supply the exports file can never disagree. Comparing
    # raw state_names let a business whose GSTIN and state_name differed
    # file an inter-state row against its own state code.
    b_code, c_code = state_code(business), state_code(customer)
    if b_code and c_code:
        return b_code != c_code
    return False


def direction_known(business, customer):
    """False when nothing on either side says where the supply goes.

    is_interstate answers "intra" for that case — the safe default for a
    local shop — but a caller holding heads the *file* supplied should keep
    them rather than overwrite them with a guess. Bulk import used to re-file
    an explicit IGST as CGST+SGST for exactly this reason.
    """
    return bool(state_code(business) and state_code(customer))


def classify_b2c(business, invoice):
    """Which GSTR-1 table a sale files in, and against which place of supply.

    Returns (table, interstate, pos, downgraded): table is "b2b", "b2cl" or
    "b2cs"; downgraded is True when the sale looked inter-state but the
    customer's state is unknown, so it is filed intra rather than dropped.

    Shared by gstr_export and gstr1_portal_json. They used to carry their own
    copies of this rule, and an inter-state B2C sale under the threshold fell
    between them (audit A2). One copy cannot drift from itself.
    """
    from billing.constants import B2CL_THRESHOLD

    customer = invoice.customer
    cust_gstin = (getattr(customer, "gst_number", "") or "").strip().upper()
    if len(cust_gstin) == 15:
        return "b2b", None, cust_gstin[:2], False

    inter = is_interstate(business, customer)
    cust_pos = state_code(customer)
    downgraded = inter and not cust_pos
    if downgraded:
        inter = False
    if inter and (invoice.total_amount or 0) > B2CL_THRESHOLD:
        return "b2cl", True, cust_pos, False
    return "b2cs", inter, (cust_pos if inter else state_code(business)), downgraded


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


def state_name_from_gstin(gstin):
    """The state a GSTIN belongs to, or "" when it cannot be read.

    Import paths used to stamp every auto-created customer with the shop's own
    state, which made a Mumbai buyer look local forever — the corrected
    interstate rule would still have said "intra". A GSTIN carries its state in
    the first two digits, so it can answer this without guessing; without one,
    blank is honest and is_interstate falls back to intra, the safe default.
    """
    from billing.gstin import derive

    g = (gstin or "").strip()
    if len(g) < 2 or not g[:2].isdigit():
        return ""
    return derive(g)["state_name"]


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
