"""GST summary, GSTR-1 export and GSTR-1 portal JSON (audit F2).

Moved verbatim out of ``InvoiceViewSet`` actions; the view keeps the routing
decorators and delegates here. ``view`` is the ViewSet instance (the summary
and export use its queryset helpers).
"""

from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.response import Response

from billing.models import Business, Invoice, LineItem
from billing.tax_rules import classify_b2c, rate_as_percent

TWO_PLACES = Decimal("0.01")


def gst_summary(view, request):
    """Server-side GST summary for GSTR-1/3B — grouped by rate slab and HSN."""
    queryset = view.get_queryset()
    invoice_ids = list(queryset.values_list("id", flat=True))
    items = LineItem.objects.filter(invoice_id__in=invoice_ids)
    # business_id from query string — used for the per-business ECRRS ledger
    # below. None when querying across all businesses.
    try:
        business_id = int(request.query_params.get("business_id") or 0) or None
    except (TypeError, ValueError):
        business_id = None

    # 1. Rate-wise breakdown (GSTR-1 style).
    #
    # Was: a for-loop over ["outward","inward"] firing two separate
    # GROUP-BY queries against LineItem. With ~100ms remote-DB round
    # trip latency that's ~200ms baseline.
    #
    # Now: a single GROUP-BY on (type_of_invoice, gst_tax_rate). One
    # query, bucketed into outward/inward in Python.
    rate_slabs = {"outward": [], "inward": []}
    slab_data = (
        items
        .values("invoice__type_of_invoice", "gst_tax_rate")
        .annotate(
            taxable=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
            cgst=Coalesce(Sum("cgst"), Decimal("0")),
            sgst=Coalesce(Sum("sgst"), Decimal("0")),
            igst=Coalesce(Sum("igst"), Decimal("0")),
            total=Coalesce(Sum("amount"), Decimal("0")),
            count=Count("invoice", distinct=True),
        )
        .order_by("invoice__type_of_invoice", "gst_tax_rate")
    )
    # The query groups by the raw stored rate but the label is the resolved
    # percent, so a book holding pre-repair 0.25 rows next to repaired
    # 0.0025 rows produced two "0.25%" slabs. Merge on the resolved rate.
    merged = {}
    for row in slab_data:
        inv_type = row["invoice__type_of_invoice"]
        if inv_type not in rate_slabs:
            continue
        key = (inv_type, float(rate_as_percent(row["gst_tax_rate"])))
        slab = merged.setdefault(key, {
            "rate": key[1], "taxable": 0.0, "cgst": 0.0, "sgst": 0.0,
            "igst": 0.0, "total": 0.0, "invoice_count": 0,
        })
        for field in ("taxable", "cgst", "sgst", "igst", "total"):
            slab[field] += float(row[field])
        slab["invoice_count"] += row["count"]
    for (inv_type, _rate), slab in merged.items():
        rate_slabs[inv_type].append(slab)

    # 2. HSN-wise breakdown
    hsn_data = (
        items
        .values("hsn_code")
        .annotate(
            taxable=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
            cgst=Coalesce(Sum("cgst"), Decimal("0")),
            sgst=Coalesce(Sum("sgst"), Decimal("0")),
            igst=Coalesce(Sum("igst"), Decimal("0")),
            total=Coalesce(Sum("amount"), Decimal("0")),
            total_qty=Coalesce(Sum("quantity"), Decimal("0")),
            count=Count("id"),
        )
        .order_by("-taxable")
    )
    hsn_summary = [
        {
            "hsn_code": h["hsn_code"] or "N/A",
            "taxable": float(h["taxable"]),
            "cgst": float(h["cgst"]),
            "sgst": float(h["sgst"]),
            "igst": float(h["igst"]),
            "total": float(h["total"]),
            "qty": float(h["total_qty"]),
            "count": h["count"],
        }
        for h in hsn_data
    ]

    # 3. GSTR-3B summary (net tax) — one aggregate with Q-filter
    #    pairs instead of two .filter().aggregate() round-trips.
    from django.db.models import Q as _Q
    combined = items.aggregate(
        outward_cgst=Coalesce(Sum("cgst", filter=_Q(invoice__type_of_invoice="outward")), Decimal("0")),
        outward_sgst=Coalesce(Sum("sgst", filter=_Q(invoice__type_of_invoice="outward")), Decimal("0")),
        outward_igst=Coalesce(Sum("igst", filter=_Q(invoice__type_of_invoice="outward")), Decimal("0")),
        inward_cgst=Coalesce(Sum("cgst", filter=_Q(invoice__type_of_invoice="inward")), Decimal("0")),
        inward_sgst=Coalesce(Sum("sgst", filter=_Q(invoice__type_of_invoice="inward")), Decimal("0")),
        inward_igst=Coalesce(Sum("igst", filter=_Q(invoice__type_of_invoice="inward")), Decimal("0")),
    )
    outward_tax = {"cgst": combined["outward_cgst"], "sgst": combined["outward_sgst"], "igst": combined["outward_igst"]}
    inward_tax = {"cgst": combined["inward_cgst"], "sgst": combined["inward_sgst"], "igst": combined["inward_igst"]}
    gstr3b = {
        "output_tax": {
            "cgst": float(outward_tax["cgst"]),
            "sgst": float(outward_tax["sgst"]),
            "igst": float(outward_tax["igst"]),
            "total": float(outward_tax["cgst"] + outward_tax["sgst"] + outward_tax["igst"]),
        },
        "input_tax_credit": {
            "cgst": float(inward_tax["cgst"]),
            "sgst": float(inward_tax["sgst"]),
            "igst": float(inward_tax["igst"]),
            "total": float(inward_tax["cgst"] + inward_tax["sgst"] + inward_tax["igst"]),
        },
        "net_payable": {
            "cgst": float(outward_tax["cgst"] - inward_tax["cgst"]),
            "sgst": float(outward_tax["sgst"] - inward_tax["sgst"]),
            "igst": float(outward_tax["igst"] - inward_tax["igst"]),
            "total": float(
                (outward_tax["cgst"] + outward_tax["sgst"] + outward_tax["igst"])
                - (inward_tax["cgst"] + inward_tax["sgst"] + inward_tax["igst"])
            ),
        },
    }

    # ── GSTR-3B Table 4 (current portal structure as of May 2026) ──
    # Sub-rows: 4(A)(1) imports, 4(A)(5) all other ITC (= current period
    # inward tax), 4(B)(1) non-reclaimable reversal, 4(B)(2) reclaimable
    # reversal, 4(C) Net = 4(A) - 4(B), 4(D)(1) reclaimed, 4(D)(2) ineligible.
    # The reversal/reclaim rows aren't tracked by line item yet, so they
    # default to 0 — the frontend lets the user override them per period.
    # The ECRRS opening balance comes from the ITCReclaimLedger model
    # (per-business). When the user is viewing "All Businesses" we
    # aggregate the opening balances across every ledger so the
    # carry-forward card on the frontend stays accurate — previously this
    # was just None for the All-Businesses view, which silently hid the
    # number the user came here looking for.
    from billing.models import ITCReclaimLedger
    opening_balance = None
    if business_id:
        ledger = ITCReclaimLedger.objects.filter(business_id=business_id).first()
        if ledger:
            cgst = float(ledger.opening_cgst or 0)
            sgst = float(ledger.opening_sgst or 0)
            igst = float(ledger.opening_igst or 0)
            opening_balance = {
                "cgst": cgst,
                "sgst": sgst,
                "igst": igst,
                "total": cgst + sgst + igst,
                "as_of": ledger.opening_as_of.isoformat() if ledger.opening_as_of else None,
                "business_count": 1,
                "configured": True,
            }
    else:
        agg = ITCReclaimLedger.objects.aggregate(
            c=Sum("opening_cgst"),
            s=Sum("opening_sgst"),
            i=Sum("opening_igst"),
        )
        c = float(agg["c"] or 0)
        s = float(agg["s"] or 0)
        i = float(agg["i"] or 0)
        biz_count = ITCReclaimLedger.objects.exclude(
            Q(opening_cgst=0) & Q(opening_sgst=0) & Q(opening_igst=0)
        ).count()
        # Surface even a 0-total response so the frontend can distinguish
        # "no business has a ledger" from "ledger exists but is zero".
        opening_balance = {
            "cgst": c,
            "sgst": s,
            "igst": i,
            "total": c + s + i,
            "as_of": None,
            "business_count": biz_count,
            "configured": biz_count > 0,
        }

    gstr3b_table4 = {
        # 4(A) ITC Available
        "a_1_imports_goods": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "a_2_imports_services": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "a_3_rcm": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "a_4_isd": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "a_5_all_other_itc": {
            "cgst": float(inward_tax["cgst"]),
            "sgst": float(inward_tax["sgst"]),
            "igst": float(inward_tax["igst"]),
        },
        "a_total": {
            "cgst": float(inward_tax["cgst"]),
            "sgst": float(inward_tax["sgst"]),
            "igst": float(inward_tax["igst"]),
        },
        # 4(B) ITC Reversed — kept at 0 until per-line reversal tracking lands
        "b_1_non_reclaimable": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "b_2_reclaimable": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "b_total": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        # 4(C) Net ITC available = 4(A) - 4(B)
        "c_net_itc": {
            "cgst": float(inward_tax["cgst"]),
            "sgst": float(inward_tax["sgst"]),
            "igst": float(inward_tax["igst"]),
        },
        # 4(D) Other details
        "d_1_reclaimed": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        "d_2_ineligible": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
        # ECRRS reclaim ledger context
        "ecrrs_opening_balance": opening_balance,
        "ecrrs_closing_balance": opening_balance,  # opening + 4(B)(2) - 4(D)(1); both 0 for now
    }

    # ── ITC Aging (Sec 16(4) cut-off) ──
    # ITC must be claimed by Nov 30 of the FY *following* the invoice date,
    # else it's forfeit. Bucket inward invoices by days-until-cutoff and
    # surface anything within 60 days as urgent.
    from datetime import date as _date
    today = timezone.localdate()
    inward_with_dates = (
        queryset.filter(type_of_invoice="inward")
        .values("id", "invoice_number", "invoice_date", "total_amount")
        .annotate(
            tax=Coalesce(
                Sum(F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst")),
                Decimal("0"),
            ),
        )
    )
    aging_buckets = {
        "fresh": {"label": "≤ 60 days to cutoff", "count": 0, "tax": 0.0},
        "warning": {"label": "60–180 days", "count": 0, "tax": 0.0},
        "stale": {"label": "180+ days (still claimable)", "count": 0, "tax": 0.0},
        "expired": {"label": "Past Sec 16(4) cutoff (forfeit)", "count": 0, "tax": 0.0},
    }
    urgent_invoices = []
    for inv in inward_with_dates:
        inv_date = inv["invoice_date"]
        if not inv_date:
            continue
        # FY of invoice: Apr-Mar
        fy_start = inv_date.year if inv_date.month >= 4 else inv_date.year - 1
        cutoff = _date(fy_start + 1, 11, 30)  # Nov 30 of following FY
        days_left = (cutoff - today).days
        tax_amt = float(inv["tax"])
        if days_left < 0:
            bucket = "expired"
        elif days_left <= 60:
            bucket = "fresh"
        elif days_left <= 180:
            bucket = "warning"
        else:
            bucket = "stale"
        aging_buckets[bucket]["count"] += 1
        aging_buckets[bucket]["tax"] += tax_amt
        if bucket in ("fresh", "expired") and len(urgent_invoices) < 50:
            urgent_invoices.append({
                "id": inv["id"],
                "invoice_number": inv["invoice_number"],
                "invoice_date": inv_date.isoformat(),
                "total_amount": float(inv["total_amount"]),
                "tax": tax_amt,
                "cutoff": cutoff.isoformat(),
                "days_left": days_left,
                "bucket": bucket,
            })
    urgent_invoices.sort(key=lambda x: x["days_left"])

    # ── GSTR-1 vs GSTR-3B reconciliation ──
    # In a clean book, the rate-slab tax (cgst+sgst+igst per rate) should
    # match GSTR-3B output_tax exactly. Variance != 0 hints at line items
    # with missing/wrong rate annotations or out-of-band tax adjustments.
    gstr1_total_tax = sum(
        r["cgst"] + r["sgst"] + r["igst"]
        for r in rate_slabs.get("outward", [])
    )
    gstr1_3b_recon = {
        "gstr1_total_tax": gstr1_total_tax,
        "gstr3b_output_tax": gstr3b["output_tax"]["total"],
        "variance": gstr3b["output_tax"]["total"] - gstr1_total_tax,
    }

    # ── Effective ITC + Net Tax including carry-forward ──
    # The user came looking for "last year's carry-forward GST" on the
    # main summary, not buried inside Table 4. We compute effective
    # numbers here so the frontend can show:
    #     Output Tax            = period output
    #     Current-period ITC    = period inward tax
    # +   Carry-forward ITC     = opening balance from ledger
    # =   Effective ITC         = sum of the two
    # =   Effective Net Tax     = Output - Effective ITC
    carry_total = opening_balance["total"] if opening_balance else 0.0
    current_itc_total = gstr3b["input_tax_credit"]["total"]
    output_total = gstr3b["output_tax"]["total"]
    effective = {
        "carry_forward_itc": carry_total,
        "current_itc": current_itc_total,
        "effective_itc": current_itc_total + carry_total,
        "effective_net_tax": output_total - (current_itc_total + carry_total),
    }

    return Response({
        "rate_slabs": rate_slabs,
        "hsn_summary": hsn_summary,
        "gstr3b": gstr3b,
        "gstr3b_table4": gstr3b_table4,
        "itc_aging": {
            "buckets": aging_buckets,
            "urgent_invoices": urgent_invoices,
        },
        "gstr1_3b_recon": gstr1_3b_recon,
        # Promoted to top-level so the Summary view doesn't have to
        # reach into gstr3b_table4.ecrrs_opening_balance. Keeps the old
        # nested copy for backwards compat with the GSTR-3B tab.
        "carry_forward_itc": opening_balance,
        "effective": effective,
    })



def gstr_export(view, request):
    """Export GSTR-1, GSTR-3B, and 2B matching data in GST portal format."""
    queryset = view.get_queryset()
    invoice_ids = list(queryset.values_list("id", flat=True))

    # Prefetch line items so the per-invoice loops below don't fire one
    # query per invoice (the previous N+1 made this endpoint take ~12s
    # for ~95 invoices over a remote-DB connection).
    outward_invoices = list(
        queryset.filter(type_of_invoice="outward")
        .select_related("customer", "business")
        .prefetch_related("lineitem_set")
    )
    inward_invoices = list(
        queryset.filter(type_of_invoice="inward")
        .select_related("customer", "business")
        .prefetch_related("lineitem_set")
    )

    # ── GSTR-1 ──

    # B2B: Invoices to registered dealers (customer has GSTIN)
    b2b_data = {}
    for inv in outward_invoices:
        cust_gst = inv.customer.gst_number.strip() if inv.customer.gst_number else ""
        if not cust_gst or len(cust_gst) < 15:
            continue  # Skip unregistered
        items = inv.lineitem_set.all()
        inv_items = []
        for li in items:
            inv_items.append({
                "num": int(li.id),
                "itm_det": {
                    "txval": float(li.quantity * li.rate),
                    "rt": float(rate_as_percent(li.gst_tax_rate)),
                    "camt": float(li.cgst),
                    "samt": float(li.sgst),
                    "iamt": float(li.igst),
                },
            })
        if cust_gst not in b2b_data:
            b2b_data[cust_gst] = {"ctin": cust_gst, "inv": []}
        b2b_data[cust_gst]["inv"].append({
            "inum": inv.invoice_number,
            "idt": inv.invoice_date.strftime("%d-%m-%Y") if inv.invoice_date else "",
            "val": float(inv.total_amount),
            "pos": inv.customer.gst_number[:2] if inv.customer.gst_number else "",
            "rchrg": "N",
            "inv_typ": "R",
            "itms": inv_items,
        })
    b2b = list(b2b_data.values())

    # B2CS: Invoices to unregistered (no GSTIN, intra-state, <=2.5L)
    # B2C (unregistered buyers). One pass, because two independent passes
    # is how the gap appeared: the B2CS loop skipped every inter-state
    # invoice ("goes to B2CL") while the B2CL loop skipped everything at or
    # under B2CL_THRESHOLD — so an inter-state B2C sale below the threshold
    # was filed in NEITHER table and simply vanished from GSTR-1.
    #
    # The rule, matching gstr1_portal_json: inter-state above the threshold
    # is B2CL; everything else consolidates into B2CS, tagged INTER or
    # INTRA and carrying the head it was actually taxed under.
    #
    # Sums are Decimal and rounded once at the end. Accumulating with
    # `float +=` produced artifacts like 3.0000000000000004 in figures that
    # go to the portal.
    b2cs_agg = {}
    b2cl = []
    warnings = []
    flagged = set()
    for inv in outward_invoices:
        table, inter, pos, _downgraded = classify_b2c(inv.business, inv)
        if table == "b2b":
            continue  # Registered — belongs in B2B

        items = inv.lineitem_set.all()

        if table == "b2cl":
            b2cl.append({
                "pos": pos,
                "inv": [{
                    "inum": inv.invoice_number,
                    "idt": inv.invoice_date.strftime("%d-%m-%Y") if inv.invoice_date else "",
                    "val": float(inv.total_amount),
                    "itms": [{
                        "num": int(li.id),
                        "itm_det": {
                            "txval": float(li.quantity * li.rate),
                            "rt": float(rate_as_percent(li.gst_tax_rate)),
                            "iamt": float(li.igst),
                        },
                    } for li in items],
                }],
            })
            continue

        sply = "INTER" if inter else "INTRA"
        for li in items:
            rate = float(rate_as_percent(li.gst_tax_rate))
            key = (sply, pos, rate)
            agg = b2cs_agg.setdefault(key, {
                "sply_ty": sply, "pos": pos, "typ": "OE", "rt": rate,
                "txval": Decimal("0"), "camt": Decimal("0"),
                "samt": Decimal("0"), "iamt": Decimal("0"),
            })
            agg["txval"] += (li.quantity or 0) * (li.rate or 0)
            agg["camt"] += li.cgst or Decimal("0")
            agg["samt"] += li.sgst or Decimal("0")
            agg["iamt"] += li.igst or Decimal("0")
            # A row tagged one way but taxed the other is a pre-repair
            # line; say so, as gstr1_portal_json does, instead of handing
            # over a file the portal will reject.
            wrong = (sply == "INTER" and (li.cgst or li.sgst)) or (sply == "INTRA" and li.igst)
            if wrong and inv.id not in flagged:
                flagged.add(inv.id)
                heads = "CGST/SGST" if sply == "INTER" else "IGST"
                warnings.append(
                    f"{inv.invoice_number}: {sply.lower()}-state supply carries {heads} — run fix_tax_heads"
                )

    b2cs = [
        {**row, **{k: float(row[k].quantize(TWO_PLACES))
                   for k in ("txval", "camt", "samt", "iamt")}}
        for row in b2cs_agg.values()
    ]

    # HSN Summary
    items_all = LineItem.objects.filter(invoice_id__in=invoice_ids)
    hsn_agg = {}
    for li in items_all.filter(invoice__type_of_invoice="outward"):
        hsn = li.hsn_code or "0"
        if hsn not in hsn_agg:
            hsn_agg[hsn] = {"hsn_sc": hsn, "qty": 0, "txval": 0, "camt": 0, "samt": 0, "iamt": 0}
        hsn_agg[hsn]["qty"] += float(li.quantity)
        hsn_agg[hsn]["txval"] += float(li.quantity * li.rate)
        hsn_agg[hsn]["camt"] += float(li.cgst)
        hsn_agg[hsn]["samt"] += float(li.sgst)
        hsn_agg[hsn]["iamt"] += float(li.igst)
    hsn = list(hsn_agg.values())

    gstr1 = {"b2b": b2b, "b2cs": b2cs, "b2cl": b2cl, "hsn": {"data": hsn}}

    # ── GSTR-3B ──
    outward_items = items_all.filter(invoice__type_of_invoice="outward")
    inward_items = items_all.filter(invoice__type_of_invoice="inward")

    ot = outward_items.aggregate(
        txval=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
        cgst=Coalesce(Sum("cgst"), Decimal("0")),
        sgst=Coalesce(Sum("sgst"), Decimal("0")),
        igst=Coalesce(Sum("igst"), Decimal("0")),
    )
    it = inward_items.aggregate(
        txval=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
        cgst=Coalesce(Sum("cgst"), Decimal("0")),
        sgst=Coalesce(Sum("sgst"), Decimal("0")),
        igst=Coalesce(Sum("igst"), Decimal("0")),
    )

    gstr3b = {
        "sup_details": {
            "osup_det": {"txval": float(ot["txval"]), "camt": float(ot["cgst"]), "samt": float(ot["sgst"]), "iamt": float(ot["igst"])},
        },
        "itc_elg": {
            # "OTH" = all other ITC (GSTR-3B table 4(A)(5)). This used to say
            # "IMPG" (import of goods), which files every rupee of domestic
            # purchase tax under imports.
            "itc_avl": [{"ty": "OTH", "iamt": float(it["igst"]), "camt": float(it["cgst"]), "samt": float(it["sgst"])}],
        },
        "intr_ltfee": {
            "intr_details": {"iamt": 0, "camt": 0, "samt": 0},
        },
        "tax_pmt": {
            "cgst": float(ot["cgst"] - it["cgst"]),
            "sgst": float(ot["sgst"] - it["sgst"]),
            "igst": float(ot["igst"] - it["igst"]),
        },
    }

    # ── GSTR-2B Matching (basic) ──
    # Compare inward invoices against expected data
    inward_list = []
    for inv in inward_invoices:
        items = inv.lineitem_set.all()
        total_tax = sum(float(li.cgst + li.sgst + li.igst) for li in items)
        total_taxable = sum(float(li.quantity * li.rate) for li in items)
        inward_list.append({
            "invoice_number": inv.invoice_number,
            "invoice_date": inv.invoice_date.strftime("%d-%m-%Y") if inv.invoice_date else "",
            "supplier_name": inv.customer.name,
            "supplier_gstin": inv.customer.gst_number or "",
            "taxable_value": total_taxable,
            "tax_amount": total_tax,
            "total": float(inv.total_amount),
        })

    return Response({
        "gstr1": gstr1,
        "gstr3b": gstr3b,
        "gstr2b": {"inward_invoices": inward_list},
        "warnings": warnings,
    })



def gstr1_portal_json(view, request):
    """GSTR-1 as the GST portal offline tool's import JSON.

    One business, one month — that's the granularity the portal files at,
    so unlike gstr_export this endpoint refuses to run without both.
    Returns {"file": <upload as-is>, "meta": {counts, skipped, warnings}}:
    only `file` goes to the portal; extra keys inside it break the import,
    which is why the diagnostics live outside it.

    Differences from the gstr_export shape that the portal cares about:
    - gstin/fp header present, values quantized to exactly 2 decimals
      (float artifacts like 0.30000000000000004 fail schema validation)
    - b2cs carries the mandatory sply_ty, and inter-state B2C sales at or
      under the B2CL threshold are filed here as INTER rows — previously
      they fell through both sections and were silently missing
    - b2cl groups invoices under one entry per place of supply
    - per-invoice items are aggregated per rate slab with serial nums
    - HSN summary (table 12, mandatory since 2021) is included
    """
    try:
        business = Business.objects.get(id=int(request.query_params.get("business_id") or 0))
    except (ValueError, Business.DoesNotExist):
        return Response({"error": "A valid business_id is required."}, status=400)
    try:
        month = int(request.query_params.get("month") or 0)
        year = int(request.query_params.get("year") or 0)
        assert 1 <= month <= 12 and 2017 <= year <= 2099
    except (ValueError, AssertionError):
        return Response({"error": "month (1-12) and year are required."}, status=400)

    gstin = (business.gst_number or "").strip().upper()
    if len(gstin) != 15:
        return Response(
            {"error": f"Business '{business.name}' has no 15-character GSTIN — "
                      "set it before generating a portal file."},
            status=400,
        )

    def r2(x):
        return float(Decimal(x or 0).quantize(TWO_PLACES))

    def rate_pct(li):
        r = li.gst_tax_rate or Decimal(0)
        return float(rate_as_percent(r))

    UQC = {"gms": "GMS", "gm": "GMS", "g": "GMS", "kg": "KGS", "kgs": "KGS",
           "pcs": "PCS", "pc": "PCS", "nos": "NOS", "carat": "CTM", "ct": "CTM"}

    invoices = (
        Invoice.objects.filter(
            business=business, type_of_invoice="outward",
            invoice_date__year=year, invoice_date__month=month,
        )
        .select_related("customer")
        .prefetch_related("lineitem_set")
        .order_by("invoice_date", "id")
    )

    skipped, warnings = [], []
    b2b_data, b2cl_data, b2cs_agg, hsn_agg = {}, {}, {}, {}
    counts = {"b2b": 0, "b2cl": 0, "b2cs": 0}

    def slabs(items):
        """Aggregate an invoice's lines into per-rate slabs (portal itms)."""
        agg = {}
        for li in items:
            rt = rate_pct(li)
            s = agg.setdefault(rt, {"txval": Decimal(0), "camt": Decimal(0),
                                    "samt": Decimal(0), "iamt": Decimal(0)})
            s["txval"] += (li.quantity or 0) * (li.rate or 0)
            s["camt"] += li.cgst or 0
            s["samt"] += li.sgst or 0
            s["iamt"] += li.igst or 0
        return agg

    for inv in invoices:
        items = list(inv.lineitem_set.all())
        label = f"{inv.invoice_number or '(no number)'} / {inv.invoice_date}"
        if not inv.invoice_number or not inv.invoice_date:
            skipped.append(f"{label}: missing invoice number or date")
            continue
        if not items:
            skipped.append(f"{label}: no line items")
            continue

        agg = slabs(items)
        idt = inv.invoice_date.strftime("%d-%m-%Y")
        val = r2(inv.total_amount)
        cust_gstin = (inv.customer.gst_number or "").strip().upper()

        if len(cust_gstin) == 15:
            itms = [
                {"num": i + 1, "itm_det": {
                    "txval": r2(s["txval"]), "rt": rt,
                    "camt": r2(s["camt"]), "samt": r2(s["samt"]),
                    "iamt": r2(s["iamt"]), "csamt": 0,
                }}
                for i, (rt, s) in enumerate(sorted(agg.items()))
            ]
            b2b_data.setdefault(cust_gstin, {"ctin": cust_gstin, "inv": []})["inv"].append({
                "inum": inv.invoice_number, "idt": idt, "val": val,
                "pos": cust_gstin[:2], "rchrg": "N", "inv_typ": "R", "itms": itms,
            })
            counts["b2b"] += 1
            continue

        table, inter, pos, downgraded = classify_b2c(business, inv)
        if downgraded:
            warnings.append(f"{label}: inter-state but customer state unknown — filed as intra-state")

        if table == "b2cl":
            itms = [
                {"num": i + 1, "itm_det": {
                    "txval": r2(s["txval"]), "rt": rt,
                    "iamt": r2(s["iamt"]), "csamt": 0,
                }}
                for i, (rt, s) in enumerate(sorted(agg.items()))
            ]
            b2cl_data.setdefault(pos, {"pos": pos, "inv": []})["inv"].append({
                "inum": inv.invoice_number, "idt": idt, "val": val, "itms": itms,
            })
            counts["b2cl"] += 1
            continue

        # Consolidated B2C: intra-state at any value, inter-state <= threshold.
        sply = "INTER" if inter else "INTRA"
        for rt, s in agg.items():
            b = b2cs_agg.setdefault((sply, pos, rt), {
                "sply_ty": sply, "pos": pos, "typ": "OE", "rt": rt,
                "txval": Decimal(0), "camt": Decimal(0),
                "samt": Decimal(0), "iamt": Decimal(0),
            })
            b["txval"] += s["txval"]
            b["camt"] += s["camt"]
            b["samt"] += s["samt"]
            b["iamt"] += s["iamt"]
            if sply == "INTRA" and s["iamt"]:
                warnings.append(f"{label}: intra-state supply carries IGST — run fix_tax_heads")
            if sply == "INTER" and (s["camt"] or s["samt"]):
                warnings.append(f"{label}: inter-state supply carries CGST/SGST — run fix_tax_heads")
        counts["b2cs"] += 1

    # HSN summary (table 12) over everything that made it into the file.
    for inv in invoices:
        if not inv.invoice_number or not inv.invoice_date:
            continue
        for li in inv.lineitem_set.all():
            hsn = (li.hsn_code or "").strip()
            uqc = UQC.get((li.unit or "").strip().lower(), "OTH")
            rt = rate_pct(li)
            h = hsn_agg.setdefault((hsn, uqc, rt), {
                "hsn_sc": hsn, "desc": (li.product_name or "")[:30], "uqc": uqc,
                "rt": rt, "qty": Decimal(0), "txval": Decimal(0),
                "camt": Decimal(0), "samt": Decimal(0), "iamt": Decimal(0),
            })
            h["qty"] += li.quantity or 0
            h["txval"] += (li.quantity or 0) * (li.rate or 0)
            h["camt"] += li.cgst or 0
            h["samt"] += li.sgst or 0
            h["iamt"] += li.igst or 0
            if not hsn:
                warnings.append(f"{inv.invoice_number}: line '{li.product_name}' has no HSN")

    fp = f"{month:02d}{year}"
    file_obj = {"gstin": gstin, "fp": fp, "version": "GST3.2.1", "hash": "hash"}
    if b2b_data:
        file_obj["b2b"] = list(b2b_data.values())
    if b2cl_data:
        file_obj["b2cl"] = list(b2cl_data.values())
    if b2cs_agg:
        file_obj["b2cs"] = [
            {"sply_ty": b["sply_ty"], "pos": b["pos"], "typ": b["typ"], "rt": b["rt"],
             "txval": r2(b["txval"]),
             **({"iamt": r2(b["iamt"])} if b["sply_ty"] == "INTER"
                else {"camt": r2(b["camt"]), "samt": r2(b["samt"])}),
             "csamt": 0}
            for b in b2cs_agg.values()
        ]
    if hsn_agg:
        file_obj["hsn"] = {"data": [
            {"num": i + 1, "hsn_sc": h["hsn_sc"], "desc": h["desc"], "uqc": h["uqc"],
             "qty": r2(h["qty"]), "rt": h["rt"], "txval": r2(h["txval"]),
             "camt": r2(h["camt"]), "samt": r2(h["samt"]),
             "iamt": r2(h["iamt"]), "csamt": 0}
            for i, h in enumerate(hsn_agg.values())
        ]}

    total_txval = sum(
        r2(b["txval"]) for b in b2cs_agg.values()
    ) + sum(
        i["itm_det"]["txval"] for g in b2b_data.values() for v in g["inv"] for i in v["itms"]
    ) + sum(
        i["itm_det"]["txval"] for g in b2cl_data.values() for v in g["inv"] for i in v["itms"]
    )

    return Response({
        "file": file_obj,
        "meta": {
            "business": business.name, "gstin": gstin, "fp": fp,
            "invoice_counts": counts,
            "taxable_total": round(total_txval, 2),
            "skipped": skipped, "warnings": warnings,
        },
    })

