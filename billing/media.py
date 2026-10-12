"""Signing media paths: the credential for an uploaded file's URL (served by billing.api.media).

Kept out of the API layer so a service (the bill page's signature image) can mint a link
without importing a view module.
"""

from urllib.parse import quote

from django.core.signing import TimestampSigner

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
