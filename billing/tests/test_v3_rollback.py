"""v3 keeps a rollback to v2 possible (design §5.1, §8; plan 1A Tasks 2 and 3).

v2's images must run unchanged on the migrated database. So part 1's migrations only add tables
and columns, and every column added to a table v2 writes is nullable or has a database default.
"""

from datetime import date
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.db import connection, migrations, models
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone

from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, BinnedInvoice, Business, Customer, FiledPeriod, Invoice, LineItem
from billing.numbering import holder
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

V2_LAST = ("billing", "0042_v3_role_groups")


def part1_migrations():
    loader = MigrationLoader(None, ignore_no_migrations=True)
    names = sorted(n for app, n in loader.disk_migrations if app == "billing" and n > V2_LAST[1])
    return loader, [(n, loader.disk_migrations[("billing", n)]) for n in names]


class AddOnlyMigrationsTest(SimpleTestCase):
    def test_part_1_only_adds_tables_and_columns(self):
        loader, found = part1_migrations()
        self.assertTrue(found)
        v2_models = {name for app, name in loader.project_state(V2_LAST).models if app == "billing"}
        for name, migration in found:
            for op in migration.operations:
                self.assertIsInstance(op, migrations.AddField | migrations.CreateModel, f"{name}: {op!r}")
                fields = [(op.model_name, op.name, op.field)] if isinstance(op, migrations.AddField) else [
                    (op.name.lower(), fname, f) for fname, f in op.fields]
                for model, fname, f in fields:
                    where = f"{name}: {model}.{fname}"
                    if f.is_relation:
                        self.assertFalse(f.db_constraint, f"{where}: a new foreign key needs db_constraint=False")
                    if model in v2_models and not f.null:
                        # v2's inserts leave the column out; v2's __all__ serializers read only `default`.
                        self.assertIsNot(f.db_default, models.NOT_PROVIDED, f"{where}: needs db_default")
                        self.assertTrue(f.has_default(), f"{where}: needs default")


_V2_STATE = None


def v2_model(model_name, app="billing"):
    """The model as v2 knows it: the migration state at 0042, before part 1."""
    global _V2_STATE
    if _V2_STATE is None:
        _V2_STATE = MigrationLoader(None, ignore_no_migrations=True).project_state(V2_LAST).apps
    return _V2_STATE.get_model(app, model_name)


def v2_insert(model_name, /, **values):
    """INSERT a row the way v2's code would: every v2 column, and none of part 1's. Returns its key."""
    model = v2_model(model_name)
    row = {}
    for f in model._meta.concrete_fields:
        if f.primary_key and f.get_internal_type() in ("AutoField", "BigAutoField"):
            continue
        if f.attname in values:
            value = values[f.attname]
        elif getattr(f, "auto_now", False) or getattr(f, "auto_now_add", False):
            value = timezone.now()
        elif f.has_default():
            value = f.get_default()
        elif f.null:
            value = None
        else:
            raise AssertionError(f"v2_insert({model_name!r}) needs {f.attname}")
        row[f.column] = f.get_db_prep_save(value, connection)
    q = connection.ops.quote_name
    sql = (f"INSERT INTO {q(model._meta.db_table)} ({', '.join(q(c) for c in row)}) "
           f"VALUES ({', '.join(['%s'] * len(row))}) RETURNING {q(model._meta.pk.column)}")
    with connection.cursor() as cursor:
        cursor.execute(sql, list(row.values()))
        return cursor.fetchone()[0]


def part1_fields(model, model_name):
    """The fields part 1 added to a v2 table."""
    v2 = {f.column for f in v2_model(model_name)._meta.concrete_fields}
    return [f for f in model._meta.concrete_fields if f.column not in v2]


