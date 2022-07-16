from django.urls import path

from billing.views import (
    CustomerView,
    CustomerListView,
    CustomerDetailView,
    CustomerEditView,
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
]
