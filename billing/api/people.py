"""Owner-managed people and each signed-in person's profile."""
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.account_access import AccountAccess
from billing.api.auth import DynamicScopedRateThrottle
from billing.api.permissions import V3Permission
from billing.services.people import account_row, change_account, change_person, create_person, people_rows


class PeopleView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "users.manage", "POST": "users.manage"}

    def get(self, request):
        return Response({"results": people_rows(request.user)})

    def post(self, request):
        return Response(create_person(request.user, request.data), status=201)


class PeopleActionView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "users.manage"}

    def post(self, request, pk, action):
        return Response(change_person(request.user, pk, action, request.data))


class AccountView(APIView):
    permission_classes = [AccountAccess]
    throttle_scope = "password"

    def get_throttles(self):
        # A phone change checks the current password, so it shares own-password's guess limit.
        data = self.request.data if self.request.method == "PATCH" else None
        return [DynamicScopedRateThrottle()] if isinstance(data, dict) and "phone" in data else []

    def get(self, request):
        return Response(account_row(request.user))

    def patch(self, request):
        return Response(change_account(request.user, request.data))
