"""GET /api/me/: who is signed in, their v3 role and what they may do.

v3 asks this once when it starts and after sign-in, instead of trusting the token's claims (a
refreshed token copies the old role claim, so a role change showed only after signing in again).
Read-only and cheap: one user row and its groups.
"""

from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.roles import ROLES, needs_role_choice, permissions_of, role_of

from .permissions import get_user_role


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        role = role_of(user)
        return Response({
            "id": user.id,
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
            "role": role,
            "role_label": ROLES[role]["label"],
            "permissions": permissions_of(user),
            "v2_role": get_user_role(user),
            "needs_role_choice": needs_role_choice(user),
        })
