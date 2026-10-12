"""One synchronous read at every v3 door, logged after it finishes; no keys in tests."""
import json
import logging
import re
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from time import monotonic
from types import SimpleNamespace

from django.conf import settings
from django.utils import timezone

from billing.cache import uncached
from billing.gstin import validate as validate_gstin
from billing.models import AiRead, Business, Customer
from billing.tax_rules import GST_SLABS, has_gstin, normalize_rate, state_code, to_paise
from billing.text import inr, money
from billing.utils import AIInvoiceProcessingError, AIInvoiceProcessor

logger = logging.getLogger(__name__)

GROUPS = ("supplier", "gstin", "bill_no", "date", "amounts")
FAILED = "This bill couldn't be read just now. Nothing was filled in; try again in a moment."


class ReadFailed(Exception):
    pass


def month_window(now=None):
    day = timezone.localdate(now)
    start = day.replace(day=1)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    zone = timezone.get_current_timezone()
    return timezone.make_aware(datetime.combine(start, time.min), zone), timezone.make_aware(datetime.combine(end, time.min), zone)


def read_usage():
    start, end = month_window()
    return {"month": start.strftime("%Y-%m"), "used": uncached(AiRead).filter(ok=True, at__gte=start, at__lt=end).count()}


def decimal(raw):
    try:
        value = Decimal(str(raw))
        return value if value.is_finite() and 0 <= value <= Decimal("999999999999.999") else None
    except (ArithmeticError, TypeError, ValueError):
        return None


