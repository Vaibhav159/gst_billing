"""Throttled JWT endpoints.

The token endpoints are the only unauthenticated POST surface, and production
had no throttling at all — three rapid wrong-password attempts were accepted
without so much as a header (verified live, 19 Aug 2026). Scoped rates keyed
by client IP; in production the throttle state lives in Redis (shared across
gunicorn workers), locally in locmem (per-process, still effective for a
single runserver).
"""

from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import CustomTokenObtainPairSerializer


class DynamicScopedRateThrottle(ScopedRateThrottle):
    """ScopedRateThrottle that reads its rates at request time.

    SimpleRateThrottle binds THROTTLE_RATES = api_settings.DEFAULT_THROTTLE_RATES
    as a class attribute when rest_framework.throttling is first imported, so a
    settings change after that (override_settings in tests, any runtime reload)
    is invisible to it — which made the throttle tests pass or fail depending
    on which test file imported DRF first. A property makes the lookup live.
    """

    @property
    def THROTTLE_RATES(self):
        return api_settings.DEFAULT_THROTTLE_RATES


class ThrottledTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "login"


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "token_refresh"
