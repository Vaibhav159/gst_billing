"""Dashboard, due-next and rate-board endpoints (part 5)."""
import re
from datetime import date

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from billing import rates
from billing.api.permissions import V3Permission
from billing.models import AuditLog, RateBoard
from billing.text import inr


class RatesView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "rates.edit"}

    def get(self, request):
        day = None
        if "date" in request.query_params:
            raw = request.query_params["date"]
            try:
                if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
                    raise ValueError
                day = date.fromisoformat(raw)
            except ValueError:
                raise ValidationError({"date": ["Give the date like 2026-09-30."]}) from None
        today, board = timezone.localdate(), rates.latest()
        out = {"today": today.isoformat(), "rows": rates.RATE_ROWS, "latest": rates.board_row(board),
               "set_today": bool(board and board.on == today), "previous": rates.board_row(rates.previous(board))}
        if day is not None:
            out["in_force"] = rates.board_row(rates.in_force(day))
        return Response(out)

    def post(self, request):
        quoted = rates.read_quotes(request.data)
        with transaction.atomic():
            board = RateBoard.objects.create(on=timezone.localdate(), quoted=quoted, set_by=request.user)
            AuditLog.objects.create(action="set", entity="rates", entity_id=board.pk, entity_name="Today's rates",
                user=request.user, details=f"Gold 22K {inr(quoted['gold-22K'])} per 10 g · "
                                           f"Silver 999 {inr(quoted['silver-999'])} per kg")
        return Response(rates.board_row(board), status=201)


def scope(request):
    from billing.params import PICK_A_FIRM, id_param
    from billing.services.dashboard import firms_in_scope
    raw = request.query_params.get("business_id")
    business_id = id_param(request.query_params, "business_id", PICK_A_FIRM)
    if raw == "":
        raise ValidationError({"business_id": [PICK_A_FIRM]})
    firms = firms_in_scope(business_id)
    if business_id is not None and not firms:
        raise ValidationError({"business_id": [PICK_A_FIRM]})
    return firms, business_id


class DashboardView(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        from billing.fy import fy_of, parse_fy
        from billing.services.dashboard import dashboard
        today = timezone.localdate()
        year = parse_fy(request.query_params["fy"]) if "fy" in request.query_params else fy_of(today)
        if year is None:
            raise ValidationError({"fy": ["Give the year like 2026-27."]})
        firms, _business = scope(request)
        return Response(dashboard(request.user, firms, year, today))


class DueNextView(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        from billing.services.due import due_next
        chosen = request.query_params.get("returns", "0")
        if chosen not in ("0", "1"):
            raise ValidationError({"returns": ["Choose 0 or 1 for returns."]})
        firms, business_id = scope(request)
        return Response(due_next(request.user, firms, business_id, timezone.localdate(), chosen == "1"))
