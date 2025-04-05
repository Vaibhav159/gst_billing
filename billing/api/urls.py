from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

from .views import (
    BusinessViewSet,
    CSRFTokenView,
    CustomerViewSet,
    InvoiceImportView,
    InvoiceViewSet,
    LineItemViewSet,
    ProductViewSet,
    PublicAPIView,
    ReportView,
)

router = DefaultRouter()
router.register(r"businesses", BusinessViewSet)
router.register(r"customers", CustomerViewSet)
router.register(r"invoices", InvoiceViewSet)
router.register(r"line-items", LineItemViewSet)
router.register(r"products", ProductViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("reports/generate/", ReportView.as_view(), name="generate-report"),
    path("invoices/import/", InvoiceImportView.as_view(), name="import-invoices"),
    path("csrf-token/", CSRFTokenView.as_view(), name="csrf-token"),
    path("public/", PublicAPIView.as_view(), name="public-api"),
    # JWT Authentication endpoints
    path("token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("token/verify/", TokenVerifyView.as_view(), name="token_verify"),
]
