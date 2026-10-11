"""The v3 firms endpoints (part 4 contract section 2)."""
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.cache import uncached
from billing.models import Business
from billing.params import fy_param
from billing.services.firms import DETAIL_FIELDS, SLIM_FIELDS, firm_detail, firm_figures, firm_numbers, firm_row

from .permissions import V3Permission


def found_firm(pk, lock=False):
    rows = uncached(Business)
    if lock:
        rows = rows.select_for_update(no_key=True)
    found = rows.only(*DETAIL_FIELDS).filter(pk=pk).first()
    if found is None:
        raise NotFound("This firm isn't on file.")
    return found


class FirmsView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "firm.edit"}

    def post(self, request):
        from billing.services.firms import save_firm
        business, _, _ = save_firm(request.data, request.user)
        return Response(firm_detail(business), status=201)

    def get(self, request):
        fy = fy_param(request.query_params)
        firms = list(uncached(Business).only(*SLIM_FIELDS).order_by("name", "pk"))
        figures = firm_figures([b.pk for b in firms], fy) if request.query_params.get("figures") == "1" else None
        results = []
        for business in firms:
            row = firm_row(business)
            if figures is not None:
                row["figures"] = figures[business.pk]
            if request.query_params.get("numbers") == "1":
                row["numbers"] = firm_numbers(business)
            results.append(row)
        return Response({"results": results})


class FirmDetailView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"PUT": "firm.edit", "DELETE": "firm.edit"}

    def put(self, request, pk):
        from billing.services.audit import change_rows
        from billing.services.firms import save_firm
        business, changes, frozen = save_firm(request.data, request.user, found_firm(pk))
        return Response({**firm_detail(business), "changes": change_rows(Business, changes), "frozen_bills": frozen})

    def delete(self, request, pk):
        from billing.services.firms import delete_firm
        entry = delete_firm(found_firm(pk), request.user)
        return Response({"audit_id": entry.pk})

    def get(self, request, pk):
        return Response(firm_detail(found_firm(pk), fy_param(request.query_params)))


class FirmSignatureView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"PUT": "firm.edit", "DELETE": "firm.edit"}
