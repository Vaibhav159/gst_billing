from django.shortcuts import render, redirect

# Create your views here.
from django.urls import reverse_lazy
from django.views import View
from django.views.generic import ListView, DeleteView

from billing.forms import CustomerForm, BusinessForm
from billing.models import Business, Customer


class CustomerView(View):
    def get(self, request):
        customer = (
            None
            if not request.GET.get("customer_id")
            else Customer.objects.get(id=int(request.GET.get("customer_id")))
        )
        form = CustomerForm(instance=customer)
        return render(request, "partials/customer_form.html", {"form": form})

    def post(self, request):
        form = CustomerForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("customer_detail", customer_id=form.instance.id)
        return render(request, "partials/customer_form.html", {"form": form})


class CustomerEditView(View):
    def get(self, request, customer_id=None):
        customer = None if not customer_id else Customer.objects.get(id=customer_id)
        form = CustomerForm(instance=customer)
        return render(request, "partials/customer_form.html", {"form": form})

    def post(self, request, customer_id):
        customer = None if not customer_id else Customer.objects.get(id=customer_id)
        form = CustomerForm(request.POST, instance=customer)
        if form.is_valid():
            form.save()
            return redirect("customer_detail", customer_id=form.instance.id)
        return render(request, "partials/customer_form.html", {"form": form})


class CustomerListView(ListView):
    model = Customer
    template_name = "customer_list.html"
    context_object_name = "customers"
    paginate_by = 2

    def get_queryset(self):
        return Customer.objects.all().order_by("id")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Customers"
        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            return render(
                request,
                "partials/customer_data_list.html",
                context=self.get_context_data(object_list=self.get_queryset()),
            )
        return super().get(request, *args, *kwargs)


class CustomerDetailView(View):
    def get(self, request, customer_id):
        context = {
            "object": Customer.objects.get(id=customer_id),
        }
        return render(request, "customer_detail.html", context)

    def post(self, request):
        return render(request, "customer_detail.html")


class CustomerDeleteView(DeleteView):
    model = Customer
    success_url = reverse_lazy("customer_list")
    template_name = "customer_list.html"


# Create views for Business just like Customer Views
class BusinessView(View):
    def get(self, request):
        business = (
            None
            if not request.GET.get("business_id")
            else Business.objects.get(id=int(request.GET.get("business_id")))
        )
        form = BusinessForm(instance=business)
        return render(request, "partials/business_form.html", {"form": form})

    def post(self, request):
        form = BusinessForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("business_detail", business_id=form.instance.id)
        return render(request, "partials/business_form.html", {"form": form})


class BusinessEditView(View):
    def get(self, request, business_id=None):
        business = None if not business_id else Business.objects.get(id=business_id)
        form = BusinessForm(instance=business)
        return render(request, "partials/business_form.html", {"form": form})

    def post(self, request, business_id):
        business = None if not business_id else Business.objects.get(id=business_id)
        form = BusinessForm(request.POST, instance=business)
        if form.is_valid():
            form.save()
            return redirect("business_detail", business_id=form.instance.id)
        return render(request, "partials/business_form.html", {"form": form})


class BusinessListView(ListView):
    model = BusinessForm
    template_name = "business_list.html"
    context_object_name = "businesses"
    paginate_by = 2

    def get_queryset(self):
        return Business.objects.all().order_by("id")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Businesses"
        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            return render(
                request,
                "partials/business_data_list.html",
                context=self.get_context_data(object_list=self.get_queryset()),
            )
        return super().get(request, *args, *kwargs)


class BusinessDetailView(View):
    def get(self, request, business_id):
        context = {
            "object": Business.objects.get(id=business_id),
        }
        return render(request, "business_detail.html", context)

    def post(self, request):
        return render(request, "business_detail.html")


class BusinessDeleteView(DeleteView):
    model = Business
    success_url = reverse_lazy("business_list")
    template_name = "business_list.html"
