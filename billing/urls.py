from django.urls import path

from billing.views import (
    CustomerView,
    CustomerListView,
    CustomerDetailView,
    CustomerEditView,
    CustomerDeleteView,
    BusinessView,
    BusinessEditView,
    BusinessListView,
    BusinessDetailView,
    BusinessDeleteView,
    InvoiceView,
    InvoiceListView,
    InvoiceAddView,
    InvoiceDetailView,
)

urlpatterns = [
    path("customer/", CustomerView.as_view(), name="customer_form"),
    path(
        "customer/edit/<int:customer_id>",
        CustomerEditView.as_view(),
        name="customer_edit",
    ),
    path("customer/list/", CustomerListView.as_view(), name="customer_list"),
    path(
        "customer/<int:customer_id>/",
        CustomerDetailView.as_view(),
        name="customer_detail",
    ),
    path(
        "customer/delete/<int:pk>",
        CustomerDeleteView.as_view(),
        name="customer_delete",
    ),
    # Business Urls
    path("business/", BusinessView.as_view(), name="business_form"),
    path(
        "business/edit/<int:business_id>",
        BusinessEditView.as_view(),
        name="business_edit",
    ),
    path("business/list/", BusinessListView.as_view(), name="business_list"),
    path(
        "business/<int:business_id>/",
        BusinessDetailView.as_view(),
        name="business_detail",
    ),
    path(
        "business/delete/<int:pk>",
        BusinessDeleteView.as_view(),
        name="business_delete",
    ),
    path(
        "invoice/",
        InvoiceView.as_view(),
        name="invoice_form",
    ),
    path("invoice/list/", InvoiceListView.as_view(), name="invoice_list"),
    path("invoice/add/", InvoiceAddView.as_view(), name="invoice_add"),
    path(
        "invoice/<int:invoice_id>/",
        InvoiceDetailView.as_view(),
        name="invoice_detail",
    ),
]
