# PRODUCT.md — GST Billing Pro Suite

## Register

product — design serves the task. Authenticated, data-dense billing tool; no marketing surface.

## What it is

Invoicing and GST-compliance workbench for a family jewellery business in Udaipur,
Rajasthan, running three firms (LODHA JEWELLERS, PYARCHAND, SHREE LODHA) from one
database. Django + DRF backend, React/Vite/shadcn SPA (`sweet-rebuild-suite-main/`)
served by nginx in production at billing.cheq.dpdns.org.

## Users

- **Owner-operators** (2–3 people, the family): create outward invoices at the counter,
  record inward purchase bills, run monthly/annual GST filings (GSTR-1, GSTR-3B),
  export Excel workbooks for the CA. Phones at the shop counter, desktop for filing.
- **Occasional staff** (editor role): data entry only.
- **Viewer role**: read-only inspection (CA, family members checking figures).

Users are fluent in bills and tax heads, not in software. Numbers are money; a wrong
figure is a filing problem, not a cosmetic one.

## Purpose and success

One place where every sale and purchase lands once, correctly split into
CGST/SGST/IGST, and comes back out as portal-ready GSTR data and CA-ready Excel.
Success = zero re-typing into Tally/portal, zero mismatched heads at filing time.

## Modes

- **Desktop**: full top-nav app, dense tables, filing and reports.
- **Mobile expert**: full feature set, card layouts, bottom nav.
- **Mobile easy**: simplified home + nav for the least technical user — big
  Create Invoice target, full-rupee amounts, no jargon. Must never show a number
  the expert surfaces would contradict.

## Brand personality

Quiet, precise, trustworthy back-office tool. Tabular numerals, Indian digit
grouping (₹1,00,000), DD MMM YYYY dates. Five user-selectable themes
(obsidian/pearl/sapphire/ember/forest) built on shadcn tokens; obsidian default.
Delight lives in speed and correctness, not decoration.

## Anti-references

- Consumer-fintech gradient dashboards; hero metrics with glow.
- Anything that hides tax detail behind cuteness — users file returns from this.
- Marketing-page motion; users are mid-task.

## Strategic design principles

1. **The number is the interface.** Every displayed figure must reconcile with the
   database and with every other page showing it. Ambiguity (unlabeled periods,
   unexplained ↓49%) is a defect.
2. **Same rule everywhere.** Tax direction (intra/inter-state) is decided by one
   shared rule on server and client (`billing/tax_rules.py` ↔ `src/utils/taxRules.ts`).
3. **Phone-first for capture, desktop-first for filing.** Photographing a supplier
   bill happens standing in the shop; GSTR review happens seated.
4. **Editable ≠ trusted.** Client-computed tax is advisory; the server re-derives.
5. **Standard affordances.** shadcn vocabulary throughout; no invented controls.
