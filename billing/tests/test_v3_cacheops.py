"""v3's reads go around cacheops (Ruling 1A-34).

Production caches Business, Customer, Product, Invoice and LineItem queries in Redis. cacheops ties a cached
query only to conditions it can read on its own tables: it can't see a subquery, an Exists or a select_related
table change. So a v3 page could show a cancelled bill's tax, or a customer's old PAN, for up to half an hour.
Every v3 read therefore goes around the cache, and v3's writes keep invalidating, so v2's cached reads stay right.

The suite runs with cacheops off, so this file turns it on as production runs it (every cached model, all ops),
with a recording stand-in for Redis: each cache read and write is recorded, and every read misses, so each query
still runs against the database. TransactionTestCase, not TestCase: inside TestCase's wrapping transaction,
cacheops treats the data the test just wrote as uncommitted and caches nothing, which would hide a cached read.
"""

import uuid
from contextlib import contextmanager, suppress
from unittest.mock import call, patch

from cacheops.conf import prepare_profiles
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from billing.cache import invalidate
from billing.constants import BILL_CANCELLED
from billing.gstin import check_digit
from billing.models import BinnedInvoice, Customer, FiledPeriod, Invoice, LineItem, Product
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale

GSTIN = "08AAKFS4821M1Z" + check_digit("08AAKFS4821M1Z")
CACHED = {f"billing.{model}": {"ops": "all", "timeout": 60}
          for model in ("business", "customer", "product", "invoice", "lineitem")}


@contextmanager
def cacheops_on():
    """cacheops as production runs it, with Redis replaced by a recorder: yields the list of cache reads and
    writes made inside the block, each with the tables its invalidation would watch."""
    touched = []

    @contextmanager
    def getting(key, cond_dnfs, prefix, lock=False):
        touched.append(("read", sorted(cond_dnfs)))
        yield None  # a miss: the query runs against the database

    def cache_thing(prefix, key, data, cond_dnfs, *args, **kwargs):
        touched.append(("write", sorted(cond_dnfs)))

    # CACHEOPS_FAKE: billing.cache.invalidate() stands down, as in CI. invalidate_obj: bulk_create's own
    # invalidation, which would call Redis.
    with override_settings(CACHEOPS_ENABLED=True, CACHEOPS=CACHED, CACHEOPS_FAKE=True), \
            patch("cacheops.query.getting", getting), patch("cacheops.query.cache_thing", cache_thing), \
            patch("cacheops.query.invalidate_obj"):
        prepare_profiles.invalidate_all()  # the profiles are memoized: read them again with the cache on
        try:
            yield touched
        finally:
            prepare_profiles.invalidate_all()


