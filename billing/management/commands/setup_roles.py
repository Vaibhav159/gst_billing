"""Management command to create default user roles (groups)."""
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the user roles: admin, editor, viewer, and v3's accountant and counter_staff"

    def handle(self, *args, **options):
        roles = ["admin", "editor", "viewer", "accountant", "counter_staff"]
        for role in roles:
            _group, created = Group.objects.get_or_create(name=role)
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created group: {role}"))
            else:
                self.stdout.write(f"Group already exists: {role}")

        self.stdout.write(self.style.SUCCESS("Done. Assign users to groups via admin or /api/users/ endpoint."))
