from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BusinessViewSet,
    CSRFTokenView,
    CustomerViewSet,
    InvoiceImportView,
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
    path("invoices/import/", InvoiceImportView.as_view(), name="import-invoices"),
    path("csrf-token/", CSRFTokenView.as_view(), name="csrf-token"),
]
