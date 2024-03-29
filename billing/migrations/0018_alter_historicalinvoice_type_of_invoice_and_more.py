# Generated by Django 4.2.2 on 2023-08-06 15:41

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0017_product"),
    ]

    operations = [
        migrations.AlterField(
            model_name="historicalinvoice",
            name="type_of_invoice",
            field=models.CharField(
                choices=[("outward", "Outward"), ("inward", "Inward")],
                default="outward",
                help_text="Type of Invoice.",
                max_length=255,
                verbose_name="Type of Invoice",
            ),
        ),
        migrations.AlterField(
            model_name="invoice",
            name="type_of_invoice",
            field=models.CharField(
                choices=[("outward", "Outward"), ("inward", "Inward")],
                default="outward",
                help_text="Type of Invoice.",
                max_length=255,
                verbose_name="Type of Invoice",
            ),
        ),
    ]
