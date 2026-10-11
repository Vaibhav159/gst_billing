"""Owner-only multipart backup preview and atomic add-only restore."""

from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.services.backup_restore import preview


class BackupRestorePreview(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "backup.restore"}
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        return Response(preview(request.FILES.get("file")))
