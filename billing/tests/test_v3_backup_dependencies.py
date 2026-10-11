"""X-40: real predecessor checks; run after the named plans land, without stand-ins."""

import json
from importlib import import_module
from importlib.util import find_spec

import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.tests.v3_helpers import person

pytestmark = pytest.mark.django_db(transaction=True)


def predecessor(module, reason):
    if find_spec(module) is None:
        pytest.skip(reason)
    return import_module(module)


def download(view, user, params=None, **kwargs):
    request = APIRequestFactory().get("/api/backup/full/", params or {})
    force_authenticate(request, user=user)
    return view.as_view()(request, **kwargs)


def test_real_filing_backup_provider_preserves_its_three_collections():
    filing = predecessor("billing.services.filing", "Runs after 3A's filing.backup_rows lands (X-40).")
    from billing.api.backups import BackupFullView
    from billing.services.backups import json_value

    expected = filing.backup_rows()
    assert set(expected) == {"filing_records", "filing_months", "opening_credits"}
    assert all(isinstance(value, list) for value in expected.values())
    owner = person("filing-backup-owner", "admin")
    data = json.loads(b"".join(download(BackupFullView, owner).streaming_content))
    assert data["v3"]["filing"] == json.loads(json.dumps(expected, default=json_value))
