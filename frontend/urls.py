from django.urls import re_path

from . import views

urlpatterns = [
    # Catch-all for React Router — but NOT /api/. Without the negative
    # lookahead an unknown endpoint fell through to here and returned 200 with
    # the SPA shell, so a typo'd URL looked like success to the client and
    # failed somewhere far from the cause.
    re_path(r"^(?!api/).*$", views.index),
]
