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

from django.contrib import admin
from django.urls import include, path

from billing.views import InitialView

urlpatterns = [
    path("admin/", admin.site.urls),
    # Legacy HTMX routes
    path("htmx/", InitialView.as_view(), name="initial"),
    path("htmx/billing/", include("billing.urls")),
    path("explorer/", include("explorer.urls")),
    # API endpoints for React
    path("api/", include("billing.api.urls")),
    # React frontend - this should be last as it catches all other routes
    path("", include("frontend.urls")),
]
