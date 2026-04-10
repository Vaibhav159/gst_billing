"""Management command to create default user roles (groups)."""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group


class Command(BaseCommand):
    help = "Create default user roles: admin, editor, viewer"

    def handle(self, *args, **options):
        roles = ["admin", "editor", "viewer"]
        for role in roles:
            group, created = Group.objects.get_or_create(name=role)
            if created:
                self.stdout.write(self.style.SUCCESS(f"Created group: {role}"))
            else:
                self.stdout.write(f"Group already exists: {role}")

        self.stdout.write(self.style.SUCCESS("Done. Assign users to groups via admin or /api/users/ endpoint."))
