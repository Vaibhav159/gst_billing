"""v3 keeps a rollback to v2 possible (design §5.1, §8; plan 1A Tasks 2 and 3).

v2's images must run unchanged on the migrated database. So part 1's migrations only add tables
and columns, and every column added to a table v2 writes is nullable or has a database default.
"""

from django.db import migrations, models
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase

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
