from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenVerifyView

from .account_sessions import PasswordView, SessionEndView, SessionsView, SignOutView
from .audit import AuditActionView, AuditExportView, AuditView
from .bill_imports import PurchaseImportView, SalesImportView
from .captures import CaptureDetailView, CaptureReadView, CaptureRestoreView, CapturesView
from .catalog import CatalogDetail, CatalogList
from .customer_merge import CustomerDuplicatesView, CustomerMergeView
from .drafts import DraftViewSet
from .firms import FirmDetailView, FirmSignatureView, FirmsView
from .gst import (
    GstBundle,
    GstFile,
    GstFiling,
    GstFilings,
    GstMonth,
    GstMonthAction,
    GstMonthEnd,
    GstOpeningCredit,
    GstSections,
    GstYear,
)
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
from .password_reset import AuthOptionsView, PasswordRulesView, ResetView
from .people import AccountView, PeopleActionView, PeopleView
from .preferences import PreferencesView
from .purchase_files import PurchaseFilesView
from .purchase_reader import AiReadsView, PurchaseReadView
from .purchases import PurchaseBinViewSet, PurchasesViewSet
from .reconciliation import ReconciliationView
from .registry import RegistryView
from .reports_v3 import CAWorkbookView, CreditView
from .reports_v3 import ReconciliationView as GSTReconciliationView
from .reports_v3 import ReportView as ReportV3View
from .sales import BinViewSet, SalesViewSet
from .search import QuickSearchView
from .setup import SetupView
from .shop import ShopSettingsView
from .suppliers import SupplierViewSet
from .token_views import ThrottledTokenObtainPairView, ThrottledTokenRefreshView
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
    path("gst/year/", GstYear.as_view()),
    path("gst/month/", GstMonth.as_view()),
    path("gst/month-end/", GstMonthEnd.as_view()),
    path("gst/month/gstr1/", GstSections.as_view(), {"kind": "gstr1"}),
    path("gst/month/gstr3b/", GstSections.as_view(), {"kind": "gstr3b"}),
    path("gst/files/gstr1/", GstFile.as_view(), {"kind": "gstr1"}),
    path("gst/files/gstr1a/", GstFile.as_view(), {"kind": "gstr1a"}),
    path("gst/files/amendments/", GstFile.as_view(), {"kind": "amendments"}),
    path("gst/files/gstr3b/", GstFile.as_view(), {"kind": "gstr3b"}),
    path("gst/files/bundle/", GstBundle.as_view()),
    path("gst/filings/", GstFilings.as_view()),
    path("gst/filings/<int:pk>/", GstFiling.as_view()),
    path("gst/months/unlock/", GstMonthAction.as_view(), {"operation": "unlock"}),
    path("gst/months/relock/", GstMonthAction.as_view(), {"operation": "relock"}),
    path("gst/months/filed-before/", GstMonthAction.as_view(), {"operation": "filed-before"}),
    path("gst/opening-credit/", GstOpeningCredit.as_view()),
    # Explicit paths BEFORE router to avoid router's <pk> catching them
    path("invoices/bulk-import/", BulkInvoiceImportView.as_view(), name="bulk-invoice-import"),
    path("reports/generate/", ReportView.as_view(), name="generate-report"),
    path("reports/ca-workbook/", CAWorkbookView.as_view(), name="ca-workbook"),
    path("reports/<str:kind>/", ReportV3View.as_view(), name="report-v3"),
    path("gst/credit/", CreditView.as_view(), name="gst-credit"),
    path("gst/reconciliation/", GSTReconciliationView.as_view(), name="gst-reconciliation"),
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
    path("firms/", FirmsView.as_view(), name="firms"),
    path("firms/<int:pk>/", FirmDetailView.as_view(), name="firm-detail"),
    path("firms/<int:pk>/signature/", FirmSignatureView.as_view(), name="firm-signature"),
    path("catalog/", CatalogList.as_view(), name="catalog"),
    path("catalog/<int:pk>/", CatalogDetail.as_view(), name="catalog-detail"),
    path("setup/", SetupView.as_view(), name="setup"),
    re_path(r"^registry/(?P<gstin>[^/]{1,20})/$", RegistryView.as_view(), name="registry"),
    path("customers/duplicates/", CustomerDuplicatesView.as_view(), name="customer-duplicates"),
    path("customers/<int:pk>/merge-preview/", CustomerMergeView.as_view(http_method_names=["get", "head", "options"]), name="customer-merge-preview"),
    path("customers/<int:pk>/merge-into/", CustomerMergeView.as_view(http_method_names=["post", "options"]), name="customer-merge-into"),
    path("audit/", AuditView.as_view(), name="audit"),
    path("audit/export/", AuditExportView.as_view(), name="audit-export"),
    path("audit/<int:pk>/<str:action>/", AuditActionView.as_view(), name="audit-action"),
    path("account/password/", PasswordView.as_view()),
    path("account/sessions/", SessionsView.as_view()),
    path("account/sessions/sign-out-others/", SessionEndView.as_view()),
    path("account/sessions/<str:pk>/sign-out/", SessionEndView.as_view()),
    path("auth/sign-out/", SignOutView.as_view()),
    path("people/", PeopleView.as_view(), name="people"),
    path("people/<int:pk>/<str:action>/", PeopleActionView.as_view(), name="people-action"),
    path("account/", AccountView.as_view(), name="account"),
    path("auth/options/", AuthOptionsView.as_view()),
    path("auth/password-rules/", PasswordRulesView.as_view()),
    path("auth/reset/start/", ResetView.as_view(), {"step": "start"}),
    path("auth/reset/finish/", ResetView.as_view(), {"step": "finish"}),
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
