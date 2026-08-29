"""Sales reconciliation — the CA's year-end working, computed by the app.

Pure module: no ORM, no DRF. The API layer hands in plain invoice rows
(one dict per invoice, its lines inlined) and gets back the rollup, the
payment-mode split, and the tie-out checks. Everything is Decimal; the
serialization boundary decides how to render.

Row shape:
    {
        "id": int, "invoice_number": str, "invoice_date": date,
        "customer_gstin": str,            # "" for B2C
        "payment_mode": str,              # "" when never recorded
        "total_amount": Decimal,          # invoice gross as stored
        "lines": [
            {"taxable": Decimal, "cgst": Decimal, "sgst": Decimal,
             "igst": Decimal, "rate": Decimal},   # rate as fraction, e.g. 0.03
        ],
    }
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

TWO = Decimal("0.01")
Z = Decimal("0")

# A difference at or under one rupee is rounding noise between paise-level
# line math and whole-invoice figures; anything above is a real mismatch.
ROUNDING_TOLERANCE = Decimal("1.00")

QUARTER_LABELS = {1: "APR-JUN", 2: "JUL-SEP", 3: "OCT-DEC", 4: "JAN-MAR"}
PERIODS = (1, 2, 3, 4, "FY")


def quarter_of(d: date) -> int:
    """Financial-year quarter (Apr–Mar): Apr-Jun=1 … Jan-Mar=4."""
    return (d.month - 4) % 12 // 3 + 1


def fy_bounds(fy: str) -> tuple[date, date]:
    """"2025-26" -> (2025-04-01, 2026-03-31)."""
    start_year = int(fy.split("-")[0])
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


@dataclass
class Cell:
    taxable: Decimal = Z
    cgst: Decimal = Z
    sgst: Decimal = Z
    igst: Decimal = Z

    def add_line(self, line):
        self.taxable += line["taxable"]
        self.cgst += line["cgst"]
        self.sgst += line["sgst"]
        self.igst += line["igst"]

    def as_dict(self):
        return {
            "taxable": self.taxable.quantize(TWO),
            "cgst": self.cgst.quantize(TWO),
            "sgst": self.sgst.quantize(TWO),
            "igst": self.igst.quantize(TWO),
        }


@dataclass
class ModeBucket:
    mode: str
    gross: Decimal = Z
    taxable: Decimal = Z
    cgst: Decimal = Z
    sgst: Decimal = Z
    igst: Decimal = Z
    invoice_count: int = 0
    share_pct: Decimal = Z


@dataclass
class Check:
    id: str
    label: str
    period: str
    expected: Decimal
    actual: Decimal
    difference: Decimal
    status: str  # pass | rounding | fail


@dataclass
class ReconResult:
    fy: str
    # section -> period -> Cell ; sections: gstr3b, b2b, b2c
    rollup: dict = field(default_factory=dict)
    modes: list = field(default_factory=list)
    checks: list = field(default_factory=list)
    invoice_counts: dict = field(default_factory=dict)  # period -> {in, rolled, empty}
    rate_buckets: dict = field(default_factory=dict)    # period -> rate -> Cell


def _blank_rollup():
    return {sec: {p: Cell() for p in PERIODS} for sec in ("gstr3b", "b2b", "b2c")}


def rollup(rows) -> ReconResult:
    r = ReconResult(fy="")
    r.rollup = _blank_rollup()
    counts = {p: {"in": 0, "rolled": 0, "empty": 0} for p in PERIODS}
    rate_buckets: dict = {p: defaultdict(Cell) for p in PERIODS}

    for row in rows:
        q = quarter_of(row["invoice_date"])
        seg = "b2b" if (row.get("customer_gstin") or "").strip() else "b2c"
        for p in (q, "FY"):
            counts[p]["in"] += 1
        if not row["lines"]:
            for p in (q, "FY"):
                counts[p]["empty"] += 1
            continue
        for p in (q, "FY"):
            counts[p]["rolled"] += 1
        for line in row["lines"]:
            for p in (q, "FY"):
                r.rollup["gstr3b"][p].add_line(line)
                r.rollup[seg][p].add_line(line)
                rate_buckets[p][line["rate"]].add_line(line)

    r.invoice_counts = counts
    r.rate_buckets = {p: dict(b) for p, b in rate_buckets.items()}
    return r


def payment_split(rows) -> list[ModeBucket]:
    """Exact per-mode sums from invoice-level modes.

    Because every invoice carries its own mode (or the honest "" for
    not-recorded), each bucket is an exact sum of its invoices' lines —
    no ratio allocation is needed, and the buckets tie to the whole by
    construction. share_pct is display-only, computed on gross with the
    residual-last rule so the percentages themselves total 100.0000.
    """
    buckets: dict[str, ModeBucket] = {}
    for row in rows:
        mode = (row.get("payment_mode") or "").strip() or "(not set)"
        b = buckets.setdefault(mode, ModeBucket(mode=mode))
        b.gross += row["total_amount"]
        b.invoice_count += 1
        for line in row["lines"]:
            b.taxable += line["taxable"]
            b.cgst += line["cgst"]
            b.sgst += line["sgst"]
            b.igst += line["igst"]

    ordered = sorted(buckets.values(), key=lambda b: -b.gross)
    all_gross = sum((b.gross for b in ordered), Z)
    if all_gross > Z and ordered:
        # Residual-last: every share but the final one is rounded from the
        # ratio; the last takes 100 − Σothers so the column sums exactly.
        acc = Z
        for b in ordered[:-1]:
            b.share_pct = (b.gross * 100 / all_gross).quantize(Decimal("0.0001"))
            acc += b.share_pct
        ordered[-1].share_pct = (Decimal("100") - acc).quantize(Decimal("0.0001"))
    for b in ordered:
        b.gross = b.gross.quantize(TWO)
        b.taxable = b.taxable.quantize(TWO)
        b.cgst = b.cgst.quantize(TWO)
        b.sgst = b.sgst.quantize(TWO)
        b.igst = b.igst.quantize(TWO)
    return ordered


def _status(diff: Decimal) -> str:
    a = abs(diff)
    if a == Z:
        return "pass"
    if a <= ROUNDING_TOLERANCE:
        return "rounding"
    return "fail"


def _check(cid, label, period, expected: Decimal, actual: Decimal) -> Check:
    diff = (actual - expected).quantize(TWO)
    return Check(
        id=cid, label=label, period=str(period),
        expected=expected.quantize(TWO), actual=actual.quantize(TWO),
        difference=diff, status=_status(diff),
    )


def run_checks(result: ReconResult, modes: list[ModeBucket]) -> list[Check]:
    checks: list[Check] = []
    R = result.rollup

    for p in PERIODS:
        plabel = QUARTER_LABELS.get(p, "FY")
        # 1+2: B2B + B2C = GSTR-3B, per column
        for col in ("taxable", "cgst", "sgst", "igst"):
            checks.append(_check(
                f"b2b_b2c_{col}", f"B2B + B2C {col} = GSTR-3B {col}", plabel,
                getattr(R["gstr3b"][p], col),
                getattr(R["b2b"][p], col) + getattr(R["b2c"][p], col),
            ))
        # 4: tax charged = taxable × rate, per rate bucket
        for rate, cell in sorted(result.rate_buckets.get(p, {}).items()):
            expected_tax = (cell.taxable * rate).quantize(TWO)
            actual_tax = (cell.cgst + cell.sgst + cell.igst).quantize(TWO)
            pct = (rate * 100).normalize()
            checks.append(_check(
                f"rate_{pct}", f"Tax at {pct}% = taxable × {pct}%", plabel,
                expected_tax, actual_tax,
            ))
        # 7: every invoice with lines is rolled up; empties surfaced
        c = result.invoice_counts[p]
        checks.append(_check(
            "coverage", f"Invoices rolled up ({c['rolled']} of {c['in']}; {c['empty']} empty)",
            plabel, Decimal(c["in"]), Decimal(c["rolled"] + c["empty"]),
        ))

    # 3: quarters sum to FY, every section and column
    for sec in ("gstr3b", "b2b", "b2c"):
        for col in ("taxable", "cgst", "sgst", "igst"):
            qsum = sum((getattr(R[sec][q], col) for q in (1, 2, 3, 4)), Z)
            checks.append(_check(
                f"qsum_{sec}_{col}", f"Σ quarters = FY ({sec} {col})", "FY",
                getattr(R[sec]["FY"], col), qsum,
            ))

    # 5+6: payment buckets tie to the whole (FY level; the "(not set)"
    # bucket participates so the identity is honest even for old years)
    fy_cell = R["gstr3b"]["FY"]
    total_tax = fy_cell.cgst + fy_cell.sgst + fy_cell.igst
    checks.append(_check(
        "mode_gross", "Σ mode gross = GSTR-3B taxable + GST", "FY",
        fy_cell.taxable + total_tax, sum((b.gross for b in modes), Z),
    ))
    checks.append(_check(
        "mode_taxable", "Σ mode taxable = GSTR-3B taxable", "FY",
        fy_cell.taxable, sum((b.taxable for b in modes), Z),
    ))
    return checks


def reconcile(fy: str, rows) -> ReconResult:
    result = rollup(rows)
    result.fy = fy
    result.modes = payment_split(rows)
    result.checks = run_checks(result, result.modes)
    return result
