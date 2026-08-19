# Product.default_unit — the unit a new invoice line adopts when this product
# is picked. Backfills every existing product with "gms" (the jewellery
# default the UI already assumed everywhere).

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0033_outward_number_unique_per_fy"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="default_unit",
            field=models.CharField(
                choices=[
                    ("gms", "Grams (gms)"),
                    ("g", "Grams (g)"),
                    ("kg", "Kilograms (kg)"),
                    ("pcs", "Pieces (pcs)"),
                    ("unit", "Unit"),
                    ("nos", "Numbers (nos)"),
                    ("mtr", "Meters (mtr)"),
                    ("ltr", "Litres (ltr)"),
                    ("ml", "Millilitres (ml)"),
                    ("box", "Box"),
                    ("pair", "Pair"),
                    ("ct", "Carat (ct)"),
                    ("oz", "Ounce (oz)"),
                    ("tola", "Tola"),
                    ("set", "Set"),
                    ("dozen", "Dozen"),
                ],
                default="gms",
                help_text="Unit a new invoice line starts with when this product is picked.",
                max_length=20,
                verbose_name="Default Unit",
            ),
        ),
    ]
