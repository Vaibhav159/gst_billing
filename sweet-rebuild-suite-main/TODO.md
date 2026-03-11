# V2 TODO

## 🔴 P0 — Fix Immediately (Broken)

- [ ] Fix `inv.date` → `inv.invoice_date` in all remaining files:
  - `InvoiceList.tsx` (L46, L70, L135, L244, L334, L366)
  - `InvoicePrint.tsx` (L109)
  - `GSTSummary.tsx` (L34)
  - `CustomerStatement.tsx` (L28, L99, L121)
  - `BulkPDF.tsx` (L26, L176)
  - `EasyDashboard.tsx` (L115)
- [ ] Fix form field name mismatches in `CustomerForm.tsx` — JSX uses `form.gst_number`, `form.mobile_number`, `form.state_name` but form state keys are `gst`, `mobile`, `state`
- [ ] Fix form field name mismatches in `BusinessForm.tsx` — same issue as above
- [ ] Fix Dashboard to use `fetchAllPages` or a stats API — currently only fetches first page, so stats are incomplete

## 🟡 P1 — High Priority (Core features)

### Backend Model Changes
- [ ] Add `email` field to `Customer` model + migration + serializer
- [ ] Add `email` field to `Business` model + migration + serializer

### Frontend
- [ ] Add "Load More" / infinite scroll to `InvoiceList.tsx`
- [ ] Add "Load More" / infinite scroll to `CustomerList.tsx`
- [ ] Add "Load More" / infinite scroll to `ProductList.tsx`
- [ ] Add "Load More" / infinite scroll to `BusinessList.tsx`
- [ ] Invoice creation flow — create invoice + line items in a single API call

### Deployment
- [ ] Configure Django to serve V2 SPA (`dist/index.html`) for all frontend routes
- [ ] Configure `STATICFILES_DIRS` to include V2's `dist/assets/`
- [ ] Setup proper CORS/CSRF for production (currently only works with Vite proxy)

## 🟢 P2 — Medium Priority

### Backend
- [ ] Add `tags` field to `Customer` model (ArrayField or M2M) + migration
- [ ] Add `description` field to `Product` model + migration
- [ ] Create `GET /api/dashboard/stats/` endpoint (total sales, counts, top customers/products)
- [ ] Create `GET /api/customers/:id/statement/` endpoint (server-side filtered invoices)
- [ ] Create `GET /api/gst-summary/` endpoint (HSN-wise GST breakdown with FY/month/business filters)
- [ ] Create `POST /api/register/` endpoint (user registration — currently disabled in V2)

### Frontend
- [ ] Wire Dashboard to use stats API instead of client-side calculation
- [ ] Wire CustomerStatement to use statement API
- [ ] Wire GSTSummary to use GST summary API

## 🔵 P3 — Future Features

- [ ] **Audit Log**: Create `AuditLog` model + `GET /api/audit-log/` endpoint + wire `AuditLog.tsx`
- [ ] **Backup/Restore**: Create `POST /api/backup/export` + `POST /api/backup/import` + wire `Backup.tsx`
- [ ] **AI Invoice Import**: Create V2-compatible `POST /api/invoices/ai-import/` endpoint (backend has `AIInvoiceProcessor` util) + wire `AIInvoiceImport.tsx`
- [ ] **Bulk PDF**: Support multi-invoice PDF download in backend + wire `BulkPDF.tsx`
- [ ] **Reports API**: Enhance `/api/report/` to return JSON analytics (not just Excel download) + wire `Reports.tsx`
- [ ] **Profile API**: Create `GET/PATCH /api/profile/` + wire `Profile.tsx`
- [ ] **Settings API**: Create `GET/PATCH /api/settings/` + wire `Settings.tsx`
- [ ] **V1 Deprecation**: Decide migration path — replace V1 entirely or run side-by-side
