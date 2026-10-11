"""Part 4's customer duplicates, merge preview and merge endpoints."""
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.services.customer_merge import duplicates, merge_customers, merge_preview


class CustomerDuplicatesView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "view"}

    def get(self, request):
        return Response(duplicates())


class CustomerMergeView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "customer.merge", "POST": "customer.merge"}

    def get(self, request, pk):
        return Response(merge_preview(pk, request.query_params.get("into")))

    def post(self, request, pk):
        into = request.data.get("into") if isinstance(request.data, dict) else None
        return Response(merge_customers(pk, into, request.user))
