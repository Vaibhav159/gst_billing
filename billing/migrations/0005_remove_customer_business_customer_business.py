# Generated by Django 4.0.6 on 2022-10-02 11:26

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0004_remove_invoice_line_items_lineitem_invoice"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="customer",
            name="business",
        ),
        migrations.AddField(
            model_name="customer",
            name="business",
            field=models.ManyToManyField(
                help_text="Businesses associated of the customer.",
                to="billing.business",
                verbose_name="Businesses",
            ),
        ),
    ]
