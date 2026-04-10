import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { useInvoices, useCustomers, useProducts, useBusinesses } from "@/hooks/useDataStore";
import { formatCurrency } from "@/utils/mockData";

type ExportFormat = "csv" | "json";
type ExportEntity = "invoices" | "customers" | "products" | "businesses" | "all";

interface DataExportPanelProps {
  defaultEntity?: ExportEntity;
}

export default function DataExportPanel({ defaultEntity = "all" }: DataExportPanelProps) {
  const { toast } = useToast();
  const { items: invoices } = useInvoices();
  const { items: customers } = useCustomers();
  const { items: products } = useProducts();
  const { items: businesses } = useBusinesses();

  const [format, setFormat] = useState<ExportFormat>("csv");
  const [entity, setEntity] = useState<ExportEntity>(defaultEntity);
  const [exported, setExported] = useState(false);

  const entities: { id: ExportEntity; label: string; count: number }[] = [
    { id: "all", label: "All Data", count: invoices.length + customers.length + products.length + businesses.length },
    { id: "invoices", label: "Invoices", count: invoices.length },
    { id: "customers", label: "Customers", count: customers.length },
    { id: "products", label: "Products", count: products.length },
    { id: "businesses", label: "Businesses", count: businesses.length },
  ];

  const escapeCsvValue = (val: unknown): string => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const exportCSV = (data: any[], headers: string[], filename: string) => {
    const csv = [headers.map(escapeCsvValue).join(","), ...data.map((row) => headers.map((h) => escapeCsvValue(row[h])).join(","))].join("\n");
    downloadFile(csv, `${filename}.csv`, "text/csv");
  };

  const exportJSON = (data: any, filename: string) => {
    downloadFile(JSON.stringify(data, null, 2), `${filename}.json`, "application/json");
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

  const handleExport = () => {
    const dateStr = new Date().toISOString().split("T")[0];

    if (entity === "all" || entity === "invoices") {
      const invData = invoices.map((i) => ({
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
      }));
      if (entity === "invoices") {
        if (format === "csv") exportCSV(invData, Object.keys(invData[0] || {}), `invoices-${dateStr}`);
        else exportJSON(invData, `invoices-${dateStr}`);
      }
    }

    if (entity === "all" || entity === "customers") {
      const custData = customers.map((c: any) => ({
        Name: c.name, GST: c.gst_number || c.gst || "", PAN: c.pan_number || c.pan || "",
        Mobile: c.mobile_number || c.mobile || "", Email: c.email || "",
        State: c.state_name || c.state || "", Address: c.address || "",
      }));
      if (entity === "customers") {
        if (format === "csv") exportCSV(custData, Object.keys(custData[0] || {}), `customers-${dateStr}`);
        else exportJSON(custData, `customers-${dateStr}`);
      }
    }

    if (entity === "all" || entity === "products") {
      const prodData = products.map((p) => ({
        Name: p.name, HSN: p.hsn, "GST Rate": p.gstRate, Description: p.description,
      }));
      if (entity === "products") {
        if (format === "csv") exportCSV(prodData, Object.keys(prodData[0] || {}), `products-${dateStr}`);
        else exportJSON(prodData, `products-${dateStr}`);
      }
    }

    if (entity === "all" || entity === "businesses") {
      const bizData = businesses.map((b: any) => ({
        Name: b.name, GST: b.gst_number || b.gst || "", PAN: b.pan_number || b.pan || "",
        State: b.state_name || b.state || "", Address: b.address || "",
        Mobile: b.mobile_number || b.mobile || "", Email: b.email || "",
        "Bank Name": b.bank_name || b.bankName || "", "Account No": b.account_number || b.accountNo || "",
        IFSC: b.ifsc_code || b.ifsc || "", Branch: b.branch || "",
      }));
      if (entity === "businesses") {
        if (format === "csv") exportCSV(bizData, Object.keys(bizData[0] || {}), `businesses-${dateStr}`);
        else exportJSON(bizData, `businesses-${dateStr}`);
      }
    }

    if (entity === "all") {
      const allData = {
        businesses: businesses,
        customers: customers,
        products: products,
        invoices: invoices,
        exportedAt: new Date().toISOString(),
        version: "3.0",
      };
      if (format === "json") exportJSON(allData, `gst-full-export-${dateStr}`);
      else {
        // For CSV all, export each entity as separate file
        const invData = invoices.map((i) => ({
          "Invoice Number": i.invoiceNumber, Date: i.date, Customer: i.customerName,
          Business: i.businessName, Type: i.type, Subtotal: i.subtotal, "Total Tax": i.totalTax, Total: i.total,
          "GST Type": i.isIGST ? "IGST" : "CGST/SGST",
        }));
        if (invData.length > 0) exportCSV(invData, Object.keys(invData[0]), `all-invoices-${dateStr}`);

        const custData = customers.map((c) => ({
          Name: c.name, GST: c.gst, PAN: c.pan, Mobile: c.mobile,
          Email: c.email, State: c.state, Address: c.address,
        }));
        if (custData.length > 0) exportCSV(custData, Object.keys(custData[0]), `all-customers-${dateStr}`);

        const prodData = products.map((p) => ({
          Name: p.name, HSN: p.hsn, "GST Rate": p.gstRate, Description: p.description,
        }));
        if (prodData.length > 0) exportCSV(prodData, Object.keys(prodData[0]), `all-products-${dateStr}`);

        const bizData = businesses.map((b) => ({
          Name: b.name, GST: b.gst, PAN: b.pan, State: b.state,
          Address: b.address, Mobile: b.mobile, Email: b.email,
        }));
        if (bizData.length > 0) exportCSV(bizData, Object.keys(bizData[0]), `all-businesses-${dateStr}`);
      }
    }

    setExported(true);
    toast({ title: "Export Complete", description: `${entity === "all" ? "All data" : entity} exported as ${format.toUpperCase()}` });
    setTimeout(() => setExported(false), 3000);
  };

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
            {e.label} <span className="text-[10px] opacity-60 ml-1">({e.count})</span>
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
            <p className="text-[10px] text-muted-foreground">Full backup format</p>
          </div>
        </button>
      </div>

      {/* Export Button */}
      <button
        onClick={handleExport}
        className={cn("premium-btn-primary w-full", exported && "bg-success")}
      >
        {exported ? (
          <><CheckCircle2 className="w-4 h-4" /> Exported!</>
        ) : (
          <><Download className="w-4 h-4" /> Export {entity === "all" ? "All Data" : entity}</>
        )}
      </button>
    </div>
  );
}
