# Backend (Django) — agent guide

Django 5.2 LTS + DRF + SimpleJWT on Postgres (Neon). This app owns the whole
money domain: invoices, line items, inward bills, GST returns, audit log.
The API surface is `billing/api/`; nothing else is public.
Root conventions: [`../AGENTS.md`](../AGENTS.md).

## Setup & commands

```bash
source .venv/bin/activate
python manage.py migrate            # dev DB (gst_billing/local.py DATABASES_DEV)
python manage.py runserver
.venv/bin/python -m pytest billing/                        # 246 tests, SQLite in-memory
.venv/bin/python -m pytest billing/tests/test_tax_heads.py # one file
.venv/bin/pre-commit run --all-files    # black + ruff (not installed standalone)
```

Settings modules: `gst_billing/settings.py` (dev, `DEBUG = True`),
`gst_billing/test_settings.py` (SQLite in-memory — what pytest uses),
`gst_billing/production_settings.py` (Postgres via `DB_*` env vars).

## Layout

- `models.py` — all models (877 lines). Invoice, LineItem, Business, Customer,
  Product, AuditLog, FiledPeriod.
- `tax_rules.py` — **authoritative** interstate/head logic. Import it; do not re-derive.
- `api/views.py` — DRF viewsets and APIViews (large; find by class name).
- `api/serializers.py` — wire format. Most are `fields = "__all__"`.
- `api/urls.py` — router registrations plus explicit paths **before** the router.
- `api/permissions.py` — `RoleBasedPermission`, `get_user_role`.
- `api/mixins.py` — `AuditLogMixin`, snapshots create/update/delete for undo.
- `services/`, `reconciliation.py`, `gstin.py`, `period_lock.py` — domain helpers.
- `management/commands/` — `fix_tax_heads`, `import_gstr2a`, `setup_roles`.

## Patterns

- **Deciding IGST vs CGST+SGST** — DO: `tax_rules.is_interstate(business, customer)`,
  which falls back to `state_name` for unregistered/B2C parties.
  DON'T: the `Invoice.is_igst_applicable` property at `models.py:373` — it reads
  GSTIN prefixes only, so a B2C interstate sale returns `False` and books
  CGST+SGST. It is still fine as a *display* hint on registered parties; it is
  not fine for deciding what to store.
- **Writing tax heads** — pass through `tax_rules.normalize_tax_heads()` so the
  total the user saw is preserved while the head is corrected. See
  `management/commands/fix_tax_heads.py` for the repair pass over existing rows.
- **New endpoints** — register in `api/urls.py`; explicit paths go **above**
  `include(router.urls)` or the router's `<pk>` swallows them. Give every view a
  permission class; ungrouped users are viewers by default.
- **Audit + undo** — mix in `AuditLogMixin` and set `audit_entity`. FK snapshots
  store the id (`business_id`), not `__str__`, or undo cannot restore relations.
- **Money** — `Decimal` throughout. Never accumulate tax in a float.

## Tests

`pytest` only. `manage.py test billing` **aborts with an ImportError**: the empty
27-byte `billing/tests.py` stub shadows the `billing/tests/` package. Do not
delete or "fix" the stub as a drive-by — check what imports it first.

Tests live in `tests/`, one file per area, `test_*.py`. `tests/test_base.py` has
shared setup. Config is in `pyproject.toml` under `[tool.pytest.ini_options]`
(`DJANGO_SETTINGS_MODULE = gst_billing.test_settings`).

## Gotchas

- `serializers.py` mostly uses `fields = "__all__"`, so renaming a model field
  changes the API silently. Grep the new and old names in
  `../sweet-rebuild-suite-main/src/` before merging.
- Line-item construction exists in several places (invoice write path, bulk
  import, CSV import, AI import, inward bills) with different money contracts.
  Fixing one is rarely enough — grep for the others.
- `django-cacheops` caches `billing.Invoice` / `billing.LineItem`. Raw deletes
  bypass invalidation; prefer the ORM's `delete()`.
- `gst_billing/local.py` contains the prod DSN. `GST_DB=prod` alone is refused;
  it also needs `GST_ALLOW_PROD=1`. Leave both unset.

## Before you push

```bash
.venv/bin/python -m pytest billing/ -x --tb=short
.venv/bin/python manage.py makemigrations --check --dry-run
```
