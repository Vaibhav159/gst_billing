from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.refusals import Refusal
from billing.services.password_reset import finish_reset, start_reset
from billing.services.sms import sms_enabled

from .auth import DynamicScopedRateThrottle


class AuthOptionsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"sms_reset": sms_enabled()})


class PasswordRulesView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"min_length": 8, "common": False})


class ResetView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "reset"

    def post(self, request, step):
        if not sms_enabled():
            raise Refusal("Password codes by SMS aren't switched on yet. Ask the owner to set a new password for you. If you are the owner, ask the person who looks after the app.", "sms_off")
        if step == "start":
            answer, status = start_reset(request.data, DynamicScopedRateThrottle().get_ident(request))
        else:
            answer, status = finish_reset(request.data)
        return Response(answer, status=status)
