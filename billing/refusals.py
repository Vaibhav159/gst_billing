"""The refusals v3's endpoints send: 409 {"detail": words, "code": what, ...more}.

DRF turns every value in an exception's detail into a string ("7" for 7); a Refusal keeps its
body as given, so ids and counters stay numbers (part 1 API contract, section 1).
"""

from rest_framework import status
from rest_framework.exceptions import APIException


class Refusal(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, detail, code, status_code=None, **more):
        super().__init__(detail, code)
        if status_code:
            self.status_code = status_code
        self.detail = {"detail": detail, "code": code, **more}
