from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .auth import DynamicScopedRateThrottle, LoginRateThrottle
from .session_tokens import SessionTokenObtainSerializer, SessionTokenRefreshSerializer


class ThrottledTokenObtainPairView(TokenObtainPairView):
    serializer_class = SessionTokenObtainSerializer
    throttle_classes = [LoginRateThrottle]
    throttle_scope = "login"


class ThrottledTokenRefreshView(TokenRefreshView):
    serializer_class = SessionTokenRefreshSerializer
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "token_refresh"
