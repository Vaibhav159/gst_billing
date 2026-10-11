"""Part 4's registry answer: the shared lookup plus small on-file references."""
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.cache import uncached
from billing.gstin import lookup
from billing.models import Business, Customer
from billing.services.bill_reads import _customer_ref
from billing.services.firms import firm_ref


class RegistryView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "view"}
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "registry"

    def get(self, request, gstin):
        data = lookup(gstin)
        result = {"gstin": data["gstin"], "status": "invalid", "reason": data.get("reason", ""),
                  **dict.fromkeys(("state_code", "state_name", "pan", "registry", "lookup", "on_file"))}
        if not data["valid"]:
            return Response(result)
        found = data["source"] in ("provider", "cache")
        registry = None
        if found:
            registry = {key: data.get(key, "") for key in (
                "legal_name", "trade_name", "address", "city", "pin_code", "registered_on",
                "taxpayer_type", "constitution")}
            registry.update(active=data["active"], status_text=data.get("status", ""))
        customers = uncached(Customer).filter(gst_number__iexact=data["gstin"]).only(
            "name", "gst_number", "mobile_number", "customer_type").order_by("name", "pk")
        firms = uncached(Business).filter(gst_number__iexact=data["gstin"]).only("name", "short_name").order_by("name", "pk")
        result.update(status="found" if found else "unknown", registry=registry,
                      lookup=data["source"] if found else "unreachable",
                      **{key: data[key] for key in ("state_code", "state_name", "pan")},
                      on_file={"customers": [_customer_ref(customer) for customer in customers],
                               "firms": [firm_ref(firm) for firm in firms]})
        return Response(result)
