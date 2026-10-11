"""Reading a request's body as v3's endpoints do: every refusal in the contract's words (Ruling 1A-5).

Shared by the endpoints, so one view module never imports another for a helper (Task 9's review, minor 2).
"""

import re

from rest_framework import serializers

from billing.cache import uncached

# What each field reads from a body that isn't an object: a value no field takes.
_UNUSABLE = object()

# What no column can store: a null character (psycopg refuses it) and a lone surrogate (no UTF-8 for it).
UNSTORABLE = re.compile("[\x00\ud800-\udfff]")


def valid(serializer_class, data, **kwargs):
    """The validated data, or a 400 with field errors.

    A body that isn't an object (a list, a string) carries nothing usable, so every field refuses
    it in its own words, the contract's: never DRF's "Expected a dictionary", and never an optional
    field passing by default, as a DELETE with no reason would (Ruling 1A-5).
    """
    if not isinstance(data, dict):
        data = dict.fromkeys(serializer_class(**kwargs).fields, _UNUSABLE)
    serializer = serializer_class(data=data, **kwargs)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class Picked(serializers.PrimaryKeyRelatedField):
    """A firm or a customer by its id, read when the request comes, around cacheops (Ruling 1A-34): a bill freezes the
    firm as it is now, and shows the customer as they are. Missing, null, blank, not plain digits (1.5, "٣", true)
    or not on file: the one sentence, `words` (Ruling 1A-5). `fields`: read only these columns, for a caller that only
    needs to know the row is on file (Ruling 1A-39)."""

    def __init__(self, model, words, fields=(), **kwargs):
        self.model, self.fields_read = model, fields
        super().__init__(error_messages=dict.fromkeys(("required", "null", "does_not_exist", "incorrect_type"), words),
                         **kwargs)

    def get_queryset(self):
        rows = uncached(self.model)
        return rows.only(*self.fields_read) if self.fields_read else rows

    def to_internal_value(self, data):
        plain = isinstance(data, str) and data.isascii() and data.isdigit()
        if not (plain or (isinstance(data, int) and not isinstance(data, bool))):
            self.fail("incorrect_type", data_type=type(data).__name__)
        return super().to_internal_value(data)
