"""P4-15 M6: spreadsheet formulas stay text after leading whitespace."""
import pytest

from billing.api.audit import safe_cell


@pytest.mark.parametrize("value", ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1", " =1+1", " \t\r +1"])
def test_formula_cells_are_escaped_without_changing_the_value(value):
    assert safe_cell(value) == "'" + value


@pytest.mark.parametrize("value", ["Kiran Gold", "  ordinary text", "123.45", ""])
def test_ordinary_cells_are_unchanged(value):
    assert safe_cell(value) == value