def v2_undo_delete(entry):
    """What v2's undo does with a "deleted" invoice entry (billing/api/views.py at 0042), written
    with v2's columns only: the bill comes back under a new id, then v2 marks the entry used."""
    fields = {f.name: f for f in v2_model("invoice")._meta.concrete_fields}
    values = {}
    for k, v in entry.snapshot.items():
        if k not in fields or k in ("id", "created_at", "updated_at"):
            continue
        f = fields[k]
        if v is None or v == "None":
            v = None if f.null else ""
        values[f.attname] = f.to_python(v) if v not in (None, "") else v
    new_id = v2_insert("invoice", **values)
    for li in entry.snapshot["line_items"]:
        line_fields = {f.name: f for f in v2_model("lineitem")._meta.concrete_fields}
        v2_insert("lineitem", invoice_id=new_id, customer_id=values["customer_id"],
                  **{k: line_fields[k].to_python(v) for k, v in li.items() if v not in (None, "None")})
    log = AuditLog.objects.create(action="created", entity="invoice", entity_id=new_id, entity_name=entry.entity_name,
                                  details=f"Restored via undo (was #{entry.entity_id})")
    entry.snapshot = {**entry.snapshot, "_undo": {"at": timezone.localtime().isoformat(), "by": None, "log": log.pk}}
    entry.save(update_fields=["snapshot"])
    return new_id


def v2_deletes(model_name, pk, app="billing"):
    """A delete by v2's code: its collector knows v2's tables only, so the bin is left as it was."""
    v2_model(model_name, app).objects.filter(pk=pk).delete()


