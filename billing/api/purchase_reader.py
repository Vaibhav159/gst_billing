"""Read without storing the upload, and inspect this month's successful read count."""
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.roles import can
from billing.services.ai_reader import FAILED, ReadFailed, read_usage, run_read
from billing.services.capture_uploads import business_from, validate_files, validate_request_size


class PurchaseReadView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": lambda request, view, obj: "purchase.create" if can(request.user, "purchase.create") else "purchase.import"}
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        validate_request_size(request)
        files = validate_files(request.FILES.getlist("files"))
        business = business_from(request.data.get("business_id"))
        kind = request.data.get("kind", "form")
        if kind not in ("form", "photos"):
            raise ValidationError({"kind": ["Choose form or photos."]})
        try:
            return Response(run_read(files, request.user, kind, business))
        except ReadFailed:
            return Response({"detail": FAILED, "code": "read_failed"}, status=502)


class AiReadsView(APIView):
    permission_classes = [V3Permission]

    def get(self, request):
        return Response(read_usage())
