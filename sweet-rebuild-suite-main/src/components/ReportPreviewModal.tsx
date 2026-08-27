import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Download, FileSpreadsheet } from "lucide-react";
import type { Invoice, Business, Customer } from "@/hooks/useDataStore";

interface Props {
  isOpen: boolean;
  invoices: Invoice[];
  businesses: Business[];
  customers: Customer[];
  onDownload: () => void;
  onClose: () => void;
  filename: string;
  /** Optional cash/bank toggle rendered beside Download — the choice is
      made at the moment of export, where it matters. */
  splitChecked?: boolean;
  onSplitChange?: (v: boolean) => void;
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

interface SectionSums {
  count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number;
}

/* Money cell used by both the summary ledger and the invoice table: right
   aligned, tabular digits, never wraps — column alignment is what makes a
   ledger scannable, so every numeric cell goes through this one class. */
const NUM = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

export default function ReportPreviewModal({ isOpen, invoices, businesses, customers, onDownload, onClose, filename, splitChecked, onSplitChange }: Props) {
  const bizMap = useMemo(() => {
    const m: Record<string, Business> = {};
    businesses.forEach(b => (m[b.id] = b));
    return m;
  }, [businesses]);

  // customers prop stays in the API for callers that pass it; the table
  // renders inv.customerName directly (already denormalized by the adapter).
  void customers;

  const { outward, inward, grand } = useMemo(() => {
    const sum = (arr: Invoice[]): SectionSums => ({
      count: arr.length,
      taxable: arr.reduce((s, i) => s + i.subtotal, 0),
      cgst: arr.reduce((s, i) => s + i.totalCGST, 0),
      sgst: arr.reduce((s, i) => s + i.totalSGST, 0),
      igst: arr.reduce((s, i) => s + i.totalIGST, 0),
      total: arr.reduce((s, i) => s + i.total, 0),
    });
    const o = sum(invoices.filter(i => i.type === "OUTWARD"));
    const inw = sum(invoices.filter(i => i.type === "INWARD"));
    return {
      outward: o,
      inward: inw,
      grand: {
        count: o.count + inw.count,
        taxable: o.taxable + inw.taxable,
        cgst: o.cgst + inw.cgst,
        sgst: o.sgst + inw.sgst,
        igst: o.igst + inw.igst,
        total: o.total + inw.total,
      },
    };
  }, [invoices]);

  // Escape closes; page behind must not scroll while the preview is up.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // The app scrolls on <html>, not <body> — lock both, or the page
    // behind keeps its scrollbar (and stays wheel-scrollable) beside us.
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Portal to <body>: any ancestor with a transform (framer page sections
  // mid-animation) becomes the containing block for position:fixed and
  // traps this overlay inside the page flow. The portal makes full-screen
  // mean full-screen unconditionally.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report preview"
      // Full-screen takeover: opaque and unanimated on purpose. A
      // translucent wash belongs behind a floating panel, never under a
      // data table — and any entrance animation (JS or CSS) that stalls
      // in a throttled tab freezes at its first keyframe, leaving the
      // surface transparent or offset. A work surface appears; it does
      // not perform.
      className="fixed inset-0 z-50 bg-background flex flex-col"
    >
            {/* Header */}
            <div className="shrink-0 border-b border-border/60 px-4 sm:px-6 py-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-display font-bold leading-tight">Report Preview</h2>
                <p className="text-xs text-muted-foreground truncate">
                  {filename} · {grand.count} {grand.count === 1 ? "invoice" : "invoices"}
                </p>
              </div>
              {onSplitChange && (
                <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                  <input type="checkbox" checked={!!splitChecked} onChange={(e) => onSplitChange(e.target.checked)} className="rounded" />
                  Cash/bank split
                </label>
              )}
              <button onClick={onDownload} className="premium-btn-primary text-[13px] h-9">
                <Download className="w-3.5 h-3.5" /> Download Excel
              </button>
              <button
                onClick={onClose}
                aria-label="Close preview"
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary ledger: one aligned mini-table instead of three cramped
                cards — five money figures per row can only stay readable when
                they share real columns. */}
            <div className="shrink-0 px-4 sm:px-6 py-4">
              <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
                <table className="w-full min-w-[40rem] text-[12.5px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                      <th className="px-3 py-2 text-left font-semibold">Section</th>
                      <th className="px-3 py-2 text-right font-semibold">Invoices</th>
                      <th className="px-3 py-2 text-right font-semibold">Taxable</th>
                      <th className="px-3 py-2 text-right font-semibold">CGST</th>
                      <th className="px-3 py-2 text-right font-semibold">SGST</th>
                      <th className="px-3 py-2 text-right font-semibold">IGST</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <SummaryRow label="Outward Supply" dotClass="bg-success" data={outward} />
                    <SummaryRow label="Inward Supply" dotClass="bg-blue-500" data={inward} />
                    <tr className="border-t border-border/60 font-semibold">
                      <td className="px-3 py-2 whitespace-nowrap">Grand Total</td>
                      <td className={NUM}>{grand.count}</td>
                      <td className={NUM}>{fmt(grand.taxable)}</td>
                      <td className={NUM}>{fmt(grand.cgst)}</td>
                      <td className={NUM}>{fmt(grand.sgst)}</td>
                      <td className={NUM}>{fmt(grand.igst)}</td>
                      <td className={`${NUM} text-primary`}>{fmt(grand.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Invoice table */}
            {invoices.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <FileSpreadsheet className="w-8 h-8 opacity-40" />
                <p className="text-sm">No invoices in this selection — adjust the FY or filters and try again.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto px-4 sm:px-6">
                {/* No bottom padding on this scroller: the sticky TOTAL row
                    must sit flush on the scrollport edge — padding leaves a
                    strip where rows show through beneath it. */}
                <table className="w-full min-w-[64rem] text-[12px] border-collapse">
                  {/* Sticky surfaces are opaque (bg-card on every th/td):
                      anything translucent here lets scrolled rows ghost
                      through the header and the pinned TOTAL row. */}
                  <thead className="sticky top-0 z-10">
                    <tr className="text-muted-foreground">
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-left font-semibold">#</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-left font-semibold">Bill No.</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-left font-semibold">Date</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-left font-semibold">Party Name</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-left font-semibold">Business</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-center font-semibold">Type</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-left font-semibold">Commodity</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-right font-semibold">Taxable</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-right font-semibold">CGST</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-right font-semibold">SGST</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-right font-semibold">IGST</th>
                      <th className="bg-card border-b border-border/60 px-3 py-2.5 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv, idx) => {
                      const biz = bizMap[inv.businessId];
                      return (
                        <tr key={inv.id || idx} className="border-t border-border/20 hover:bg-secondary/20 transition-colors">
                          <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{inv.invoiceNumber}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fd(inv.invoice_date)}</td>
                          <td className="px-3 py-2 max-w-[16rem] truncate" title={inv.customerName}>{inv.customerName}</td>
                          <td className="px-3 py-2 text-muted-foreground text-[11px] max-w-[11rem] truncate" title={biz?.name || undefined}>{biz?.name || "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              inv.type === "OUTWARD"
                                ? "bg-success/15 text-success"
                                : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                            }`}>
                              {inv.type === "OUTWARD" ? "OUT" : "IN"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[13rem] truncate" title={inv.items[0]?.productName || undefined}>{inv.items[0]?.productName || "-"}</td>
                          <td className={NUM}>{fmt(inv.subtotal)}</td>
                          <td className={NUM}>{fmt(inv.totalCGST)}</td>
                          <td className={NUM}>{fmt(inv.totalSGST)}</td>
                          <td className={NUM}>{fmt(inv.totalIGST)}</td>
                          <td className={`${NUM} font-semibold`}>{fmt(inv.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className="font-semibold">
                      <td colSpan={7} className="bg-card border-t-2 border-primary/40 px-3 py-2.5 text-right">TOTAL</td>
                      <td className={`bg-card border-t-2 border-primary/40 ${NUM} py-2.5`}>{fmt(grand.taxable)}</td>
                      <td className={`bg-card border-t-2 border-primary/40 ${NUM} py-2.5`}>{fmt(grand.cgst)}</td>
                      <td className={`bg-card border-t-2 border-primary/40 ${NUM} py-2.5`}>{fmt(grand.sgst)}</td>
                      <td className={`bg-card border-t-2 border-primary/40 ${NUM} py-2.5`}>{fmt(grand.igst)}</td>
                      <td className={`bg-card border-t-2 border-primary/40 ${NUM} py-2.5 text-primary`}>{fmt(grand.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
    </div>,
    document.body
  );
}

function SummaryRow({ label, dotClass, data }: { label: string; dotClass: string; data: SectionSums }) {
  return (
    <tr className="border-t border-border/20 first:border-t-0">
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden />
          {label}
        </span>
      </td>
      <td className={`${NUM} text-muted-foreground`}>{data.count}</td>
      <td className={NUM}>{fmt(data.taxable)}</td>
      <td className={NUM}>{fmt(data.cgst)}</td>
      <td className={NUM}>{fmt(data.sgst)}</td>
      <td className={NUM}>{fmt(data.igst)}</td>
      <td className={`${NUM} font-semibold`}>{fmt(data.total)}</td>
    </tr>
  );
}
