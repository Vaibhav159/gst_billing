"""The bill maths on the screens and on the server agree to the paisa (part 1 design, decision 2).

web/src/core/sales/maths.vectors.json holds worked figures, and web/src/core/sales/maths.test.ts holds the client's
maths.ts to them. This file holds the server to the same figures (Ruling 1B-6):

* tax_rules' rule: a line's taxable value is to_paise(quantity x rate), its tax to_paise(taxable x rate), split by
  split_tax (CGST the half rounded half-up, SGST the rest, or all of it IGST);
* the line builder every v3 bill goes through, build_line_items(source="api"), on unsaved models.

A bill's total stays exact to the paisa: nothing rounds it to the rupee (Ruling 1B-12). A change to either side's
rounding fails one of the two files.
"""

import json
from decimal import Decimal
from pathlib import Path

from django.test import SimpleTestCase

from billing.models import Business, Customer, Invoice
from billing.services.line_items import build_line_items
from billing.tax_rules import normalize_rate, rate_as_percent, split_tax, to_paise

VECTORS = Path(__file__).resolve().parents[2] / "web" / "src" / "core" / "sales" / "maths.vectors.json"
LINE_FIGURES = ("taxable", "cgst", "sgst", "igst", "tax", "amount")
SLAB_FIGURES = ("taxable", "cgst", "sgst", "igst", "tax")


def by_rule(line, interstate):
    """One line's figures by tax_rules alone."""
    taxable = to_paise(Decimal(line["quantity"]) * Decimal(line["rate"]))
    cgst, sgst, igst = split_tax(taxable * normalize_rate(line["gst_percent"], assume="percent"), interstate)
    tax = cgst + sgst + igst
    return {"taxable": taxable, "cgst": cgst, "sgst": sgst, "igst": igst, "tax": tax, "amount": taxable + tax}


def built(lines, interstate):
    """The lines as the server's builder makes them for a bill from Rajasthan, to a local buyer or one in Maharashtra."""
    firm = Business(name="KIRAN GOLD HOUSE", gst_number="08ABCPK1234F1Z5", state_name="RAJASTHAN")
    buyer = (Customer(name="Mehta Traders", gst_number="27AAACK1234L1ZN", state_name="MAHARASHTRA") if interstate
             else Customer(name="Anil Gupta", gst_number="", state_name="RAJASTHAN"))
    items = [{"product_name": "Gold Ring 22K", "quantity": li["quantity"], "rate": li["rate"],
              "gst_tax_rate": normalize_rate(li["gst_percent"], assume="percent")} for li in lines]
    return build_line_items(Invoice(business=firm, customer=buyer), items, source="api")


def figures_of(li):
    """A built line's figures: its taxable value as the API works it out, its heads, their sum and its amount."""
    tax = li.cgst + li.sgst + li.igst
    return {"taxable": to_paise(li.quantity * li.rate), "cgst": li.cgst, "sgst": li.sgst, "igst": li.igst, "tax": tax,
            "amount": li.amount}


def money(vector, keys):
    return {k: Decimal(vector[k]) for k in keys}


class MathsVectorsTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vectors = json.loads(VECTORS.read_text())

    def test_each_line_comes_to_the_vectors_paise(self):
        for v in self.vectors["lines"]:
            want = money(v, LINE_FIGURES)
            with self.subTest(quantity=v["quantity"], rate=v["rate"], gst_percent=v["gst_percent"], interstate=v["interstate"]):
                self.assertEqual(by_rule(v, v["interstate"]), want)
                (line,), total = built([v], v["interstate"])
                self.assertEqual(figures_of(line), want)
                self.assertEqual(total, want["amount"])

    def test_each_bill_sums_its_lines_and_its_slabs_highest_first(self):
        for v in self.vectors["bills"]:
            with self.subTest(bill=v["name"]):
                lines, total = built(v["lines"], v["interstate"])
                figures = [figures_of(li) for li in lines]
                sums = {k: sum((f[k] for f in figures), Decimal(0)) for k in SLAB_FIGURES}
                self.assertEqual(sums, money(v, SLAB_FIGURES))
                self.assertEqual(total, Decimal(v["total"]))
                slabs = {}
                for li, f in zip(lines, figures, strict=True):
                    slab = slabs.setdefault(rate_as_percent(li.gst_tax_rate), dict.fromkeys(SLAB_FIGURES, Decimal(0)))
                    for k in SLAB_FIGURES:
                        slab[k] += f[k]
                self.assertEqual([{"gst_percent": p, **slabs[p]} for p in sorted(slabs, reverse=True)],
                                 [{"gst_percent": Decimal(s["gst_percent"]), **money(s, SLAB_FIGURES)} for s in v["slabs"]])
