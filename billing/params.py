"""Query parameters v3's endpoints share, read once, with the words of their 400s."""

from rest_framework.exceptions import ValidationError

from billing.fy import parse_fy


def fy_param(params):
    """`fy` ("2026-27") as the year it starts; None when absent."""
    if not params.get("fy"):
        return None
    fy = parse_fy(params["fy"])
    if fy is None:
        raise ValidationError({"fy": ["Give the financial year like 2026-27."]})
    return fy
