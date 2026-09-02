"""Signed, expiring media URLs — the auth layer for uploaded bill scans.

Why signatures instead of the JWT header: media is consumed by <img> and
<iframe> tags, which cannot attach Authorization headers. The URL itself is
therefore the credential — an HMAC over the file path with a timestamp,
minted only inside authenticated API responses and valid for a few hours.

In production nginx does the actual file streaming: this view validates the
signature and answers with X-Accel-Redirect to an `internal` location, so
Django never proxies bytes. In development and tests (no nginx in front)
it streams the file itself.
"""

import mimetypes
import posixpath
from urllib.parse import quote

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import FileResponse, HttpResponse, HttpResponseForbidden
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

_signer = TimestampSigner(salt="billing.media")

# How long a minted URL stays valid. API responses are consumed immediately
# and re-fetched on every page visit, so hours is generous.
MAX_AGE_SECONDS = 6 * 60 * 60


def sign_media_path(name: str) -> str:
    """Storage-relative file name → same-origin signed URL.

    Relative on purpose (see serializers._abs): the SPA is same-origin with
    the API everywhere, and absolute URLs would be built from the proxied
    plain-http request and get blocked as mixed content.
    """
    token = _signer.sign(name)
    return f"/api/media/{quote(name)}?s={quote(token)}"


class SignedMediaView(APIView):
    # The signature IS the credential — this must work for bare <img>/<iframe>
    # requests that carry neither JWT header nor session cookie.
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, subpath: str):
        token = request.query_params.get("s", "")
        try:
            signed_name = _signer.unsign(token, max_age=MAX_AGE_SECONDS)
        except SignatureExpired:
            return HttpResponseForbidden("Link expired — reload the page for a fresh one.")
        except BadSignature:
            return HttpResponseForbidden("Invalid media signature.")

        # The path in the URL must be exactly the path that was signed, and
        # normalised it must stay inside MEDIA_ROOT.
        if signed_name != subpath:
            return HttpResponseForbidden("Signature does not match this file.")
        normalized = posixpath.normpath(subpath)
        if normalized != subpath or subpath.startswith(("/", "../")) or ".." in subpath.split("/"):
            return HttpResponseForbidden("Invalid media path.")

        content_type = mimetypes.guess_type(subpath)[0] or "application/octet-stream"
        # Nothing served from here may run as a document at the app origin.
        # Images and PDFs stay inline (they embed as subresources); anything
        # else is a download, and every response carries a CSP that forbids
        # script even if a browser sniffs its way to text/html.
        inline = content_type.startswith("image/") or content_type == "application/pdf"
        disposition = f'{"inline" if inline else "attachment"}; filename="{subpath.rsplit("/", 1)[-1]}"'
        hardening = {
            "Content-Disposition": disposition,
            "Content-Security-Policy": "default-src 'none'",
            "X-Content-Type-Options": "nosniff",
        }

        if getattr(settings, "MEDIA_ACCEL_REDIRECT", False):
            # nginx serves the bytes from the `internal` location.
            resp = HttpResponse(content_type=content_type)
            resp["X-Accel-Redirect"] = quote(f"/protected-media/{subpath}")
            resp["Cache-Control"] = "private, max-age=3600"
            for k, v in hardening.items():
                resp[k] = v
            return resp

        # Dev / tests: stream directly.
        try:
            f = (settings.MEDIA_ROOT / subpath).open("rb") if hasattr(settings.MEDIA_ROOT, "open") \
                else open(f"{settings.MEDIA_ROOT}/{subpath}", "rb")
        except FileNotFoundError:
            return HttpResponse(status=404)
        resp = FileResponse(f, content_type=content_type)
        resp["Cache-Control"] = "private, max-age=3600"
        for k, v in hardening.items():
            resp[k] = v
        return resp
