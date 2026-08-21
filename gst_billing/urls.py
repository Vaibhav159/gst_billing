"""gst_billing URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("explorer/", include("explorer.urls")),
    # API endpoints for React
    path("api/", include("billing.api.urls")),
]

# Media files must be before the SPA catch-all
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Liveness for uptime monitors and Watchtower sanity: 200 when the DB
# answers, 503 when it doesn't. Registered before the SPA fallback so the
# catch-all never swallows it. No auth — it leaks nothing but "up".
def healthz(request):
    from django.db import connection
    from django.http import JsonResponse

    try:
        with connection.cursor() as c:
            c.execute("SELECT 1")
        return JsonResponse({"ok": True, "db": True})
    except Exception:
        return JsonResponse({"ok": False, "db": False}, status=503)


urlpatterns += [path("healthz", healthz)]


# SPA fallback — nginx serves the real app in production; this answers direct
# Django hits (dev runserver, probes) now that the V1 webpack shell is deleted.
# The negative lookahead keeps unknown /api/ paths as JSON 404s, not HTML 200s.
def spa_fallback(request):
    from django.http import HttpResponse

    return HttpResponse(
        "<!doctype html><title>GST Billing</title>"
        "<p>API lives at <code>/api/</code>. The app UI is served by nginx in "
        "production; locally, run the Vite dev server "
        "(sweet-rebuild-suite-main).</p>"
    )


urlpatterns += [
    re_path(r"^(?!api/).*$", spa_fallback),
]
