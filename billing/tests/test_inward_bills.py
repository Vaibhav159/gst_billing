"""Tests for the Inward Bills module."""

import json
from decimal import Decimal as D
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from billing.api.inward_bills_service import (
    compute_lines,
    gstin_matches,
    resolve_tax,
)
from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class InwardBillsServiceTest(SimpleTestCase):
    """Pure tax + validation helpers (no DB)."""

    def test_resolve_tax_intra(self):
        self.assertEqual(
            resolve_tax(D("468544"), D("0.03"), intra=True),
            (D("7028.16"), D("7028.16"), D("0")),
        )

    def test_resolve_tax_inter(self):
        self.assertEqual(
            resolve_tax(D("76889.09"), D("0.03"), intra=False),
            (D("0"), D("0"), D("2306.67")),
        )

    def test_compute_lines_intra_amounts(self):
        lines = [{"taxable": D("3883.5"), "rate": D("0.03")}]
        out, total = compute_lines(lines, intra=True)
        self.assertEqual(out[0]["cgst"], D("58.25"))
        self.assertEqual(out[0]["sgst"], D("58.25"))
        self.assertEqual(out[0]["amount"], D("4000.00"))
        self.assertEqual(total, D("4000.00"))

    def test_compute_lines_absorbs_roundoff_to_bill_total(self):
        # printed total 31533.00; natural sum 31533.24 -> last line absorbs -0.24
        lines = [
            {"taxable": D("5368.80"), "rate": D("0.03")},
            {"taxable": D("25246.00"), "rate": D("0.03")},
        ]
        out, total = compute_lines(lines, intra=True, bill_total=D("31533.00"))
        self.assertEqual(total, D("31533.00"))
        self.assertEqual(sum(line["amount"] for line in out), D("31533.00"))
        self.assertEqual(out[0]["cgst"], D("80.53"))
        self.assertEqual(out[1]["cgst"], D("378.69"))
        self.assertEqual(out[1]["amount"], D("26003.14"))

    def test_compute_lines_inter_sets_igst_only(self):
        lines = [{"taxable": D("76889.09"), "rate": D("0.03")}]
        out, _ = compute_lines(lines, intra=False)
        self.assertEqual(out[0]["igst"], D("2306.67"))
        self.assertEqual(out[0]["cgst"], D("0"))
        self.assertEqual(out[0]["sgst"], D("0"))

    def test_gstin_matches(self):
        self.assertTrue(gstin_matches("08AAGPL3375F1ZO", "08AAGPL3375F1ZO"))
        self.assertTrue(gstin_matches("08aagpl3375f1zo", "08AAGPL3375F1ZO"))
        self.assertFalse(gstin_matches("", "08AAGPL3375F1ZO"))  # B2C / unregistered
        self.assertFalse(gstin_matches(None, "08AAGPL3375F1ZO"))
        self.assertFalse(gstin_matches("27AABCR1718E1ZP", "08AAGPL3375F1ZO"))