def cleaned_read(raw, source):
    if not isinstance(raw, dict) or not isinstance(raw.get("lines"), list) or not raw["lines"]:
        raise ReadFailed("This doesn't look like a bill.")
    confidence = {key: "medium" if (raw.get("confidence") or {}).get(key) == "medium" else "high" for key in GROUPS}
    notes = []
    if len(raw["lines"]) > 200:
        confidence["amounts"] = "medium"
        notes.append(f"This bill has {len(raw['lines'])} lines. Only the first 200 are shown; check the bill before saving.")
    seller = raw.get("supplier") if isinstance(raw.get("supplier"), dict) else {}
    buyer = raw.get("buyer") if isinstance(raw.get("buyer"), dict) else {}
    gst = str(seller.get("gst_number") or "").strip().upper()
    buyer_gst = str(buyer.get("gst_number") or "").strip().upper()
    if gst and not validate_gstin(gst)[0]:
        confidence["gstin"] = "medium"
        notes.append(validate_gstin(gst)[1])
    seller_name = str(seller.get("name") or "")[:255]
    suppliers = uncached(Customer).only("id", "state_name", "city")
    supplier = suppliers.filter(gst_number__iexact=gst).first() if has_gstin(gst) else suppliers.filter(name__iexact=seller_name).first()
    if supplier is None:
        supplier = suppliers.filter(name__iexact=seller_name).first()
    if buyer_gst and not validate_gstin(buyer_gst)[0]:
        confidence["gstin"] = "medium"
        notes.append(validate_gstin(buyer_gst)[1])
    firms = list(uncached(Business).only("id", "gst_number"))
    def match(value):
        return next((firm.pk for firm in firms if value and (firm.gst_number or "").upper() == value), None)
    try:
        day = date.fromisoformat(str(raw.get("invoice_date")))
    except (TypeError, ValueError):
        day = None
    if day is None or day > timezone.localdate():
        confidence["date"] = "medium"
        notes.append("Check the date printed on the bill.")
    lines, total = [], Decimal("0")
    for number, item in enumerate(raw["lines"][:200], 1):
        if not isinstance(item, dict):
            raise ReadFailed("This doesn't look like a bill.")
        printed = str(item.get("printed_rate") or item.get("gst_percent") or "")
        try:
            printed_percent = Decimal(str(item.get("gst_percent", "")).replace("%", ""))
            slab = format(printed_percent.normalize(), "f") if printed_percent in GST_SLABS else None
        except (ArithmeticError, TypeError, ValueError):
            slab = None
        if slab is None:
            confidence["amounts"] = "medium"
            notes.append(f'Line {number}: choose the slab printed on the bill ({printed or "not read"}).')
        quantity, price = decimal(item.get("quantity")), decimal(item.get("rate"))
        amount_only = item.get("amount_only") is True or quantity is None or price is None
        if not amount_only:
            rounded_quantity = quantity.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            rounded_price = price.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
            if (quantity, price) != (rounded_quantity, rounded_price) or quantity == 0 or price == 0:
                confidence["amounts"] = "medium"
                notes.append(f"Line {number}: check the quantity and rate; this app keeps three decimal places.")
            quantity, price = rounded_quantity, rounded_price
        taxable = decimal(item.get("taxable")) if amount_only else to_paise(quantity * price)
        if taxable is None:
            raise ReadFailed("The photo is too blurred to read the numbers.")
        taxable = to_paise(taxable)
        tax = to_paise(taxable * normalize_rate(slab, "percent")) if slab is not None else Decimal("0")
        total += taxable + tax
        lines.append({"product_name": str(item.get("product_name") or "")[:255], "hsn_code": str(item.get("hsn_code") or "")[:8],
                      "gst_percent": slab, "printed_rate": printed, "quantity": None if amount_only else f"{quantity:.3f}",
                      "unit": str(item.get("unit") or "gms"), "rate": None if amount_only else f"{price:.3f}",
                      "taxable": money(taxable), "amount_only": amount_only})
    printed_total = decimal(raw.get("printed_total"))
    if printed_total is not None and total != to_paise(printed_total):
        delta = total - printed_total
        if abs(delta) > 1:
            confidence["amounts"] = "medium"
        direction = "more" if delta > 0 else "less"
        rounding = ", likely round-off" if abs(delta) <= 1 else ""
        notes.append(f"The bill shows {inr(printed_total)}; its lines add up to {inr(total)} ({inr(abs(delta))} {direction}{rounding}). The lines are what's saved: edit them if the bill's figure is right.")
    irn = str(raw.get("irn") or "")
    if re.fullmatch(r"[0-9a-fA-F]{64}", irn):
        source, confidence = "e-invoice", {key: "high" for key in GROUPS}
    else:
        irn = ""
    return {"source": source, "irn": irn, "supplier": {"name": seller_name, "gst_number": gst, "id": supplier.pk if supplier else None,
            "state_code": state_code(SimpleNamespace(gst_number=gst, state_name=supplier.state_name if supplier else "")), "city": supplier.city if supplier else str(seller.get("city") or "")},
            "buyer": {"name": str(buyer.get("name") or ""), "gst_number": buyer_gst, "business": match(buyer_gst)},
            "seller_business": match(gst), "invoice_number": str(raw.get("invoice_number") or "")[:50],
            "invoice_date": day.isoformat() if day else None, "payment_mode": raw.get("payment_mode") if raw.get("payment_mode") in ("cash", "bank", "credit", "mixed") else "",
            "lines": lines, "printed_total": money(printed_total) if printed_total is not None else None,
            "lines_total": money(total), "confidence": confidence, "notes": notes}


def run_read(files, user, kind, business=None, capture=None):
    try:
        processor = AIInvoiceProcessor()
        if getattr(settings, "AI_READER", "") == "fake" and getattr(settings, "AI_READER_ALLOW_FAKE", False):
            from billing.services.fake_reader import fake_read
            raw = fake_read(getattr(files[0], "_bill_original_name", files[0].name))
        elif files[0].content_type == "application/pdf":
            raw = processor.process_invoice_pdf(files[0], business_id=business.pk if business else None, pages=files)
        else:
            raw = processor.process_invoice_image(files[0], business_id=business.pk if business else None, pages=files, v3=True)
        result = cleaned_read(raw, "pdf" if any(file.content_type == "application/pdf" for file in files) else "photo")
    except Exception as exc:
        logger.exception("Bill reader failed (kind=%s, pages=%s)", kind, len(files))
        AiRead.objects.create(user=user, kind=kind, business=business, capture=capture, pages=len(files), ok=False)
        if isinstance(exc, ReadFailed):
            raise
        if isinstance(exc, TimeoutError) or "timeout" in str(exc).lower() or "timed out" in str(exc).lower():
            raise ReadFailed("The reader didn't answer in time.") from None
        raise ReadFailed("The reader couldn't be reached just now.") from None
    AiRead.objects.create(user=user, kind=kind, business=business, capture=capture, pages=len(files), ok=True)
    return result


