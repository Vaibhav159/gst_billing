"""Where a supply is taxed, and under which head.

Kept apart from views and models so both the invoice write paths and the
inward-bills module decide this the same way, and so the rules can be unit
tested without a request.
"""

from decimal import Decimal


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
