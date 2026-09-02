"""The GSTR-2A importer had no test file at all (audit F5)."""

import io
from datetime import date
from decimal import Decimal

from django.test import TestCase
from openpyxl import Workbook

from billing.constants import INVOICE_TYPE_INWARD
from billing.models import Business, Customer, Invoice
from billing.services.gstr2a_import import import_file, preview_file

COLUMNS = ["GSTIN", "Supplier Name", "Invoice No", "Invoice Date", "Invoice Value", "Taxable Value",
           "IGST", "CGST", "SGST", "CESS", "3B Status", "RC", "State", "POS"]


def portal_file(recipient_gstin="08ABCDE1234A1Z5", rows=None):
    """A workbook shaped like the portal's download: a recipient header on
    row 0, column headers on row 2, data from row 3; plus a `note` sheet."""
    wb = Workbook()
    ws = wb.active
    ws.title = "invoice"
    ws.append([f"Goods and Services Tax - GSTR-2A  LODHA JEWELLERS  {recipient_gstin}"])
    ws.append(["Financial year 2026-27"])
    ws.append(COLUMNS)
    for r in rows if rows is not None else [
        ["27AAAAA0000A1Z5", "SOLANKI JEWELLERS", "S-101", date(2026, 5, 10), 10300, 10000, 300, 0, 0, 0, "Filed", "No", "Maharashtra", "08-Rajasthan"],
        ["08BBBBB0000B1Z5", "JAIPUR BULLION", "J-7", date(2026, 5, 12), 20600, 20000, 0, 300, 300, 0, "Not filed", "No", "Rajasthan", "08-Rajasthan"],
    ]:
        ws.append(r)
    note = wb.create_sheet("note")
    note.append(["Credit/Debit notes"])
    note.append([""])
    note.append(["nothing here"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class GSTR2AImportTests(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")

    def test_preview_matches_the_business_by_recipient_gstin(self):
        p = preview_file(portal_file(), filename="2A.xlsx")
        self.assertEqual(p.recipient_gstin, "08ABCDE1234A1Z5")
        self.assertEqual(p.matched_business_id, self.biz.id)
        self.assertEqual(len(p.parsed_rows), 2)
        self.assertEqual(p.parse_errors, [])
        self.assertEqual(p.parsed_rows[0].igst, Decimal("300"))
        self.assertTrue(p.parsed_rows[0].filed_3b)
        self.assertFalse(p.parsed_rows[1].filed_3b)

    def test_import_creates_inward_invoices_suppliers_by_gstin_and_is_idempotent(self):
        result = import_file(portal_file(), filename="2A.xlsx")
        self.assertEqual(result.errors, [])
        self.assertEqual((result.created_invoices, result.created_suppliers), (2, 2))
        invs = Invoice.objects.filter(business=self.biz).order_by("invoice_number")
        self.assertEqual([i.type_of_invoice for i in invs], [INVOICE_TYPE_INWARD] * 2)
        inter = invs.get(invoice_number="S-101")
        self.assertEqual(inter.customer.gst_number, "27AAAAA0000A1Z5")
        self.assertEqual(inter.total_amount, Decimal("10300"))
        li = inter.lineitem_set.get()
        self.assertEqual((li.cgst, li.sgst, li.igst), (Decimal("0"), Decimal("0"), Decimal("300")))
        intra = invs.get(invoice_number="J-7").lineitem_set.get()
        self.assertEqual((intra.cgst, intra.sgst, intra.igst), (Decimal("300"), Decimal("300"), Decimal("0")))

        again = import_file(portal_file(), filename="2A.xlsx")
        self.assertEqual(again.created_invoices, 0)
        self.assertEqual(again.skipped_duplicates, 2)
        self.assertEqual(Invoice.objects.filter(business=self.biz).count(), 2)
        self.assertEqual(Customer.objects.filter(gst_number__in=["27AAAAA0000A1Z5", "08BBBBB0000B1Z5"]).count(), 2)

    def test_dry_run_commits_nothing(self):
        import_file(portal_file(), filename="2A.xlsx", dry_run=True)
        self.assertEqual(Invoice.objects.count(), 0)
        self.assertEqual(Customer.objects.count(), 0)

    def test_unknown_recipient_imports_nothing_and_says_why(self):
        result = import_file(portal_file(recipient_gstin="29ZZZZZ9999Z1Z5"), filename="2A.xlsx")
        self.assertEqual(result.created_invoices, 0)
        self.assertEqual(result.skipped_no_business, 2)
        self.assertTrue(any("No Business found" in e for e in result.errors))
        self.assertEqual(Invoice.objects.count(), 0)

    def test_a_bad_date_is_a_row_error_not_a_crash(self):
        rows = [["27AAAAA0000A1Z5", "SOLANKI JEWELLERS", "S-1", "not a date", 10300, 10000, 300, 0, 0, 0, "Filed", "No", "MH", "08"]]
        p = preview_file(portal_file(rows=rows), filename="2A.xlsx")
        self.assertEqual(len(p.parsed_rows), 0)
        self.assertEqual(len(p.parse_errors), 1)
