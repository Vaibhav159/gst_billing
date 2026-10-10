"""How v3's endpoints write values: money, timestamps, people (part 1 API contract, section 0)."""

from django.utils import timezone


def stamp(moment):
    """An aware datetime as ISO 8601 in IST ("2026-10-08T10:42:05.123456+05:30"), or None."""
    return timezone.localtime(moment).isoformat() if moment else None


def person(user):
    """{"id", "name"} for a user (the full name, else the username), or None."""
    if user is None:
        return None
    return {"id": user.pk, "name": user.get_full_name() or user.username}
