from django.shortcuts import render, redirect

# Create your views here.
from django.views import View
from django.views.generic import ListView

from billing.forms import CustomerForm
from billing.models import Customer


class CustomerView(View):
    def get(self, request):
        form = CustomerForm()
        return render(request, "customer_form.html", {"form": form})

    def post(self, request):
        form = CustomerForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("customer_detail")
        return render(request, "customer_form.html", {"form": form})


class CustomerListView(ListView):
    model = Customer
    template_name = "customer_list.html"
    context_object_name = "customers"
    paginate_by = 10

    def get_queryset(self):
        return Customer.objects.all()

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Customers"
        return context


class CustomerDetailView(View):
    def get(self, request, customer_id):
        context = {
            "object": Customer.objects.get(id=customer_id),
        }
        return render(request, "customer_detail.html", context)

    def post(self, request):
        return render(request, "customer_detail.html")
