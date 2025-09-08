from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

from .views import (
    AIInvoiceCreateView,
    AIInvoiceProcessingView,
    BusinessViewSet,
    CSVImportView,
    CustomerViewSet,
    InvoiceViewSet,
    LineItemViewSet,
    ProductViewSet,
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
    path("csv/import/", CSVImportView.as_view(), name="csv-import"),
    path(
        "ai/invoice/process/",
        AIInvoiceProcessingView.as_view(),
        name="ai-invoice-process",
    ),
    path("ai/invoice/create/", AIInvoiceCreateView.as_view(), name="ai-invoice-create"),
    path(
        "invoices/<int:invoice_id>/line-items/",
        LineItemViewSet.as_view({"get": "list", "post": "create"}),
        name="invoice-line-items",
    ),
    # JWT Authentication endpoints
    path("token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("token/verify/", TokenVerifyView.as_view(), name="token_verify"),
]
