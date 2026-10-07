/**
 * The invoices the PDF downloads print: every page, with their lines (H18).
 *
 * The customer page zipped page 1 of the invoice list: 50 invoices at most,
 * none with line items, so every PDF had an empty item and HSN table under
 * full totals and older invoices were silently left out. Bulk PDF made one
 * 1,000-row request and stopped there.
 */
import { fetchAllInvoices } from "@/hooks/useDataStore";

/** Every invoice of one customer, with lines, for "Download All". */
export function customerInvoicesForPdf(customerId: string) {
  return fetchAllInvoices({ customerId }, { withItems: true });
}

/** Every invoice of an FY ("2025-26"), optionally one firm and one type, with lines, for Bulk PDF. */
export function fyInvoicesForPdf(fy: string, businessId: string, type: string) {
  return fetchAllInvoices({ fyFilter: fy, businessId, typeFilter: type }, { withItems: true });
}