class InwardBillAPITest(BaseAPITestCase):
    """List / detail / extract / create endpoints."""

    def _make_inward(self, number="P-1", supplier=None):
        supplier = supplier or self.customer
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=supplier,
            invoice_number=number, invoice_date="2026-05-01",
            type_of_invoice=INVOICE_TYPE_INWARD, total_amount=0,
        )
        LineItem.objects.create(
            workspace_id=1, customer=supplier, invoice=inv, product_name="Silver",
            hsn_code="711319", gst_tax_rate="0.03", quantity="10", rate="100",
            cgst="15", sgst="15", igst="0", amount="1030", unit="gms",
        )
        inv.refresh_from_db()
        return inv

    def test_list_returns_only_inward(self):
        self._make_inward(number="P-1")
        Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="S-1", invoice_date="2026-05-02",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        resp = self.client.get(reverse("inward-bill-list"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["invoice_number"], "P-1")
        self.assertEqual(resp.data["results"][0]["supplier"]["name"], self.customer.name)

    def test_list_filters(self):
        self._make_inward(number="P-1")
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"business": 999999}).data["count"], 0)
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"business": self.business.id}).data["count"], 1)
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"q": self.customer.name[:4]}).data["count"], 1)
        self.assertEqual(self.client.get(reverse("inward-bill-list"), {"q": "zzzznomatch"}).data["count"], 0)

    def test_detail_has_line_items_and_file_field(self):
        inv = self._make_inward(number="P-9")
        resp = self.client.get(reverse("inward-bill-detail", args=[inv.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["line_items"]), 1)
        self.assertIn("source_file_url", resp.data)

    def test_extract_maps_supplier_and_tax_type(self):
        fake = {
            "buyer_gst_number": self.business.gst_number, "buyer_name": "Us",
            "seller_gst_number": "27AABCR1718E1ZP", "seller_name": "ACME SUPPLIES",
            "invoice_number": "AC-1", "invoice_date": "2026-05-01",
            "customer_name": "", "customer_gst_number": "",
            "line_items": [{"product_name": "Gold", "quantity": 5, "rate": 100,
                            "hsn_code": "7108", "gst_tax_rate": 0.03, "amount": 500}],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["supplier"]["gstin"], "27AABCR1718E1ZP")
        self.assertEqual(resp.data["supplier"]["name"], "ACME SUPPLIES")
        self.assertEqual(resp.data["tax_type"], "igst")  # 27 != 22
        self.assertFalse(resp.data["warnings"]["gstin_mismatch"])
        self.assertEqual(len(resp.data["line_items"]), 1)

    @override_settings(GEMINI_API_KEYS="", GEMINI_API_KEY="")
    def test_extract_works_without_api_keys_configured(self):
        # Regression guard: the processor must be constructible without keys so
        # that patching process_invoice_image is enough to test this view. When
        # the key check lived in __init__, these tests passed only on machines
        # with keys in .env and failed in CI.
        fake = {
            "buyer_gst_number": self.business.gst_number,
            "seller_gst_number": "27AABCR1718E1ZP", "seller_name": "ACME SUPPLIES",
            "invoice_number": "AC-2", "invoice_date": "2026-05-01", "line_items": [],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["warnings"]["extraction_failed"])
        self.assertEqual(resp.data["supplier"]["gstin"], "27AABCR1718E1ZP")

    def test_extract_flags_gstin_mismatch(self):
        fake = {
            "buyer_gst_number": "99ZZZZZ0000Z1Z9",  # not our firm
            "seller_gst_number": "22XXXXX0000X1Z5", "seller_name": "S",
            "invoice_number": "M-1", "invoice_date": "2026-05-01", "line_items": [],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertTrue(resp.data["warnings"]["gstin_mismatch"])
        self.assertEqual(resp.data["tax_type"], "cgst_sgst")  # 22 == 22

    def test_extract_missing_buyer_gstin_does_not_false_flag(self):
        # AI failed to read the buyer GSTIN -> we must NOT flag a mismatch
        # (would false-positive on clean bills addressed to the firm).
        fake = {
            "buyer_gst_number": "", "seller_gst_number": "27AABCR1718E1ZP",
            "seller_name": "ACME", "invoice_number": "AC-9",
            "invoice_date": "2026-05-01", "customer_name": "", "customer_gst_number": "",
            "line_items": [],
        }
        f = SimpleUploadedFile("b.jpg", b"x", content_type="image/jpeg")
        with patch("billing.api.inward_bills.AIInvoiceProcessor.process_invoice_image", return_value=fake):
            resp = self.client.post(reverse("inward-bill-extract"),
                                    {"file": f, "business_id": self.business.id})
        self.assertFalse(resp.data["warnings"]["gstin_mismatch"])

    def test_extract_pdf_falls_back_to_manual(self):
        f = SimpleUploadedFile("b.pdf", b"%PDF-1.4", content_type="application/pdf")
        resp = self.client.post(reverse("inward-bill-extract"),
                                {"file": f, "business_id": self.business.id})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["warnings"]["extraction_failed"])

    def test_create_intra_tax_file_and_supplier(self):
        f = SimpleUploadedFile("b.jpg", b"\xff\xd8\xffdata", content_type="image/jpeg")
        resp = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "NEW SUPPLIER", "supplier_gstin": "22ZZZZZ0000Z1Z5",
            "invoice_number": "N-1", "invoice_date": "2026-05-05",
            "lines": json.dumps([{"product_name": "Silver", "hsn_code": "711319",
                                  "quantity": "20", "rate": "194.175", "gst_tax_rate": "0.03", "unit": "gms"}]),
            "bill_total": "4000.00", "file": f,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        inv = Invoice.objects.get(invoice_number="N-1", type_of_invoice=INVOICE_TYPE_INWARD)
        li = inv.lineitem_set.get()
        self.assertEqual(li.cgst, D("58.25"))
        self.assertEqual(li.sgst, D("58.25"))
        self.assertEqual(li.igst, D("0"))
        self.assertEqual(inv.total_amount, D("4000.00"))
        self.assertTrue(bool(inv.source_file))
        supplier = Customer.objects.get(gst_number="22ZZZZZ0000Z1Z5")
        self.assertIn(self.business, list(supplier.businesses.all()))

    def test_create_inter_state_sets_igst(self):
        f = SimpleUploadedFile("b.jpg", b"data", content_type="image/jpeg")
        resp = self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id,
            "supplier_name": "MH SUP", "supplier_gstin": "27AABCR1718E1ZP",
            "invoice_number": "N-2", "invoice_date": "2026-05-05",
            "lines": json.dumps([{"product_name": "Gold", "hsn_code": "7108",
                                  "quantity": "2", "rate": "15085.815", "gst_tax_rate": "0.03", "unit": "gms"}]),
            "file": f,
        })
        self.assertEqual(resp.status_code, 201, resp.data)
        li = Invoice.objects.get(invoice_number="N-2").lineitem_set.get()
        self.assertEqual(li.igst, D("905.15"))
        self.assertEqual(li.cgst, D("0"))
        self.assertEqual(li.sgst, D("0"))

    def _dup_payload(self, number, supplier_name, supplier_gstin):
        return {
            "business_id": self.business.id, "supplier_gstin": supplier_gstin,
            "supplier_name": supplier_name, "invoice_number": number,
            "invoice_date": "2026-05-05",
            "lines": json.dumps([{"product_name": "A", "hsn_code": "1",
                                  "quantity": "1", "rate": "100", "gst_tax_rate": "0.03"}]),
        }

    def test_same_supplier_same_number_is_409_then_overridable(self):
        base = self._dup_payload("DUP-1", "DUPCO", "22ZZZZZ0000Z1Z5")
        first = self.client.post(reverse("inward-bill-list"),
                                 {**base, "file": SimpleUploadedFile("a.jpg", b"d", content_type="image/jpeg")})
        self.assertEqual(first.status_code, 201, first.data)

        again = self.client.post(reverse("inward-bill-list"),
                                 {**base, "file": SimpleUploadedFile("a.jpg", b"d", content_type="image/jpeg")})
        self.assertEqual(again.status_code, 409)

        forced = self.client.post(reverse("inward-bill-list"),
                                  {**base, "override_warnings": "true",
                                   "file": SimpleUploadedFile("a.jpg", b"d", content_type="image/jpeg")})
        self.assertEqual(forced.status_code, 201, forced.data)
        self.assertEqual(Invoice.objects.filter(invoice_number="DUP-1",
                         type_of_invoice=INVOICE_TYPE_INWARD).count(), 2)

    def test_two_suppliers_may_both_use_the_same_bill_number(self):
        # Bill numbering belongs to the supplier, so two of them issuing a
        # "001" in the same year is ordinary. Keying the duplicate check on
        # (business, number) alone rejected the second one outright.
        one = self.client.post(reverse("inward-bill-list"),
                               self._dup_payload("001", "SUPPLIER ONE", "22AAAAA1111A1Z5"))
        self.assertEqual(one.status_code, 201, one.data)
        two = self.client.post(reverse("inward-bill-list"),
                               self._dup_payload("001", "SUPPLIER TWO", "22BBBBB2222B1Z5"))
        self.assertEqual(two.status_code, 201, two.data)
        self.assertEqual(Invoice.objects.filter(invoice_number="001",
                         type_of_invoice=INVOICE_TYPE_INWARD).count(), 2)


