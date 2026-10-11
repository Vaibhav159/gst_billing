"""v3 GST endpoints; permissions and input shape stay at the HTTP boundary."""

import json
from datetime import date, timedelta

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.utils.encoders import JSONEncoder
from rest_framework.views import APIView

from billing.cache import uncached
from billing.fy import due_dates, fy_of
from billing.models import AuditLog, FilingRecord, OpeningCredit
from billing.numbering import lock_firms
from billing.params import fy_param
from billing.refusals import Refusal
from billing.services.gst_reads import month_end_read, month_read, wire, year_read
from billing.text import day_text, inr, money, person, stamp

from .gst_input import firm_input, month_input, opening_heads
from .permissions import V3Permission


def over(month):
    if month >= timezone.localdate().replace(day=1):
        first = due_dates(month.year, month.month)["gstr1"].replace(day=1)
        raise Refusal(f"{month:%B %Y} is still running. Its returns can be filed from {day_text(first)}.", "month_running",
                      file_from=first.isoformat())


def body_of(request):
    return request.data if isinstance(request.data, dict) else {}


class GstYear(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        business = firm_input(request.query_params)
        return Response(year_read(business, fy_param(request.query_params) or fy_of()))


class GstMonth(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        business = firm_input(request.query_params)
        return Response(month_read(business, month_input(request.query_params)))


class GstMonthEnd(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        params = request.query_params
        month = month_input(params) if params.get("month") else (timezone.localdate().replace(day=1) - timedelta(days=1)).replace(day=1)
        over(month)
        return Response(month_end_read(month))


class GstSections(APIView):
    permission_classes = [V3Permission]

    def get(self, request, kind):
        business, month = firm_input(request.query_params), month_input(request.query_params)
        if kind == "gstr1":
            from billing.services.gst_downloads import filed_snapshot
            from billing.services.gstr1_file import build_gstr1
            result = filed_snapshot(business, month, sections=True) if request.query_params.get("as_filed") == "1" else build_gstr1(business, month.year, month.month)["sections"]
        else:
            from billing.services.ledger import gstr3b_tables
            result = gstr3b_tables(business, month.year, month.month)
        return Response(wire(result))


class GstFile(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "gst.download"}

    def get(self, request, kind):
        from billing.services.gst_downloads import file_name, filed_snapshot, record_download, via_input
        business, month = firm_input(request.query_params), month_input(request.query_params)
        over(month)
        via = via_input(request.query_params)
        as_filed = kind == "gstr1" and request.query_params.get("as_filed") == "1"
        if as_filed:
            contents = filed_snapshot(business, month)
        else:
            if not business.gst_number:
                raise ValidationError({"detail": f"{business.name} has no GSTIN. Add it on the firm first."})
            from billing.services.gst_checks import month_checks
            from billing.services.gstr1_file import build_amendments, build_gstr1
            if kind == "gstr1":
                from billing.services.filing import pending_amendments
                from billing.services.gstr1_file import attach_amendments
                month_builds = {}
                own = build_gstr1(business, month.year, month.month, amendments=False, month_builds=month_builds)
                checks = month_checks(business, month.year, month.month, built=own)["blockers"]
                if checks:
                    n = len(checks)
                    raise Refusal(f"{n} check{'s fail' if n != 1 else ' fails'} for {month:%B %Y}, so the portal file isn't made. Fix {'them' if n != 1 else 'it'} first.", "checks_failing", checks=checks)
                changes = pending_amendments(business, month.year, month.month, month_builds=month_builds)
                contents = attach_amendments(own, business, month.year, month.month, changes,
                                            month_builds=month_builds, strict=True)["file"]
            elif kind == "gstr1a":
                from billing.period_lock import month_status
                from billing.services.filing import changes_for_month
                state = month_status(business.pk, month.year, month.month)
                if state.gstr3b or state.legacy:
                    raise Refusal(f"{month:%B %Y}'s GSTR-3B is marked filed, so corrections go in the next GSTR-1, not GSTR-1A.", "gstr3b_filed")
                month_builds = {}
                changes = changes_for_month(business, month.year, month.month, month_builds=month_builds) if state.gstr1 else []
                if not changes:
                    raise Refusal(f"Nothing has changed since {month:%B %Y}'s GSTR-1, so there's no GSTR-1A to record.", "no_corrections")
                contents = build_amendments(business, month.year, month.month, changes,
                                             before_gstr3b=True, month_builds=month_builds)
            elif kind == "amendments":
                from billing.services.filing import amendment_plan, changes_for_month, changes_since_filing
                month_builds = {}
                changes = changes_for_month(business, month.year, month.month, month_builds=month_builds)
                summary = changes_since_filing(business, month.year, month.month, changes=changes)
                plan = amendment_plan(business, month.year, month.month, changes=summary)
                if not plan or not plan["rows"]:
                    raise Refusal(f"Nothing has changed since {month:%B %Y}'s GSTR-1, so there's no GSTR-1A to record.", "no_corrections")
                corrected = month
                month = date.fromisoformat(plan["carried_by"] + "-01")
                contents = build_amendments(business, month.year, month.month,
                    [{**row, "month": corrected.strftime("%Y-%m")} for row in changes],
                    before_gstr3b=plan["before_gstr3b"], month_builds=month_builds)
                kind = "gstr1a" if plan["before_gstr3b"] else "amend"
            else:
                from billing.services.ledger import build_gstr3b_json
                contents = build_gstr3b_json(business, month.year, month.month)
        record_download(business, month, "gstr1_filed" if as_filed else kind, request.user, via, contents)
        response = HttpResponse(json.dumps(contents, cls=JSONEncoder, ensure_ascii=False), content_type="application/json")
        response["Content-Disposition"] = f'attachment; filename="{file_name(business, month, kind)}"'
        if kind == "gstr3b":
            from billing.services.gst_amounts import INTEREST_NOTE
            response["X-GST-Interest-Note"] = INTEREST_NOTE
        return response


class GstBundle(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "gst.download"}

    def post(self, request):
        from billing.services.gst_downloads import record_download, via_input
        data = body_of(request)
        business, month = firm_input(data, "business"), month_input(data)
        over(month)
        via = via_input(data)
        parts = data.get("parts")
        if not isinstance(parts, list) or not parts or any(item not in ("gstr1", "gstr3b", "excel") for item in parts):
            raise ValidationError({"parts": ["Choose the files in the CA bundle."]})
        record_download(business, month, "bundle", request.user, via, {"parts": sorted(set(parts))})
        return Response(status=204)


class GstFilings(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "gst.file"}

    def post(self, request):
        from billing.services.filing import filing_data, mark_filed
        data = body_of(request)
        business, month = firm_input(data, "business"), month_input(data)
        records = mark_filed(business, month, request.user, data)
        return Response({"filings": [filing_data(row) for row in records], "month": month_read(business, month)}, status=201)


class GstFiling(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"PATCH": "gst.file", "DELETE": "gst.unlock"}

    def record(self, pk):
        row = uncached(FilingRecord).filter(pk=pk).select_related("business").only(
            "id", "business_id", "year", "month", "business__id", "business__name",
            "business__gst_number", "business__state_name", "business__invoice_prefix").first()
        if row is None:
            raise NotFound("That filing record isn't on file.")
        return row

    def patch(self, request, pk):
        from billing.services.filing import edit_filing, filing_data
        return Response(filing_data(edit_filing(self.record(pk), request.user, body_of(request))))

    def delete(self, request, pk):
        from billing.services.filing import remove_filing
        row = self.record(pk)
        business, month = row.business, date(row.year, row.month, 1)
        remove_filing(row, request.user, body_of(request).get("reason"))
        return Response({"month": month_read(business, month)})


class GstMonthAction(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": lambda request, view, obj: {"unlock": "gst.unlock", "relock": "gst.lock", "filed-before": "settings.edit"}[view.kwargs["operation"]]}

    def post(self, request, operation):
        from billing.services.filing import filed_before, relock_month, unlock_month
        data = body_of(request)
        business = firm_input(data, "business")
        month = month_input(data, "up_to" if operation == "filed-before" else "month")
        if operation == "filed-before":
            return Response(filed_before(business, month, request.user))
        if operation == "unlock":
            unlock_month(business, month, request.user, data.get("reason"))
        else:
            relock_month(business, month, request.user)
        return Response(month_read(business, month))


def opening_data(business):
    from billing.services.ledger import month_position
    row = uncached(OpeningCredit).filter(business_id=business.pk).select_related("updated_by").only(
        "business_id", "as_of", "igst", "cgst", "sgst", "updated_at", "updated_by_id",
        "updated_by__id", "updated_by__username", "updated_by__first_name", "updated_by__last_name").first()
    values = {key: getattr(row, key, 0) for key in ("igst", "cgst", "sgst")}
    values["total"] = sum(values.values())
    first = uncached(FilingRecord).filter(business_id=business.pk, kind="gstr3b").order_by("year", "month").values("year", "month").first()
    return {"business": business.pk, "as_of": "2025-04-01", **{key: money(value) for key, value in values.items()},
            "first_filed_3b": f"{first['year']:04d}-{first['month']:02d}" if first else None,
            "typed": row is not None, "updated_by": person(row.updated_by) if row else None,
            "updated_at": stamp(row.updated_at) if row else None,
            "carried_out_of_first_month": {"month": "2025-04", "heads": wire(month_position(business, 2025, 4)["carry_on"])}}


class GstOpeningCredit(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"PUT": "settings.edit"}

    def get(self, request):
        return Response(opening_data(firm_input(request.query_params)))

    @transaction.atomic
    def put(self, request):
        from billing.services.ledger import opening_effect
        data = body_of(request)
        business, values = firm_input(data, "business"), opening_heads(data)
        if request.query_params.get("preview") == "1":
            return Response(wire(opening_effect(business, values)))
        lock_firms(business.pk)
        effect = opening_effect(business, values)
        previous = uncached(OpeningCredit).filter(business_id=business.pk).values("igst", "cgst", "sgst").first()
        OpeningCredit.objects.update_or_create(business_id=business.pk, defaults={**values, "updated_by": request.user})
        AuditLog.objects.create(entity="credit", entity_id=business.pk, entity_name=business.name, user=request.user,
            action="updated", details=f"{business.name} · as of 01 Apr 2025: {inr(sum((previous or {}).values()))} → {inr(sum(values.values()))}")
        return Response({"opening": opening_data(business), "effect": wire(effect)})
