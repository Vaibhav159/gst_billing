"""Shared set-up for part 1's server tests: people in each role (Task 2 adds firms and bills)."""

from django.contrib.auth.models import Group, User
from rest_framework.test import APIClient

from billing.roles import GROUP_ACCOUNTANT, GROUP_STAFF

ROLE_GROUPS = {"owner": ("admin",), "accountant": (GROUP_ACCOUNTANT, "editor"),
               "staff": (GROUP_STAFF, "editor"), "viewer": ("viewer",)}


def person(username, *groups, superuser=False, first_name="", last_name=""):
    """A user in `groups`, loaded afresh the way each request loads one."""
    u = User.objects.create_user(username=username, password="x", is_superuser=superuser,
                                 first_name=first_name, last_name=last_name)
    for g in groups:
        u.groups.add(Group.objects.get_or_create(name=g)[0])
    return User.objects.get(pk=u.pk)


def client_for(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c
