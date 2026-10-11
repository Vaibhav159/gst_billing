"""Reading a request's body as v3's endpoints do: every refusal in the contract's words (Ruling 1A-5).

Shared by the endpoints, so one view module never imports another for a helper (Task 9's review, minor 2).
"""

# What each field reads from a body that isn't an object: a value no field takes.
_UNUSABLE = object()


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
