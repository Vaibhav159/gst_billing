# Generated by Django 4.0.6 on 2023-01-27 13:54

import django.db.models.deletion
import simple_history.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("billing", "0009_alter_customer_name"),
    ]

    operations = [
        migrations.CreateModel(
            name="HistoricalInvoice",
            fields=[
                (
                    "id",
                    models.BigIntegerField(
                        auto_created=True, blank=True, db_index=True, verbose_name="ID"
                    ),
                ),
                ("created_at", models.DateTimeField(blank=True, editable=False)),
                ("updated_at", models.DateTimeField(blank=True, editable=False)),
                (
                    "invoice_number",
                    models.CharField(
                        help_text="Invoice Number of the invoice.",
                        max_length=255,
                        verbose_name="Invoice Number",
                    ),
                ),
                (
                    "total_amount",
                    models.DecimalField(
                        decimal_places=3,
                        default=0,
                        help_text="Total Amount of the invoice.",
                        max_digits=12,
                        verbose_name="Total Amount",
                    ),
                ),
                (
                    "invoice_date",
                    models.DateField(help_text="Date at which invoice was raised."),
                ),
                ("history_id", models.AutoField(primary_key=True, serialize=False)),
                ("history_date", models.DateTimeField(db_index=True)),
                ("history_change_reason", models.CharField(max_length=100, null=True)),
                (
                    "history_type",
                    models.CharField(
                        choices=[("+", "Created"), ("~", "Changed"), ("-", "Deleted")],
                        max_length=1,
                    ),
                ),
                (
                    "business",
                    models.ForeignKey(
                        blank=True,
                        db_constraint=False,
                        help_text="Business of the invoice.",
                        null=True,
                        on_delete=django.db.models.deletion.DO_NOTHING,
                        related_name="+",
                        to="billing.business",
                        verbose_name="Business",
                    ),
                ),
                (
                    "customer",
                    models.ForeignKey(
                        blank=True,
                        db_constraint=False,
                        help_text="Customer of the invoice.",
                        null=True,
                        on_delete=django.db.models.deletion.DO_NOTHING,
                        related_name="+",
                        to="billing.customer",
                        verbose_name="Customer",
                    ),
                ),
                (
                    "history_user",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "historical invoice",
                "verbose_name_plural": "historical invoices",
                "ordering": ("-history_date", "-history_id"),
                "get_latest_by": ("history_date", "history_id"),
            },
            bases=(simple_history.models.HistoricalChanges, models.Model),
        ),
    ]
