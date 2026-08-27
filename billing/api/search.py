"""Quick search — the two-second answer to "what did we bill him last?".

One round trip: customers matching the query each carry their most recent
invoices inline, alongside direct invoice-number and product hits. Backed
by the full database, not whatever page the client happened to have loaded.
"""

from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.models import Customer, Invoice, Product

from .permissions import RoleBasedPermission


class QuickSearchView(APIView):
    permission_classes = [RoleBasedPermission]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"customers": [], "invoices": [], "products": []})

        customers = list(
            Customer.objects.filter(
                Q(name__icontains=q) | Q(gst_number__icontains=q) | Q(mobile_number__icontains=q)
            ).order_by("name")[:5]
        )
        cust_payload = []
        for c in customers:
            recent = Invoice.objects.filter(customer=c).order_by(
                "-invoice_date", "-id"
            )[:3]
            cust_payload.append({
                "id": c.id,
                "name": c.name,
                "gst_number": c.gst_number or "",
                "state_name": c.state_name or "",
                "recent_invoices": [
                    {
                        "id": i.id,
                        "invoice_number": i.invoice_number,
                        "invoice_date": str(i.invoice_date) if i.invoice_date else "",
                        "total_amount": str(i.total_amount),
                        "type_of_invoice": i.type_of_invoice,
                        "business_id": i.business_id,
                    }
                    for i in recent
                ],
            })

        invoices = [
            {
                "id": i.id,
                "invoice_number": i.invoice_number,
                "invoice_date": str(i.invoice_date) if i.invoice_date else "",
                "total_amount": str(i.total_amount),
                "type_of_invoice": i.type_of_invoice,
                "customer_name": i.customer.name if i.customer_id else "",
            }
            for i in Invoice.objects.filter(invoice_number__icontains=q)
            .select_related("customer")
            .order_by("-invoice_date", "-id")[:8]
        ]

        products = [
            {"id": p.id, "name": p.name, "hsn_code": p.hsn_code or ""}
            for p in Product.objects.filter(
                Q(name__icontains=q) | Q(hsn_code__icontains=q)
            ).order_by("name")[:4]
        ]

        return Response({"customers": cust_payload, "invoices": invoices, "products": products})
