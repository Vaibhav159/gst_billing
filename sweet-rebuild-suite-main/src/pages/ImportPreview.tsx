import { useLocation, useNavigate, Link } from "react-router-dom";
import { CheckCircle2, ArrowLeft, FileText, TrendingUp, TrendingDown, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import Breadcrumbs from "@/components/Breadcrumbs";
import type { ImportReadyInvoice } from "@/utils/parseInvoiceExcel";
import { useMemo } from "react";

interface ImportPreviewState {
  invoices: ImportReadyInvoice[];
  result: { created: number; skipped: number; errors: string[] };
  businessName?: string;
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function ImportPreview() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ImportPreviewState | null;

  const { outward, inward, grandTotals } = useMemo(() => {
    if (!state?.invoices) return { outward: { invoices: [] as ImportReadyInvoice[], taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }, inward: { invoices: [] as ImportReadyInvoice[], taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }, grandTotals: { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 } };
    const out = state.invoices.filter(i => i.type === "OUTWARD");
    const inw = state.invoices.filter(i => i.type === "INWARD");
    const sum = (arr: ImportReadyInvoice[]) => ({
      invoices: arr,
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
        taxable: o.taxable + i.taxable,
        cgst: o.cgst + i.cgst,
        sgst: o.sgst + i.sgst,
        igst: o.igst + i.igst,
        total: o.total + i.total,
      },
    };
  }, [state?.invoices]);

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">No import data available.</p>
        <Link to="/billing/invoice/import" className="premium-btn-primary">Go to Import</Link>
      </div>
    );
  }

  const { result, businessName } = state;
  const allInvoices = state.invoices;

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-5 max-w-7xl mx-auto">
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "Import", href: "/billing/invoice/import" }, { label: "Import Summary" }]} />

      {/* Success Header */}
      <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-display font-bold text-foreground">Import Successful</h1>
            <p className="text-sm text-muted-foreground">
              {businessName && <span className="font-medium text-foreground">{businessName}</span>}
              {businessName && " \u2014 "}
              <span className="text-emerald-600 font-semibold">{result.created}</span> imported,{" "}
              <span className="text-amber-600 font-semibold">{result.skipped}</span> skipped
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/billing/invoice/import" className="premium-btn-outline text-[13px] h-9">
              <ArrowLeft className="w-3.5 h-3.5" /> Import More
            </Link>
            <Link to="/billing/invoice/list" className="premium-btn-primary text-[13px] h-9">
              <FileText className="w-3.5 h-3.5" /> View Invoices
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Outward / Inward / Grand Total Summary */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Outward */}
        <div className="elevated-card rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <h3 className="text-xs font-display font-bold uppercase tracking-wider text-emerald-600">Outward Supply</h3>
            <span className="ml-auto text-xs text-muted-foreground">{outward.invoices.length} invoices</span>
          </div>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span className="font-semibold">{fmt(outward.taxable)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-medium">{fmt(outward.cgst)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-medium">{fmt(outward.sgst)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-medium">{fmt(outward.igst)}</span></div>
            <div className="flex justify-between pt-2 border-t border-border/40"><span className="font-semibold">Total Invoice Value</span><span className="font-bold text-emerald-600">{fmt(outward.total)}</span></div>
          </div>
        </div>

        {/* Inward */}
        <div className="elevated-card rounded-2xl p-5 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-blue-500" />
            <h3 className="text-xs font-display font-bold uppercase tracking-wider text-blue-600">Inward Supply</h3>
            <span className="ml-auto text-xs text-muted-foreground">{inward.invoices.length} invoices</span>
          </div>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span className="font-semibold">{fmt(inward.taxable)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-medium">{fmt(inward.cgst)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-medium">{fmt(inward.sgst)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-medium">{fmt(inward.igst)}</span></div>
            <div className="flex justify-between pt-2 border-t border-border/40"><span className="font-semibold">Total Invoice Value</span><span className="font-bold text-blue-600">{fmt(inward.total)}</span></div>
          </div>
        </div>

        {/* Grand Total */}
        <div className="elevated-card rounded-2xl p-5 border-l-4 border-l-primary">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-display font-bold uppercase tracking-wider text-primary">Grand Total</h3>
            <span className="ml-auto text-xs text-muted-foreground">{allInvoices.length} invoices</span>
          </div>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span className="font-semibold">{fmt(grandTotals.taxable)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-medium">{fmt(grandTotals.cgst)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-medium">{fmt(grandTotals.sgst)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-medium">{fmt(grandTotals.igst)}</span></div>
            <div className="flex justify-between pt-2 border-t border-border/40"><span className="font-semibold">Total Invoice Value</span><span className="font-bold text-primary">{fmt(grandTotals.total)}</span></div>
          </div>
        </div>
      </motion.div>

      {/* Errors (if any) */}
      {result.errors && result.errors.length > 0 && (
        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-5 border-l-4 border-l-destructive">
          <h3 className="text-xs font-display font-bold uppercase tracking-wider text-destructive mb-3">Errors ({result.errors.length})</h3>
          <ul className="space-y-1 text-[12px] text-muted-foreground max-h-40 overflow-y-auto">
            {result.errors.map((err, i) => <li key={i} className="flex gap-2"><span className="text-destructive shrink-0">{i + 1}.</span>{err}</li>)}
          </ul>
        </motion.div>
      )}

      {/* Invoice Details Table */}
      <motion.div variants={fadeUp} className="elevated-card rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border/30">
          <h3 className="text-sm font-display font-bold text-foreground">Imported Invoices</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-secondary/30 text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-semibold">#</th>
                <th className="px-3 py-2.5 text-left font-semibold">Bill No.</th>
                <th className="px-3 py-2.5 text-left font-semibold">Date</th>
                <th className="px-3 py-2.5 text-left font-semibold">Party Name</th>
                <th className="px-3 py-2.5 text-center font-semibold">Type</th>
                <th className="px-3 py-2.5 text-left font-semibold">Commodity</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                <th className="px-3 py-2.5 text-center font-semibold">GST %</th>
                <th className="px-3 py-2.5 text-right font-semibold">Taxable</th>
                <th className="px-3 py-2.5 text-right font-semibold">CGST</th>
                <th className="px-3 py-2.5 text-right font-semibold">SGST</th>
                <th className="px-3 py-2.5 text-right font-semibold">IGST</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {allInvoices.map((inv, idx) => (
                <tr key={idx} className="border-t border-border/20 hover:bg-secondary/10 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2 text-muted-foreground">{inv.invoice_date}</td>
                  <td className="px-3 py-2">{inv.customerName}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${inv.type === "OUTWARD" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"}`}>
                      {inv.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{inv.items[0]?.productName || "-"}</td>
                  <td className="px-3 py-2 text-right font-mono">{inv.items.reduce((s, i) => s + i.qty, 0).toFixed(3)}</td>
                  <td className="px-3 py-2 text-right font-mono">{inv.items[0]?.rate?.toFixed(2) || "-"}</td>
                  <td className="px-3 py-2 text-center font-mono text-muted-foreground">{(inv.items[0]?.gstRate ?? 0)}%</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(inv.subtotal)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(inv.totalCGST)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(inv.totalSGST)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(inv.totalIGST)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(inv.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5 border-t-2 border-primary/20 font-semibold">
                <td colSpan={9} className="px-3 py-2.5 text-right">TOTAL</td>
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
    </motion.div>
  );
}
