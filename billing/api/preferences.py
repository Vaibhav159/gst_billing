"""Per-user preferences: GET returns the blob, PATCH shallow-merges into it.

Lives in its own module (not views.py) so the endpoint never collides with
the several in-flight branches that edit views.py.
"""

import json

from rest_framework.response import Response
from rest_framework.views import APIView

from billing.models import UserPreference

# One JSON blob per user; 8 KB is ~40x what the Settings page stores today —
# a typo'd client can't turn this into unbounded storage.
MAX_BYTES = 8192


class PreferencesView(APIView):
    def get(self, request):
        pref = UserPreference.objects.filter(user=request.user).first()
        return Response({"data": pref.data if pref else {}})

    def patch(self, request):
        incoming = request.data
        if not isinstance(incoming, dict):
            return Response({"error": "preferences must be a JSON object"}, status=400)
        pref, _ = UserPreference.objects.get_or_create(user=request.user)
        merged = {**pref.data, **incoming}
        # A key set to null means "remove" — lets the client un-set without
        # a separate DELETE shape.
        merged = {k: v for k, v in merged.items() if v is not None}
        if len(json.dumps(merged)) > MAX_BYTES:
            return Response({"error": "preferences too large"}, status=400)
        pref.data = merged
        pref.save(update_fields=["data", "updated_at"])
        return Response({"data": pref.data})
