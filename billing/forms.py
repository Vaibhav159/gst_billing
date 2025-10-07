from crispy_forms.helper import FormHelper
from crispy_forms.layout import Submit
from django import forms
from django.urls import reverse_lazy

from billing.models import Business, Customer, LineItem, Product


class CustomerForm(forms.ModelForm):
    class Meta:
        model = Customer
        fields = "__all__"
        widgets = {
            "pan_number": forms.TextInput(
                attrs={
                    "minlength": "10",
                }
            ),
            "mobile_number": forms.TextInput(
                attrs={
                    "minlength": "10",
                }
            ),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.helper = FormHelper()
        if kwargs.get("instance"):
            self.helper.form_action = reverse_lazy(
                "customer_edit", kwargs={"customer_id": kwargs["instance"].id}
            )
        else:
            self.helper.form_action = reverse_lazy("customer_form")
        self.helper.add_input(
            Submit(
                "submit",
                "Submit",
                css_class="bg-blue-500 hover:bg-blue-700 text-white "
                "font-bold py-2 px-4 rounded",
            )
        )


class LineItemForm(forms.ModelForm):
    """
    ModelForm for LineItem. Includes the unit field and number widgets
    for quantity and rate so unit-aware input is supported in server-side forms.
    """

    class Meta:
        model = LineItem
        fields = "__all__"
        widgets = {
            "quantity": forms.NumberInput(attrs={"step": "0.001", "min": "0"}),
            "rate": forms.NumberInput(attrs={"step": "0.001", "min": "0"}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.helper = FormHelper()
        # Keep form_action generic; override where used if necessary
        self.helper.form_action = reverse_lazy("line_item_form")
        self.helper.add_input(
            Submit(
                "submit",
                "Submit",
                css_class="bg-blue-500 hover:bg-blue-700 text-white "
                "font-bold py-2 px-4 rounded",
            )
        )


class BusinessForm(forms.ModelForm):
    class Meta:
        model = Business
        fields = "__all__"
        widgets = {
            "mobile_number": forms.TextInput(
                attrs={
                    "minlength": "10",
                }
            ),
            "primary_color_theme": forms.TextInput(
                attrs={
                    "type": "color",
                    "style": "width: 25%; padding: 0;",
                },
            ),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.helper = FormHelper()
        if kwargs.get("instance"):
            self.helper.form_action = reverse_lazy(
                "business_edit", kwargs={"business_id": kwargs["instance"].id}
            )
        else:
            self.helper.form_action = reverse_lazy("business_form")
        self.helper.add_input(
            Submit(
                "submit",
                "Submit",
                css_class="bg-blue-500 hover:bg-blue-700 text-white "
                "font-bold py-2 px-4 rounded",
            )
        )


class ProductForm(forms.ModelForm):
    class Meta:
        model = Product
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.helper = FormHelper()
        if kwargs.get("instance"):
            self.helper.form_action = reverse_lazy(
                "product_edit", kwargs={"product_id": kwargs["instance"].id}
            )
        else:
            self.helper.form_action = reverse_lazy("product_form")
        self.helper.add_input(
            Submit(
                "submit",
                "Submit",
                css_class="bg-blue-500 hover:bg-blue-700 text-white "
                "font-bold py-2 px-4 rounded",
            )
        )
