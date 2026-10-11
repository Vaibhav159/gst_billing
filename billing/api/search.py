"""Quick search — the two-second answer to "what did we bill him last?".

One round trip: customers matching the query each carry their most recent
invoices inline, alongside direct invoice-number and product hits. Backed
by the full database, not whatever page the client happened to have loaded.
"""

from django.db.models import Case, IntegerField, Q, Value, When
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.cache import uncached
from billing.credit import credit_month_of
from billing.models import Customer, Invoice, Product
from billing.params import text_param
from billing.services.purchase_reads import supplier_ref
from billing.services.suppliers import suppliers

from .permissions import RoleBasedPermission

# Recent and direct bill rows read only the columns they show.
RECENT_FIELDS = ("invoice_number", "invoice_date", "total_amount", "type_of_invoice", "business", "status",
                 "itc_month", "needs_review")
BILL_FIELDS = (*RECENT_FIELDS, "paper", "customer__name")


def purchase_bits(invoice):
    if invoice.type_of_invoice != "inward":
        return {}
    month = credit_month_of(invoice)
    return {"credit_month": month.strftime("%Y-%m") if month else None, "needs_review": invoice.needs_review}


def number_part(digits):
    """The bills whose number part is `digits` as a number, a database filter: the trailing digits numbering.counter_of
    reads, so "31" (or "031") finds KGH/2026-27/31, MO-031 and 31, and never 131 or 310."""
    return Q(invoice_number__regex=rf"(^|[^0-9])0*{digits.lstrip('0') or '0'}[ \t\n\r\f\v]*$")


class QuickSearchView(APIView):
    permission_classes = [RoleBasedPermission]

    def get(self, request):
        q = text_param(request.query_params, "q")  # psycopg refuses a null character in a query
        # v3's search (Ctrl K) reads this too, so it reads around cacheops (Ruling 1A-34): a bill cancelled or
        # renumbered a moment ago shows as it is.
        if len(q) < 2:
            return Response({"customers": [], "invoices": [], "products": []})

        customers = list(
            uncached(Customer).filter(
                Q(name__icontains=q) | Q(gst_number__icontains=q) | Q(mobile_number__icontains=q)
            ).only("name", "gst_number", "state_name", "mobile_number").order_by("name")[:5]
        )
        cust_payload = []
        for c in customers:
            recent = uncached(Invoice).filter(customer=c).only(*RECENT_FIELDS).order_by(
                "-invoice_date", "-id"
            )[:3]
            cust_payload.append({
                "id": c.id,
                "name": c.name,
                "gst_number": c.gst_number or "",
                "state_name": c.state_name or "",
                "mobile_number": c.mobile_number or "",
                "recent_invoices": [
                    {
                        "id": i.id,
                        "invoice_number": i.invoice_number,
                        "invoice_date": str(i.invoice_date) if i.invoice_date else "",
                        "total_amount": str(i.total_amount),
                        "type_of_invoice": i.type_of_invoice,
                        "business_id": i.business_id,
                        "status": i.status,
                        **purchase_bits(i),
                    }
                    for i in recent
                ],
            })

        # A bill whose number is exactly q comes first: "31" finds 31 before 131 (part 0 carry). Then, for plain
        # digits, the bills whose number part is q, any firm, newest first (Ruling 1A-40): eight newer numbers holding
        # 31 (/310 to /317) no longer push KGH/2026-27/31 out of the eight rows. One read, in the columns the rows show.
        number, first = Q(invoice_number__icontains=q), [When(invoice_number__iexact=q, then=Value(0))]
        if q.isascii() and q.isdigit():
            part = number_part(q)
            number |= part
            first.append(When(part, then=Value(1)))
        rank = Case(*first, default=Value(2), output_field=IntegerField())
        invoices = [
            {
                "id": i.id,
                "invoice_number": i.invoice_number,
                "invoice_date": str(i.invoice_date) if i.invoice_date else "",
                "total_amount": str(i.total_amount),
                "type_of_invoice": i.type_of_invoice,
                "customer_name": i.customer.name if i.customer_id else "",
                "business_id": i.business_id,
                "status": i.status,
                "paper": i.paper,
                **purchase_bits(i),
            }
            for i in uncached(Invoice).filter(number)
            .select_related("customer")
            .only(*BILL_FIELDS)
            .annotate(rank=rank)
            .order_by("rank", "-invoice_date", "-id")[:8]
        ]

        products = [
            # gst_tax_rate as stored, a fraction (0.03 is 3%), the way the invoices' totals go: a string
            {"id": p.id, "name": p.name, "hsn_code": p.hsn_code or "", "gst_tax_rate": str(p.gst_tax_rate)}
            for p in uncached(Product).filter(
                Q(name__icontains=q) | Q(hsn_code__icontains=q)
            ).only("name", "hsn_code", "gst_tax_rate").order_by("name")[:4]
        ]

        supplier_payload = [supplier_ref(party) for party in suppliers().filter(
            Q(name__icontains=q) | Q(gst_number__icontains=q) | Q(mobile_number__icontains=q)
        ).only("name", "gst_number", "state_name", "city").order_by("name")[:5]]
        return Response({"customers": cust_payload, "invoices": invoices, "products": products,
                         "suppliers": supplier_payload})
