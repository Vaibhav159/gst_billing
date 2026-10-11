from datetime import date

from billing.models import FilingMonth, FilingRecord, OpeningCredit, ReturnDownload


def test_new_models_keep_foreign_keys_additive():
    for model in (FilingRecord, FilingMonth, OpeningCredit, ReturnDownload):
        assert not model._meta.get_field("business").db_constraint
    assert OpeningCredit._meta.get_field("as_of").get_default() == date(2025, 4, 1)

