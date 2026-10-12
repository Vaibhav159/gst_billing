from datetime import date

import pytest

from billing.models import FilingMonth, FilingRecord, OpeningCredit, ReturnDownload


def test_new_models_keep_foreign_keys_additive():
    for model in (FilingRecord, FilingMonth, OpeningCredit, ReturnDownload):
        assert not model._meta.get_field("business").db_constraint
    assert OpeningCredit._meta.get_field("as_of").get_default() == date(2025, 4, 1)



@pytest.mark.django_db
@pytest.mark.parametrize("model", [FilingRecord, FilingMonth, ReturnDownload])
def test_filing_tables_refuse_a_month_outside_1_to_12(model):
    from django.core.exceptions import ValidationError
    from django.db import IntegrityError, transaction

    from billing.models import Business

    firm = Business.objects.create(name="Kiran")
    more = {"kind": "gstr1", "filed_on": date(2026, 10, 8)} if model is FilingRecord else (
        {"kind": "gstr1", "fingerprint": "x"} if model is ReturnDownload else {})
    with pytest.raises(ValidationError) as exc:
        model(business=firm, year=2026, month=13, **more).full_clean()
    assert "Pick a month from 1 to 12." in str(exc.value)
    for month in (0, 13):
        with pytest.raises(IntegrityError), transaction.atomic():
            model.objects.create(business=firm, year=2026, month=month, **more)
