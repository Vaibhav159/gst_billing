"""
Custom JWT Token Serializer - adds username to JWT claims.

HOW TO APPLY:
  Add this code to billing/api/serializers.py (at the top, after existing imports)
"""

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Extends the default JWT serializer to include username in token claims."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        return token
