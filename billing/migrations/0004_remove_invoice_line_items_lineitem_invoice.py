# Generated by Django 4.0.6 on 2022-09-07 17:50

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        (
            "billing",
            "0003_alter_business_options_alter_customer_mobile_number_and_more",
        ),
    ]

    operations = [
        migrations.RemoveField(
            model_name="invoice",
            name="line_items",
        ),
        migrations.AddField(
            model_name="lineitem",
            name="invoice",
            field=models.ForeignKey(
                default=1,
                help_text="Invoice of the line item.",
                on_delete=django.db.models.deletion.CASCADE,
                to="billing.invoice",
                verbose_name="Invoice",
            ),
            preserve_default=False,
        ),
    ]
