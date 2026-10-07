"""Throttled JWT endpoints.

The token endpoints are the only unauthenticated POST surface, and production
had no throttling at all — three rapid wrong-password attempts were accepted
without so much as a header (verified live, 19 Aug 2026). Scoped rates keyed
by client IP; in production the throttle state lives in Redis (shared across
gunicorn workers), locally in locmem (per-process, still effective for a
single runserver).
"""

import hashlib
import logging

from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import CustomTokenObtainPairSerializer

logger = logging.getLogger(__name__)


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


class LoginRateThrottle(DynamicScopedRateThrottle):
    """Login attempts per client address, or per username when the proxies
    in front didn't say who the client is.

    Production counts two proxies (NUM_PROXIES: Cosmos, then nginx), each
    adding an X-Forwarded-For hop, and DRF keys on the hop the first one
    added. With fewer hops than proxies the edge didn't add the client, and
    DRF would key every request on the edge's own address: one bucket for
    everybody, so ten bad logins from anyone would lock every user out.
    Keying on the username keeps guessing limited per account instead.
    """

    _warned = False

    def get_cache_key(self, request, view):
        num_proxies = api_settings.NUM_PROXIES
        hops = [h for h in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if h.strip()]
        if not num_proxies or len(hops) >= num_proxies:
            return super().get_cache_key(request, view)
        if not LoginRateThrottle._warned:
            LoginRateThrottle._warned = True
            logger.warning(
                "X-Forwarded-For has %d hop(s) but NUM_PROXIES is %d: the edge isn't adding "
                "the client's address, so the login throttle keys on the username.",
                len(hops), num_proxies,
            )
        data = request.data if hasattr(request.data, "get") else {}
        username = str(data.get("username") or "").strip().lower()
        ident = "user-" + hashlib.sha256(username.encode()).hexdigest()[:32]
        return self.cache_format % {"scope": self.scope, "ident": ident}


class ThrottledTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [LoginRateThrottle]
    throttle_scope = "login"


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "token_refresh"
