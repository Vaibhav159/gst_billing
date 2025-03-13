from django.urls import path

from billing.views import (
    BusinessDeleteView,
    BusinessDetailView,
    BusinessEditView,
    BusinessListView,
    BusinessView,
    CustomerDeleteView,
    CustomerDetailView,
    CustomerEditView,
    CustomerListView,
    CustomerSearchView,
    CustomerView,
    DownloadInvoicesView,
    InvoiceAddView,
    InvoiceDeleteView,
    InvoiceDetailView,
    InvoiceListView,
    InvoiceSummaryView,
    InvoiceView,
    LineItemView,
    PrintInvoiceView,
    ProductDeleteView,
    ProductEditView,
    ProductListView,
    ProductView,
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
    path("invoice_summary/", InvoiceSummaryView.as_view(), name="invoice_summary"),
    path(
        "invoice/<int:invoice_id>/print",
        PrintInvoiceView.as_view(),
        name="invoice_print",
    ),
    path(
        "invoice/delete/<int:pk>",
        InvoiceDeleteView.as_view(),
        name="invoice_delete",
    ),
    # line items
    path("line_item/", LineItemView.as_view(), name="line_item_inline_form"),
    path("download_invoice/", DownloadInvoicesView.as_view(), name="download_invoice"),
    # product urls
    path("product/", ProductView.as_view(), name="product_form"),
    path("product/list/", ProductListView.as_view(), name="product_list"),
    path(
        "product/edit/<int:product_id>",
        ProductEditView.as_view(),
        name="product_edit",
    ),
    path(
        "product/delete/<int:pk>",
        ProductDeleteView.as_view(),
        name="product_delete",
    ),
    path("customer/search/", CustomerSearchView.as_view(), name="customer_search"),
]