class InwardBillRateTest(BaseAPITestCase):
    """C1: the capture form had no GST-rate field and the server turned a
    blank or 0 rate into 3%, so every manually entered purchase booked 3%
    ITC; an AI-read "0.25" went in verbatim and was taxed at 25%."""

    def _post(self, number, rate, **line):
        ln = {"product_name": "Cut & Polished Diamonds", "hsn_code": "710239",
              "quantity": "2", "rate": "500000", "unit": "ct", **line}
        if rate is not ...:
            ln["gst_tax_rate"] = rate
        return self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id, "supplier_name": "GEM HOUSE",
            "supplier_gstin": "22CCCCC0000C1Z5",
            "invoice_number": number, "invoice_date": "2026-05-05",
            "lines": json.dumps([ln]),
        })

    def test_every_rate_shape_is_stored_as_the_slab_it_means(self):
        # (what arrives, stored fraction, CGST on a 10,00,000 taxable line)
        cases = [
            ("0.25", D("0.0025"), D("1250.00")),   # Gemini's reading of 0.25%
            ("0.0025", D("0.0025"), D("1250.00")),
            ("3", D("0.03"), D("15000.00")),       # a percent on the wire
            ("0.03", D("0.03"), D("15000.00")),
            (0.05, D("0.05"), D("25000.00")),
        ]
        for i, (sent, stored, cgst) in enumerate(cases):
            with self.subTest(sent=sent):
                resp = self._post(f"R-{i}", sent)
                self.assertEqual(resp.status_code, 201, resp.data)
                li = Invoice.objects.get(invoice_number=f"R-{i}").lineitem_set.get()
                self.assertEqual(li.gst_tax_rate, stored)
                self.assertEqual((li.cgst, li.sgst, li.igst), (cgst, cgst, D("0")))

    def test_a_rate_off_the_slab_list_is_refused(self):
        """No GST slab is 50%, 12.5%, 100% or 7%: "0.5" was stored as 50%, and
        "0.125" (the CGST half of 0.25%) as 12.5%. The picker can't send these;
        an API client could."""
        for i, rate in enumerate(["0.5", "0.125", "100", "7", "-0.03"]):
            with self.subTest(rate=rate):
                resp = self._post(f"OFF-{i}", rate)
                self.assertEqual(resp.status_code, 400, resp.data)
                self.assertIn("GST rate", resp.data["error"])
        self.assertFalse(Invoice.objects.filter(invoice_number__startswith="OFF-").exists())

    def test_an_explicit_zero_rate_books_no_tax(self):
        resp = self._post("Z-1", 0)
        self.assertEqual(resp.status_code, 201, resp.data)
        li = Invoice.objects.get(invoice_number="Z-1").lineitem_set.get()
        self.assertEqual((li.gst_tax_rate, li.cgst + li.sgst + li.igst), (D("0"), D("0")))

    def test_a_line_without_a_rate_is_refused_not_booked_at_3pct(self):
        suppliers = Customer.objects.count()
        for i, rate in enumerate([..., None, "", "three"]):
            with self.subTest(rate=rate):
                resp = self._post(f"N-{i}", rate)
                self.assertEqual(resp.status_code, 400)
                self.assertIn("GST rate", resp.data["error"])
        self.assertFalse(Invoice.objects.filter(invoice_number__startswith="N-").exists())
        self.assertEqual(Customer.objects.count(), suppliers, "a refused bill must not create its supplier")


