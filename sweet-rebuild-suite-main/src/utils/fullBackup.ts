/**
 * The full backup (UX1): every business, customer, product and invoice on
 * file, each invoice with its lines (inward bills are invoices of type
 * "inward"), whatever financial year, firm or type the Backup page shows.
 *
 * "JSON Backup" sent the page's FY filter and "Export All Data" saved the
 * invoice list's first page, so a "full backup" held 149 of 435 invoices, or
 * the latest 50, while its toast counted 197 records.
 *
 * Rows are saved as the API returns them, which is what restoreBackup reads:
 * invoices through backupInvoiceToImportRow (invoice_number, line_items),
 * products with their stored gst_tax_rate fraction.
 */
import { fetchAllPages } from "@/hooks/useDataStore";
import api from "@/utils/api";
import { todayLocal } from "@/utils/localDate";

export interface BackupCounts {
  businesses: number;
  customers: number;
  products: number;
  invoices: number;
  inwardBills: number;
}

export interface FullBackup {
  businesses: any[];
  customers: any[];
  products: any[];
  invoices: any[];
  exportedAt: string;
  version: string;
  scope: "everything";
  counts: BackupCounts;
  totalRecords: number;
}

/** What a backup file holds (an older one too: "type" is the app's own shape). */
export function backupCounts(data: { businesses?: any[]; customers?: any[]; products?: any[]; invoices?: any[] }): BackupCounts {
  const invoices = data.invoices || [];
  return {
    businesses: (data.businesses || []).length,
    customers: (data.customers || []).length,
    products: (data.products || []).length,
    invoices: invoices.length,
    inwardBills: invoices.filter((i) => String(i?.type_of_invoice ?? i?.type ?? "").toLowerCase() === "inward").length,
  };
}

// ponytail: a walk over the list pages, not a snapshot. An invoice deleted
// while it runs can move the next one past a page boundary unseen; a
// server-side export endpoint would close that if it ever matters.
export async function buildFullBackup(): Promise<FullBackup> {
  const [businesses, customers, products, invoices] = await Promise.all([
    fetchAllPages<any>("businesses/?page_size=200"),
    fetchAllPages<any>("customers/?page_size=1000"),
    fetchAllPages<any>("products/?page_size=1000"),
    fetchAllPages<any>("invoices/?page_size=200&include_items=true"),
  ]);
  const counts = backupCounts({ businesses, customers, products, invoices });
  return {
    businesses,
    customers,
    products,
    invoices,
    exportedAt: new Date().toISOString(),
    version: "4.1",
    scope: "everything",
    counts,
    totalRecords: counts.businesses + counts.customers + counts.products + counts.invoices,
  };
}

/** Build the backup and save it as gst-backup-<date>.json. */
export async function saveFullBackup(): Promise<{ backup: FullBackup; bytes: number }> {
  const backup = await buildFullBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gst-backup-${todayLocal()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  // In the audit log, as Bulk PDF records its downloads (M7); a log that
  // can't be written never fails the backup.
  void api.post("audit-logs/log/", {
    action: "exported",
    entity: "invoice",
    entity_id: 0,
    entity_name: `Full backup (${backup.totalRecords.toLocaleString("en-IN")} records)`,
    details: `${describeCounts(backup.counts)}; ${Math.round(blob.size / 1024).toLocaleString("en-IN")} KB`,
  }).catch(() => {});
  return { backup, bytes: blob.size };
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** "3 businesses, 35 customers, 10 products, 435 invoices (110 inward bills)" */
export function describeCounts(c: BackupCounts): string {
  const inward = c.inwardBills ? ` (${count(c.inwardBills, "inward bill", "inward bills")})` : "";
  return [
    count(c.businesses, "business", "businesses"),
    count(c.customers, "customer", "customers"),
    count(c.products, "product", "products"),
    count(c.invoices, "invoice", "invoices") + inward,
  ].join(", ");
}

/** The restore confirmation: what the file holds against what is on file now. */
export function restorePrompt(fileName: string, inFile: BackupCounts, onFile: BackupCounts | null): string {
  return [
    `Restore from "${fileName}"?`,
    `This backup holds: ${describeCounts(inFile)}.`,
    onFile ? `On file now: ${describeCounts(onFile)}.` : "",
    "Missing businesses, products and customers will be created, and invoices whose numbers are not already on file will be imported. Nothing is deleted.",
  ].filter(Boolean).join("\n\n");
}
