import { X, Download, TrendingUp, TrendingDown, Receipt } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";
import type { Invoice, Business, Customer } from "@/hooks/useDataStore";

interface Props {
  isOpen: boolean;
  invoices: Invoice[];
  businesses: Business[];
  customers: Customer[];
  onDownload: () => void;
  onClose: () => void;
  filename: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fd(d: string) {
  try {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}-${String(dt.getMonth() + 1).padStart(2, "0")}-${dt.getFullYear()}`;
  } catch { return d; }
}

export default function ReportPreviewModal({ isOpen, invoices, businesses, customers, onDownload, onClose, filename }: Props) {
  const bizMap = useMemo(() => {
    const m: Record<string, Business> = {};
    businesses.forEach(b => (m[b.id] = b));
    return m;
  }, [businesses]);

  const custMap = useMemo(() => {
    const m: Record<string, Customer> = {};
    customers.forEach(c => (m[c.id] = c));
    return m;
  }, [customers]);

  const { outward, inward, grandTotals } = useMemo(() => {
    const out = invoices.filter(i => i.type === "OUTWARD");
    const inw = invoices.filter(i => i.type === "INWARD");
    const sum = (arr: Invoice[]) => ({
      count: arr.length,
      taxable: arr.reduce((s, i) => s + i.subtotal, 0),
      cgst: arr.reduce((s, i) => s + i.totalCGST, 0),
      sgst: arr.reduce((s, i) => s + i.totalSGST, 0),
      igst: arr.reduce((s, i) => s + i.totalIGST, 0),
      total: arr.reduce((s, i) => s + i.total, 0),
    });
    const o = sum(out);
    const i = sum(inw);
    return {
      outward: o,
      inward: i,
      grandTotals: {
        count: o.count + i.count,
        taxable: o.taxable + i.taxable,
        cgst: o.cgst + i.cgst,
        sgst: o.sgst + i.sgst,
        igst: o.igst + i.igst,
        total: o.total + i.total,
      },
    };
  }, [invoices]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border/30 bg-background px-6 py-4 flex items-center gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-display font-bold">Report Preview</h2>
            <p className="text-xs text-muted-foreground">{filename} · {grandTotals.count} invoices</p>
          </div>
          <button onClick={onDownload} className="premium-btn-primary text-[13px] h-9">
            <Download className="w-3.5 h-3.5" /> Download Excel
          </button>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Cards */}
        <div className="shrink-0 px-6 py-4 border-b border-border/20">
          <div className="grid grid-cols-3 gap-4 max-w-4xl">
            <SummaryCard icon={TrendingUp} label="Outward Supply" count={outward.count} data={outward} color="emerald" />
            <SummaryCard icon={TrendingDown} label="Inward Supply" count={inward.count} data={inward} color="blue" />
            <SummaryCard icon={Receipt} label="Grand Total" count={grandTotals.count} data={grandTotals} color="primary" />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-secondary/60 backdrop-blur text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-semibold">#</th>
                <th className="px-3 py-2.5 text-left font-semibold">Bill No.</th>
                <th className="px-3 py-2.5 text-left font-semibold">Date</th>
                <th className="px-3 py-2.5 text-left font-semibold">Party Name</th>
                <th className="px-3 py-2.5 text-left font-semibold">Business</th>
                <th className="px-3 py-2.5 text-center font-semibold">Type</th>
                <th className="px-3 py-2.5 text-left font-semibold">Commodity</th>
                <th className="px-3 py-2.5 text-right font-semibold">Taxable</th>
                <th className="px-3 py-2.5 text-right font-semibold">CGST</th>
                <th className="px-3 py-2.5 text-right font-semibold">SGST</th>
                <th className="px-3 py-2.5 text-right font-semibold">IGST</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, idx) => {
                const biz = bizMap[inv.businessId];
                const cust = custMap[inv.customerId];
                return (
                  <tr key={inv.id || idx} className="border-t border-border/15 hover:bg-secondary/10 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fd(inv.invoice_date)}</td>
                    <td className="px-3 py-2">{inv.customerName}</td>
                    <td className="px-3 py-2 text-muted-foreground text-[11px]">{biz?.name || "-"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${inv.type === "OUTWARD" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}`}>
                        {inv.type === "OUTWARD" ? "OUT" : "IN"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.items[0]?.productName || "-"}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(inv.subtotal)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(inv.totalCGST)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(inv.totalSGST)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(inv.totalIGST)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(inv.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5 border-t-2 border-primary/20 font-semibold sticky bottom-0">
                <td colSpan={7} className="px-3 py-2.5 text-right">TOTAL</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmt(grandTotals.taxable)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmt(grandTotals.cgst)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmt(grandTotals.sgst)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{fmt(grandTotals.igst)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-primary">{fmt(grandTotals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function SummaryCard({ icon: Icon, label, count, data, color }: {
  icon: any; label: string; count: number;
  data: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  color: string;
}) {
  const colorMap: Record<string, { text: string; bg: string; border: string }> = {
    emerald: { text: "text-emerald-600", bg: "bg-emerald-500/10", border: "border-l-emerald-500" },
    blue: { text: "text-blue-600", bg: "bg-blue-500/10", border: "border-l-blue-500" },
    primary: { text: "text-primary", bg: "bg-primary/10", border: "border-l-primary" },
  };
  const c = colorMap[color] || colorMap.primary;

  return (
    <div className={`rounded-xl border border-border/30 p-3 border-l-4 ${c.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 ${c.text}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${c.text}`}>{label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
      </div>
      <div className="grid grid-cols-5 gap-1 text-[10px]">
        <div><span className="text-muted-foreground block">Taxable</span><span className="font-semibold">{fmt(data.taxable)}</span></div>
        <div><span className="text-muted-foreground block">CGST</span><span className="font-medium">{fmt(data.cgst)}</span></div>
        <div><span className="text-muted-foreground block">SGST</span><span className="font-medium">{fmt(data.sgst)}</span></div>
        <div><span className="text-muted-foreground block">IGST</span><span className="font-medium">{fmt(data.igst)}</span></div>
        <div><span className="text-muted-foreground block">Total</span><span className={`font-bold ${c.text}`}>{fmt(data.total)}</span></div>
      </div>
    </div>
  );
}
