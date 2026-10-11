"""Full-backup and spreadsheet download endpoints."""

from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.services.backups import full_stream, summary


class BackupSummaryView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "view"}

    def get(self, request):
        return Response(summary(request.user))


class BackupFullView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "backup.download"}

    def get(self, request):
        made = timezone.now()
        filename = f"gst-backup-{timezone.localdate(made).isoformat()}.json"
        response = StreamingHttpResponse(full_stream(request.user, made, filename), content_type="application/json")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
