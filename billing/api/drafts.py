"""/api/drafts/: unfinished sales bills, shop-wide (part 1 API contract, section 4)."""

import json
import math
import uuid

from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef
from django.http import Http404
from rest_framework import serializers, viewsets
from rest_framework.response import Response

from billing.models import Business, SaleDraft, SavedDraft
from billing.params import PICK_A_FIRM, id_param
from billing.services.drafts import saved_already
from billing.text import person, stamp

from .auth import DynamicScopedRateThrottle
from .body import UNSTORABLE, Picked, valid
from .permissions import V3Permission

NEEDS_DATA = "An unfinished bill needs its data."
TOO_BIG = "This unfinished bill is too big to keep (over 64 KB). Save it as a bill, or start a new one."
# The most the list sends (contract 4), newest change first.
LISTED = 500
# How deep a draft's data may nest, the data itself the first level: a bill form's state is a few levels deep. Deeper
# is no bill's, and nesting without end would outrun the encoders' own recursion.
DEEPEST = 32
# What a draft is read in: everything it answers, and of who started it, only what names them (Rulings 1A-36, 1A-39).
STARTER = ("started_by__username", "started_by__first_name", "started_by__last_name")
LISTED_FIELDS = ("id", "business", "data", "created_at", "updated_at", *STARTER)
# A keep sends the data and gets it back: the stored data is never read.
KEPT_FIELDS = ("id", "business", "created_at", "updated_at", *STARTER)


def storable(data):
    """`data` as a JSON column can keep it and any answer can carry it, or None when it can't be kept at all.

    What no column can store (a null character, half an emoji) is dropped from every text and key, as typed text is
    elsewhere. A number no JSON can carry (1e400 reads as infinity), or nesting deeper than DEEPEST, makes it no bill's
    data. Walked without recursion, so no nesting can make it fail.
    """
    kept = {}
    pending = [(data, kept, 1)]
    while pending:
        source, copy, depth = pending.pop()
        if depth > DEEPEST:
            return None
        for key, value in (source.items() if isinstance(source, dict) else enumerate(source)):
            if isinstance(value, dict | list):
                inner = {} if isinstance(value, dict) else [None] * len(value)
                pending.append((value, inner, depth + 1))
                value = inner
            elif isinstance(value, str):
                value = UNSTORABLE.sub("", value)
            elif isinstance(value, float) and not math.isfinite(value):
                return None
            copy[UNSTORABLE.sub("", key) if isinstance(copy, dict) else key] = value
    return kept


class DraftData(serializers.Field):
    """A draft's `data`: the form's own state, a JSON object of at most 64 KB as the client sends it (compact JSON in
    UTF-8). Missing, null or anything but an object: the contract's one sentence (Ruling 1A-5)."""

    def __init__(self):
        super().__init__(error_messages=dict.fromkeys(("required", "null"), NEEDS_DATA))

    def to_internal_value(self, data):
        kept = storable(data) if isinstance(data, dict) else None
        if kept is None:
            raise serializers.ValidationError(NEEDS_DATA)
        if len(json.dumps(kept, ensure_ascii=False, separators=(",", ":")).encode()) > SaleDraft.MAX_BYTES:
            raise serializers.ValidationError(TOO_BIG)
        return kept

    def to_representation(self, value):
        return value


class DraftSerializer(serializers.Serializer):
    business = Picked(Business, PICK_A_FIRM, fields=("id",), required=False, allow_null=True, default=None)
    data = DraftData()


def draft_key(pk):
    """The draft's UUID from the path, or a 404 in words."""
    try:
        return uuid.UUID(pk)
    except ValueError:
        raise Http404("No draft has that id.") from None


def draft_row(draft):
    """A Draft (contract 4)."""
    return {"id": str(draft.pk), "business": draft.business_id, "started_by": person(draft.started_by),
            "data": draft.data, "created_at": stamp(draft.created_at), "updated_at": stamp(draft.updated_at)}


class DraftViewSet(viewsets.GenericViewSet):
    """Everyone who may make bills sees and finishes every draft, with who started it. Nothing polls: the client sends
    a draft as it's kept, and asks for the list as a bill form opens and as the network comes back."""

    permission_classes = [V3Permission]
    # A keep is a request at every pause while a bill is typed, so drafts have their own rate (Ruling 1A-42): a day of
    # the paper book never spends the user's daily requests, which its saves need, and the rate still caps a runaway.
    throttle_classes = [DynamicScopedRateThrottle]
    throttle_scope = "drafts"
    # Any id reaches the view, so one that isn't a draft's is the 404 in words, never Django's page.
    lookup_value_regex = "[^/]+"
    v3_actions = {"list": "bill.create", "update": "bill.create", "destroy": "bill.create"}

    def list(self, request):
        """GET drafts/: the shop's drafts, newest change first, at most LISTED; business_id narrows them to one firm
        (Ruling 1A-33: an id not on file matches none). A draft whose bill was saved while a keep of it raced the save
        is left out (and goes with its next keep or discard). One read, never a write (Ruling 1A-16)."""
        drafts = (SaleDraft.objects.select_related("started_by").only(*LISTED_FIELDS)
                  .exclude(Exists(SavedDraft.objects.filter(pk=OuterRef("pk")))))
        firm = id_param(request.query_params, "business_id", PICK_A_FIRM)
        if firm is not None:
            drafts = drafts.filter(business_id=firm)
        return Response({"results": [draft_row(d) for d in drafts.order_by("-updated_at")[:LISTED]]})

    def update(self, request, pk=None):
        """PUT drafts/{uuid}/: make it (201) or replace it (200); who started it stays.

        The draft's row is locked first. A bill being saved from the draft deletes it as the save begins, right after
        claiming it (billing.services.drafts.claim), and holds that lock until the save ends: a keep that comes while
        the bill is made waits for the save, then finds the draft saved (409 draft_saved), and never makes it again. A
        saved draft is refused before its body is read: the client lets it go either way.
        """
        key = draft_key(pk)
        with transaction.atomic():
            locked = SaleDraft.objects.select_for_update(of=("self",)).select_related("started_by").only(*KEPT_FIELDS)
            draft = locked.filter(pk=key).first()
            saved = SavedDraft.objects.filter(pk=key).first()
            if saved is None:
                body = valid(DraftSerializer, request.data)
                made = draft is None
                if made:
                    try:
                        with transaction.atomic():
                            draft = SaleDraft.objects.create(id=key, started_by=request.user, **body)
                    except IntegrityError:  # another keep made this new draft a moment before: this one replaces it
                        draft, made = locked.get(pk=key), False
                if not made:
                    draft.business, draft.data = body["business"], body["data"]
                    draft.save(update_fields=["business", "data", "updated_at"])
            elif draft is not None:
                draft.delete()  # made again by a keep that raced its save: it goes the way the save took it
        if saved is not None:
            raise saved_already(saved)
        return Response(draft_row(draft), status=201 if made else 200)

    def destroy(self, request, pk=None):
        """204, also when it's gone already: a draft deleted offline syncs once however often it's sent."""
        SaleDraft.objects.filter(pk=draft_key(pk)).delete()
        return Response(status=204)
