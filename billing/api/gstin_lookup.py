"""GET /api/gstin/<gstin>/ — validate a GSTIN and return what we know.

Always 200 for a syntactically attemptable input: the response's `valid` flag
carries the verdict, so the SPA's axios interceptor never treats a typo as a
transport error. Auth required like the rest of the API — this proxies a keyed
third-party quota.
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from billing import gstin as gstin_service

from .permissions import RoleBasedPermission


class GstinLookupView(APIView):
    permission_classes = [RoleBasedPermission]

    def get(self, request, gstin: str):
        return Response(gstin_service.lookup(gstin))
