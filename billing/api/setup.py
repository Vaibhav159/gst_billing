"""Read-only setup counts; visiting a checklist never creates data."""
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.cache import uncached
from billing.models import AuditLog, Business, Customer, Invoice, Product
from billing.roles import can
from billing.text import stamp

from .permissions import V3Permission


def names_and_count(rows):
    return {"count": rows.count(), "names": list(rows.order_by("id").values_list("name", flat=True)[:3])}


class SetupView(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        customers = uncached(Customer).exclude(customer_type="walkin").exclude(name__iexact="Walk-in Customer")
        bills = Invoice.objects.sales().aggregate(count=Count("id", filter=Q(status="active")), cancelled=Count("id", filter=Q(status="cancelled")))
        backup = AuditLog.objects.filter(entity="backup", action="exported", entity_name="Full backup").order_by("-timestamp").values_list("timestamp", flat=True).first()
        return Response({
            "firms": names_and_count(uncached(Business)), "customers": names_and_count(customers),
            "products": names_and_count(uncached(Product)), "bills": bills,
            "people": get_user_model().objects.filter(is_active=True).count() if can(request.user, "users.manage") else None,
            "last_backup_at": stamp(backup),
        })
