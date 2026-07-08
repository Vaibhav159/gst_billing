# Inward Bills Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Inward Bills module — AI-assisted capture (upload → pre-fill → verify → save) plus a browsable purchase register where each recorded bill's original file is viewable/downloadable.

**Architecture:** New inward-focused DRF endpoints + a serializer that exposes the stored file, all over the existing `Invoice`/`LineItem`/`Customer`/`Business` models (`type_of_invoice='inward'`). New React pages (register, add, detail) reusing existing shadcn/ui + data hooks. Extraction reuses `AIInvoiceProcessor`; tax/dedup/GSTIN logic lives in a small pure service so it's unit-testable.

**Tech Stack:** Django REST Framework, `AIInvoiceProcessor` (Gemini), pillow-heif; React + TypeScript + Vite + shadcn/ui + TanStack Query.

---

## File Structure

**Backend**
- Create `billing/api/inward_bills_service.py` — pure functions: `resolve_tax(taxable, rate, intra)`, `compute_lines(lines, intra)`, `gstin_matches(bill_gstin, firm_gstin)`, `find_duplicate(business, invoice_number)`. No DB writes except `find_duplicate` (read-only query).
- Create `billing/api/inward_bills.py` — `InwardBillExtractView`, `InwardBillListCreateView`, `InwardBillDetailView` (APIViews).
- Modify `billing/api/serializers.py` — add `InwardBillSerializer` + `InwardBillListSerializer` (expose `source_file_url`, `source_preview_url`, supplier fields, tax breakup).
- Modify `billing/api/urls.py` — wire `inward-bills/…` routes.
- Create `billing/tests/test_inward_bills.py` — service + endpoint tests.

**Frontend**
- Create `sweet-rebuild-suite-main/src/hooks/useInwardBills.ts` — query/mutation hooks.
- Create `sweet-rebuild-suite-main/src/pages/InwardBills.tsx` — register list + filters.
- Create `sweet-rebuild-suite-main/src/pages/InwardBillAdd.tsx` — capture flow.
- Create `sweet-rebuild-suite-main/src/pages/InwardBillDetail.tsx` — detail + file viewer.
- Modify `sweet-rebuild-suite-main/src/App.tsx` — lazy routes.
- Modify the sidebar nav component — add "Inward Bills" entry.

---

## Task 1: Tax + validation service (pure, TDD)

**Files:**
- Create: `billing/api/inward_bills_service.py`
- Test: `billing/tests/test_inward_bills.py`

- [ ] **Step 1: Write failing tests**

```python
from decimal import Decimal as D
from billing.api.inward_bills_service import resolve_tax, compute_lines, gstin_matches

def test_resolve_tax_intra():
    assert resolve_tax(D("468544"), D("0.03"), intra=True) == (D("7028.16"), D("7028.16"), D("0"))

def test_resolve_tax_inter():
    assert resolve_tax(D("76889.09"), D("0.03"), intra=False) == (D("0"), D("0"), D("2306.67"))

def test_compute_lines_absorbs_roundoff_to_bill_total():
    # two lines, printed total 31533.00, natural sum 31533.24 -> last line absorbs -0.24
    lines = [
        {"taxable": D("5368.80"), "rate": D("0.03")},
        {"taxable": D("25246.00"), "rate": D("0.03")},
    ]
    out, total = compute_lines(lines, intra=True, bill_total=D("31533.00"))
    assert total == D("31533.00")
    assert sum(l["amount"] for l in out) == D("31533.00")
    assert out[0]["cgst"] == D("80.53") and out[1]["cgst"] == D("378.69")

def test_gstin_matches_prefix_state_and_full():
    assert gstin_matches("08AAGPL3375F1ZO", "08AAGPL3375F1ZO") is True
    assert gstin_matches("", "08AAGPL3375F1ZO") is False        # B2C / unregistered
    assert gstin_matches("27AABCR1718E1ZP", "08AAGPL3375F1ZO") is False
```

- [ ] **Step 2: Run — expect ImportError/fail**

Run: `.venv/bin/python -m pytest billing/tests/test_inward_bills.py -q`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

