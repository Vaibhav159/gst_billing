"""Part 3B's reads; v2 reports/generate and reconciliation stay untouched."""

from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.api.report_params import report_firm, report_fy, report_range, report_side, report_split

KINDS = frozenset(("sales", "purchases", "tax", "hsn", "months", "customers", "products", "ca-workbook"))


def credit_payload(business, fy):
    from billing.services.report_context import credit_payload as read
    return read(business, fy)


def reconciliation_payload(business, fy, *, split):
    from billing.services.report_context import reconciliation_payload as read
    return read(business, fy, split=split)


def report_payload(kind, business, start, end, *, split, side):
    from billing.services.report_context import report_payload as read
    return read(kind, business, start, end, split=split, side=side)


class CreditView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "view"}

    def get(self, request):
        business = report_firm(request.query_params, required=True)
        return Response(credit_payload(business, report_fy(request.query_params)))


class ReconciliationView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "view"}

    def get(self, request):
        params = request.query_params
        business = report_firm(params, required=True)
        return Response(reconciliation_payload(business, report_fy(params), split=report_split(params)))


class ReportView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "view"}

    def get(self, request, kind):
        if kind not in KINDS:
            raise NotFound(f'There\'s no report called "{kind}".')
        params = request.query_params
        business = report_firm(params)
        start, end = report_range(params)
        return Response(report_payload(kind, business, start, end, split=report_split(params), side=report_side(params)))


class CAWorkbookView(ReportView):
    v3_actions = {"GET": "reports.export"}

    def get(self, request):
        return super().get(request, "ca-workbook")
