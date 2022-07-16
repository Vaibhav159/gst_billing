from crispy_forms.helper import FormHelper
from crispy_forms.layout import Submit
from django import forms
from django.urls import reverse_lazy

from billing.models import Customer


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
