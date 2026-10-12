"""The unfinished bill a new bill is made from (Rulings 1D-6, 1D-7 and 1D-8; part 1 API contract, 2.3 and 4).

The save takes the draft with it, in its own transaction, and keeps a note of the draft's id and the bill it became
(SavedDraft, kept for good). A keep of that draft while the bill is being made waits for the save, and a later keep or
a later save of it is refused with 409 draft_saved and makes nothing: two counters finishing one shop-wide draft, or a
save retried after its answer was lost, never make two bills, and a keep never brings the draft back.
"""

from django.db import IntegrityError, transaction

from billing.models import Invoice, SaleDraft, SavedDraft
from billing.numbering import REF_FIELDS, bill_ref
from billing.refusals import Refusal


def saved_already(saved):
    """409 draft_saved for a draft a bill was made from: that bill (BillRef) by its number now, or null, with the
    number it was saved as, once the bill has left Sales for the bin. The bill is read around cacheops (Ruling 1A-34),
    in the columns a BillRef shows (Ruling 1A-39)."""
    bill = (Invoice.objects.sales().select_related("customer").only(*REF_FIELDS).filter(pk=saved.bill_id).first()
            if saved.bill_id is not None else None)
    number = bill.invoice_number if bill is not None else saved.invoice_number
    return Refusal(f"This unfinished bill was saved as {number} already.", "draft_saved",
                   bill=bill_ref(bill) if bill is not None else None)


def claim(draft_id):
    """The first thing a save from a draft does, inside its transaction: a note that the draft is being made a bill,
    and the draft taken at once.

    A second save of the same draft waits on the note for the first to end; if the first made its bill, the second is
    refused (409 draft_saved) before anything else, never as a clash over the number the first one took. A keep of the
    draft waits on its row, which the delete locks until the save ends (Task 10's review, minor 2): it is then refused,
    never told "kept" while the bill is being made from it. A refused save rolls both back.
    """
    try:
        with transaction.atomic():
            SavedDraft.objects.create(id=draft_id)
    except IntegrityError:
        raise saved_already(SavedDraft.objects.get(pk=draft_id)) from None
    SaleDraft.objects.filter(pk=draft_id).delete()


def became(draft_id, bill):
    """The draft became `bill`: its note keeps the bill and its number."""
    SavedDraft.objects.filter(pk=draft_id).update(bill_id=bill.pk, invoice_number=bill.invoice_number)
