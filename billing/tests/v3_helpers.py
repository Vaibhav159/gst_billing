"""Shared set-up for part 1's server tests: people in each role, firms, and bills built the way
the API builds them (billing.services.line_items)."""

from django.contrib.auth.models import Group, User
from rest_framework.test import APIClient

from billing.constants import BILL_ACTIVE
from billing.models import Business, Customer, Invoice, LineItem
from billing.roles import GROUP_ACCOUNTANT, GROUP_STAFF
from billing.services.line_items import build_line_items

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


def firm(name="KIRAN GOLD HOUSE", gstin="08ABCDE1234A1Z5", state="RAJASTHAN", **more):
    return Business.objects.create(name=name, gst_number=gstin, state_name=state, address="12 Sandbox Bazaar",
                                   mobile_number="9000000003", **more)


def buyer(name="Anil Gupta", state="RAJASTHAN", **more):
    return Customer.objects.create(name=name, state_name=state, **more)


def line(rate="10000", qty="1", gst="0.03", hsn="711311", name="Silver", unit="gms"):
    return {"product_name": name, "hsn_code": hsn, "gst_tax_rate": gst, "quantity": qty, "rate": rate, "unit": unit}


def sale(business, customer, number, day, *lines, status=BILL_ACTIVE, kind="outward", **more):
    """A bill with `lines` (default: one ₹10,000 silver line at 3%), its total set as the API sets it."""
    inv = Invoice.objects.create(business=business, customer=customer, invoice_number=number, invoice_date=day,
                                 type_of_invoice=kind, status=status, **more)
    built, total = build_line_items(inv, list(lines) or [line()], source="api")
    LineItem.objects.bulk_create(built)
    Invoice.objects.filter(pk=inv.pk).update(total_amount=total)
    inv.refresh_from_db()
    return inv
