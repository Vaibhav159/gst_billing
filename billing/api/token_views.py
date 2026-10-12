from rest_framework_simplejwt.serializers import TokenVerifySerializer
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

from .auth import DynamicScopedRateThrottle, LoginRateThrottle
from .session_auth import SessionJWTAuthentication
from .session_tokens import SessionTokenObtainSerializer, SessionTokenRefreshSerializer


class ThrottledTokenObtainPairView(TokenObtainPairView):
    serializer_class = SessionTokenObtainSerializer
    throttle_classes = [LoginRateThrottle]
    throttle_scope = "login"


class ThrottledTokenRefreshView(TokenRefreshView):
    serializer_class = SessionTokenRefreshSerializer
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "token_refresh"


class SessionTokenVerifySerializer(TokenVerifySerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        # A signed-out device or a revoked token is not valid, whatever its signature says.
        SessionJWTAuthentication().get_user(UntypedToken(attrs["token"]))
        return data


class SessionTokenVerifyView(TokenVerifyView):
    serializer_class = SessionTokenVerifySerializer
