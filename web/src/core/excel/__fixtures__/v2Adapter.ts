import type { Invoice } from "./v2Report";
import { rateToPercent } from "./v2Rates";

/**
 * Test-only snapshot of v2's real useDataStore adapter, commit 112cacf0.
 * Original getFinancialYear/mapDjangoInvoice declarations are unchanged except
 * trailing whitespace; fixture-only types/imports avoid loading React or v2.
 * Body SHA-256 (inside outer braces, LF, trailing line whitespace removed):
 * getFinancialYear: b2166342f9f608bd1eeca02215e9c3669bfaa8c561ad6a3736746d8a5f3393c7
 * mapDjangoInvoice: cf8c09f2c08544b48574fb5710cf7be59e1cfe19f09d6b070d8a6afecd8125af
 */
export type DjangoInvoice = Record<string, any>;

function getFinancialYear(date: string) {
  if (!date) return "";
  const d = new Date(date);
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m < 3) return `${y - 1}-${y.toString().slice(-2)}`;
  return `${y}-${(y + 1).toString().slice(-2)}`;
}

export function mapDjangoInvoice(inv: DjangoInvoice): Invoice {
  const hasItems = Array.isArray(inv.line_items) && inv.line_items.length > 0;

  const items = (inv.line_items || []).map((item: any) => ({
    productId: String(item.product || item.id || ""),
    productName: item.product_name || item.item_name || "",
    hsn: item.hsn_code || "",
    gstRate: rateToPercent(item.gst_tax_rate),
    qty: parseFloat(item.quantity) || 0,
    rate: parseFloat(item.rate) || 0,
    unit: item.unit || "gms",
    amount: parseFloat(item.amount) || 0,
    cgst: parseFloat(item.cgst) || 0,
    sgst: parseFloat(item.sgst) || 0,
    igst: parseFloat(item.igst) || 0,
  }));

  let subtotal = hasItems ? items.reduce((sum: number, it: any) => sum + (it.qty * it.rate), 0) : 0;
  let totalCGST = items.reduce((sum: number, it: any) => sum + it.cgst, 0);
  let totalSGST = items.reduce((sum: number, it: any) => sum + it.sgst, 0);
  let totalIGST = items.reduce((sum: number, it: any) => sum + it.igst, 0);

  // Use annotated total_tax if line_items is empty/missing
  const itemBasedTax = totalCGST + totalSGST + totalIGST;
  const totalTax = itemBasedTax > 0 ? itemBasedTax : (parseFloat(inv.total_tax || "0") || 0);

  // If line items didn't have cgst/sgst/igst breakdown, infer from totalTax + isIGST flag
  if (itemBasedTax === 0 && totalTax > 0) {
    const isIGST = inv.is_igst_applicable || false;
    if (isIGST) {
      totalIGST = totalTax;
    } else {
      totalCGST = totalTax / 2;
      totalSGST = totalTax / 2;
    }
  }

  // Prefer the API-provided total_amount (always accurate), fall back to calculated
  const apiTotal = parseFloat(inv.total_amount) || 0;
  const calculatedTotal = subtotal + totalTax;
  // The server's figure, to the paisa. This used to round every total to the
  // rupee and invent a "round-off" the server never stored: printed bills and
  // statements showed Rs 566 where the books held 566.05, statement sums
  // drifted by up to 50p per invoice, and re-importing an export adopted the
  // rounded figure as truth — permanent paise drift on every round trip.
  const rawTotal = Math.round((apiTotal > 0 ? apiTotal : calculatedTotal) * 100) / 100;

  // Also fix subtotal: if line items are missing, derive from total - tax
  if (subtotal === 0 && apiTotal > 0) {
    subtotal = apiTotal - totalTax;
  }

  return {
    id: String(inv.id),
    invoiceNumber: inv.invoice_number || "",
    invoice_date: inv.invoice_date || "",
    customerId: String(typeof inv.customer === 'object' ? inv.customer.id : (inv.customer || "")),
    customerName: inv.customer_name || (typeof inv.customer === 'object' ? inv.customer.name : ""),
    businessId: String(typeof inv.business === 'object' ? inv.business.id : (inv.business || "")),
    businessName: inv.business_name || (typeof inv.business === 'object' ? inv.business.name : ""),
    type: (inv.type_of_invoice || "OUTWARD").toUpperCase() as Invoice["type"],
    isIGST: inv.is_igst_applicable || false,
    items,
    subtotal,
    totalCGST,
    totalSGST,
    totalIGST,
    totalTax,
    total: rawTotal,
    roundedOff: undefined,
    paymentMode: inv.payment_mode || "",
    financialYear: getFinancialYear(inv.invoice_date),
    createdAt: inv.created_at || "",
    updatedAt: inv.updated_at || "",
    lineItemCount: hasItems ? items.length : (inv.line_item_count || 0),
    // Audit-trail source image (populated by AI Import): signed, expiring
    // /api/media/ links. The plain /media/ path is a 404 behind nginx.
    sourceFile: inv.source_file_url || null,
    sourcePreview: inv.source_preview_url || null,
  };
}
