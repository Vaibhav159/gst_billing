"""Synthetic part 2 cases, selected explicitly so v2's seed contract stays stable."""
from datetime import datetime, timedelta
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image

from billing.cache import invalidate
from billing.credit import default_credit_month
from billing.fy import fy_of
from billing.models import AiRead, AuditLog, CapturePage, Customer, Invoice, InwardCapture
from billing.numbering import format_number, next_counter
from billing.text import inr


def seed_purchases(command, firms, parties):
    owner = User.objects.get(username="sandbox_owner")
    business, seller = firms[0], firms[1]
    supplier = parties["supplier"][0]
    Customer.objects.filter(pk__in=[party.pk for party in parties["supplier"]]).update(is_supplier=True)
    today, month = command.today, command.today.replace(day=1)
    last = (month - timedelta(days=1)).replace(day=1)
    made = []

    def purchase(number, day=today, **extra):
        party = extra.pop("supplier", supplier)
        items = extra.pop("items", [command._line("bar24", qty=1)])
        bill = command._invoice(business, party, day, number, "inward", items, "bank")
        bill.source = "typed"
        for name, value in extra.items():
            setattr(bill, name, value)
        bill.save()
        AuditLog.objects.create(action="created", entity="invoice", entity_id=bill.pk, entity_name=number,
                                user=owner, details=f"{party.name} · {inr(bill.total_amount)}")
        made.append(bill)
        return bill

    late_day = (last - timedelta(days=1)).replace(day=1)
    purchase("P2-LATE", late_day, itc_month=default_credit_month(business.pk, late_day, today)[0])
    old_day = month.replace(year=fy_of(today), month=3, day=31)
    purchase("P2-OLD-FY", old_day, itc_month=month)
    purchase("P2-NOT-ALLOWED", itc_eligible=False)
    photo_item = {**command._line("bar24", qty=1, rate=100), "product_name": "Gold bullion 995", "hsn_code": "7108"}
    filled_bill = purchase("P2-CHECK-1", needs_review=True, source="capture", items=[photo_item])
    purchase("P2-CHECK-2", needs_review=True, source="capture")
    purchase("P2-DUP")
    purchase("P2-DUP")
    item = command._line("bar24", qty=1)
    item["hsn_code"] = ""
    purchase("P2-NO-HSN", items=[item])
    unregistered = Customer.objects.create(name="P2 Unregistered Supplier (SANDBOX)", state_name="RAJASTHAN", is_supplier=True)
    untaxed = {**command._line("bar24", qty=1), "gst_tax_rate": "0"}
    purchase("P2-NO-GSTIN", supplier=unregistered, items=[untaxed])
    customer = Customer.objects.create(name="P2 Buyer Firm (SANDBOX)", gst_number=business.gst_number,
                                       state_name=business.state_name)
    seller_party = Customer.objects.create(name="P2 Seller Firm (SANDBOX)", gst_number=seller.gst_number,
                                           state_name=seller.state_name, is_supplier=True)
    number = format_number(seller, today, str(next_counter(seller.pk, fy_of(today))))
    paired_items = [command._line("bar24", qty=1)]
    sold = command._invoice(seller, customer, today, number, "outward", paired_items, "bank", paper=True)
    purchase(number, supplier=seller_party, linked_sale=sold.pk, source="photos", items=paired_items)

    captures = list(InwardCapture.objects.order_by("id"))
    captures += [InwardCapture.objects.create(business=business, supplier_hint=supplier.name,
                                              note="Synthetic sample bill") for _ in range(2)]
    now = timezone.now()
    for index, capture in enumerate(captures):
        capture.captured_by, capture.label = owner, f"Bill photo {index + 1}"
        capture.business = None if index == 3 else business
        capture.supplier_hint = supplier.name
        capture.read_status = "failed" if index == 1 else "reading" if index == 3 else "ready"
        capture.read_error = "The photo is too blurred to read the numbers." if index == 1 else ""
        capture.read_started_at = now if index == 3 else None
        capture.read_at = now if capture.read_status == "ready" else None
        capture.discarded_at = now if index == 2 else None
        capture.discarded_by = owner if index == 2 else None
        capture.pages, capture.pdf = (2 if index == 0 else 1), index == 2
        capture.status, capture.invoice = ("converted", filled_bill) if index == 4 else ("new", None)
        bill_number = filled_bill.invoice_number if index == 4 else f"P2-PHOTO-{index + 1}"
        capture.read_data = {"source": "pdf" if capture.pdf else "photo", "irn": "",
            "supplier": {"id": supplier.pk, "name": supplier.name, "gst_number": supplier.gst_number,
                         "state_code": "08", "city": "Udaipur"},
            "buyer": {"name": business.name, "gst_number": business.gst_number, "business": business.pk},
            "seller_business": None, "invoice_number": bill_number, "invoice_date": today.isoformat(),
            "payment_mode": "bank", "lines": [{"product_name": "Gold bullion 995", "hsn_code": "7108",
                "gst_percent": "3", "printed_rate": "3%", "quantity": "1.000", "unit": "gms",
                "rate": "100.000", "taxable": "100.00", "amount_only": False}],
            "printed_total": "103.00", "lines_total": "103.00",
            "confidence": {key: "high" for key in ("supplier", "gstin", "bill_no", "date", "amounts")}, "notes": []}
        if capture.read_status != "ready":
            capture.read_data = None
        png = command._bill_png(supplier, business, bill_number, today, [photo_item])
        for position in range(1, capture.pages + 1):
            name = f"p2-seed-{capture.pk}-{position}"
            content = ContentFile(png, name=f"{name}.png")
            if capture.pdf:
                buffer = BytesIO()
                with Image.open(BytesIO(png)) as page_image:
                    page_image.convert("RGB").save(buffer, format="PDF")
                content = ContentFile(buffer.getvalue(), name=f"{name}.pdf")
            page = CapturePage.objects.create(capture=capture, position=position, file=content,
                        content_type="application/pdf" if capture.pdf else "image/png", size=content.size,
                        original_name=content.name)
            if capture.pdf:
                page.preview.save(f"{name}.png", ContentFile(png), save=False)
            else:
                page.preview.name = page.file.name
            page.save(update_fields=["preview"])
            if position == 1:
                capture.image.name = page.file.name
        capture.save()
    # Informational monthly usage only; there is no cap or quota setting.
    start = timezone.make_aware(datetime.combine(month, datetime.min.time()))
    span = max((now - start).total_seconds() - 120, 0)
    AiRead.objects.bulk_create([AiRead(user=owner, business=business, kind="capture", ok=True,
        at=start + timedelta(seconds=span * index / 1212)) for index in range(1212)])
    invalidate(Customer, Invoice, InwardCapture)
    return len(made), 1, len(captures)
