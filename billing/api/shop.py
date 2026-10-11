"""/api/shop-settings/: the shop's printing and sharing defaults (part 1 API contract, section 5)."""

import re

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.cache import uncached
from billing.models import AuditLog, Business, ShopSetting
from billing.text import person, stamp

from .body import Picked, valid
from .permissions import V3Permission

COPIES_WORDS = "Choose Original, Duplicate, Triplicate or All three."
BANK_WORDS = "Choose whether bills show the bank details."
MESSAGE_LONG = "Keep the message to 500 characters."
MESSAGE_WORDS = "Write a message, or put back the standard one."  # the prototype's Settings words


class ShareMessage(serializers.CharField):
    """The message sent with each bill, refused in the contract's words when it's too long and in the prototype's
    for anything else it can't keep (blank, null, not text, a null character): never DRF's (Ruling 1A-5)."""

    def run_validation(self, data=serializers.empty):
        try:
            return super().run_validation(data)
        except serializers.ValidationError:
            too_long = isinstance(data, str) and len(data.strip()) > self.max_length
            raise serializers.ValidationError(MESSAGE_LONG if too_long else MESSAGE_WORDS) from None


class ShopSettingSerializer(serializers.ModelSerializer):
    share_message = ShareMessage(max_length=500)
    default_business = Picked(Business, "Pick a firm from the list.", fields=("id", "name"), allow_null=True, required=False)

    def validate_share_message(self, value):
        placeholders = re.findall(r"\{([^{}]*)\}", value)
        rest = re.sub(r"\{[^{}]*\}", "", value)
        if "{" in rest or "}" in rest:
            raise serializers.ValidationError("A brace is left open. Each placeholder needs { and }.")
        unknown = sorted(set(placeholders) - {"customer", "number", "total", "firm", "date"})
        if unknown:
            names = ", ".join("{" + name + "}" for name in unknown)
            verb = "isn't" if len(unknown) == 1 else "aren't"
            raise serializers.ValidationError(f"{names} {verb} something the app can fill in. Use {{customer}}, {{number}}, {{total}}, {{firm}} or {{date}}.")
        return value

    class Meta:
        model = ShopSetting
        fields = ["copies", "show_bank", "share_message", "default_business"]
        extra_kwargs = {
            "copies": {"error_messages": {"invalid_choice": COPIES_WORDS, "null": COPIES_WORDS}},
            "show_bank": {"error_messages": {"invalid": BANK_WORDS, "null": BANK_WORDS}},
        }


def shown(setting):
    """ShopSettings (contract 5)."""
    name = uncached(Business).filter(pk=setting.default_business_id).values_list("name", flat=True).first() if setting.default_business_id else None
    return {"default_business": setting.default_business_id, "default_business_name": name,
            "copies": setting.copies, "show_bank": setting.show_bank, "share_message": setting.share_message,
            "updated_at": stamp(setting.updated_at), "updated_by": person(setting.updated_by)}


class ShopSettingsView(APIView):
    """Anyone reads them; only the owner changes them ("Make these the default" on the print page)."""

    permission_classes = [V3Permission]
    v3_actions = {"PUT": "settings.edit"}

    def get(self, request):
        return Response(shown(ShopSetting.load()))  # the defaults until someone saves: reading never writes

    def put(self, request):
        data = valid(ShopSettingSerializer, request.data, partial=True)  # any of the three
        with transaction.atomic():
            # The row locked, so two saves at once can't both make it or lose each other's change. A save that
            # changes nothing writes nothing, so the "last changed" stamp agrees with the audit log; on a fresh
            # database the row is made with the defaults and no stamp, which reads exactly as before. The last changer
            # is joined (only the row locked), so one v2 deleted since answers as nobody (Ruling 1A-6).
            setting = (ShopSetting.objects.select_related("updated_by").select_for_update(of=("self",))
                       .get_or_create(pk=1)[0])
            changed = [key for key, value in data.items() if
                       (setting.default_business_id != getattr(value, "pk", None) if key == "default_business" else getattr(setting, key) != value)]
            old_firm_name = (uncached(Business).filter(pk=setting.default_business_id).values_list("name", flat=True).first()
                             if "default_business" in changed else None)
            changes = {key: {"old": old_firm_name if key == "default_business" else str(getattr(setting, key)),
                             "new": getattr(data[key], "name", None) if key == "default_business" else str(data[key])}
                       for key in changed}
            if changed:
                for key in changed:
                    setattr(setting, key, data[key])
                setting.updated_at, setting.updated_by = timezone.now(), request.user
                setting.save()
                AuditLog.objects.create(action="updated", entity="settings", entity_id=setting.pk,
                                        entity_name="Shop settings", user=request.user,
                                        details=f"Changed {', '.join(changed)}", changes=changes)
        # A save that changed nothing answers the row as stored, read afresh: on Postgres one that waited for the lock
        # behind another owner's change re-reads the changed row, but its join can miss the person who changed it
        # (Task 9's re-review), so the locked read's own person can be nobody.
        answer = shown(setting if changed else ShopSetting.load())
        answer["warnings"] = [] if "{number}" in answer["share_message"] else ["Customers find bills by number. Consider adding {number}."]
        return Response(answer)
