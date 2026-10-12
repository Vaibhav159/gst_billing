from datetime import date
from unittest.mock import patch

import pytest

from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale


@pytest.mark.django_db
def test_dashboard_separates_headers_lines_and_zeros_past_year():
    f, c = firm(), buyer(address="street")
    sale(f, c, "1", date(2026, 10, 8), line(rate="100", gst="0"), line(rate="200", gst="0"), payment_mode="cash")
    sale(f, c, "2", date(2026, 10, 8), line(rate="30", gst="0"), kind="inward")
    sale(f, c, "3", date(2026, 10, 8), status="cancelled")
    sale(f, c, "4", date(2026, 3, 31), line(rate="50", gst="0"))
    client = client_for(person("dash-viewer", "viewer"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        r = client.get("/api/dashboard/", {"business_id": f.pk})
        assert r.status_code == 200
        data = r.json()
        assert data["today"]["total"] == "300.00"
        assert data["today"]["count"] == 1
        assert data["today"]["by_payment"] == [{"mode": "cash", "total": "300.00"}]
        assert data["month"]["sales"] == {"count": 1, "total": "300.00", "taxable": "300.00", "tax": "0.00"}
        assert data["month"]["purchases"]["total"] == "30.00"
        assert len(data["year"]["months"]) == 7
        assert data["year"]["months"][0]["sales"]["total"] == "0.00"
        assert data["last30"]["from"] == "2026-09-09"
        assert data["changes"] is None
        with patch("billing.services.dashboard.past_returns", return_value=[]):
            past = client.get("/api/dashboard/?fy=2025-26").json()
        assert past["today"] == data["today"]
        assert past["month"]["kind"] == "last_of_fy"
        assert past["month"]["to"] == "2026-03-31"
        assert past["year"]["sales"]["total"] == "50.00"
        assert len(past["year"]["months"]) == 12
        assert past["last30"] is None


@pytest.mark.django_db
def test_today_cap_recent_and_bad_scope():
    from billing.models import Invoice
    f, c = firm(), buyer()
    Invoice.objects.bulk_create([Invoice(business=f, customer=c, invoice_number=str(i), invoice_date=date(2026, 10, 8),
                                        type_of_invoice="outward", total_amount="1") for i in range(105)])
    client = client_for(person("dash-limit", "viewer"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        d = client.get("/api/dashboard/").json()
        assert (d["today"]["count"], len(d["today"]["bills"]), d["today"]["more"]) == (105, 100, 5)
        for value in ("", "x", "²", "9" * 100, "9999999"):
            r = client.get("/api/dashboard/", {"business_id": value})
            assert r.status_code == 400
            assert r.json() == {"business_id": ["Pick a firm from the list."]}
        for value in ("", "x", "2026-28"):
            assert client.get("/api/dashboard/", {"fy": value}).json() == {"fy": ["Give the year like 2026-27."]}
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 9)):
        d = client.get("/api/dashboard/").json()
        assert d["today"]["count"] == 0
        assert len(d["today"]["recent"]) == 5


@pytest.mark.django_db
def test_taxable_rounds_each_legacy_half_paisa_line():
    from billing.models import LineItem
    f, c = firm(), buyer()
    bill = sale(f, c, "1", date(2026, 10, 8), line(rate="1", gst="0"), line(rate="1", gst="0"))
    LineItem.objects.filter(invoice=bill).update(quantity="1", rate="0.025")
    client = client_for(person("dash-paise", "viewer"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        d = client.get("/api/dashboard/").json()
        assert d["month"]["sales"]["taxable"] == d["today"]["bills"][0]["taxable"] == "0.06"


@pytest.mark.django_db
def test_year_rounds_stored_totals_once_across_months():
    from billing.models import Invoice
    f, c = firm(), buyer(address="Street")
    a = sale(f, c, "A1", date(2026, 4, 1))
    b = sale(f, c, "B1", date(2026, 5, 1))
    Invoice.objects.filter(pk__in=[a.pk, b.pk]).update(total_amount="1.005")
    client = client_for(person("year-paise", "viewer"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        data = client.get("/api/dashboard/").json()
    assert data["year"]["sales"]["total"] == "2.01"


@pytest.mark.django_db
def test_dashboard_gst_rounds_each_head_per_line_to_the_paisa():
    """P5-6 / X-55: two stored 0.025 heads are 0.03 + 0.03, not 0.05."""
    from billing.models import LineItem
    f, c = firm(), buyer(address="street")
    bill = sale(f, c, "1", date(2026, 10, 8), line(rate="1", gst="0.05"), line(rate="1", gst="0.05"))
    LineItem.objects.filter(invoice=bill).update(cgst="0.025", sgst="0", igst="0")
    client = client_for(person("dash-paisa-viewer", "viewer"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        data = client.get("/api/dashboard/", {"business_id": f.pk}).json()
    assert data["month"]["sales"]["tax"] == "0.06"
    assert data["last30"]["sales"]["tax"] == "0.06"
    assert data["year"]["months"][-1]["sales"]["tax"] == "0.06"


@pytest.mark.django_db
def test_dashboard_gst_matches_figures_of_sums():
    from billing.models import LineItem
    from billing.services.bill_reads import figures, sums
    f, c = firm(), buyer(address="street")
    bill = sale(f, c, "1", date(2026, 10, 8), line(rate="1", gst="0.05"), line(rate="1", gst="0.05"))
    LineItem.objects.filter(invoice=bill).update(cgst="0.025", sgst="0", igst="0")
    client = client_for(person("dash-sums-viewer", "viewer"))
    with patch("billing.api.dashboard.timezone.localdate", return_value=date(2026, 10, 8)):
        data = client.get("/api/dashboard/", {"business_id": f.pk}).json()
    assert data["month"]["sales"]["tax"] == figures(sums(LineItem.objects.filter(invoice=bill)))["tax"]
