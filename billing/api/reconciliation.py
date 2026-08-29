"""Sales reconciliation endpoint — thin ORM adapter over billing.reconciliation."""

import re

from rest_framework.response import Response
from rest_framework.views import APIView

from billing.models import Invoice
from billing.reconciliation import QUARTER_LABELS, fy_bounds, reconcile

from .permissions import RoleBasedPermission

_FY_RE = re.compile(r"^(20\d{2})-(\d{2})$")


class ReconciliationView(APIView):
    permission_classes = [RoleBasedPermission]

    def get(self, request):
        fy = (request.query_params.get("fy") or "").strip()
        m = _FY_RE.match(fy)
        if not m or (int(m.group(1)) + 1) % 100 != int(m.group(2)):
            return Response({"error": "fy must look like 2025-26."}, status=400)
        start, end = fy_bounds(fy)

        qs = Invoice.objects.filter(
            type_of_invoice="outward", invoice_date__gte=start, invoice_date__lte=end,
        )
        business_id = request.query_params.get("business_id")
        if business_id:
            qs = qs.filter(business_id=business_id)
        qs = qs.select_related("customer").prefetch_related("lineitem_set")

        rows = [
            {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "invoice_date": inv.invoice_date,
                "customer_gstin": (inv.customer.gst_number or "") if inv.customer_id else "",
                "payment_mode": inv.payment_mode or "",
                "total_amount": inv.total_amount or 0,
                "lines": [
                    {
                        "taxable": (li.quantity or 0) * (li.rate or 0),
                        "cgst": li.cgst or 0,
                        "sgst": li.sgst or 0,
                        "igst": li.igst or 0,
                        "rate": li.gst_tax_rate or 0,
                    }
                    for li in inv.lineitem_set.all()
                ],
            }
            for inv in qs
        ]

        result = reconcile(fy, rows)

        def cell(c):
            d = c.as_dict()
            return {k: str(v) for k, v in d.items()}

        quarters = [
            {
                "label": f"{QUARTER_LABELS[q]} {str(start.year)[2:] if q < 4 else str(end.year)[2:]}",
                "gstr3b": cell(result.rollup["gstr3b"][q]),
                "b2b": cell(result.rollup["b2b"][q]),
                "b2c": cell(result.rollup["b2c"][q]),
                "invoice_count": result.invoice_counts[q]["in"],
            }
            for q in (1, 2, 3, 4)
        ]

        return Response({
            "fy": fy,
            "quarters": quarters,
            "total": {
                "gstr3b": cell(result.rollup["gstr3b"]["FY"]),
                "b2b": cell(result.rollup["b2b"]["FY"]),
                "b2c": cell(result.rollup["b2c"]["FY"]),
                "invoice_count": result.invoice_counts["FY"]["in"],
            },
            "payment_split": [
                {
                    "mode": b.mode,
                    "gross": str(b.gross),
                    "taxable": str(b.taxable),
                    "cgst": str(b.cgst),
                    "sgst": str(b.sgst),
                    "igst": str(b.igst),
                    "invoice_count": b.invoice_count,
                    "share_pct": str(b.share_pct),
                }
                for b in result.modes
            ],
            "checks": [
                {
                    "id": c.id,
                    "label": c.label,
                    "period": c.period,
                    "expected": str(c.expected),
                    "actual": str(c.actual),
                    "difference": str(c.difference),
                    "status": c.status,
                }
                for c in result.checks
            ],
        })
