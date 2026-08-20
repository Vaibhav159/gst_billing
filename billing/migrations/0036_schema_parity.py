# Schema parity with production, found the hard way during the 20 Aug product-
# master cleanup:
#
# 1. Prod's billing_product carries a legacy NOT NULL `description` column that
#    no migration ever created (V1-era drift) — so the ORM's INSERT omitted it
#    and every product creation on prod died with a NotNullViolation. This
#    brings the column back under Django's management. The DDL is vendor-aware
#    and idempotent because the column already exists on prod but not on any
#    migration-built database (CI Postgres, scratch SQLite).
#
# 2. gst_tax_rate was numeric(12,3) on Product AND LineItem — three decimal
#    places cannot represent the 0.25% diamond/stone rate (0.0025), which
#    silently rounded to 0.003. Widened to numeric(13,4).

import django.core.validators
from decimal import Decimal
from django.db import migrations, models


def _add_description(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            "ALTER TABLE billing_product "
            "ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''"
        )
        # On prod the column pre-exists WITHOUT a default; make it safe either way.
        schema_editor.execute(
            "ALTER TABLE billing_product ALTER COLUMN description SET DEFAULT ''"
        )
    else:  # sqlite — migration-built DBs never have the column yet
        schema_editor.execute(
            "ALTER TABLE billing_product "
            "ADD COLUMN description text NOT NULL DEFAULT ''"
        )


def _drop_description(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute("ALTER TABLE billing_product DROP COLUMN IF EXISTS description")
    else:
        schema_editor.execute("ALTER TABLE billing_product DROP COLUMN description")


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0035_user_preference'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='product',
                    name='description',
                    field=models.TextField(blank=True, default='', help_text='Free-text note shown on the product page.'),
                ),
            ],
            database_operations=[
                migrations.RunPython(_add_description, _drop_description),
            ],
        ),
        migrations.AlterField(
            model_name='lineitem',
            name='gst_tax_rate',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.03'), help_text='GST Tax Rate of the product.', max_digits=13, verbose_name='GST Tax Rate'),
        ),
        migrations.AlterField(
            model_name='product',
            name='gst_tax_rate',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.03'), help_text='GST Tax Rate of the product.', max_digits=13, validators=[django.core.validators.MinValueValidator(Decimal('0.00')), django.core.validators.MaxValueValidator(Decimal('1.00'))], verbose_name='GST Tax Rate'),
        ),
    ]
