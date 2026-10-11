from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenVerifyView

from .auth import ThrottledTokenObtainPairView, ThrottledTokenRefreshView
from .bill_imports import PurchaseImportView, SalesImportView
from .captures import CaptureDetailView, CaptureReadView, CaptureRestoreView, CapturesView
from .drafts import DraftViewSet
from .gstin_lookup import GstinLookupView
from .inward_bills import (
    InwardBillDetailView,
    InwardBillExtractView,
    InwardBillListCreateView,
    InwardCaptureDetailView,
    InwardCaptureListCreateView,
)
from .me import MeView
from .media import SignedMediaView
from .preferences import PreferencesView
from .purchase_files import PurchaseFilesView
from .purchase_reader import AiReadsView, PurchaseReadView
from .purchases import PurchaseBinViewSet, PurchasesViewSet
from .reconciliation import ReconciliationView
from .sales import BinViewSet, SalesViewSet
from .search import QuickSearchView
from .shop import ShopSettingsView
from .suppliers import SupplierViewSet
from .views import (
    AIInvoiceCreateView,
    AIInvoiceProcessingView,
    AuditLogViewSet,
    BulkInvoiceImportView,
    BusinessViewSet,
    CSVImportView,
    CustomerViewSet,
    FiledPeriodViewSet,
    InvoiceViewSet,
    ITCReclaimLedgerView,
    LineItemViewSet,
    ProductViewSet,
    ProfileView,
    ReportView,
    UserManagementView,
)

router = DefaultRouter()
router.register(r"purchases/bin", PurchaseBinViewSet, basename="purchase-bin")
router.register(r"purchases", PurchasesViewSet, basename="purchase")
router.register(r"businesses", BusinessViewSet)
router.register(r"customers", CustomerViewSet)
router.register(r"invoices", InvoiceViewSet)
router.register(r"line-items", LineItemViewSet)
router.register(r"products", ProductViewSet)
router.register(r"audit-logs", AuditLogViewSet)
router.register(r"filed-periods", FiledPeriodViewSet)
router.register(r"sales", SalesViewSet, basename="sale")
router.register(r"bin", BinViewSet, basename="bin")
router.register(r"drafts", DraftViewSet, basename="draft")
router.register(r"suppliers", SupplierViewSet, basename="supplier")

urlpatterns = [
    path("purchases/<int:pk>/files/", PurchaseFilesView.as_view(), name="purchase-files"),
    path("purchases/<int:pk>/files/<str:file_id>/", PurchaseFilesView.as_view(), name="purchase-file"),
    path("captures/", CapturesView.as_view(), name="capture-list"),
    path("captures/<int:pk>/", CaptureDetailView.as_view(), name="capture-detail"),
    path("captures/<int:pk>/restore/", CaptureRestoreView.as_view(), name="capture-restore"),
    path("captures/<int:pk>/read/", CaptureReadView.as_view(), name="capture-read"),
    path("purchases/read/", PurchaseReadView.as_view(), name="purchase-read"),
    path("ai-reads/", AiReadsView.as_view(), name="ai-reads"),
    path("purchases/import/", PurchaseImportView.as_view(), name="purchase-import"),
    path("sales/import/", SalesImportView.as_view(), name="sale-import"),
    # Explicit paths BEFORE router to avoid router's <pk> catching them
    path("invoices/bulk-import/", BulkInvoiceImportView.as_view(), name="bulk-invoice-import"),
    path("reports/generate/", ReportView.as_view(), name="generate-report"),
    path("csv/import/", CSVImportView.as_view(), name="csv-import"),
    # Inward Bills module (explicit paths BEFORE router)
    path("inward-bills/", InwardBillListCreateView.as_view(), name="inward-bill-list"),
    path("inward-bills/extract/", InwardBillExtractView.as_view(), name="inward-bill-extract"),
    path("inward-captures/", InwardCaptureListCreateView.as_view(), name="inward-capture-list"),
    path("inward-captures/<int:pk>/", InwardCaptureDetailView.as_view(), name="inward-capture-detail"),
    path("search/quick/", QuickSearchView.as_view(), name="quick-search"),
    path("reconciliation/", ReconciliationView.as_view(), name="reconciliation"),
    path("shop-settings/", ShopSettingsView.as_view(), name="shop-settings"),
    path("inward-bills/<int:pk>/", InwardBillDetailView.as_view(), name="inward-bill-detail"),
    path("", include(router.urls)),
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
    # ITC Reclaim Ledger (ECRRS opening balance, per business)
    path(
        "itc-ledger/<int:business_id>/",
        ITCReclaimLedgerView.as_view(),
        name="itc-reclaim-ledger",
    ),
    # Profile & User Management
    # GSTIN validation + taxpayer autofill (see billing/gstin.py)
    path("gstin/<str:gstin>/", GstinLookupView.as_view(), name="gstin-lookup"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("me/", MeView.as_view(), name="me"),
    path("users/", UserManagementView.as_view(), name="user-management"),
    path("preferences/", PreferencesView.as_view(), name="preferences"),
    path("media/<path:subpath>", SignedMediaView.as_view(), name="signed-media"),
    # JWT Authentication endpoints
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", ThrottledTokenRefreshView.as_view(), name="token_refresh"),
    path("token/verify/", TokenVerifyView.as_view(), name="token_verify"),
]