class ReadsAroundTheCacheTest(TransactionTestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.client = client_for(self.owner)
        self.kgh = firm(invoice_prefix="KGH")
        self.mo = firm("MEERA ORNAMENTS", gstin="24AAAAA0000A1Z5", state="GUJARAT")
        self.anil = buyer(mobile_number="9829041122", pan_number="ABCDE1234F")
        self.rathore = Customer.objects.create(name="Rathore Gems", gst_number=GSTIN, state_name="RAJASTHAN")
        Product.objects.create(name="Gold Ring 22K", hsn_code="711319")
        self.b31 = sale(self.kgh, self.anil, "KGH/2026-27/31", "2026-09-08", payment_mode="cash")
        self.big = sale(self.kgh, self.rathore, "KGH/2026-27/32", "2026-09-09", line(rate="258000", hsn=""),
                        payment_mode="cash")
        self.twin = sale(self.kgh, self.anil, "kgh/2026-27/31", "2026-09-10", replaces=self.b31.pk)
        self.gone = sale(self.kgh, self.anil, "KGH/2026-27/19", "2026-09-03", status=BILL_CANCELLED,
                         cancel_reason="Customer returned it")
        Invoice.objects.create(business=self.kgh, customer=self.anil, invoice_number="KGH/2026-27/40",
                               invoice_date="2026-09-11")  # no items
        self.binned, _ = bin_bill(sale(self.kgh, self.anil, "KGH-27", "2026-09-24"), self.owner, "Entered twice")
        FiledPeriod.objects.create(business=self.mo, year=2026, month=8)
        self.august = sale(self.mo, self.anil, "5", "2026-08-20")  # in MEERA's filed August

    def test_the_stand_in_sees_v2s_cached_reads(self):
        # The control: v2's endpoints still read through cacheops, so the stand-in is wired and the test below
        # couldn't pass with the cache never consulted.
        with cacheops_on() as touched:
            self.assertEqual(self.client.get(reverse("invoice-list")).status_code, 200)
            self.assertEqual(self.client.get(reverse("customer-list")).status_code, 200)
        self.assertIn("billing_invoice", {table for _op, tables in touched for table in tables})
        self.assertTrue(any(op == "write" for op, _tables in touched))

    def test_v3s_reads_never_touch_the_cache(self):
        sales = reverse("sale-list")
        reads = [
            (sales, {"fy": "2026-27", "facets": "1", "q": "31"}),
            (sales, {"fy": "2026-27", "business_id": self.kgh.pk, "facets": "1", "page_size": "1"}),
            (sales, {"check": "1", "itax": "1", "dups": "1"}),
            (sales, {"empty": "1"}), (sales, {"no_hsn": "1"}), (sales, {"gst_rate": "3"}),
            (sales, {"segment": "b2b"}), (sales, {"segment": "b2cl"}), (sales, {"segment": "b2cs", "number": "kgh/2026-27/31"}),
            (sales, {"customer_id": self.anil.pk, "itax": "1", "ordering": "number"}),
            (reverse("sale-detail", args=[self.b31.pk]), {}),
            (reverse("sale-detail", args=[self.twin.pk]), {}),
            (reverse("sale-detail", args=[self.binned.original_id]), {}),  # the deleted bill's 404
            (reverse("sale-next-number"), {"business_id": self.kgh.pk, "invoice_date": "2026-09-30"}),
            (reverse("sale-check-number"), {"business_id": self.kgh.pk, "invoice_date": "2026-09-30",
                                            "invoice_number": "27", "exclude_id": self.b31.pk}),
            (reverse("sale-check-number"), {"business_id": self.kgh.pk, "invoice_date": "2026-09-30",
                                            "invoice_number": "KGH/2026-27/31"}),
            (reverse("sale-paper-book"), {"business_id": self.kgh.pk, "month": "2026-09"}),
            (reverse("bin-list"), {"business_id": self.kgh.pk, "q": "27"}),
            (reverse("quick-search"), {"q": "31"}),
            (reverse("quick-search"), {"q": "Gold"}),
            (reverse("quick-search"), {"q": "Anil"}),  # a customer that matches: their recent bills are read too
        ]
        with cacheops_on() as touched:
            for url, params in reads:
                with self.subTest(url=url, params=params):
                    self.assertIn(self.client.get(url, params).status_code, (200, 404))
            # The writes read too: the bill they act on, and what they answer.
            for url, body in (
                (reverse("sale-sent", args=[self.b31.pk]), {"via": "whatsapp"}),
                (reverse("sale-renumber", args=[self.twin.pk]), {"invoice_number": "KGH/2026-27/33"}),
                (reverse("sale-move", args=[self.big.pk]), {"business": self.mo.pk, "invoice_number": "1"}),
                (reverse("sale-cancel", args=[self.b31.pk]), {"reason": "Customer returned it"}),
                (reverse("bin-restore", args=[self.binned.pk]), None),
            ):
                with self.subTest(url=url):
                    self.assertEqual(self.client.post(url, body, format="json").status_code, 200)
            r = self.client.delete(reverse("sale-detail", args=[self.twin.pk]), {"reason": "Twice"}, format="json")
            self.assertEqual(r.status_code, 200)
            # A new bill made again from a cancelled one; an edit of the restored bill to another customer and place;
            # the e-way details; the tax heads.
            line = {"product_name": "Gold Ring 22K", "hsn_code": "711319", "gst_percent": "3", "quantity": "1",
                    "unit": "gms", "rate": "6500"}
            r = self.client.post(reverse("sale-list"), {
                "business": self.kgh.pk, "customer": self.rathore.pk, "invoice_number": "KGH/2026-27/50",
                "invoice_date": "2026-09-12", "payment_mode": "bank", "replaces": self.gone.pk, "lines": [line]},
                format="json")
            self.assertEqual(r.status_code, 201, r.data)
            back = self.binned.original_id
            for method, url, body in (
                ("put", reverse("sale-detail", args=[back]), {
                    "business": self.kgh.pk, "customer": self.rathore.pk, "invoice_number": "KGH-27",
                    "invoice_date": "2026-09-24", "payment_mode": "cash", "place_of_supply": "24", "lines": [line]}),
                ("put", reverse("sale-eway", args=[back]), {"eway_bill_number": "123456789012", "vehicle_number": "RJ14AB1234"}),
                ("post", reverse("sale-fix-heads", args=[back]), None),
            ):
                with self.subTest(url=url):
                    self.assertEqual(getattr(self.client, method)(url, body, format="json").status_code, 200)
            # A refusal reads too: the closed month's words name its firm.
            r = self.client.post(reverse("sale-cancel", args=[self.august.pk]), {"reason": "Returned"}, format="json")
            self.assertEqual((r.status_code, r.data["code"]), (409, "month_closed"))
            self.assertIn("for MEERA ORNAMENTS", r.data["detail"])
        self.assertEqual(touched, [])
        self.assertFalse(BinnedInvoice.objects.live().filter(pk=self.binned.pk).exists())  # the restore happened
        self.assertEqual(LineItem.objects.filter(invoice_id=self.binned.original_id).count(), 1)

    def test_v3s_customer_reads_never_touch_the_cache(self):
        # 1A Task 9: the customers list with figures (its orders and filters), a statement, the shop settings.
        self.anil.businesses.add(self.kgh)
        customers, statement = reverse("customer-list"), reverse("customer-statement", args=[self.anil.pk])
        reads = [
            (customers, {"figures": "1"}),
            (customers, {"figures": "1", "figures_business_id": self.kgh.pk, "start_date": "2026-09-01",
                         "end_date": "2026-09-30", "ordering": "-last_bill"}),
            (customers, {"figures": "1", "ordering": "-sales", "has_gstin": "1", "type": "business",
                         "state_name": "RAJASTHAN", "search": "Rathore"}),
            (customers, {"figures": "1", "business_id": self.kgh.pk, "type": "person", "page_size": "1"}),
            (statement, {}),
            (statement, {"business_id": self.kgh.pk, "start_date": "2026-09-01", "end_date": "2026-09-30"}),
            (reverse("customer-statement", args=[self.rathore.pk]), {}),
            (reverse("shop-settings"), {}),
        ]
        with cacheops_on() as touched:
            for url, params in reads:
                with self.subTest(url=url, params=params):
                    r = self.client.get(url, params)
                    self.assertEqual(r.status_code, 200)
                    self.assertTrue(r.data.get("bills") or r.data.get("results") or r.data.get("copies"))
            r = self.client.put(reverse("shop-settings"), {"copies": "all"}, format="json")
            self.assertEqual((r.status_code, self.client.get(reverse("shop-settings")).data["copies"]), (200, "all"))
        self.assertEqual(touched, [])
        # The control: v2's own list, without figures, still reads customers through the cache, so the stand-in
        # sees a customer read and the test above couldn't pass with none recordable.
        with cacheops_on() as touched:
            self.assertEqual(self.client.get(customers).status_code, 200)
        self.assertIn("billing_customer", {table for _op, tables in touched for table in tables})

    def test_selective_facets_never_touch_the_cache(self):
        # Ruling 1A-43: grouped months and the smaller elsewhere read stay fresh too.
        with cacheops_on() as touched:
            for selector in ("months", "elsewhere"):
                response = self.client.get(reverse("sale-list"), {
                    "fy": "2026-27", "facets": selector, "summary": "0", "q": "Anil"})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(set(response.data["facets"]), {selector})
                self.assertTrue(response.data["results"])
        self.assertEqual(touched, [])

    def test_v3s_draft_reads_never_touch_the_cache(self):
        # 1A Task 10: the drafts list; a keep, which reads its firm; a bill saved from the draft; a keep and a save of
        # the saved draft, whose refusal names the bill; and a discard.
        key, drafts = str(uuid.uuid4()), reverse("draft-list")
        draft, keep = reverse("draft-detail", args=[key]), {"business": self.kgh.pk, "data": {"note": "Bangles"}}
        bill = {"business": self.kgh.pk, "customer": self.anil.pk, "invoice_number": "KGH/2026-27/60",
                "invoice_date": "2026-09-12", "lines": [{"product_name": "Gold Ring 22K", "hsn_code": "711319",
                                                         "gst_percent": "3", "quantity": "1", "rate": "6500"}],
                "draft_id": key}
        with cacheops_on() as touched:
            self.assertEqual(self.client.put(draft, keep, format="json").status_code, 201)
            self.assertEqual(self.client.put(draft, keep, format="json").status_code, 200)
            self.assertEqual(len(self.client.get(drafts, {"business_id": self.kgh.pk}).data["results"]), 1)
            self.assertEqual(self.client.post(reverse("sale-list"), bill, format="json").status_code, 201)
            for r in (self.client.put(draft, keep, format="json"),
                      self.client.post(reverse("sale-list"), bill, format="json")):
                self.assertEqual((r.status_code, r.data["code"], r.data["bill"]["invoice_number"]),
                                 (409, "draft_saved", "KGH/2026-27/60"))
            self.assertEqual(self.client.delete(draft).status_code, 204)
            self.assertEqual(self.client.get(drafts).data["results"], [])
        self.assertEqual(touched, [])


class WritesInvalidateTest(TestCase):
    """v3's writes keep v2's cached reads right (Ruling 1A-34): a write cacheops can't see (a queryset update(), a
    bulk write) is followed by billing.cache.invalidate. save() and delete() invalidate by their own signals."""

    def test_each_write_cacheops_cant_see_invalidates(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        bill = sale(firm(), buyer(mobile_number="9829041122"), "1", "2026-09-10")
        with patch("billing.services.sales.invalidate") as invalidate:  # the send is an update()
            self.assertEqual(owner.post(reverse("sale-sent", args=[bill.pk]), {"via": "whatsapp"},
                                        format="json").status_code, 200)
        invalidate.assert_called_once_with(Invoice)
        binned, _ = bin_bill(Invoice.objects.get(pk=bill.pk), None)
        with patch("billing.services.bin.invalidate") as invalidate:  # restore bulk-creates the lines
            self.assertEqual(owner.post(reverse("bin-restore", args=[binned.pk])).status_code, 200)
        invalidate.assert_called_once_with(Invoice, LineItem)
        li = LineItem.objects.get(invoice_id=bill.pk)
        li.amount += 1
        with patch("billing.signals.invalidate") as invalidate:  # a one-off line save resyncs the total by update()
            li.save()
        invalidate.assert_called_once_with(Invoice)
        self.assertEqual(Invoice.objects.get(pk=bill.pk).total_amount, li.amount)


# billing.cache.invalidate() acting as in production; each test replaces Redis (or cacheops' clear) with a mock.
LIVE = {"CACHEOPS_ENABLED": True, "CACHEOPS_FAKE": False}


class ClearsTest(TestCase):
    """A model-wide clear is a Redis KEYS scan over the whole cache: none a write doesn't need (Task 7's re-review)."""

    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        self.kgh, self.anil = firm(), buyer(mobile_number="9829041122")

    def bill(self, number, lines):
        return sale(self.kgh, self.anil, number, "2026-09-11", *[line(rate=str(1000 + n)) for n in range(lines)])

    def test_a_bills_delete_resyncs_no_line_and_clears_nothing(self):
        # v2's resync (billing.signals) keeps a bill's total after a one-off line write. A bill going to the bin takes
        # its lines with it: no total is left to keep, and cacheops' own delete handlers drop the bill's and its lines'
        # cached queries. It used to re-read, re-sum and re-write the bill once per line, and ask for a clear each time.
        asked = []
        self.owner.get(reverse("sale-list"))  # anything a first request sets up
        for number, lines in (("1", 1), ("2", 20)):
            bill = self.bill(number, lines)
            with override_settings(**LIVE), patch("cacheops.invalidate_model") as clear, \
                    CaptureQueriesContext(connection) as seen:
                r = self.owner.delete(reverse("sale-detail", args=[bill.pk]), {"reason": "Entered twice"}, format="json")
            self.assertEqual(r.status_code, 200, r.data)
            self.assertEqual(clear.call_args_list, [])
            asked.append([q["sql"] for q in seen.captured_queries])
        one, twenty = asked
        self.assertEqual(len(twenty), len(one))
        self.assertEqual([sql for sql in twenty if 'SUM("billing_lineitem"."amount")' in sql
                          or sql.startswith('UPDATE "billing_invoice"')], [])

    def test_a_one_off_line_save_or_delete_still_clears_the_bills_total(self):
        # The resync stays for what it's for: an admin's or a shell's one-off line write, each asking for a clear.
        bill = self.bill("4", 2)
        first, second = LineItem.objects.filter(invoice=bill).order_by("pk")
        first.amount += 1
        with override_settings(**LIVE), patch("cacheops.invalidate_model") as clear:
            first.save()
        self.assertEqual(clear.call_args_list, [call(Invoice)])
        self.assertEqual(Invoice.objects.get(pk=bill.pk).total_amount, first.amount + second.amount)
        with override_settings(**LIVE), patch("cacheops.invalidate_model") as clear:
            second.delete()
        self.assertEqual(clear.call_args_list, [call(Invoice)])
        self.assertEqual(Invoice.objects.get(pk=bill.pk).total_amount, first.amount)


class OneClearPerTransactionTest(TransactionTestCase):
    """cacheops queues a transaction's clears for its commit; billing.cache.invalidate() queues each model once, so the
    commit scans Redis once per model however often the transaction asked. Real commits here (TransactionTestCase),
    with Redis a mock that counts the scans."""

    @contextmanager
    def redis(self):
        with override_settings(**LIVE), patch("cacheops.invalidation.redis_client") as redis:
            redis.keys.return_value = []
            yield redis

    @staticmethod
    def scanned(redis):
        """The tables of the KEYS scans made so far."""
        return [scan.args[0].split(":")[-2] for scan in redis.keys.call_args_list]

    def test_a_v2_edit_that_resaves_20_lines_scans_once(self):
        # v2's PATCH of a 20-line bill's customer re-saves every line (Invoice._follow_parties), and each line's resync
        # asks for an Invoice clear: it used to scan 20 times.
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        bill = sale(firm(), buyer(), "1", "2026-09-11", *[line(rate=str(1000 + n)) for n in range(20)])
        rathore = buyer("Rathore Gems")
        with self.redis() as redis:
            r = owner.patch(reverse("invoice-detail", args=[bill.pk]), {"customer": rathore.pk}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.scanned(redis), ["billing_invoice"])
        self.assertEqual(set(LineItem.objects.filter(invoice=bill).values_list("customer_id", flat=True)), {rathore.pk})

    def test_a_marker_that_cant_be_kept_still_clears_every_model(self):
        # Review fix 1: the bookkeeping is the dedupe's only; when it fails, each model still gets its clear.
        from cacheops.transaction import TransactionState

        push = TransactionState.push

        def failing(state, item):
            if type(item[0]).__name__ == "_Waiting":
                raise AttributeError("no push here")
            return push(state, item)

        with self.redis() as redis, patch.object(TransactionState, "push", failing):
            with transaction.atomic():
                invalidate(Invoice, LineItem)
            self.assertEqual(self.scanned(redis), ["billing_invoice", "billing_lineitem"])

    def test_a_clear_waits_for_the_commit_and_goes_with_a_rolled_back_savepoint(self):
        with self.redis() as redis:
            invalidate(Invoice)  # outside a transaction: at once
            self.assertEqual(self.scanned(redis), ["billing_invoice"])
            redis.reset_mock()
            with transaction.atomic():
                with suppress(RuntimeError), transaction.atomic():
                    invalidate(LineItem)
                    raise RuntimeError  # its writes are undone, and so is its clear
                invalidate(Invoice, LineItem)
                invalidate(LineItem)
                with transaction.atomic():
                    invalidate(Invoice)
                self.assertEqual(self.scanned(redis), [])  # nothing before the commit
            self.assertEqual(self.scanned(redis), ["billing_invoice", "billing_lineitem"])
