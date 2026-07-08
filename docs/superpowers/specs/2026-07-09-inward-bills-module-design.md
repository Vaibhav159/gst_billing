# Inward Bills Module — Design Spec

**Date:** 2026-07-09
**Status:** Approved (brainstorming) → pending implementation plan

## 1. Goal

A dedicated **Inward Bills** module for recording purchase (inward) bills for any of the
three firms, with two halves:

1. **Capture** — upload a bill file (PDF / image / HEIC), let AI pre-fill the fields, the
   user **verifies & corrects**, then saves. Nothing is written until Save.
2. **Register** — a browsable list of every recorded inward bill where the **original file
   can be viewed inline and downloaded**. This is the "record of bills" the user wants;
   today `source_file` is stored but exposed nowhere.

This is a *fresh, standalone module* (own pages + endpoints) built over the existing,
proven data model — not a new table.

## 2. Scope

**In:** inward bills for LODHA / PYARCHAND / SHREE LODHA (user picks the buying firm per
bill); AI-assisted capture with mandatory human verify; file storage + viewing; a filterable
register; our-GSTIN validation, duplicate guard, automatic CGST/SGST-vs-IGST tax.

**Out (this PR):** outward/sales bills; bulk multi-file upload; editing recorded bills
(use the existing invoice edit screen); any change to how GST reports read data.

## 3. Data model — reuse, don't fork

An inward bill **is** an existing `Invoice` with `type_of_invoice='inward'`, its `LineItem`s,
and the existing `source_file` / `source_preview` fields for the attached document. **No new
table.** Rationale: GST reports, the ITC ledger, and totals already read from `Invoice`; a
separate table would make these bills invisible to all of it. The module is new UI +
inward-focused endpoints over the same model.

Supplier = a `Customer` (matched by GSTIN, auto-created if new). Buying firm = a `Business`.

## 4. Backend API (`/api/inward-bills/`)

- `POST /extract/` — multipart: `file`, `business_id`. Converts HEIC→JPEG if needed, runs the
  existing Gemini extraction (factored into a reusable `extract_inward_bill(file, business)`
  service), and returns a **pre-fill payload**: `supplier {name, gstin, address, pan, mobile}`,
  `invoice_number`, `invoice_date`, `line_items[{product_name, hsn_code, quantity, rate,
  taxable}]`, `tax_type` (`igst` | `cgst_sgst`, from state codes), computed `totals`, and
  `warnings[]` (`gstin_mismatch`, `duplicate`). Never writes to the DB.
- `POST /` (create) — multipart: verified JSON payload + `file` + optional `override_warnings`.
  Creates `Invoice(type='inward')` + `LineItem`s with the tax math (§6), stores `source_file`,
  generates `source_preview`, runs the duplicate guard. Returns the created bill (409 with a
  clear body if duplicate and not overridden).
- `GET /` (register) — paginated inward invoices: `id, business, supplier, invoice_number,
  invoice_date, taxable, cgst, sgst, igst, total, has_file, source_preview_url`. Filters:
  `business`, `date_from`/`date_to`, `q` (supplier/invoice search).
- `GET /<id>/` (detail) — full bill + line items + `source_file_url` + `source_preview_url`.

New `InwardBillSerializer` exposes `source_file_url` / `source_preview_url` (absolute URLs);
media is served via existing `/media/` config. Endpoints are permission-guarded like the rest
of the API (JWT).

## 5. Capture flow (frontend)

New pages (lazy-routed, added to nav under a "Purchases"/"Inward Bills" entry):

- **`InwardBills.tsx`** — register table + filters + **"Add Inward Bill"** button.
- **`InwardBillAdd.tsx`** — (1) pick buying firm + drop/upload file → (2) `POST /extract/` →
  (3) **verify form**: supplier (auto-fills from GSTIN, editable), invoice #, date, editable
  line items (HSN, qty, rate → live taxable/tax/total), read-out of tax type, and warning
  banners (§6). **Save** → `POST /`. Extraction failure ⇒ the same form, blank, for manual entry.
- **`InwardBillDetail.tsx`** — recorded fields + **inline viewer** (PDF via `<iframe>`, images
  via `source_preview`) + **Download original**.

Reuses existing shadcn/ui components and `useDataStore`/customers hooks.

## 6. Validation & tax rules

- **Our-GSTIN gate:** compare the bill's buyer GSTIN against the selected firm's
  `gst_number`. On mismatch (e.g. a B2C/unregistered bill), show a clear warning — *"not
  addressed to <firm>'s GSTIN"* — as an **override-able** block (checkbox to record anyway),
  not a hard stop.
- **Duplicate guard:** warn (and 409 on create unless overridden) when
  `(business, invoice_number, type='inward')` already exists.
- **Automatic tax:** same state code (buyer vs supplier) ⇒ intra-state, `cgst = sgst =
  round(taxable × rate/2, 2)`, `igst = 0`; different ⇒ inter-state, `igst = round(taxable ×
  rate, 2)`, `cgst = sgst = 0`. `LineItem.amount` is tax-inclusive; the invoice total equals
  `sum(amounts)` (existing signal). Bill round-off is absorbed into a line amount so the stored
  total matches the printed total to the paisa.
- **HEIC handling:** convert iPhone `.heic` uploads to JPEG server-side (pillow-heif),
  reusing/extending the existing `source_preview` generation.

## 7. Error handling

Extraction failure / unreadable file ⇒ fall back to the blank verify form (never blocks
recording). Unsupported or oversized file ⇒ specific 4xx + inline message. Duplicate ⇒ warning,
override to proceed. GSTIN mismatch ⇒ warning, override to proceed. All create writes are
transactional.

## 8. Testing

Backend unit/integration: tax math (intra / inter / round-off), duplicate detection, GSTIN-match
flag, `/extract/` payload shape (Gemini mocked), `/` create (invoice + line items + file stored
+ preview generated), register list (file URLs + filters), HEIC→JPEG conversion. Frontend:
smoke-verify the capture→save→appears-in-register→file-viewable path via the preview server.

## 9. Future (not now)

Bulk multi-file upload; in-module edit/delete; inter-firm auto-mirror in this module (the
existing AI-import path already does it and merges via its own PR); outward-bill capture.
