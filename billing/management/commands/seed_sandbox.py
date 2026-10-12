"""Load synthetic books into the sandbox database (deploy/sandbox/).

Everything is invented: three fictitious Rajasthan firms, buyers and
suppliers across several states, the jewellery GST slabs (3%, 0.25%, 5%,
18%), and invoices from the start of the previous financial year to today,
built through the same line-item builder the API uses. It also files (locks)
past months, leaves supplier-bill captures in the inbox, and creates one
login per role.

Edge cases are planted on purpose: invoices on 31 March and 1 April, an
inter-state B2C sale above the B2CL threshold, a mixed-rate B2B invoice, and
a buyer whose state is unknown. For v3 (part 1): KIRAN's paper bills of last
month, typed in after this month's with two numbers not entered yet, one
cancelled and one deleted; bills sent on WhatsApp, one to a walk-in's number;
a bill over ₹2 lakh to a buyer with no PAN, and one of exactly ₹2 lakh in cash.

Refuses to run unless GST_SANDBOX=1 and the database is the sandbox's own
Postgres (or a throwaway SQLite, for tests).
"""

import os
import random
import secrets
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import BytesIO
from uuid import uuid4
from zoneinfo import ZoneInfo

from django.contrib.auth.models import Group, User
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from billing.cache import invalidate
from billing.constants import B2CL_THRESHOLD, INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.fy import fy_of
from billing.gstin import check_digit
from billing.models import (
    AiRead,
    AuditLog,
    BinnedInvoice,
    Business,
    CapturePage,
    Customer,
    FiledPeriod,
    Invoice,
    InwardCapture,
    ITCReclaimLedger,
    LineItem,
    Product,
    RateBoard,
    SaleDraft,
    SavedDraft,
    UserPreference,
)
from billing.numbering import format_number, next_counter
from billing.roles import GROUP_ACCOUNTANT, GROUP_STAFF
from billing.services.bin import bin_bill
from billing.services.line_items import build_line_items
from billing.services.sales import cancel_bill

D = Decimal

FIRMS = [
    # name, city, invoice-volume weight, months left unfiled (None = never filed)
    ("AARAV JEWELLERS (SANDBOX)", "Udaipur", 0.30, 1),
    ("MEERA ORNAMENTS (SANDBOX)", "Udaipur", 0.20, 3),
    ("KIRAN GOLD HOUSE (SANDBOX)", "Jaipur", 0.13, None),
]

# name, state, registered?, role
PARTIES = [
    ("Sharma Gold Traders", "RAJASTHAN", True, "buyer"),
    ("Mehta Bullion Co", "RAJASTHAN", True, "buyer"),
    ("Jain Ornament House", "RAJASTHAN", True, "buyer"),
    ("Rathore Silver Works", "RAJASTHAN", True, "buyer"),
    ("Bhandari Jewels", "RAJASTHAN", True, "buyer"),
    ("Patel Diamonds", "GUJARAT", True, "buyer"),
    ("Desai Gems", "GUJARAT", True, "buyer"),
    ("Kulkarni Jewellers", "MAHARASHTRA", True, "buyer"),
    ("Shah Bullion Mumbai", "MAHARASHTRA", True, "buyer"),
    ("Kapoor & Sons", "DELHI", True, "buyer"),
    ("Verma Ornaments", "MADHYA PRADESH", True, "buyer"),
    ("Reddy Gold Palace", "TELANGANA", True, "buyer"),
    ("Rohit Verma", "RAJASTHAN", False, "buyer"),
    ("Priya Sharma", "RAJASTHAN", False, "buyer"),
    ("Anil Gupta", "RAJASTHAN", False, "buyer"),
    ("Sunita Jain", "RAJASTHAN", False, "buyer"),
    ("Vikram Singh", "RAJASTHAN", False, "buyer"),
    ("Neha Agarwal", "RAJASTHAN", False, "buyer"),
    ("Kavita Joshi", "RAJASTHAN", False, "buyer"),
    ("Manoj Saini", "RAJASTHAN", False, "buyer"),
    ("Pooja Bhati", "RAJASTHAN", False, "buyer"),
    ("Deepak Choudhary", "RAJASTHAN", False, "buyer"),
    ("Anjali Paliwal", "RAJASTHAN", False, "buyer"),
    ("Arjun Nair", "KERALA", False, "buyer"),
    ("Sneha Kulkarni", "MAHARASHTRA", False, "buyer"),
    ("Farhan Qureshi", "DELHI", False, "buyer"),
    ("Ishita Banerjee", "WEST BENGAL", False, "buyer"),
    ("Karan Malhotra", "PUNJAB", False, "buyer"),
    ("Walk-in Customer", None, False, "buyer"),
    ("Udaipur Bullion Suppliers", "RAJASTHAN", True, "supplier"),
    ("Jaipur Gem Exporters", "RAJASTHAN", True, "supplier"),
    ("Surat Diamond Exchange", "GUJARAT", True, "supplier"),
    ("Zaveri Bazaar Refiners", "MAHARASHTRA", True, "supplier"),
    ("Delhi Silver Mart", "DELHI", True, "supplier"),
    ("Rajkot Ornament Works", "GUJARAT", True, "supplier"),
]

