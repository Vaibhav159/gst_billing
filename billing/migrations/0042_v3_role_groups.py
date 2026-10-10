"""Create the v3 role groups. Add-only: v2 never reads them, and leaving them on a rollback is harmless."""

from django.db import migrations

NEW_GROUPS = ("accountant", "counter_staff")


def create_groups(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for name in NEW_GROUPS:
        Group.objects.get_or_create(name=name)


class Migration(migrations.Migration):
    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("billing", "0041_lineitem_customer_protect"),
    ]
    operations = [migrations.RunPython(create_groups, migrations.RunPython.noop)]
