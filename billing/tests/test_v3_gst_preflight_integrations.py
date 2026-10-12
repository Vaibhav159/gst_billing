"""X-40 gates: run these assertions once their owning plans have landed."""

import importlib.util
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from billing.models import LineItem
from billing.tests.v3_helpers import buyer, firm, line, sale


@pytest.mark.django_db
@pytest.mark.skipif(importlib.util.find_spec("billing.services.suppliers") is None,
                    reason="P3-1 / X-40: requires 2A's supplier service and purchase fields.")
def test_supplier_figures_match_the_shared_per_line_tax_totals():
    from billing.services.bill_reads import sums
    from billing.services.suppliers import supplier_figures

    business, supplier = firm(), buyer()
    purchase = sale(business, supplier, "PF-1", date(2026, 9, 1), line(), line(), kind="inward")
    LineItem.objects.filter(invoice=purchase).update(cgst=Decimal("0.025"), sgst=Decimal("0.025"), igst=0)
    figures = supplier_figures([supplier.pk], business.pk, 2026)[supplier.pk]
    projected = sums(LineItem.objects.filter(invoice=purchase))
    assert projected["cgst"] == projected["sgst"] == Decimal("0.06")
    assert figures["tax"] == figures["credit"] == "0.12"


@pytest.mark.skipif(not (Path(__file__).parents[2] / "web/src/core/gst/setoff.ts").exists(),
                    reason="P3-5 / X-40: run after 3C Task 2 appends its 23 canonical vectors.")
def test_shared_vector_file_retains_all_31_server_and_client_cases():
    from billing.tests.test_v3_setoff import VECTORS

    assert isinstance(VECTORS, list)
    assert len(VECTORS) == 31
    assert len({case["name"] for case in VECTORS}) == 31
    # test_v3_setoff parametrizes this same complete list, so every case executes
    # the server's Decimal implementation when the integrated suite runs.
