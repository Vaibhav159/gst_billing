"""JSON that is nested too deeply is the client's mistake: a 400, never a 500 (part 7, Ruling 7-D15).

DRF's JSONParser turns a ValueError into a ParseError but lets RecursionError through, so a body like
"[[[[…" a hundred thousand deep was a 500 on every JSON endpoint, the unauthenticated sign-in included.
"""
from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser

TOO_DEEP = "JSON parse error - the data is nested too deeply."


class SafeJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        try:
            return super().parse(stream, media_type, parser_context)
        except RecursionError:
            raise ParseError(TOO_DEEP) from None