class V2OnTheMigratedDatabaseTest(TestCase):
    def test_v2_inserts_land_and_read_back_with_part_1_defaults(self):
        biz = v2_insert("business", name="V2 FIRM", address="1 Road", gst_number="08ABCDE1234A1Z5",
                        mobile_number="9000000001", state_name="RAJASTHAN")
        cust = v2_insert("customer", name="V2 BUYER", state_name="RAJASTHAN")
        inv = v2_insert("invoice", business_id=biz, customer_id=cust, invoice_number="501",
                        invoice_date=date(2026, 9, 10), total_amount=Decimal("10300"))
        v2_insert("historicalinvoice", id=inv, business_id=biz, customer_id=cust, invoice_number="501",
                  invoice_date=date(2026, 9, 10), total_amount=Decimal("10300"), created_at=timezone.now(),
                  updated_at=timezone.now(), history_date=timezone.now(), history_type="+")
        v2_insert("lineitem", invoice_id=inv, customer_id=cust, product_name="Silver", hsn_code="711311",
                  quantity=Decimal("1"), rate=Decimal("10000"), cgst=Decimal("150"), sgst=Decimal("150"),
                  amount=Decimal("10300"))
        rows = [(Business.objects.get(pk=biz), "business"), (Customer.objects.get(pk=cust), "customer"),
                (Invoice.objects.get(pk=inv), "invoice"), (LineItem.objects.get(invoice_id=inv), "lineitem"),
                (Invoice.history.filter(id=inv).first(), "historicalinvoice")]
        for row, name in rows:
            for f in part1_fields(type(row), name):
                self.assertEqual(f.value_from_object(row), f.get_default(), f"{name}.{f.name}")
        self.assertEqual(Invoice.objects.counted().filter(pk=inv).count(), 1)

    def test_v2_undo_brings_back_a_bill_v3_deleted(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        biz, cust = firm(), buyer()
        bill = sale(biz, cust, "7", "2026-09-10")
        owner.delete(reverse("sale-detail", args=[bill.pk]), {"reason": "Entered twice"}, format="json")
        entry = AuditLog.objects.get(action="deleted", entity_id=bill.pk)

        new_id = v2_undo_delete(entry)  # after a rollback, in v2

        back = Invoice.objects.get(pk=new_id)
        self.assertEqual((back.invoice_number, back.status, back.total_amount), ("7", "active", bill.total_amount))
        self.assertEqual(back.lineitem_set.count(), 1)
        # forward again on v3: the bin row is stale, and its restore says so
        r = owner.post(reverse("bin-restore", args=[BinnedInvoice.objects.get().pk]))
        self.assertEqual((r.status_code, r.data["code"], r.data["bill"]["id"]), (409, "already_restored", new_id))
        self.assertEqual(r.data["detail"], "7 is back already: it was restored from the Audit log.")  # Ruling 1A-9
        self.assertEqual(owner.get(reverse("bin-list")).data["results"], [])
        # Ruling 1A-6: v2 renumbered it meanwhile. The stale row holds no number, and the restore still
        # names the bill v2 brought back.
        Invoice.objects.filter(pk=new_id).update(invoice_number="8")
        self.assertIsNone(holder(biz.pk, 2026, "7"))
        r = owner.post(reverse("bin-restore", args=[BinnedInvoice.objects.get().pk]))
        self.assertEqual((r.data["code"], r.data["bill"]["id"]), ("already_restored", new_id))

    def test_the_bin_still_lists_bills_whose_customer_firm_or_deleter_v2_deleted(self):
        # Ruling 1A-6: in the rollback window v2 deletes customers, firms and users without knowing the
        # bin. Their rows still list (the count and the page agree), with the names the bill had, and
        # nothing 500s: a restore says why it can't.
        deleter = person("rakesh", *ROLE_GROUPS["owner"], first_name="Rakesh", last_name="Soni")
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        biz, cust = firm(), buyer()
        binned, _entry = bin_bill(sale(biz, cust, "7", "2026-09-10"), deleter, "Entered twice")
        v2_deletes("customer", cust.pk)
        v2_deletes("business", biz.pk)
        v2_deletes("user", deleter.pk, app="auth")
        self.assertFalse(Business.objects.filter(pk=biz.pk).exists())

        r = owner.get(reverse("bin-list"))
        self.assertEqual((r.status_code, r.data["count"], len(r.data["results"])), (200, 1, 1))
        row = r.data["results"][0]
        self.assertEqual((row["business_name"], row["customer"], row["deleted_by"]),
                         ("KIRAN GOLD HOUSE", {"id": cust.pk, "name": "Anil Gupta"}, None))
        self.assertEqual(owner.get(reverse("bin-list"), {"q": "anil"}).data["count"], 1)

        r = owner.post(reverse("bin-restore", args=[binned.pk]))
        self.assertEqual((r.status_code, r.data["code"]), (409, "firm_gone"))
        self.assertEqual(r.data["detail"], "The firm on this bill was deleted, so it can't come back as it was. "
                                           "Make the bill again in the right firm.")


class PrepareV2RollbackTest(TestCase):
    def setUp(self):
        self.biz, self.cust = firm(), buyer()
        self.live = sale(self.biz, self.cust, "1", "2026-09-10")
        self.dead = sale(self.biz, self.cust, "2", "2026-09-10", status=BILL_CANCELLED,
                         cancel_reason="Customer returned it")

    def run_command(self, *args):
        out = StringIO()
        call_command("prepare_v2_rollback", *args, stdout=out)
        return out.getvalue()

    def test_a_dry_run_changes_nothing(self):
        out = self.run_command()
        self.assertIn("KIRAN GOLD HOUSE 2 of 2026-09-10: cancelled (Customer returned it)", out)
        self.assertIn("Dry run", out)
        self.assertTrue(Invoice.objects.filter(pk=self.dead.pk).exists())

    def test_there_and_back(self):
        self.run_command("--apply")
        self.assertEqual(list(Invoice.objects.values_list("invoice_number", flat=True)), ["1"])  # what v2 will count
        binned = BinnedInvoice.objects.get()
        self.assertEqual((binned.kind, binned.original_id), ("cancelled", self.dead.pk))
        entry = AuditLog.objects.get(pk=binned.audit_log_id)
        self.assertEqual(entry.details, "Cancelled in v3, set aside for v2: Customer returned it")

        self.run_command("--reverse", "--apply")
        back = Invoice.objects.get(pk=self.dead.pk)
        self.assertEqual((back.status, back.cancel_reason), (BILL_CANCELLED, "Customer returned it"))
        binned.refresh_from_db()
        self.assertIsNotNone(binned.restored_at)

    def test_a_filed_month_moves_too(self):
        # Like every repair command, it bypasses the month locks both ways.
        FiledPeriod.objects.create(business=self.biz, year=2026, month=9)
        self.run_command("--apply")
        self.assertEqual(BinnedInvoice.objects.get().original_id, self.dead.pk)
        self.run_command("--reverse", "--apply")
        self.assertEqual(Invoice.objects.get(pk=self.dead.pk).status, BILL_CANCELLED)

    def test_reverse_leaves_a_bill_whose_number_was_taken(self):
        self.run_command("--apply")
        sale(self.biz, self.cust, "2", "2026-09-11")  # made in v2 meanwhile
        out = self.run_command("--reverse", "--apply")
        self.assertIn("2: left in the bin. 2 is already used in FY 2026-27", out)
        self.assertIsNone(BinnedInvoice.objects.get().restored_at)