def extract_pages(processor, files):
    """One model request contains every page, preserving PDFs as application/pdf."""
    from google import genai
    from google.genai import types

    from billing.utils import GEMINI_TIMEOUT_MS
    if not processor.gemini_keys:
        raise AIInvoiceProcessingError("Reader unavailable")
    gstins = list(uncached(Business).exclude(gst_number="").values_list("gst_number", flat=True))
    prompt = ("Read every page of this single supplier bill. Transcribe item names and printed rates exactly. "
              "Never invent missing fields. Return JSON with supplier:{name,gst_number,city}, buyer:{name,gst_number}, "
              "invoice_number, invoice_date (YYYY-MM-DD), payment_mode, irn (64 hex characters if printed), "
              "lines:[{product_name,hsn_code,gst_percent,printed_rate,quantity,unit,rate,taxable,amount_only}], "
              "printed_total and confidence:{supplier,gstin,bill_no,date,amounts}, each high or medium. "
              "Numbers must be decimal strings; missing numbers null. gst_percent is percent as printed. "
              "A value without a quantity or rate has amount_only true. Shop firm GSTINs: " + ", ".join(gstins))
    parts = [{"text": prompt}]
    for file in files:
        file.seek(0)
        data, mime = file.read(), file.content_type
        if mime != "application/pdf":
            data, mime = processor._normalize_image(data, mime)
        parts.append({"inline_data": {"mime_type": mime, "data": data}})
    deadline = monotonic() + GEMINI_TIMEOUT_MS / 1000
    attempted = False
    for key in processor.gemini_keys:
        if processor._is_cooled_down(key):
            continue
        remaining = GEMINI_TIMEOUT_MS if not attempted else int((deadline - monotonic()) * 1000)
        if remaining <= 0:
            raise TimeoutError("reader deadline")
        attempted = True
        client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=remaining))
        try:
            response = client.models.generate_content(model=processor.gemini_model, contents=[{"role": "user", "parts": parts}],
                config=types.GenerateContentConfig(candidate_count=1, temperature=0, max_output_tokens=8192,
                                                  response_mime_type="application/json", response_schema=read_schema()))
            return json.loads(response.text)
        except Exception as error:
            problem = AIInvoiceProcessingError(processor._format_gemini_error(error))
            if not processor._is_per_key_error(problem):
                raise problem from None
            seconds = processor._extract_retry_seconds(problem)
            if seconds is None:
                seconds = 86400 if any(code in str(error) for code in ("403", "401")) else 3600
            processor._set_cooldown(key, seconds)
    raise AIInvoiceProcessingError("Reader unavailable")


def read_schema():
    text = {"type": "STRING", "nullable": True}
    party = {"type": "OBJECT", "properties": {key: text for key in ("name", "gst_number", "city")}}
    line = {"type": "OBJECT", "properties": {key: text for key in (
        "product_name", "hsn_code", "gst_percent", "printed_rate", "quantity", "unit", "rate", "taxable")}}
    line["properties"]["amount_only"] = {"type": "BOOLEAN"}
    properties = {key: text for key in ("invoice_number", "invoice_date", "payment_mode", "irn", "printed_total")}
    properties.update(supplier=party, buyer=party, lines={"type": "ARRAY", "items": line},
        confidence={"type": "OBJECT", "properties": {key: {"type": "STRING", "enum": ["high", "medium"]} for key in GROUPS}})
    return {"type": "OBJECT", "properties": properties, "required": list(properties)}
