import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { fetchAllPages, mapDjangoInvoice, mapDjangoProduct } from "@/hooks/useDataStore";
import { formatApiError } from "@/utils/apiError";
import type { BackupCounts } from "@/utils/fullBackup";

import { todayLocal } from "@/utils/localDate";

type ExportFormat = "csv" | "json";
type ExportEntity = "invoices" | "customers" | "products" | "businesses" | "all";

/** The invoices the page's export filters pick, and how to say so ("FY 2026-27"). */
export interface InvoiceScope {
  query: string;
  label: string;
  count: number;
}

interface DataExportPanelProps {
  defaultEntity?: ExportEntity;
  /** Everything on file, all years (null while it loads). */
  onFile: BackupCounts | null;
  invoiceScope: InvoiceScope;
  /** All Data as JSON is the full backup, which the page builds and saves; true once saved. */
  onFullBackup: () => Promise<boolean>;
}

const n = (count: number) => count.toLocaleString("en-IN");

/**
 * Every export here reads every page when it runs (UX1). It used to write
 * what the page had loaded: the invoice list's first 50 rows, whatever the
 * labels said.
 */
export default function DataExportPanel({ defaultEntity = "all", onFile, invoiceScope, onFullBackup }: DataExportPanelProps) {
  const { toast } = useToast();

  const [format, setFormat] = useState<ExportFormat>("csv");
  const [entity, setEntity] = useState<ExportEntity>(defaultEntity);
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState(false);

  const allCount = onFile ? onFile.businesses + onFile.customers + onFile.products + onFile.invoices : null;
  const entities: { id: ExportEntity; label: string; count: number | null }[] = [
    { id: "all", label: "All Data · all years", count: allCount },
    { id: "invoices", label: `Invoices · ${invoiceScope.label}`, count: invoiceScope.count },
    { id: "customers", label: "Customers", count: onFile?.customers ?? null },
    { id: "products", label: "Products", count: onFile?.products ?? null },
    { id: "businesses", label: "Businesses", count: onFile?.businesses ?? null },
  ];

  const escapeCsvValue = (val: unknown): string => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const write = (rows: Record<string, unknown>[], filename: string) => {
    if (format === "json") return downloadFile(JSON.stringify(rows, null, 2), `${filename}.json`, "application/json");
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.map(escapeCsvValue).join(","), ...rows.map((row) => headers.map((h) => escapeCsvValue(row[h])).join(","))].join("\n");
    downloadFile(csv, `${filename}.csv`, "text/csv");
  };

  const flashDone = () => {
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  const handleExport = async () => {
    setBusy(true);
    if (entity === "all" && format === "json") {
      // The page toasts either way; "Exported!" only when the file was saved.
      try {
        if (await onFullBackup()) flashDone();
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const want = (e: ExportEntity) => entity === "all" || entity === e;
      const none = Promise.resolve([] as any[]);
      const [invoiceRows, customers, productRows, businesses] = await Promise.all([
        want("invoices") ? fetchAllPages<any>(entity === "all" ? "invoices/?page_size=200" : `invoices/?${invoiceScope.query}`) : none,
        want("customers") ? fetchAllPages<any>("customers/?page_size=1000") : none,
        want("products") ? fetchAllPages<any>("products/?page_size=1000") : none,
        want("businesses") ? fetchAllPages<any>("businesses/?page_size=200") : none,
      ]);
      const invoices = invoiceRows.map(mapDjangoInvoice);
      const products = productRows.map(mapDjangoProduct);
      const dateStr = todayLocal();
      const prefix = entity === "all" ? "all-" : "";

      if (want("invoices")) write(invoices.map((i) => ({
        "Invoice Number": i.invoiceNumber,
        Date: i.invoice_date,
        Customer: i.customerName,
        Business: i.businessName,
        Type: i.type,
        Subtotal: i.subtotal,
        "Total Tax": i.totalTax,
        Total: i.total,
        "GST Type": i.isIGST ? "IGST" : "CGST/SGST",
        "Financial Year": i.financialYear,
      })), `${prefix}invoices-${dateStr}`);
      if (want("customers")) write(customers.map((c: any) => ({
        Name: c.name, GST: c.gst_number || "", PAN: c.pan_number || "",
        Mobile: c.mobile_number || "", Email: c.email || "",
        State: c.state_name || "", Address: c.address || "",
      })), `${prefix}customers-${dateStr}`);
      if (want("products")) write(products.map((p) => ({
        Name: p.name, HSN: p.hsn, "GST Rate": p.gstRate, Description: p.description,
      })), `${prefix}products-${dateStr}`);
      if (want("businesses")) write(businesses.map((b: any) => ({
        Name: b.name, GST: b.gst_number || "", PAN: b.pan_number || "",
        State: b.state_name || "", Address: b.address || "",
        Mobile: b.mobile_number || "", Email: b.email || "",
        "Bank Name": b.bank_name || "", "Account No": b.bank_account_number || "",
        IFSC: b.bank_ifsc_code || "", Branch: b.bank_branch_name || "",
      })), `${prefix}businesses-${dateStr}`);

      const what = entity === "all"
        ? `All years: ${n(invoices.length)} invoices, ${n(customers.length)} customers, ${n(products.length)} products, ${n(businesses.length)} businesses`
        : entity === "invoices"
          ? `${invoiceScope.label} · ${n(invoices.length)} invoices`
          : `${n((entity === "customers" ? customers : entity === "products" ? products : businesses).length)} ${entity}`;
      toast({ title: "Export Complete", description: `${what} exported as ${format.toUpperCase()}.` });
      flashDone();
    } catch (err) {
      toast({ title: "Export Failed", description: formatApiError(err, "Could not export data."), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = entity === "all"
    ? (format === "json" ? "Download Full Backup" : "Export All Data · all years")
    : entity === "invoices"
      ? `Export Invoices · ${invoiceScope.label} · ${n(invoiceScope.count)}`
      : `Export ${entity}`;

  return (
    <div className="space-y-4">
      {/* Entity Selection */}
      <div className="flex flex-wrap gap-2">
        {entities.map((e) => (
          <button
            key={e.id}
            onClick={() => setEntity(e.id)}
            className={cn(
              "px-3 py-2 rounded-xl text-[12px] font-medium transition-all border",
              entity === e.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/30 text-muted-foreground hover:border-primary/20"
            )}
          >
            {e.label} <span className="text-[10px] opacity-60 ml-1 tabular-nums">({e.count == null ? "…" : n(e.count)})</span>
          </button>
        ))}
      </div>

      {/* Format Selection */}
      <div className="flex gap-3">
        <button
          onClick={() => setFormat("csv")}
          className={cn(
            "flex-1 flex items-center gap-2 p-3 rounded-xl border-2 transition-all",
            format === "csv" ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/20"
          )}
        >
          <FileSpreadsheet className={cn("w-5 h-5", format === "csv" ? "text-primary" : "text-muted-foreground")} />
          <div className="text-left">
            <p className="text-[12px] font-semibold text-foreground">CSV</p>
            <p className="text-[10px] text-muted-foreground">Excel-compatible</p>
          </div>
        </button>
        <button
          onClick={() => setFormat("json")}
          className={cn(
            "flex-1 flex items-center gap-2 p-3 rounded-xl border-2 transition-all",
            format === "json" ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/20"
          )}
        >
          <FileJson className={cn("w-5 h-5", format === "json" ? "text-primary" : "text-muted-foreground")} />
          <div className="text-left">
            <p className="text-[12px] font-semibold text-foreground">JSON</p>
            <p className="text-[10px] text-muted-foreground">{entity === "all" ? "Full backup format" : "Rows as listed"}</p>
          </div>
        </button>
      </div>

      {/* Export Button */}
      <button
        onClick={handleExport}
        disabled={busy}
        className={cn("premium-btn-primary w-full disabled:opacity-40", exported && "bg-success")}
      >
        {busy ? (
          <><Clock className="w-4 h-4 animate-spin" /> Exporting…</>
        ) : exported ? (
          <><CheckCircle2 className="w-4 h-4" /> Exported!</>
        ) : (
          <><Download className="w-4 h-4" /> {buttonLabel}</>
        )}
      </button>
    </div>
  );
}
