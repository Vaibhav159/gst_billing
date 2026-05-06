"""
Custom JWT Token View - uses the custom serializer with username in claims.

HOW TO APPLY:
  Add this code to billing/api/views.py (after existing imports)
"""

from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import CustomTokenObtainPairSerializer


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
