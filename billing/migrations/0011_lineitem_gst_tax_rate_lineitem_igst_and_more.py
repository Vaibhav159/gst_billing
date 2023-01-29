# Generated by Django 4.0.6 on 2023-01-29 10:02

from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0010_historicalinvoice"),
    ]

    operations = [
        migrations.AddField(
            model_name="lineitem",
            name="gst_tax_rate",
            field=models.DecimalField(
                decimal_places=3,
                default=Decimal("0.03"),
                help_text="GST Tax Rate of the product.",
                max_digits=12,
                verbose_name="GST Tax Rate",
            ),
        ),
        migrations.AddField(
            model_name="lineitem",
            name="igst",
            field=models.DecimalField(
                decimal_places=3,
                default=0,
                help_text="IGST of the product.",
                max_digits=10,
                verbose_name="IGST",
            ),
        ),
        migrations.AlterField(
            model_name="lineitem",
            name="cgst",
            field=models.DecimalField(
                decimal_places=3,
                default=0,
                help_text="CGST of the product.",
                max_digits=10,
                verbose_name="CGST",
            ),
        ),
        migrations.AlterField(
            model_name="lineitem",
            name="sgst",
            field=models.DecimalField(
                decimal_places=3,
                default=0,
                help_text="SGST of the product.",
                max_digits=10,
                verbose_name="SGST",
            ),
        ),
    ]
