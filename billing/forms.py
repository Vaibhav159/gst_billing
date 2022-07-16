from django import forms

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
