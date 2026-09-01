"""Interstate tax heads on the four import paths (audit A3).

`Invoice.is_igst_applicable` compared GSTIN prefixes and returned falsy when
the customer had no GSTIN, so an unregistered interstate buyer was billed
CGST+SGST. The invoice form and inward bills were moved onto
`tax_rules.is_interstate`; the four import paths still read the property, so
every import re-planted the bug that fix_tax_heads had just repaired.
"""

from decimal import Decimal

from django.test import TestCase

from billing.models import Business, Customer, Invoice
from billing.tax_rules import is_interstate, state_name_from_gstin


class IsIgstApplicableTests(TestCase):
    """The property the import paths all read."""

    def setUp(self):
        # 08 = Rajasthan
        self.business = Business.objects.create(
            name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )

    _seq = 0

    def _invoice(self, customer):
        # Outward numbers are unique per business per FY — give each its own.
        type(self)._seq += 1
        return Invoice.objects.create(
            business=self.business,
            customer=customer,
            invoice_number=str(type(self)._seq),
            invoice_date="2026-04-10",
            type_of_invoice="outward",
        )

    def test_unregistered_interstate_buyer_is_interstate(self):
        """The regression: no GSTIN used to mean 'local' whatever the state."""
        customer = Customer.objects.create(name="MUMBAI B2C", state_name="MAHARASHTRA")
        self.assertTrue(self._invoice(customer).is_igst_applicable)

    def test_unregistered_local_buyer_is_not_interstate(self):
        customer = Customer.objects.create(name="LOCAL B2C", state_name="RAJASTHAN")
        self.assertFalse(self._invoice(customer).is_igst_applicable)

    def test_registered_interstate_buyer_still_works(self):
        customer = Customer.objects.create(
            name="MUMBAI LTD", gst_number="27AAAAA0000A1Z5", state_name="MAHARASHTRA"
        )
        self.assertTrue(self._invoice(customer).is_igst_applicable)

    def test_registered_local_buyer_still_works(self):
        customer = Customer.objects.create(
            name="JAIPUR LTD", gst_number="08BBBBB1111B1Z5", state_name="RAJASTHAN"
        )
        self.assertFalse(self._invoice(customer).is_igst_applicable)

    def test_unknown_state_defaults_to_intra(self):
        """Safest default for a local shop — matches is_interstate's contract."""
        customer = Customer.objects.create(name="NO INFO")
        self.assertFalse(self._invoice(customer).is_igst_applicable)

    def test_property_agrees_with_the_shared_rule(self):
        cases = [
            ("", "MAHARASHTRA"), ("", "RAJASTHAN"), ("27AAAAA0000A1Z5", "MAHARASHTRA"),
            ("08BBBBB1111B1Z5", "RAJASTHAN"), ("", ""),
        ]
        for n, (gstin, state) in enumerate(cases):
            with self.subTest(gstin=gstin, state=state):
                # Customer.name is unique — give each case its own.
                c = Customer.objects.create(
                    name=f"CASE {n}", gst_number=gstin, state_name=state
                )
                self.assertEqual(
                    bool(self._invoice(c).is_igst_applicable),
                    is_interstate(self.business, c),
                )


class StateNameFromGstinTests(TestCase):
    """Auto-created customers were all stamped RAJASTHAN (audit A3, compounding)."""

    def test_derives_the_state_from_the_gstin(self):
        self.assertEqual(state_name_from_gstin("27AAAAA0000A1Z5"), "MAHARASHTRA")
        self.assertEqual(state_name_from_gstin("08BBBBB1111B1Z5"), "RAJASTHAN")

    def test_blank_when_there_is_no_gstin(self):
        """Blank is honest; a wrong state silently makes an interstate sale local."""
        for value in ("", None, "  ", "XX", "ABCDE"):
            self.assertEqual(state_name_from_gstin(value), "", repr(value))

    def test_unknown_code_is_blank(self):
        # 99 is real (Centre Jurisdiction); 00 is not assigned.
        self.assertEqual(state_name_from_gstin("00ZZZZZ9999Z9Z9"), "")

    def test_a_mumbai_buyer_imported_by_gstin_bills_igst(self):
        """End to end: the state the import writes must drive the tax head."""
        business = Business.objects.create(
            name="LODHA", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN"
        )
        customer = Customer.objects.create(
            name="MUMBAI TRADERS",
            gst_number="27AAAAA0000A1Z5",
            state_name=state_name_from_gstin("27AAAAA0000A1Z5") or None,
        )
        invoice = Invoice.objects.create(
            business=business, customer=customer, invoice_number="2",
            invoice_date="2026-04-10", type_of_invoice="outward",
        )
        self.assertEqual(customer.state_name, "MAHARASHTRA")
        self.assertTrue(invoice.is_igst_applicable)


class BulkImportRefilesSuppliedHeadsTests(TestCase):
    """Heads supplied by the spreadsheet were written verbatim (audit A3)."""

    def test_normalize_tax_heads_refiles_a_local_split_on_an_interstate_row(self):
        from billing.tax_rules import normalize_tax_heads

        cgst, sgst, igst = normalize_tax_heads(
            Decimal("150"), Decimal("150"), Decimal("0"), True
        )
        self.assertEqual((cgst, sgst), (Decimal("0"), Decimal("0")))
        self.assertEqual(igst, Decimal("300"))

    def test_refiling_preserves_the_total(self):
        from billing.tax_rules import normalize_tax_heads

        for heads in [("150", "150", "0"), ("0", "0", "300"), ("100", "200", "0")]:
            c, s, i = (Decimal(x) for x in heads)
            for interstate in (True, False):
                out = normalize_tax_heads(c, s, i, interstate)
                self.assertEqual(sum(out), c + s + i, f"{heads} interstate={interstate}")
