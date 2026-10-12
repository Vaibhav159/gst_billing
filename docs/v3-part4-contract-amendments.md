# Part 4 final review contract amendments (X-74)

These amendments accompany the final part-4 review fixes. They supplement the
external part-4 API contract, which the fix worktree does not own.

- **Full backup (`GET backup/full/`)**: top-level `invoices` contains active sales
  and purchases, in the existing v2 serializer shape. Cancelled sales use the same
  invoice objects in `v3.cancelled: Invoice[]`, with `status: "cancelled"`.
  v3 restore reads both lists, including financial-year selection and count limits;
  it also accepts earlier v5 files with cancelled sales in top-level `invoices`.
  v2 restore reads top-level `invoices` and therefore never reactivates cancelled
  sales from a new v3 backup. Summary counts still include cancelled sales.
- **Firm mutations** (`POST firms/`, `PUT firms/{id}/`, signature `PUT`/`DELETE`):
  return the persisted firm fields and the live print fields. They omit computed
  `figures`, `months`, `recent`, `numbers`, and `uses`. A firm `PUT` also returns
  `changes` and `frozen_bills`. Full detail remains available through the detail GET.
- **Audit list (`GET audit/`)**: `total` is included only when `counts=1` is requested.
  Subsequent pages omit it; paging does not require an unconditional full-table count.
- **Customer merge refusal**: `duplicate_purchase` has `bills: BillRef[]` naming the
  two conflicting purchase bills. `sent_changes` has `bills: MergeChange[]`, where
  each change includes its `bill` and explanatory `words`. Clients render the shape
  selected by `code`; a plain BillRef has no nested `bill` field.
- **Restore matching and preview**: GSTIN matching takes precedence. A name fallback
  is allowed only when at least one side has no GSTIN. Two different nonblank GSTINs
  with the same name are refused with `same name as {name}, but a different GSTIN`.
  A rejected master record's reason also appears on dependent bills. Added bill rows
  may carry `detail` explaining recalculated tax heads or totals that differ from the
  file; bin restores continue to use their saved contents.