STATE_CODES = {
    "RAJASTHAN": "08", "GUJARAT": "24", "MAHARASHTRA": "27", "DELHI": "07",
    "MADHYA PRADESH": "23", "TELANGANA": "36", "KERALA": "32",
    "WEST BENGAL": "19", "PUNJAB": "03",
}
CITIES = {
    "RAJASTHAN": "Udaipur", "GUJARAT": "Surat", "MAHARASHTRA": "Mumbai", "DELHI": "Delhi",
    "MADHYA PRADESH": "Indore", "TELANGANA": "Hyderabad", "KERALA": "Kochi",
    "WEST BENGAL": "Kolkata", "PUNJAB": "Ludhiana",
}

# key: name, HSN/SAC, stored rate, unit, (rate low, high), (qty low, high)
PRODUCTS = {
    "gold22": ("Gold Ornaments 22K", "711319", "0.03", "gms", (9200, 10800), (2, 60)),
    "gold18": ("Gold Ornaments 18K", "711319", "0.03", "gms", (7400, 8600), (2, 35)),
    "silver": ("Silver Ornaments", "711311", "0.03", "gms", (95, 135), (20, 600)),
    "utensil": ("Silver Utensils", "711411", "0.03", "gms", (95, 130), (100, 1500)),
    "bar24": ("Gold Bar 24K", "710813", "0.03", "gms", (9800, 11600), (10, 100)),
    "diamond": ("Cut & Polished Diamonds", "710239", "0.0025", "ct", (35000, 120000), (0.1, 2.5)),
    "ruby": ("Ruby (Cut)", "710391", "0.0025", "ct", (8000, 40000), (0.5, 5)),
    "making": ("Making Charges (Job Work)", "998892", "0.05", "nos", (500, 25000), (1, 1)),
    "hallmark": ("Hallmarking Charges", "998346", "0.18", "nos", (45, 45), (1, 12)),
    "imitation": ("Imitation Jewellery", "711719", "0.03", "pcs", (300, 2500), (1, 10)),
}

# Wedding season and Akshaya Tritiya in spring, Diwali in autumn.
SEASON = {4: 1.3, 5: 1.2, 6: 0.7, 7: 0.6, 8: 0.8, 9: 0.9, 10: 1.5, 11: 1.6, 12: 1.1, 1: 0.9, 2: 1.1, 3: 1.0}
PAYMENT_MODES = ["cash"] * 7 + ["bank"] * 9 + ["credit"] * 2 + ["mixed", ""]
PAPER_BUYERS = ("Rohit Verma", "Sunita Jain", "Vikram Singh", "Neha Agarwal", "Kavita Joshi", "Manoj Saini")
PAPER_GAPS_BEFORE = (2, 4)
PAPER_BLOCK_SIZE = len(PAPER_BUYERS) + len(PAPER_GAPS_BEFORE)

ROLES = [
    ("owner", "sandbox_owner", ("admin",), True),
    ("admin", "sandbox_admin", ("admin",), False),
    ("editor", "sandbox_editor", ("editor",), False),
    ("viewer", "sandbox_viewer", ("viewer",), False),
    ("no group (viewer by default)", "sandbox_nogroup", (), False),
    # v3's roles keep their v2 group too, so today's permission classes (and a rollback) work
    ("accountant", "sandbox_accountant", (GROUP_ACCOUNTANT, "editor"), False),
    ("staff", "sandbox_staff", (GROUP_STAFF, "editor"), False),
]


def fy_start(d):
    return date(d.year if d.month >= 4 else d.year - 1, 4, 1)


