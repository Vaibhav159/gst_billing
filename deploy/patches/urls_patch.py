"""
URL patch - replace TokenObtainPairView with CustomTokenObtainPairView.

HOW TO APPLY in billing/api/urls.py:
  1. Change import: replace TokenObtainPairView with CustomTokenObtainPairView from .views
  2. Change line 47:
     FROM: path("token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
     TO:   path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),

Also in gst_billing/urls.py, wrap the frontend catch-all so it's conditional in production:

  FROM:
    urlpatterns += [
        path("", include("frontend.urls")),
    ]

  TO:
    if "frontend" in settings.INSTALLED_APPS:
        urlpatterns += [
            path("", include("frontend.urls")),
        ]
"""
