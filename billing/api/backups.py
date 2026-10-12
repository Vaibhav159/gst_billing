"""Full-backup and spreadsheet download endpoints."""

from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework.negotiation import DefaultContentNegotiation
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


class DownloadNegotiation(DefaultContentNegotiation):
    def filter_renderers(self, renderers, format_name):
        # ?format chooses the attachment type, rather than a DRF renderer.
        return renderers


class RecordExportView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "reports.export"}
    content_negotiation_class = DownloadNegotiation

    def get(self, request, kind):
        from billing.services.record_exports import response_for
        return response_for(request.user, kind, request.query_params)