```python
# billing/api/inward_bills_service.py
from decimal import Decimal, ROUND_HALF_UP

def _r(x): return Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def resolve_tax(taxable, rate, intra):
    if intra:
        half = _r(taxable * rate / 2)
        return (half, half, Decimal("0"))
    return (Decimal("0"), Decimal("0"), _r(taxable * rate))

def compute_lines(lines, intra, bill_total=None):
    out = []
    for ln in lines:
        cgst, sgst, igst = resolve_tax(ln["taxable"], ln["rate"], intra)
        amount = _r(ln["taxable"] + cgst + sgst + igst)
        out.append({**ln, "cgst": cgst, "sgst": sgst, "igst": igst, "amount": amount})
    total = sum((l["amount"] for l in out), Decimal("0"))
    if bill_total is not None and out and total != bill_total:
        # absorb round-off into the last line's amount so stored total == printed total
        out[-1]["amount"] = _r(out[-1]["amount"] + (bill_total - total))
        total = bill_total
    return out, total

def gstin_matches(bill_gstin, firm_gstin):
    return bool(bill_gstin) and bool(firm_gstin) and bill_gstin.strip().upper() == firm_gstin.strip().upper()

def find_duplicate(business, invoice_number):
    from billing.models import Invoice
    return (Invoice.objects.defer("source_file", "source_preview")
            .filter(business=business, invoice_number=invoice_number, type_of_invoice="inward")
            .first())
```

- [ ] **Step 4: Run — expect PASS.** `.venv/bin/python -m pytest billing/tests/test_inward_bills.py -q`
- [ ] **Step 5: Commit** — `git add billing/api/inward_bills_service.py billing/tests/test_inward_bills.py && git commit -m "feat(inward-bills): tax + validation service with tests"`

## Task 2: Serializers (expose stored file)

**Files:** Modify `billing/api/serializers.py`

- [ ] **Step 1:** Add `InwardBillListSerializer` (id, business{id,name,gst_number}, customer{id,name,gst_number} as `supplier`, invoice_number, invoice_date, taxable [sum qty*rate], cgst, sgst, igst, total_amount, `has_file`, `source_preview_url`) and `InwardBillSerializer` (adds `line_items`, `source_file_url`). Build URLs with `request.build_absolute_uri(obj.source_file.url)` guarded by truthiness. Test: assert serializer output dict has `source_file_url` set when a file is attached and `None` otherwise (use `RequestFactory`).
- [ ] **Step 2:** Run the serializer test — FAIL then PASS.
- [ ] **Step 3: Commit** — `feat(inward-bills): serializers exposing source file URLs`

## Task 3: List + detail endpoints (register)

**Files:** Create `billing/api/inward_bills.py`; modify `billing/api/urls.py`

