from datetime import date
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from billing.tests.v3_helpers import ROLE_GROUPS, client_for, firm, person

pytestmark = pytest.mark.django_db


@pytest.fixture
def user_client():
    return client_for(person("viewer", *ROLE_GROUPS["viewer"]))


def test_all_new_routes_require_sign_in():
    client = APIClient()
    for path in ("gst/credit/", "gst/reconciliation/", "reports/sales/", "reports/ca-workbook/"):
        assert client.get("/api/" + path).status_code == 401


@pytest.mark.parametrize("role", ROLE_GROUPS)
def test_every_role_can_read_credit_and_export_workbook(role):
    client = client_for(person(role, *ROLE_GROUPS[role]))
    business = firm()
    with patch("billing.api.reports_v3.credit_payload", return_value={"business": business.pk}) as credit:
        response = client.get("/api/gst/credit/", {"business_id": business.pk, "fy": "2026-27"})
    assert response.status_code == 200
    assert credit.call_args.args[0].pk == business.pk
    assert credit.call_args.args[1] == 2026
    with patch("billing.api.reports_v3.report_payload", return_value={"scope": "All firms"}) as export:
        response = client.get("/api/reports/ca-workbook/", {"from": "2026-09-01", "to": "2026-09-30"})
    assert response.status_code == 200
    assert export.call_args.args == ("ca-workbook", None, date(2026, 9, 1), date(2026, 9, 30))
    assert export.call_args.kwargs == {"split": False, "side": "sales"}


def test_unknown_kind_has_exact_404_without_loading_register(user_client):
    response = user_client.get("/api/reports/mystery/")
    assert response.status_code == 404
    assert response.json() == {"detail": 'There\'s no report called "mystery".'}


@pytest.mark.parametrize("kind", ["sales", "purchases", "tax", "hsn", "months", "customers", "products"])
def test_report_kind_reaches_the_service_with_parsed_params(user_client, kind):
    business = firm()
    with patch("billing.api.reports_v3.report_payload", return_value={"kind": kind}) as report:
        response = user_client.get(f"/api/reports/{kind}/", {
            "business_id": business.pk, "from": "2026-03-31", "to": "2026-04-01", "split": "1",
        })
    assert response.status_code == 200
    args = report.call_args.args
    assert (args[0], args[1].pk, args[2], args[3]) == (kind, business.pk, date(2026, 3, 31), date(2026, 4, 1))
    assert report.call_args.kwargs == {"split": True, "side": "sales"}


def test_reconciliation_uses_firm_and_fy(user_client):
    business = firm()
    with patch("billing.api.reports_v3.reconciliation_payload", return_value={"business": business.pk}) as report:
        response = user_client.get("/api/gst/reconciliation/", {"business_id": business.pk, "fy": "2025-26", "split": "1"})
    assert response.status_code == 200
    assert report.call_args.args[0].pk == business.pk
    assert report.call_args.args[1] == 2025
    assert report.call_args.kwargs == {"split": True}


def test_malformed_filters_fail_before_any_service(user_client):
    with patch("billing.api.reports_v3.credit_payload") as credit:
        response = user_client.get("/api/gst/credit/", {"business_id": "9" * 30})
    assert response.status_code == 400
    assert response.json() == {"business_id": ["Pick a firm from the list."]}
    credit.assert_not_called()
    response = user_client.get("/api/reports/sales/", {"from": "2026-09-01", "to": "2026-08-31"})
    assert response.status_code == 400
    assert response.json() == {"to": ["The range ends before it starts (01 Sep 2026). Pick a later end date."]}


def test_hsn_side_and_writes_are_refused(user_client):
    response = user_client.get("/api/reports/hsn/", {"from": "2026-09-01", "to": "2026-09-30", "side": "mixed"})
    assert response.status_code == 400
    assert response.json() == {"side": ["Choose sales or purchases."]}
    response = user_client.post("/api/reports/sales/", {}, format="json")
    assert response.status_code == 403


def test_legacy_report_route_keeps_its_owner():
    from django.urls import resolve

    from billing.api.views import ReportView
    assert resolve("/api/reports/generate/").func.view_class is ReportView

