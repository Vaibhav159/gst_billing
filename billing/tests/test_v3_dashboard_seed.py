from datetime import date
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.test import override_settings

from billing.management.commands.seed_sandbox import Command
from billing.models import RateBoard


@pytest.mark.django_db
def test_seed_rate_history_skips_today_and_resets_cleanly(tmp_path):
    with (override_settings(MEDIA_ROOT=tmp_path), patch.object(Command, "_assert_sandbox"),
          patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=date(2026, 10, 8))):
        for args in ([], ["--reset"]):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=StringIO(), stderr=StringIO())
            assert RateBoard.objects.count() == 27
            assert not RateBoard.objects.filter(on=date(2026, 10, 8)).exists()
            assert RateBoard.objects.filter(on=date(2026, 10, 7)).count() == 2
            assert RateBoard.objects.filter(set_by__username="sandbox_owner").count() == 27
