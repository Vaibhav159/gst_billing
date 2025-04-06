from django.urls import re_path

from . import views

urlpatterns = [
    # This will catch all routes and let React Router handle them
    re_path(r"^.*$", views.index),
]
