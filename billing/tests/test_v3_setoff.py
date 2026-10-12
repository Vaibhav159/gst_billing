import json
from decimal import Decimal
from pathlib import Path

import pytest

from billing.tax_rules import set_off

VECTORS = json.loads((Path(__file__).parents[2] / "web/src/core/gst/setoff.vectors.json").read_text())


def money(value):
    if isinstance(value, dict):
        return {key: money(item) for key, item in value.items()}
    if isinstance(value, list):
        return [money(item) for item in value]
    return Decimal(value) / 100 if isinstance(value, int) else value


@pytest.mark.parametrize("vector", VECTORS, ids=lambda row: row["name"])
def test_shared_hand_worked_vectors(vector):
    assert set_off(money(vector["output"]), money(vector["credit"])) == money(vector["expected"])


@pytest.mark.parametrize("bad", ["-0.01", "NaN", "Infinity"])
def test_setoff_rejects_invalid_money(bad):
    with pytest.raises(ValueError, match="finite, non-negative"):
        set_off({"igst": bad}, {})


def test_setoff_rounds_half_up_before_allocating_and_does_not_mutate():
    output, credit = {"cgst": Decimal("0.015")}, {"igst": Decimal("0.005")}
    result = set_off(output, credit)
    assert result["cash"]["cgst"] == Decimal("0.01")
    assert output["cgst"] == Decimal("0.015")
    assert credit["igst"] == Decimal("0.005")