class InwardBillNoGstinTest(BaseAPITestCase):
    """C1b: a purchase from a supplier without a GSTIN carries no input tax.
    Without one on the bill there is no ITC to claim, whatever rate it shows."""

    def _post(self, number, gstin, rates):
        data = {
            "business_id": self.business.id, "supplier_name": "LOCAL KARIGAR",
            "invoice_number": number, "invoice_date": "2026-05-05",
            "lines": json.dumps([
                {"product_name": f"item {i}", "hsn_code": "711319", "quantity": "1",
                 "rate": "10000", "gst_tax_rate": rate}
                for i, rate in enumerate(rates)
            ]),
        }
        if gstin is not None:
            data["supplier_gstin"] = gstin
        return self.client.post(reverse("inward-bill-list"), data)

    def test_gst_on_a_bill_without_a_supplier_gstin_is_refused_naming_the_line(self):
        suppliers = Customer.objects.count()
        for i, gstin in enumerate([None, "", "NA", "URP", " urp "]):
            with self.subTest(gstin=gstin):
                resp = self._post(f"U-{i}", gstin, ["0", "0.03"])
                self.assertEqual(resp.status_code, 400, resp.data)
                self.assertIn("Line 2", resp.data["error"])
                self.assertIn("GSTIN", resp.data["error"])
        # 14 characters: a typo, refused as one rather than as "no GSTIN" (review of H12).
        resp = self._post("U-T", "22AAAAA0000A1Z", ["0", "0.03"])
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn("isn't a GSTIN", resp.data["error"])
        self.assertFalse(Invoice.objects.filter(invoice_number__startswith="U-").exists())
        self.assertEqual(Customer.objects.count(), suppliers, "a refused bill must not create its supplier")

    def test_a_zero_rated_bill_without_a_gstin_is_recorded_and_the_placeholder_is_not_kept(self):
        resp = self._post("U-OK", "URP", ["0", "0"])
        self.assertEqual(resp.status_code, 201, resp.data)
        inv = Invoice.objects.get(invoice_number="U-OK")
        self.assertEqual(sum(li.cgst + li.sgst + li.igst for li in inv.lineitem_set.all()), 0)
        self.assertIn(inv.customer.gst_number, (None, ""), "URP is not a GSTIN")

    def test_a_gstin_typed_for_a_supplier_on_file_without_one_is_kept_on_the_supplier(self):
        """The no-GSTIN hint asks for the supplier's GSTIN. Matched by name, the
        supplier on file kept its blank GSTIN while the bill claimed credit on
        the typed one: later edits (which check the stored GSTIN) were refused,
        and GSTR-2B matching showed no supplier GSTIN."""
        sup = Customer.objects.create(name="LOCAL KARIGAR", gst_number="URP")
        resp = self._post("G-1", "22KKKKK0000K1Z5", ["0.03"])
        self.assertEqual(resp.status_code, 201, resp.data)
        sup.refresh_from_db()
        self.assertEqual(sup.gst_number, "22KKKKK0000K1Z5")
        self.assertEqual(Invoice.objects.get(invoice_number="G-1").customer_id, sup.id)

    def test_a_supplier_gstin_on_file_is_never_overwritten(self):
        # Nor is the bill booked there under the other GSTIN: it is refused
        # until the GSTIN or the name is corrected (review of M26).
        sup = Customer.objects.create(name="LOCAL KARIGAR", gst_number="22AAAAA1111A1Z5")
        resp = self._post("G-2", "22KKKKK0000K1Z5", ["0.03"])
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data["error"], "supplier_gstin_conflict")
        sup.refresh_from_db()
        self.assertEqual(sup.gst_number, "22AAAAA1111A1Z5")
        self.assertFalse(Invoice.objects.filter(invoice_number="G-2").exists())