- [ ] **Step 1: Write endpoint tests** (`APITestCase`, JWT auth): create two inward + one outward invoice; `GET /api/inward-bills/` returns only the 2 inward with file URLs; `?business=<id>` filters; `?q=<supplier>` filters by supplier name/gstin; `?date_from&date_to` filters; `GET /api/inward-bills/<id>/` returns line_items + `source_file_url`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `InwardBillListCreateView.get` (filter `Invoice.objects.filter(type_of_invoice="inward")`, apply `business`/`q`/date filters, paginate with the project's default pagination, serialize with `InwardBillListSerializer`) and `InwardBillDetailView.get`. Register routes `path("inward-bills/", InwardBillListCreateView.as_view())` and `path("inward-bills/<int:pk>/", InwardBillDetailView.as_view())`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(inward-bills): register list + detail endpoints`

## Task 4: Extract endpoint (AI pre-fill, no writes)

**Files:** Modify `billing/api/inward_bills.py`

- [ ] **Step 1: Write test** — mock `AIInvoiceProcessor.process_invoice_image` to return a fixed extraction (buyer gstin, seller gstin, line items). `POST /api/inward-bills/extract/` with `business_id` of LODHA + a dummy file returns `supplier`, `invoice_number`, `line_items`, `tax_type`, and `warnings` containing `gstin_mismatch=False`; when the mocked buyer gstin ≠ firm gstin, `gstin_mismatch=True`; when a matching inward invoice exists, `duplicate=True`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `InwardBillExtractView.post`: validate file (reuse the type/size checks from `AIInvoiceProcessingView`), call `AIInvoiceProcessor().process_invoice_image(file, business_id)`, map its output to the inward pre-fill shape, set `tax_type` from buyer-vs-seller state codes, compute `warnings` via `gstin_matches` + `find_duplicate`. Return 200 with payload; on processor exception return 200 with an empty pre-fill + `warnings.extraction_failed=True` (so the UI shows a blank manual form).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(inward-bills): AI extract/pre-fill endpoint`

## Task 5: Create endpoint (verify → save + store file)

**Files:** Modify `billing/api/inward_bills.py`

- [ ] **Step 1: Write tests** — `POST /api/inward-bills/` multipart with a verified payload (business, supplier gstin/name, invoice_number, invoice_date, lines[qty,rate,hsn], bill_total, tax intra) + a file:
  - creates one `Invoice(type='inward')` + N `LineItem`s; `total_amount == bill_total`; `source_file` stored; `source_preview` generated.
  - auto-creates the supplier `Customer` when the gstin is new and links it to the business.
  - inter-state payload → line `igst` set, `cgst==sgst==0`.
  - duplicate (same business+invoice_number) without `override_warnings` → 409; with `override_warnings=true` → 201.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `InwardBillListCreateView.post` in a `transaction.atomic()`: resolve/create supplier `Customer` (match by gstin, `.businesses.add(business)`), `find_duplicate` guard (409 unless override), `compute_lines(...)` for tax + round-off, create `Invoice` + `LineItem`s (workspace_id=1, gst_tax_rate, unit), save `source_file`, generate `source_preview` (reuse the PIL/pillow-heif snippet from `AIInvoiceCreateView` ~lines 3597-3615), return `InwardBillSerializer` at 201.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(inward-bills): create endpoint (verify, tax, dedup, file store)`

## Task 6: Frontend data hooks

**Files:** Create `sweet-rebuild-suite-main/src/hooks/useInwardBills.ts`

- [ ] **Step 1:** `useInwardBills(filters)` (TanStack Query GET list), `useInwardBill(id)` (GET detail), `useExtractInwardBill()` (mutation → `/extract/`), `useCreateInwardBill()` (mutation → POST, multipart). Follow the auth/fetch pattern in existing hooks (`useDataStore.ts`). Invalidate the list query on create.
- [ ] **Step 2: Commit** — `feat(inward-bills): frontend data hooks`

## Task 7: Register page

**Files:** Create `sweet-rebuild-suite-main/src/pages/InwardBills.tsx`

- [ ] **Step 1:** Table (firm, supplier, invoice #, date, taxable, tax, total, file icon) with firm select, month/date range, and search box; "Add Inward Bill" button → `/inward-bills/add`; row click → `/inward-bills/:id`. Empty + loading states. Match `InvoiceList.tsx` styling.
- [ ] **Step 2: Commit** — `feat(inward-bills): purchase register page`

## Task 8: Add / capture page

**Files:** Create `sweet-rebuild-suite-main/src/pages/InwardBillAdd.tsx`

- [ ] **Step 1:** Step A: firm `Select` + file dropzone (accept pdf/jpeg/png/heic). On file, call extract; show spinner. Step B: verify form pre-filled from the response — supplier (auto-fill from gstin via customers, editable), invoice #, date, editable line-item rows (hsn, qty, rate → live taxable + tax + total), tax-type readout, and warning banners (`gstin_mismatch` → override checkbox; `duplicate` → override checkbox; `extraction_failed` → info). Save → `useCreateInwardBill` (multipart incl. file + `override_warnings`) → toast + navigate to detail. Handle 409 by surfacing the duplicate warning.
- [ ] **Step 2: Commit** — `feat(inward-bills): capture/verify page`

## Task 9: Detail page + file viewer

**Files:** Create `sweet-rebuild-suite-main/src/pages/InwardBillDetail.tsx`

- [ ] **Step 1:** Show header fields + line-item table + tax summary; render the original file inline — PDF via `<iframe src={source_file_url}>`, images via `<img src={source_preview_url || source_file_url}>`; "Download original" link. Loading/not-found states.
- [ ] **Step 2: Commit** — `feat(inward-bills): detail page with inline file viewer`

## Task 10: Routing + nav + smoke test

**Files:** Modify `sweet-rebuild-suite-main/src/App.tsx`; sidebar nav component

- [ ] **Step 1:** Lazy-import the three pages; add routes `/inward-bills`, `/inward-bills/add`, `/inward-bills/:id`. Add a sidebar "Inward Bills" entry (Receipt/FileDown icon) near Invoices.
- [ ] **Step 2:** Start the dev server (preview tools), sign in, walk upload→extract→verify→save, confirm the bill appears in the register and the file opens in detail. Capture a screenshot.
- [ ] **Step 3: Commit** — `feat(inward-bills): routes + nav + verified end-to-end`

---

## Self-Review Notes

- **Spec coverage:** capture (T4,T5,T8), register (T3,T7), file viewing (T2,T9), our-GSTIN gate (T1,T4,T8), dedup (T1,T5,T8), auto tax + round-off (T1,T5), HEIC (reused processor, T4), errors/fallback (T4). All spec §s map to a task.
- **Type consistency:** service returns `(cgst, sgst, igst)` tuples and line dicts with keys `taxable/rate/cgst/sgst/igst/amount`; serializers and endpoints use `source_file_url`/`source_preview_url` consistently; frontend hooks/pages consume those exact field names.
- **Scope:** one cohesive module; backend (T1–T5) is independently testable and can land/verify before the frontend (T6–T10).
