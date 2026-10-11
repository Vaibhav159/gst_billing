"""The original scan can be attached by its maker for one day, or by an editor."""
from datetime import timedelta
from pathlib import PurePosixPath

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import MethodNotAllowed, NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.inward_bills import _store_file_and_preview
from billing.api.permissions import V3Permission
from billing.cache import uncached
from billing.credit import credit_month_of
from billing.models import AuditLog
from billing.numbering import lock_firms
from billing.period_lock import assert_purchase_open
from billing.roles import can, why_not
from billing.services.capture_uploads import discard_files, validate_files, validate_request_size
from billing.services.purchase_reads import purchase_detail, purchase_queryset


class PurchaseFilesView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": lambda request, view, obj: "purchase.edit" if can(request.user, "purchase.edit") else "purchase.create", "DELETE": "purchase.edit"}
    parser_classes = [MultiPartParser, FormParser]

    def get_bill(self, pk):
        bill = purchase_queryset().select_for_update(of=("self",)).filter(pk=pk).first()
        if bill is None:
            raise NotFound("No purchase matches the given query.")
        return bill

    def post(self, request, pk, file_id=None):
        if file_id is not None:
            raise MethodNotAllowed("POST")
        validate_request_size(request, field="file")
        files = validate_files(request.FILES.getlist("file"), field="file")
        if len(files) != 1:
            raise ValidationError({"file": ["Choose a photo (JPEG, PNG or HEIC) or a PDF."]})
        written = []
        try:
            with transaction.atomic():
                bill = self.get_bill(pk)
                lock_firms(bill.business_id)
                maker = uncached(AuditLog).filter(entity="invoice", entity_id=bill.pk, action__in=["created", "imported"]).order_by("timestamp", "pk").values_list("user_id", flat=True).first()
                own_new = maker == request.user.pk and bill.created_at >= timezone.now() - timedelta(hours=24)
                if not can(request.user, "purchase.edit") and not (own_new and can(request.user, "purchase.create")):
                    raise PermissionDenied({"detail": why_not(request.user, "purchase.edit"), "needs": "purchase.edit"})
                assert_purchase_open(bill.business, credit_month_of(bill), "files")
                if bill.source_file:
                    raise ValidationError({"file": ["This bill has its file already. Remove it first to put another."]})
                try:
                    _store_file_and_preview(bill, files[0])
                finally:
                    written += [(bill.source_file.storage, bill.source_file.name), (bill.source_preview.storage, bill.source_preview.name)]
                AuditLog.objects.create(entity="invoice", entity_id=bill.pk, entity_name=bill.invoice_number,
                    action="updated", user=request.user, details=f"File attached: {files[0].name}")
        except Exception:
            discard_files(written)
            raise
        return Response(purchase_detail(bill))

    @transaction.atomic
    def delete(self, request, pk, file_id=None):
        bill = self.get_bill(pk)
        if file_id != "src" or not bill.source_file:
            raise NotFound("That file isn't attached to this bill.")
        lock_firms(bill.business_id)
        assert_purchase_open(bill.business, credit_month_of(bill), "files")
        files = [(bill.source_file.storage, bill.source_file.name), (bill.source_preview.storage, bill.source_preview.name)]
        name = PurePosixPath(bill.source_file.name).name
        bill.source_file, bill.source_preview = "", ""
        bill.save(update_fields=["source_file", "source_preview"])
        transaction.on_commit(lambda: discard_files(files))
        AuditLog.objects.create(entity="invoice", entity_id=bill.pk, entity_name=bill.invoice_number,
            action="updated", user=request.user, details=f"File removed: {name}")
        return Response(status=204)