class AIReadRateTest(SimpleTestCase):
    """C1: a rate the model didn't give is unknown, not 3%. The extractor's
    0.03 fallback made the inward form preselect 3% and AI Import book 3% ITC."""

    def _rates(self, *items):
        from billing.utils import AIInvoiceProcessor

        out = AIInvoiceProcessor._convert_to_dict({"line_items": [
            {"product_name": "x", "quantity": 1, "rate": 100, **item} for item in items
        ]})
        return [li["gst_tax_rate"] for li in out["line_items"]]

    def test_a_missing_rate_stays_unknown(self):
        self.assertEqual(self._rates({}, {"gst_tax_rate": None}, {"gst_tax_rate": ""}, {"gst_tax_rate": "n/a"}),
                         [None, None, None, None])

    def test_a_rate_the_model_gave_is_kept_as_read(self):
        self.assertEqual(self._rates({"gst_tax_rate": 0}, {"gst_tax_rate": 0.25}, {"gst_tax_rate": "0.03"}), [0.0, 0.25, 0.03])


class InwardBillSavedSupplierHeadTest(BaseAPITestCase):
    """M26: the head came from the GSTIN and state typed on the form, but the
    bill is booked on the supplier the server resolves. A supplier on file
    from Maharashtra, matched by name while the form carried another GSTIN,
    got CGST+SGST, and is_igst_applicable (read from the saved supplier) then
    disagreed with the heads stored.

    Review: when the bill's GSTIN and the record's are both real and differ,
    M26 booked the bill on the record, under the record's head. A trade name
    can hold a registration in each state, so that record is another supplier,
    and the credit followed the wrong GSTIN. Such a bill is refused until the
    GSTIN or the name is corrected."""

    def setUp(self):
        super().setUp()
        # The base business is 22 (Chhattisgarh).
        self.mh = Customer.objects.create(name="MH BULLION", gst_number="27AABCR1718E1ZP", state_name="")
        self.mh.businesses.add(self.business)

    def _post(self, number, **over):
        data = {"business_id": self.business.id, "supplier_name": "MH BULLION",
                "supplier_gstin": "22DDDDD0000D1Z5", "invoice_number": number, "invoice_date": "2026-05-05",
                "lines": json.dumps([{"product_name": "Gold bar", "hsn_code": "710813", "quantity": "1",
                                      "rate": "100000", "gst_tax_rate": "0.03", "unit": "gms"}])}
        data.update(over)
        return self.client.post(reverse("inward-bill-list"), data)

    def test_a_bill_from_another_gstin_than_the_named_supplier_is_refused(self):
        resp = self._post("MH-1")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data["error"], "supplier_gstin_conflict")
        self.assertIn("27AABCR1718E1ZP", resp.data["detail"])
        self.assertIn("22DDDDD0000D1Z5", resp.data["detail"])
        self.assertFalse(Invoice.objects.filter(invoice_number="MH-1").exists())
        self.mh.refresh_from_db()
        self.assertEqual(self.mh.gst_number, "27AABCR1718E1ZP")

    def test_the_head_follows_the_supplier_the_bill_is_booked_on(self):
        resp = self._post("MH-1", supplier_gstin="27AABCR1718E1ZP")
        self.assertEqual(resp.status_code, 201, resp.data)
        inv = Invoice.objects.get(invoice_number="MH-1")
        self.assertEqual(inv.customer_id, self.mh.id)
        li = inv.lineitem_set.get()
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("0"), D("0"), D("3000")))
        self.assertTrue(inv.is_igst_applicable)