def month_add(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


class Command(BaseCommand):
    help = "Load synthetic data into the sandbox database (refuses any other database)."

    def add_arguments(self, parser):
        parser.add_argument("--purchases-v3", action="store_true", help="Add v3 purchase, capture and AI usage cases.")
        parser.add_argument("--gst", action="store_true", help="Add v3 filing, correction and credit examples (needs part 2A).")
        parser.add_argument("--reset", action="store_true", help="Delete existing sandbox data first.")
        parser.add_argument("--easy", action="store_true", help="Add Easy's synthetic acceptance cases.")
        parser.add_argument(
            "--print-credentials", action="store_true",
            help="Print role, username and password for each sandbox login to stdout.",
        )
        parser.add_argument("--scale", type=float, default=1.0, help="Scale the invoice volume (tests use 0.1).")
        parser.add_argument("--seed", type=int, default=2026, help="Random seed; same seed, same books.")

    def handle(self, *args, **opts):
        self._assert_sandbox()
        self.rng = random.Random(opts["seed"])
        self.today = timezone.localdate()
        with transaction.atomic():
            if opts["reset"]:
                self._reset()
            elif Invoice.objects.exists() or Business.objects.exists():
                raise CommandError("The sandbox already has data; run with --reset to replace it.")
            logins = self._users()
            firms = self._firms()
            self._usual_firms(firms)
            parties = self._parties(firms)
            self._products()
            n_out = self._outward(firms, parties, opts["scale"])
            n_out += self._selling(firms, parties)
            if opts["easy"]:
                n_out += self._easy(firms, parties)
            n_in = self._inward(firms, parties, opts["scale"])
            n_locked = self._file_periods(firms)
            n_caps = self._captures(firms, parties)
            if opts["purchases_v3"]:
                from billing.services.seed_purchases import seed_purchases

                added_inward, added_outward, n_caps = seed_purchases(self, firms, parties)
                n_in += added_inward
                n_out += added_outward
            if opts["gst"]:
                from billing.services.gst_seed import seed_gst
                seed_gst(firms, User.objects.get(username="sandbox_owner"), self.today)
            self._records()
            self._rates()
        self.stderr.write(
            f"Seeded {len(firms)} firms, {len(parties['all'])} parties, {Product.objects.count()} products, "
            f"{n_out} outward + {n_in} inward invoices, {n_locked} filed months, {n_caps} captures."
        )
        if opts["print_credentials"]:
            for role, username, password in logins:
                self.stdout.write(f"{role}\t{username}\t{password}")
        else:
            self.stderr.write("Passwords not shown; rerun with --print-credentials (via sandbox.sh seed).")

    # ── guards ────────────────────────────────────────────────────────────
    def _assert_sandbox(self):
        if os.environ.get("GST_SANDBOX") != "1":
            raise CommandError("seed_sandbox runs only inside the sandbox stack (GST_SANDBOX=1).")
        db = connection.settings_dict
        if connection.vendor == "postgresql":
            if not (str(db.get("NAME", "")).startswith("gst_sandbox") and db.get("HOST") in {"db", "localhost", "127.0.0.1"}):
                raise CommandError("Refusing: this Postgres is not the sandbox database.")
        elif connection.vendor != "sqlite":
            raise CommandError(f"Refusing: unexpected database vendor {connection.vendor!r}.")

    def _reset(self):
        AiRead.objects.all().delete()
        CapturePage.objects.all().delete()
        from billing.models import FilingMonth, FilingRecord, OpeningCredit, ReturnDownload
        for model in (ReturnDownload, FilingRecord, FilingMonth, OpeningCredit):
            model.objects.all().delete()
        RateBoard.objects.all().delete()
        BinnedInvoice.objects.all().delete()  # these two protect the customers and firms below
        SaleDraft.objects.all().delete()
        SavedDraft.objects.all().delete()  # the notes of drafts saved as the bills below
        LineItem.objects.all().delete()
        InwardCapture.objects.all().delete()
        Invoice.objects.all().delete()
        Invoice.history.model.objects.all().delete()
        FiledPeriod.objects.all().delete()
        ITCReclaimLedger.objects.all().delete()
        AuditLog.objects.all().delete()
        Customer.objects.all().delete()
        Product.objects.all().delete()
        Business.objects.all().delete()
        UserPreference.objects.filter(user__username__startswith="sandbox_").delete()
        User.objects.filter(username__startswith="sandbox_").delete()

    # ── masters ───────────────────────────────────────────────────────────
    def _gstin(self, state_code, holder="F"):
        letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
        pan = (
            "".join(self.rng.choice(letters) for _ in range(3)) + holder + self.rng.choice(letters)
            + f"{self.rng.randint(1000, 9999)}" + self.rng.choice(letters)
        )
        first14 = f"{state_code}{pan}1Z"
        return first14 + check_digit(first14), pan

    def _users(self):
        logins = []
        for role, username, groups, superuser in ROLES:
            password = secrets.token_urlsafe(12)
            user = User.objects.create_user(
                username=username, email=f"{username}@example.com", password=password,
                is_staff=superuser, is_superuser=superuser,
            )
            for group in groups:
                user.groups.add(Group.objects.get_or_create(name=group)[0])
            logins.append((role, username, password))
        for name in ("admin", "editor", "viewer", GROUP_ACCOUNTANT, GROUP_STAFF):
            Group.objects.get_or_create(name=name)
        return logins

    def _firms(self):
        firms = []
        for i, (name, city, _weight, _unfiled) in enumerate(FIRMS, start=1):
            gstin, pan = self._gstin("08")
            firms.append(Business.objects.create(
                name=name, address=f"{10 + i} Sandbox Bazaar, {city}, Rajasthan",
                gst_number=gstin, pan_number=pan, state_name="RAJASTHAN",
                mobile_number=f"900000000{i}", email=f"firm{i}@example.com",
                bank_name="Sandbox Bank", bank_account_number=f"00000000000{i}",
                bank_ifsc_code=f"SBOX000000{i}", bank_branch_name=city,
            ))
        # Only KIRAN's paper bills carry the full number from last month on.
        kiran = firms[2]
        kiran.invoice_prefix = "KGH"
        kiran.paper_full_number_from = month_add(self.today.replace(day=1), -1)
        kiran.save(update_fields=["invoice_prefix", "paper_full_number_from"])
        return firms

    def _usual_firms(self, firms):
        """Counter staff usually work for KIRAN: v3 opens on that firm (v2 reads the same key)."""
        kiran = next(f for f in firms if f.name.startswith("KIRAN"))
        staff = User.objects.get(username="sandbox_staff")
        UserPreference.objects.update_or_create(user=staff, defaults={"data": {"defaultBusinessId": str(kiran.id)}})

    def _parties(self, firms):
        pools = {"all": [], "supplier": [], "b2b_intra": [], "b2b_inter": [], "b2c_intra": [], "b2c_inter": [], "unknown": []}
        for i, (name, state, registered, role) in enumerate(PARTIES):
            gstin = pan = None
            if registered:
                gstin, pan = self._gstin(STATE_CODES[state], self.rng.choice("FCP"))
            walkin = name == "Walk-in Customer"
            mobile = f"98{self.rng.randint(10_000_000, 99_999_999)}"
            party = Customer.objects.create(
                name=name, address=f"{i + 1} Demo Road, {(state or 'Unknown').title()}",
                gst_number=gstin, pan_number=pan, state_name=state,
                mobile_number="" if walkin else mobile,
                customer_type="walkin" if walkin else "", city=CITIES.get(state, ""),
            )
            party.businesses.add(*(firms if role == "supplier" else self.rng.sample(firms, self.rng.randint(1, 3))))
            pools["all"].append(party)
            if role == "supplier":
                pools["supplier"].append(party)
            elif state is None:
                pools["unknown"].append(party)
            else:
                local = state == "RAJASTHAN"
                key = ("b2b_" if registered else "b2c_") + ("intra" if local else "inter")
                pools[key].append(party)
        return pools

    def _products(self):
        for name, hsn, rate, unit, _price, _qty in PRODUCTS.values():
            Product.objects.create(name=name, hsn_code=hsn, gst_tax_rate=D(rate), default_unit=unit)

    # ── invoices ──────────────────────────────────────────────────────────
    def _records(self):
        """Part 4's synthetic recording cases; repeatable without changing any bill."""
        from billing.api.mixins import snapshot_of
        from billing.services.catalog import effective_kind
        user = User.objects.filter(username="sandbox_owner").first()
        for product in Product.objects.all():
            product.kind = effective_kind(product)
            product.purity = "22K" if product.kind == "gold" else "925" if product.kind == "silver" else ""
            product.usual_rate = Decimal("6470.000") if product.kind == "gold" else Decimal("85.000") if product.kind == "silver" else None
            product.save(update_fields=["kind", "purity", "usual_rate"])
        product = Product.objects.filter(name="Gold Ornaments 22K").first()
        if product:
            before = snapshot_of(product)
            product.name = "Gold jewellery 22K"
            product.save(update_fields=["name"])
            AuditLog.objects.get_or_create(entity="product", entity_id=product.pk, action="updated", entity_name=product.name,
                defaults={"user": user, "changes": {"name": {"old": before["name"], "new": product.name}},
                          "snapshot": before, "details": "Renamed; older bills keep their names"})
        Product.objects.get_or_create(name="GOLD JEWELLERY 22K", defaults={"hsn_code": "711319", "kind": "gold", "purity": "22K", "usual_rate": Decimal("6470.000")})
        Product.objects.get_or_create(name="Unused packing box", defaults={"hsn_code": "4819", "gst_tax_rate": Decimal("0.18"), "kind": "packing", "purchase_only": True, "default_unit": "pcs"})
        for name in ("Sample duplicate one", "Sample duplicate two"):
            Customer.objects.get_or_create(name=name, defaults={"mobile_number": "9000000042", "customer_type": "person", "state_name": "RAJASTHAN"})
        business = Business.objects.order_by("pk").first()
        if business:
            business.bank_account_number = ""
            business.save(update_fields=["bank_account_number"])

    def _line(self, key, qty=None, rate=None):
        name, hsn, gst, unit, (lo, hi), (qlo, qhi) = PRODUCTS[key]
        if qty is None:
            qty = qlo if qlo == qhi else (self.rng.randint(qlo, qhi) if unit in ("nos", "pcs") else round(self.rng.uniform(qlo, qhi), 3))
        if rate is None:
            rate = round(self.rng.uniform(lo, hi), 2)
        return {
            "product_name": name, "hsn_code": hsn, "gst_tax_rate": gst, "unit": unit,
            "quantity": str(qty), "rate": str(rate),
        }

    def _basket(self):
        roll = self.rng.random()
        if roll < 0.55:
            items = [self._line(self.rng.choice(["gold22", "gold22", "gold18"]))]
            if self.rng.random() < 0.5:
                items.append(self._line("making"))
        elif roll < 0.72:
            items = [self._line(self.rng.choice(["silver", "utensil"]))]
        elif roll < 0.87:
            items = [self._line("gold18"), self._line(self.rng.choice(["diamond", "ruby"])), self._line("making")]
            if self.rng.random() < 0.5:
                items.append(self._line("hallmark"))
        elif roll < 0.94:
            items = [self._line("imitation")]
        else:
            items = [self._line("bar24", qty=self.rng.choice([10, 20, 50]))]
        return items

    def _buyer(self, firm, parties):
        roll = self.rng.random()
        pool = (
            "b2c_intra" if roll < 0.55 else "b2b_intra" if roll < 0.70 else
            "b2b_inter" if roll < 0.85 else "b2c_inter" if roll < 0.95 else "unknown"
        )
        linked = [p for p in parties[pool] if firm in p.businesses.all()]
        return self.rng.choice(linked or parties[pool])

    def _outward(self, firms, parties, scale):
        start = date(fy_start(self.today).year - 1, 4, 1)
        specs = []
        day = start
        while day <= self.today:
            if day.weekday() != 6:  # shops here close on Sunday
                for firm, (_n, _c, weight, _u) in zip(firms, FIRMS, strict=True):
                    if self.rng.random() < weight * SEASON[day.month] * scale:
                        specs.append((firm, day, self._buyer(firm, parties), self._basket()))
            day += timedelta(days=1)

        # Planted cases, for every page that has to get them right.
        boundary = fy_start(self.today)
        last_mar = boundary - timedelta(days=1)
        this_month = self.today.replace(day=1)
        by_name = {p.name: p for p in parties["all"]}
        aarav = firms[0]
        for firm in firms:
            specs.append((firm, last_mar, self.rng.choice(parties["b2c_intra"]), [self._line("gold22")]))
            specs.append((firm, boundary, self.rng.choice(parties["b2c_intra"]), [self._line("gold22")]))
        big = [self._line("gold22", qty=9.5, rate=10450), self._line("diamond", qty=0.62, rate=98000)]
        specs.append((aarav, month_add(this_month, -2) + timedelta(days=11), by_name["Arjun Nair"], big))
        specs.append((aarav, month_add(this_month, -1) + timedelta(days=8), by_name["Ishita Banerjee"], big))
        specs.append((aarav, month_add(this_month, -1) + timedelta(days=9), by_name["Farhan Qureshi"], [self._line("silver", qty=150, rate=120)]))
        specs.append((aarav, month_add(this_month, -1) + timedelta(days=10), by_name["Patel Diamonds"], [
            self._line("gold18", qty=25.4, rate=7950), self._line("diamond", qty=1.15, rate=85000),
            self._line("making", qty=1, rate=12500), self._line("hallmark", qty=4, rate=45),
        ]))
        specs.append((aarav, this_month, by_name["Walk-in Customer"], [self._line("gold22", qty=4.215, rate=10333.33)]))

        kiran = firms[2]
        last_month = month_add(this_month, -1)
        # Keep the original RNG draws, so omitting KIRAN's paper sales leaves the other books unchanged.
        specs = [(*s, self.rng.choice(PAYMENT_MODES)) for s in sorted(specs, key=lambda s: s[1])]
        # The later KIRAN sales are still in the paper book; in April, this includes the planted 31 March.
        specs = [s for s in specs if not (s[0] == kiran and last_month.replace(day=15) <= s[1] < this_month)]
        if not any(f == kiran and when >= this_month for f, when, *_ in specs):
            # Even a sparse seed on the first of the month shows the bills entered before the paper run.
            specs.append((kiran, this_month, by_name["Anil Gupta"], [self._line("gold22", qty=4, rate=9850)], "cash"))
        specs.sort(key=lambda s: s[1])
        counters = {}
        self.paper_counter = None
        for firm, when, buyer, items, payment_mode in specs:
            if self.paper_counter is None and when >= this_month:
                # Reserve six paper bills and two not entered yet before this month's numbers are taken.
                self.paper_counter = next_counter(kiran.pk, fy_of(last_month))
                counters[(kiran.pk, fy_start(last_month))] = self.paper_counter + PAPER_BLOCK_SIZE - 1
            key = (firm.pk, fy_start(when))
            counters[key] = counters.get(key, 0) + 1
            number = format_number(firm, when, str(counters[key]))
            self._invoice(firm, buyer, when, number, INVOICE_TYPE_OUTWARD, items, payment_mode)
        assert any(
            inv.total_amount > B2CL_THRESHOLD for inv in Invoice.objects.filter(customer=by_name["Arjun Nair"])
        ), "the planted B2CL sale must clear the threshold"
        return len(specs)

    def _inward(self, firms, parties, scale):
        start = date(fy_start(self.today).year - 1, 4, 1)
        n = 0
        month = start
        while month <= self.today:
            for firm, per_month in zip(firms, (3, 2, 1), strict=True):
                for _ in range(max(1, round(per_month * scale)) if self.rng.random() < scale * 3 else 0):
                    supplier = self.rng.choice(parties["supplier"])
                    when = month + timedelta(days=self.rng.randint(0, 27))
                    if when > self.today:
                        continue
                    kind = self.rng.random()
                    if kind < 0.5:
                        items = [self._line("bar24", qty=self.rng.choice([100, 200, 250, 500]))]
                    elif kind < 0.75:
                        items = [self._line("diamond", qty=round(self.rng.uniform(2, 15), 2))]
                    else:
                        items = [self._line("silver", qty=self.rng.randint(1000, 5000))]
                    initials = "".join(w[0] for w in supplier.name.split()[:3]).upper()
                    fy = fy_start(when)
                    number = f"{initials}/{fy.year % 100}-{(fy.year + 1) % 100}/{self.rng.randint(1, 999):04d}"
                    self._invoice(firm, supplier, when, number, INVOICE_TYPE_INWARD, items, "bank")
                    n += 1
            month = month_add(month, 1)
        return n

    def _selling(self, firms, parties):
        """Part 1's cases: the paper book, cancel and the bin, sends, income-tax checks."""
        aarav, meera, kiran = firms
        by_name = {p.name: p for p in parties["all"]}
        this_month = self.today.replace(day=1)
        last_month = month_add(this_month, -1)

        # Typed in after this month's bills (higher ids), under the numbers kept free in _outward.
        n = self.paper_counter
        for step, name in enumerate(PAPER_BUYERS):
            if step in PAPER_GAPS_BEFORE:
                n += 1  # a paper bill not entered yet: its number is a gap
            when = last_month + timedelta(days=14 + 2 * step)
            bill = self._invoice(kiran, by_name[name], when, format_number(kiran, when, str(n)), INVOICE_TYPE_OUTWARD,
                                 [self._line("gold22", qty=4 + step, rate=9850)], "cash", paper=True)
            if step == 1:
                # Ruling 1A-12: the paper book includes a cancellation; the seed has no person to name in its audit.
                cancel_bill(bill, None, "Customer returned the piece the same day")
            if step == 3:
                bin_bill(bill, None, "Entered twice by mistake")
            n += 1

        # No PAN on a bill over ₹2 lakh (Rule 114B), and exactly ₹2,00,000 in cash (Sec 269ST).
        self._invoice(aarav, by_name["Deepak Choudhary"], self.today,
                      format_number(aarav, self.today, str(next_counter(aarav.pk, fy_of(self.today)))),
                      INVOICE_TYPE_OUTWARD, [self._line("gold22", qty=25, rate=10000)], "bank")
        self._invoice(meera, by_name["Pooja Bhati"], self.today,
                      format_number(meera, self.today, str(next_counter(meera.pk, fy_of(self.today)))),
                      INVOICE_TYPE_OUTWARD, [self._line("gold22", qty=1, rate="194174.76")], "cash")

        # Two of every three of this month's app bills went out on WhatsApp; the walk-in's twice.
        now, walkin = timezone.now(), by_name["Walk-in Customer"]
        recent = Invoice.objects.sales().filter(invoice_date__gte=this_month, paper=False).exclude(
            customer=walkin).order_by("id")
        for i, pk in enumerate(recent.values_list("id", flat=True)):
            if i % 3 != 2:
                Invoice.objects.filter(pk=pk).update(sent_at=now, last_sent_at=now, sent_count=1, sent_via="whatsapp")
        Invoice.objects.filter(customer=walkin, invoice_date__gte=this_month).update(
            sent_at=now, last_sent_at=now, sent_count=2, sent_via="whatsapp", sent_to="9829041122")
        invalidate(Invoice)
        return len(PAPER_BUYERS) + 2

    def _easy(self, firms, parties):
        """Part 6's opt-in fixtures; base seed tests keep their original books."""
        aarav, meera, kiran = firms
        by_name = {party.name: party for party in parties["all"]}
        staff = User.objects.get(username="sandbox_staff")
        owner = User.objects.get(username="sandbox_owner")
        before = Invoice.objects.count()
        # These rows were created in this seed's transaction. Easy opens on exactly three sales.
        Invoice.objects.filter(business=kiran, invoice_date=self.today, type_of_invoice=INVOICE_TYPE_OUTWARD).delete()

        def at(hour, minute):
            return timezone.make_aware(datetime.combine(self.today, time(hour, minute)), ZoneInfo("Asia/Kolkata"))

        def make(firm, customer, items, payment):
            number = format_number(firm, self.today, str(next_counter(firm.pk, fy_of(self.today))))
            return self._invoice(firm, customer, self.today, number, INVOICE_TYPE_OUTWARD, items, payment)

        walkin = by_name["Walk-in Customer"]
        walkin.businesses.add(kiran)
        make(kiran, walkin, [self._line("gold22", qty="2", rate="9850")], "cash")
        sent = make(kiran, by_name["Anil Gupta"], [self._line("silver", qty="25", rate="120")], "bank")
        Invoice.objects.filter(pk=sent.pk).update(sent_at=at(10, 44), last_sent_at=at(10, 44), sent_count=1, sent_via="whatsapp")
        make(kiran, by_name["Priya Sharma"], [self._line("gold18", qty="3", rate="7950")], "cash")

        lalit = Customer.objects.create(
            name="Lalit Jain", address="7 Demo Road, Jaipur", city="Jaipur", state_name="RAJASTHAN",
            mobile_number="9829041150", customer_type="person",
        )
        lalit.businesses.add(kiran)
        parties["all"].append(lalit)
        product, _ = Product.objects.get_or_create(name="Gold bangles 22K", defaults={
            "hsn_code": "711319", "gst_tax_rate": D("0.03"), "default_unit": "gms",
        })
        draft = SaleDraft.objects.create(
            id=uuid4(), business=kiran, started_by=staff,
            data={
                "v": 1, "firmId": kiran.pk,
                "customer": {"id": lalit.pk, "name": lalit.name, "address": lalit.address, "city": lalit.city,
                             "state_name": lalit.state_name, "mobile_number": lalit.mobile_number,
                             "gst_number": "", "pan_number": "", "email": "", "businesses": [kiran.pk],
                             "created_at": lalit.created_at.isoformat(), "customer_type": "person", "type": "person", "pan": ""},
                "date": self.today.isoformat(),
                "number": format_number(kiran, self.today, str(next_counter(kiran.pk, fy_of(self.today)))),
                "numberTyped": False, "paper": False, "posOverride": None, "payment": None, "notes": "",
                "lines": [{"productId": product.pk, "name": "Gold bangles 22K", "hsn": "711319", "gst": "3",
                           "unit": "gms", "qty": None, "rate": "", "note": "", "custom": False}],
                "replaces": None,
            },
        )
        SaleDraft.objects.filter(pk=draft.pk).update(created_at=at(15, 20), updated_at=at(15, 20))
        viewer = User.objects.get(username="sandbox_viewer")
        pref, _ = UserPreference.objects.get_or_create(user=viewer)
        pref.data = {**pref.data, "defaultBusinessId": str(aarav.pk)}
        pref.save(update_fields=["data"])

        no_hsn = {**self._line("gold22", qty="4", rate="9850"), "hsn_code": ""}
        imported = make(aarav, by_name["Sharma Gold Traders"], [no_hsn], "")
        AuditLog.objects.create(
            user=owner, action="imported", entity="invoice", entity_id=imported.pk, entity_name=imported.invoice_number,
            details=f"Imported from Excel (1 items, total: {imported.total_amount})",
        )
        make(aarav, by_name["Bhandari Jewels"], [], "")
        cancelled = make(meera, by_name["Neha Agarwal"], [self._line("gold22", qty="3", rate="9850")], "cash")
        cancel_bill(cancelled, owner, "Wrong weight or rate")

        last_month = month_add(self.today.replace(day=1), -1)
        original = (Invoice.objects.sales().filter(business=kiran, status="active", paper=True,
                                                   invoice_date__gte=last_month, invoice_date__lt=self.today.replace(day=1))
                    .only("invoice_number", "invoice_date").order_by("invoice_date", "id").first())
        # Legacy case variants are duplicates to _number_key, while the DB's exact constraint remains intact.
        self._invoice(kiran, by_name["Anil Gupta"], original.invoice_date, original.invoice_number.lower(),
                      INVOICE_TYPE_OUTWARD, [self._line("gold22", qty="2", rate="9850")], "cash", paper=True)
        invalidate(Invoice, LineItem)
        return Invoice.objects.count() - before

    def _invoice(self, firm, party, when, number, kind, items, payment_mode, paper=False):
        invoice = Invoice.objects.create(
            business=firm, customer=party, invoice_number=number, invoice_date=when,
            type_of_invoice=kind, payment_mode=payment_mode, paper=paper,
        )
        lines, _total = build_line_items(invoice, items, source="api")
        LineItem.objects.bulk_create(lines)
        invoice.save(recalc_total=True)
        return invoice

    def _file_periods(self, firms):
        n = 0
        start = date(fy_start(self.today).year - 1, 4, 1)
        this_month = self.today.replace(day=1)
        for firm, (_n, _c, _w, unfiled) in zip(firms, FIRMS, strict=True):
            if unfiled is None:
                continue
            month = start
            while month < month_add(this_month, -unfiled):
                FiledPeriod.objects.create(business=firm, year=month.year, month=month.month, note="GSTR-1 + 3B filed (sandbox)")
                month = month_add(month, 1)
                n += 1
        return n

    # ── capture inbox ─────────────────────────────────────────────────────
    def _captures(self, firms, parties):
        n = 0
        for i, supplier in enumerate(parties["supplier"][:3], start=1):
            items = [self._line("bar24", qty=100), self._line("making", qty=1, rate=1500)]
            png = self._bill_png(supplier, firms[0], f"SB/{i:03d}", self.today - timedelta(days=i), items)
            InwardCapture.objects.create(
                business=firms[0], supplier_hint=supplier.name, note="Synthetic sample bill",
                image=ContentFile(png, name=f"sandbox-bill-{i}.png"),
            )
            n += 1
        return n

    def _bill_png(self, supplier, buyer, number, when, items):
        """A plain, obviously-fake tax invoice image for the capture/AI flows."""
        from PIL import Image, ImageDraw, ImageFont

        def font(size):
            try:
                return ImageFont.load_default(size=size)
            except TypeError:  # Pillow without FreeType: fixed bitmap font
                return ImageFont.load_default()

        big, mid, small = font(44), font(30), font(26)
        img = Image.new("RGB", (1240, 1754), "white")
        draw = ImageDraw.Draw(img)
        y = 80
        for text, f, gap in (
            (supplier.name.upper(), big, 70),
            (f"GSTIN: {supplier.gst_number}    State: {supplier.state_name}", mid, 50),
            ("TAX INVOICE  -  SANDBOX SAMPLE, NOT A REAL BILL", mid, 60),
            (f"Invoice No: {number}        Date: {when:%d-%m-%Y}", mid, 50),
            (f"Bill to: {buyer.name}    GSTIN: {buyer.gst_number}", small, 70),
        ):
            draw.text((80, y), text, fill="black", font=f)
            y += gap
        cols = (80, 560, 720, 870, 1030)
        for x, head in zip(cols, ("Item", "HSN", "Qty", "Rate", "Taxable"), strict=True):
            draw.text((x, y), head, fill="black", font=small)
        y += 45
        inter = supplier.state_name != buyer.state_name
        taxable_total = tax_total = D("0")
        for it in items:
            qty, rate, gst = D(it["quantity"]), D(it["rate"]), D(it["gst_tax_rate"])
            taxable = (qty * rate).quantize(D("0.01"))
            taxable_total += taxable
            tax_total += (taxable * gst).quantize(D("0.01"))
            for x, val in zip(cols, (it["product_name"], it["hsn_code"], f"{qty} {it['unit']}", f"{rate}", f"{taxable}"), strict=True):
                draw.text((x, y), str(val), fill="black", font=small)
            y += 42
        y += 30
        heads = [("IGST", tax_total)] if inter else [("CGST", tax_total / 2), ("SGST", tax_total / 2)]
        for label, val in [("Taxable value", taxable_total), *heads, ("Grand total", taxable_total + tax_total)]:
            draw.text((720, y), f"{label}: {val.quantize(D('0.01'))}", fill="black", font=mid)
            y += 48
        buf = BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()


    def _rates(self):
        owner = User.objects.get(username="sandbox_owner")
        base = {"gold-24K": D("71040"), "gold-22K": D("65125"), "gold-18K": D("53280"),
                "silver-999": D("78500"), "silver-925": D("72610")}
        for ago in range(30, 0, -1):
            if ago in {4, 11, 18, 25}:
                continue
            quotes = {key: f"{amount - ago * D('10'):.2f}" for key, amount in base.items()}
            board = RateBoard.objects.create(on=self.today - timedelta(days=ago), quoted=quotes, set_by=owner)
            when = timezone.make_aware(datetime.combine(board.on, time(10, 5)))
            RateBoard.objects.filter(pk=board.pk).update(set_at=when)
            if ago == 1:
                corrected = RateBoard.objects.create(on=board.on, quoted={key: f"{amount:.2f}" for key, amount in base.items()}, set_by=owner)
                RateBoard.objects.filter(pk=corrected.pk).update(set_at=when + timedelta(hours=1))
