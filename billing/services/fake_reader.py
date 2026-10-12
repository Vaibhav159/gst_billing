"""Synthetic prototype bills; enabled only by sandbox_settings, never production."""
import re
import time
from copy import deepcopy
from decimal import Decimal

FIRMS = {"kgh": ("Kiran Gold House", "08VRHFA2322D1ZI"), "mo": ("Meera Ornaments", "08WWUFP9975S1ZN"),
         "aj": ("Aarav Jewellers", "08DLTFT2681H1ZV")}
SUPPLIERS = {
    "UBS": ("Udaipur Bullion Suppliers", "08AACFU5521R1ZN"),
    "RST": ("Rajasthan Silver Traders", "08AAFFR2210N1Z7"),
    "HCU": ("Hallmark Centre Udaipur", "08AAHFH3381G1ZC"),
    "JGE": ("Jaipur Gem Exporters", "08YZCFU7539B1Z3"),
    "MBC": ("Mumbai Bullion Co.", "27AAACM4410F1ZY"),
    "MP": ("Mewar Packaging", "08AAGFM7312D1ZJ"),
    "RS": ("Ramesh Soni, karigar", "08BXHPS6614Q1ZL"),
}
PRODUCTS = {
    "bullion": ("Gold bullion 995", "7108", "3", "gms"),
    "boxes": ("Jewellery boxes", "4819", "18", "nos"),
    "utensils": ("Silver utensils", "7114", "3", "gms"),
    "chain": ("Gold chain 22K", "7113", "3", "gms"),
    "silverbar": ("Silver bar 999", "7106", "3", "gms"),
    "hallmark": ("Hallmarking (HUID)", "9983", "18", "nos"),
    "jobwork": ("Job work by karigar", "9988", "5", "nos"),
    "diamond": ("Diamond, cut and polished", "7102", "0.25", "ct"),
    "ring": ("Gold ring 22K", "7113", "3", "gms"),
}


def bill(seller, firm, number, day, product, quantity, rate, **extra):
    name, hsn, slab, unit = PRODUCTS[product]
    return {"supplier": {"name": seller[0], "gst_number": seller[1]},
            "buyer": {"name": FIRMS[firm][0], "gst_number": FIRMS[firm][1]},
            "invoice_number": number, "invoice_date": day, "payment_mode": "", "irn": "", "printed_total": None,
            "confidence": {"supplier": "high", "gstin": "high", "bill_no": "high", "date": "medium", "amounts": "high"},
            "lines": [{"product_name": name, "hsn_code": hsn, "gst_percent": slab, "printed_rate": f"{slab}%",
                       "quantity": quantity, "unit": unit, "rate": rate,
                       "taxable": str(Decimal(quantity) * Decimal(rate)), "amount_only": False}], **extra}


EXAMPLES = {
    "IMG_2041.jpg": bill(SUPPLIERS["UBS"], "kgh", "UBS/26-27/0866", "2026-10-07", "bullion", "42.18", "6878", printed_total="298817.00"),
    "WhatsApp Image 2026-10-07 at 18.22.jpeg": bill(SUPPLIERS["MP"], "kgh", "MP/0342", "2026-10-05", "boxes", "250", "45",
                                                buyer={"name": "Kiran Gold House", "gst_number": "08VRHFA2322D1ZL"}),
    "IMG_2046.jpg": bill(FIRMS["mo"], "mo", "MO/2026-27/31", "2026-10-07", "utensils", "1200", "117", payment_mode="bank",
                         buyer={"name": "Jodhpur Silver Crafts", "gst_number": "08ADFPJ3348L1ZB"}),
    "IMG_2047.jpg": bill(FIRMS["aj"], "kgh", "AJ/2026-27/44", "2026-10-07", "chain", "30.25", "6512.50", payment_mode="bank"),
    "IMG_2049.png": bill(("Rajasthan Silver Trader", ""), "mo", "RST/26-27/0455", "2026-10-06", "silverbar", "2500", "114"),
    "IMG_2050.jpg": bill(("Sanghvi Jewels", "24AAFCS8812M1Z0"), "aj", "SJ/26-27/118", "2026-10-05", "chain", "52.3", "6420"),
    "IMG_2052.jpg": bill(("Hallmark Centre Udaipur", "08AAHFH3381G1ZO"), "kgh", "HCU/0915", "2026-10-03", "hallmark", "60", "45"),
    "IMG_2053.jpg": bill(("Mohan Lal, karigar", ""), "kgh", "Slip 236", "2026-10-06", "jobwork", "1", "15000"),
    "IMG_2055.jpg": bill(SUPPLIERS["UBS"], "kgh", "UBS/26-27/0826", "2026-08-18", "bullion", "55.4", "6780"),
    "IMG_2056.jpg": bill(SUPPLIERS["JGE"], "aj", "JGE/1121", "2026-03-12", "diamond", "5.12", "58000"),
    "IMG_2058.jpg": bill(SUPPLIERS["UBS"], "kgh", "UBS-26-27-0850", "2026-10-04", "bullion", "69.54", "6878"),
    "IMG_2060.heic": bill(FIRMS["kgh"], "kgh", "KGH/2026-27/34", "2026-10-08", "ring", "4.2", "6512.50", payment_mode="cash",
                         buyer={"name": "Sunita Bhandri", "gst_number": ""}),
}
EXAMPLES["IMG_2050.jpg"]["lines"][0].update(gst_percent=None, printed_rate="2.5%")
FILE_BILLS = [
    ("UBS", "UBS/26-27/", "0866", "kgh", "2026-10-07", "bullion", "42.18", "6878"),
    ("RST", "RST/26-27/", "0458", "mo", "2026-10-05", "silverbar", "2400", "114.50"),
    ("HCU", "HCU/", "0921", "kgh", "2026-10-03", "hallmark", "60", "45"),
    ("JGE", "JGE/", "1201", "aj", "2026-10-06", "diamond", "2.4", "58000"),
    ("MBC", "MBC/", "2240", "aj", "2026-10-06", "bullion", "100", "6853"),
    ("MP", "MP/", "0350", "kgh", "2026-10-04", "boxes", "200", "45"),
    ("RS", "RS-", "0071", "aj", "2026-10-02", "jobwork", "1", "22500"),
]


def fake_read(name):
    from billing.services.ai_reader import ReadFailed
    time.sleep(1.5)
    if "blur" in name.lower():
        raise ReadFailed("The photo is too blurred to read the numbers.")
    if name in EXAMPLES:
        return deepcopy(EXAMPLES[name])
    stem = re.sub(r"\.[a-z0-9]+$", "", name, flags=re.I)
    hashed = 17
    for character in name:
        hashed = (hashed * 31 + ord(character)) & 0xffffffff
    named = next((row for row in FILE_BILLS if re.search(rf"(^|[^a-z]){row[0]}(?![a-z])", stem, re.I)), None)
    row = named or next(row for row in FILE_BILLS if row[0] == ("RST", "HCU", "RS")[hashed % 3])
    code, prefix, default, firm, day, product, quantity, rate = row
    digits = re.findall(r"\d{3,5}", stem) if named else []
    number = digits[-1] if digits else str(int(default) + hashed % 40).zfill(len(default))
    return bill(SUPPLIERS[code], firm, prefix + number, day, product, quantity, rate)
