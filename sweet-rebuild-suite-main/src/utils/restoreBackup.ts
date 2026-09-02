/**
 * Restore a Full Backup JSON through the real API (audit E1).
 *
 * The Backup page used to write the file into `gst_data_*` localStorage keys,
 * toast "Restore Complete — N restored", and reload. Nothing in the app reads
 * those keys; after the reload every page refetched from the API and the user
 * who had just lost data was told it was back.
 *
 * This creates missing businesses, products and customers by name, then sends
 * invoices through invoices/bulk-import/ (which auto-creates any remaining
 * customers and skips numbers that already exist), and reports what the server
 * actually did.
 */
import type { AxiosInstance } from "axios";
import { percentToRate } from "./gstRate";

export interface RestoreReport {
  businesses: number;
  products: number;
  customers: number;
  invoices: { created: number; skipped: number; errors: string[] };
}

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

async function existingNames(api: AxiosInstance, path: string): Promise<Set<string>> {
  const names = new Set<string>();
  let url: string | null = `${path}?page_size=500`;
  while (url) {
    const res = await api.get(url);
    const rows = Array.isArray(res.data) ? res.data : res.data?.results || [];
    for (const r of rows) names.add(lower(r.name));
    url = res.data?.next ? String(res.data.next).replace(/^.*\/api\//, "") : null;
  }
  return names;
}

export function backupInvoiceToImportRow(inv: any, bizById: Map<string, any>) {
  const biz = bizById.get(String(inv.businessId)) || {};
  return {
    invoiceNumber: inv.invoiceNumber,
    invoice_date: inv.invoice_date,
    customerName: inv.customerName,
    customerGST: inv.customerGST || "",
    firmName: inv.businessName || biz.name || "",
    firmGSTIN: biz.gst_number || "",
    type: inv.type || "OUTWARD",
    total: inv.total,
    items: (inv.items || []).map((it: any) => ({
      productName: it.productName, hsn: it.hsn || "", gstRate: it.gstRate ?? 0,
      qty: it.qty, rate: it.rate, cgst: it.cgst || 0, sgst: it.sgst || 0, igst: it.igst || 0, amount: it.amount,
    })),
  };
}

export async function restoreBackup(
  data: { businesses?: any[]; customers?: any[]; products?: any[]; invoices?: any[] },
  api: AxiosInstance,
  onProgress?: (label: string) => void,
): Promise<RestoreReport> {
  const report: RestoreReport = { businesses: 0, products: 0, customers: 0, invoices: { created: 0, skipped: 0, errors: [] } };

  onProgress?.("businesses");
  const haveBiz = await existingNames(api, "businesses/");
  for (const b of data.businesses || []) {
    if (!b?.name || haveBiz.has(lower(b.name))) continue;
    await api.post("businesses/", {
      name: b.name, gst_number: b.gst_number || "", address: b.address || "", state_name: b.state_name || "",
      pan_number: b.pan_number || "", mobile_number: b.mobile_number || "", email: b.email || "",
      bank_name: b.bank_name || "", bank_account_number: b.bank_account_number || "",
      bank_ifsc_code: b.bank_ifsc_code || "", bank_branch_name: b.bank_branch_name || "",
    });
    report.businesses++;
  }

  onProgress?.("products");
  const haveProd = await existingNames(api, "products/");
  for (const pr of data.products || []) {
    if (!pr?.name || haveProd.has(lower(pr.name))) continue;
    await api.post("products/", {
      name: pr.name, hsn_code: pr.hsn || pr.hsn_code || "",
      gst_tax_rate: pr.gst_tax_rate != null ? pr.gst_tax_rate : percentToRate(pr.gstRate ?? 0, "percent"),
      description: pr.description || "",
    });
    report.products++;
  }

  onProgress?.("customers");
  const haveCust = await existingNames(api, "customers/");
  for (const c of data.customers || []) {
    if (!c?.name || haveCust.has(lower(c.name))) continue;
    await api.post("customers/", {
      name: c.name, gst_number: c.gst_number || "", state_name: c.state_name || "", address: c.address || "",
      mobile_number: c.mobile_number || "", pan_number: c.pan_number || "", email: c.email || "",
    });
    report.customers++;
  }

  onProgress?.("invoices");
  const bizById = new Map((data.businesses || []).map((b: any) => [String(b.id), b]));
  const rows = (data.invoices || []).map((inv: any) => backupInvoiceToImportRow(inv, bizById));
  for (let i = 0; i < rows.length; i += 100) {
    const res = await api.post("invoices/bulk-import/", { invoices: rows.slice(i, i + 100) });
    report.invoices.created += Number(res.data?.created) || 0;
    report.invoices.skipped += Number(res.data?.skipped) || 0;
    report.invoices.errors.push(...(res.data?.errors || []));
  }
  return report;
}
