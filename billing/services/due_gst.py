"""Part-3 service adapter and contract wording. No GST rule is recomputed here."""
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count

from billing.cache import uncached
from billing.fy import due_dates, fy_label, fy_of
from billing.models import Invoice
from billing.rates import firm_short
from billing.services.dashboard import month_keys
from billing.services.due import item, possessive
from billing.text import day_text, inr, money, person


def total(heads):
    return sum((heads.get(key, Decimal("0")) for key in ("igst", "cgst", "sgst")), Decimal("0"))


def join_names(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def gst_items(keys, firms, today, facts):
    out = []
    ended = today.replace(day=1) - timedelta(days=1)
    month, name = ended.strftime("%Y-%m"), ended.strftime("%B")
    dates = due_dates(ended.year, ended.month)
    stages, blocks = facts["stages"], facts["blocks"]
    if "gst.file" in keys:
        for f in firms:
            floor = max(facts["latest"].get(f.pk) or "0000-00", f"{fy_of(today) - 1}-03")
            for (firm_id, key), block in sorted(blocks.items()):
                if firm_id != f.pk or not floor < key <= month or not block["count"] or stages.get((firm_id, key)) in {"gstr1", "filed", "unlocked"}:
                    continue
                day = date.fromisoformat(key + "-01")
                due = due_dates(day.year, day.month)["gstr1"]
                count = block["count"]
                title = block["first_two"][0] if count == 1 else f"{count} problems stop {possessive(firm_short(f))} {day.strftime('%B')} GSTR-1"
                out.append(item("blocker", count, title,
                    f"{f.name} · {day.strftime('%B %Y')} GSTR-1 can't be filed until {'it’s' if count == 1 else 'they’re'} fixed".replace("’", "'"),
                    due, f.pk, key, badge="home_dot" if (due - today).days <= 3 else None))
        ready = [f for f in firms if stages.get((f.pk, month)) == "ready"]
        if ready and (dates["gstr1"] - today).days <= 15:
            names = ready[0].name if len(ready) == 1 else join_names([firm_short(f) for f in ready])
            out.append(item("file_gstr1", len(ready), f"File {name} GSTR-1 for {names}",
                "Every check passes · " + ("ready for the portal" if len(ready) == 1 else "all ready for the portal"),
                dates["gstr1"], ready[0].pk, month))
        waiting = [f for f in firms if stages.get((f.pk, month)) != "filed"]
        if waiting and (dates["gstr3b"] - today).days <= 15:
            payers = sorted(waiting, key=lambda f: -total(facts["positions"][f.pk]["cash"]))
            cash = sum((total(facts["positions"][f.pk]["cash"]) for f in payers), Decimal("0"))
            paying = [f for f in payers if total(facts["positions"][f.pk]["cash"]) > 0]
            covered = [f for f in payers if f not in paying]
            detail = "Credit covers the tax; nothing to pay in cash"
            if cash > 0:
                parts = [name, *(f"{firm_short(f)} {inr(total(facts['positions'][f.pk]['cash']))}" for f in paying)]
                if covered:
                    parts.append(f"{join_names([firm_short(f) for f in covered])}: credit covers it")
                detail = " · ".join(parts)
            out.append(item("pay_3b", len(waiting), f"Pay {inr(cash)} GSTR-3B tax in cash" if cash > 0 else f"File {name} GSTR-3B",
                            detail, dates["gstr3b"], payers[0].pk, month))
    if "bill.edit" in keys:
        for f in firms:
            key = today.strftime("%Y-%m")
            block = blocks.get((f.pk, key), {})
            count = block.get("bills", 0)
            if count:
                name_now = today.strftime("%B")
                out.append(item("open_blocker", count,
                    f"{count} {name_now} {'bill needs' if count == 1 else 'bills need'} fixing before {name_now}'s GSTR-1",
                    f"{f.name} · {'; '.join(block['first_two'])}", due_dates(today.year, today.month)["gstr1"], f.pk, key))
    risk = facts["risk"]
    if "gst.file" in keys and risk["count"]:
        count = risk["count"]
        out.append(item("credit", count, f"Claim {inr(risk['tax'])} of last year's credit",
            f"{count} purchase {'bill' if count == 1 else 'bills'} from FY {fy_label(fy_of(today) - 1)}; the credit lapses after {day_text(risk['earliest_deadline'])}",
            risk["earliest_deadline"], risk["first_business_id"]))
    return out


def returns_card(firms, today, facts):
    ended = today.replace(day=1) - timedelta(days=1)
    month = ended.strftime("%Y-%m")
    due = due_dates(ended.year, ended.month)
    rows = []
    for firm in firms:
        stage = facts["stages"][(firm.pk, month)]
        position = facts["positions"][firm.pk]
        output, cash = total(position["output"]), total(position["cash"])
        rows.append({"firm": {"id": firm.pk, "name": firm.name, "gst_number": firm.gst_number or ""},
            "stage": stage, "blockers": facts["blocks"].get((firm.pk, month), {}).get("count", 0) if stage == "blocked" else 0,
            "purchases_to_check": facts["reviews"].get(firm.pk, 0), "output": money(output), "cash": money(cash),
            "credit_used": money(output - cash), "carry_on": money(total(position["carry_on"])),
            "gstr1": facts["records"].get((firm.pk, "gstr1")), "gstr3b": facts["records"].get((firm.pk, "gstr3b"))})
    return {"month": month, "gstr1_due": due["gstr1"].isoformat(), "gstr3b_due": due["gstr3b"].isoformat(), "firms": rows}


def collect_gst(firms, today, keys, with_returns):
    from billing.models import FilingRecord
    from billing.services.filing import credit_at_risk_summary, month_stages
    from billing.services.gst_checks import gstr1_blockers
    from billing.services.ledger import month_position
    ids = [f.pk for f in firms]
    ended = today.replace(day=1) - timedelta(days=1)
    month = ended.strftime("%Y-%m")
    # One month_stages call covers every month the scan can reach (P5-3); its stages already fold in v2's
    # whole-month locks, so a locked month is "filed" and never re-checked (P5-2).
    scan = list(month_keys(date(fy_of(today) - 1, 4, 1), ended)) if "gst.file" in keys else [month]
    found = month_stages(ids, scan, today=today)
    stages, latest = found["stages"], found["latest_gstr1"]
    # Blocker text is read only for months month_stages found blocked, plus this month's open bills.
    months = set()
    for firm in firms:
        floor = max(latest.get(firm.pk) or "0000-00", f"{fy_of(today) - 1}-03") if "gst.file" in keys else "0000-00"
        months.update(m for m in scan if m > floor and stages.get((firm.pk, m)) == "blocked")
    if "bill.edit" in keys:
        months.add(today.strftime("%Y-%m"))
    blocks = gstr1_blockers(ids, sorted(months)) if months and (with_returns or keys & {"gst.file", "bill.edit"}) else {}
    need_positions = with_returns or ("gst.file" in keys and (due_dates(ended.year, ended.month)["gstr3b"] - today).days <= 15)
    positions = {f.pk: month_position(f, ended.year, ended.month) for f in firms} if need_positions else {}
    risk = credit_at_risk_summary(ids, today=today) if "gst.file" in keys else {"count": 0}
    records, reviews = {}, {}
    if with_returns:
        rows = uncached(FilingRecord).filter(business_id__in=ids, year=ended.year, month=ended.month, kind__in=["gstr1", "gstr3b"])
        rows = rows.select_related("marked_by").only("business_id", "kind", "filed_on", "arn", "cash_total",
            "marked_by__username", "marked_by__first_name", "marked_by__last_name")
        for row in rows:
            records[row.business_id, row.kind] = {"filed_on": row.filed_on.isoformat(), "arn": row.arn,
                "cash_paid": money(row.cash_total) if row.kind == "gstr3b" and row.cash_total is not None else None,
                "by": person(row.marked_by)}
        reviews = {r["business_id"]: r["count"] for r in uncached(Invoice).counted().filter(
            business_id__in=ids, type_of_invoice="inward", invoice_date__year=ended.year,
            invoice_date__month=ended.month, needs_review=True).order_by().values("business_id").annotate(count=Count("pk"))}
    return {"stages": stages, "latest": latest, "blocks": blocks, "positions": positions, "risk": risk, "records": records, "reviews": reviews}
