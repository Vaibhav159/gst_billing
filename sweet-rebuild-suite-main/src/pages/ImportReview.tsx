import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, AlertTriangle, FileSpreadsheet, Plus, Pencil,
  Check, X, UserPlus, Receipt, Upload, AlertCircle, TrendingUp, TrendingDown,
} from "lucide-react";
import { useBusinesses, useCustomers, useInvoices } from "@/hooks/useDataStore";
import type { Business, Customer } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import type { ImportReadyInvoice } from "@/utils/parseInvoiceExcel";

interface LocationState {
  parsedInvoices: ImportReadyInvoice[];
  fileName: string;
  bizFilter?: string;
}

interface ValidationResult {
  invoice: ImportReadyInvoice;
  businessMatch: Business | null;
  customerMatch: Customer | null;
  isDuplicate: boolean;
  status: "ready" | "missing_business" | "missing_customer" | "duplicate";
}

function roundAmount(val: number): number {
  return Math.round(val * 100) / 100;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function ImportReview() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const state = location.state as LocationState | null;

  const { items: businesses } = useBusinesses();
  const { items: customers, refetch: refetchCustomers } = useCustomers();
  const { items: existingInvoices, refetch: refetchInvoices } = useInvoices(undefined, true);

  const [excelPreview] = useState<ImportReadyInvoice[]>(state?.parsedInvoices || []);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ date: "", party: "", gst: "", qty: "", rate: "" });
  const [newlyCreatedCustomers, setNewlyCreatedCustomers] = useState<string[]>([]);
  const [bizFilter] = useState(state?.bizFilter || "all");

  // Redirect if no data
  if (!state?.parsedInvoices || state.parsedInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">No import data. Please upload a file first.</p>
        <Link to="/billing/invoice/import" className="premium-btn-primary">Go to Import</Link>
      </div>
    );
  }

  // Build customer name map for matching
  const customerNameMap = useMemo(() => {
    const map = new Map<string, Customer>();
    customers.forEach(c => {
      map.set(c.name.toLowerCase().trim(), c);
      if ((c as any).gst_number) map.set((c as any).gst_number.toLowerCase().trim(), c);
    });
    newlyCreatedCustomers.forEach(name => {
      const found = customers.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (found) map.set(name.toLowerCase().trim(), found);
    });
    return map;
  }, [customers, newlyCreatedCustomers]);

  // Validation
  const validationResults: ValidationResult[] = useMemo(() => {
    if (!excelPreview || excelPreview.length === 0) return [];
    return excelPreview.map((inv) => {
      // Business match
      let businessMatch: Business | null = null;
      if (bizFilter && bizFilter !== "all") {
        businessMatch = businesses.find(b => String(b.id) === bizFilter) || null;
      }
      if (!businessMatch && inv.firmGSTIN) {
        businessMatch = businesses.find(b => (b as any).gst_number?.toLowerCase() === inv.firmGSTIN.toLowerCase()) || null;
      }
      if (!businessMatch && inv.firmName) {
        businessMatch = businesses.find(b => b.name.toLowerCase().includes(inv.firmName.toLowerCase())) || null;
      }

      // Customer match
      let customerMatch = customerNameMap.get(inv.customerName.toLowerCase().trim()) || null;
      if (!customerMatch && inv.customerGST) {
        customerMatch = customerNameMap.get(inv.customerGST.toLowerCase().trim()) || null;
      }

      // Duplicate check — must match on business + bill# + date AND TYPE.
      // Sales invoice #1 (outward) and purchase bill #1 (inward) are
      // different documents, even when number/date/firm coincide.
      const isDuplicate = existingInvoices.some(
        ei => ei.invoiceNumber === inv.invoiceNumber &&
          String(ei.businessId) === String(businessMatch?.id) &&
          ei.invoice_date === inv.invoice_date &&
          (ei.type || "OUTWARD").toUpperCase() === inv.type
      );

      let status: ValidationResult["status"] = "ready";
      if (!businessMatch) status = "missing_business";
      else if (isDuplicate) status = "duplicate";
      else if (!customerMatch) status = "missing_customer";

      return { invoice: inv, businessMatch, customerMatch, isDuplicate, status };
    });
  }, [excelPreview, businesses, customers, existingInvoices, bizFilter, customerNameMap, newlyCreatedCustomers]);

  const readyCount = validationResults.filter(v => v.status === "ready").length;
  const missingCustCount = validationResults.filter(v => v.status === "missing_customer").length;
  const duplicateCount = validationResults.filter(v => v.status === "duplicate").length;
  const missingBizCount = validationResults.filter(v => v.status === "missing_business").length;

  // Auto-select importable
  useEffect(() => {
    if (validationResults.length > 0) {
      const keys = new Set(
        validationResults
          .filter(v => v.status === "ready" || v.status === "missing_customer")
          .map(v => `${v.invoice.firmName}-${v.invoice.invoiceNumber}`)
      );
      setSelectedInvoices(keys);
    }
  }, [validationResults]);

  const toggleInvoice = (key: string) => {
    setSelectedInvoices(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const toggleAll = () => {
    const importable = validationResults
      .filter(v => v.status === "ready" || v.status === "missing_customer")
      .map(v => `${v.invoice.firmName}-${v.invoice.invoiceNumber}`);
    setSelectedInvoices(prev => prev.size === importable.length ? new Set() : new Set(importable));
  };

  // Inline editing
  const startEditing = (idx: number) => {
    const inv = excelPreview[idx];
    if (!inv) return;
    setEditingIdx(idx);
    setEditForm({
      date: inv.invoice_date, party: inv.customerName, gst: inv.customerGST,
      qty: String(inv.items[0]?.qty || 0), rate: String(inv.items[0]?.rate || 0),
    });
  };
  const cancelEditing = () => setEditingIdx(null);
  const saveEditing = () => {
    if (editingIdx === null) return;
    const inv = excelPreview[editingIdx];
    inv.invoice_date = editForm.date;
    inv.customerName = editForm.party;
    inv.customerGST = editForm.gst;
    if (inv.items.length > 0) {
      const item = inv.items[0];
      item.qty = parseFloat(editForm.qty) || 0;
      item.rate = parseFloat(editForm.rate) || 0;
      item.amount = roundAmount(item.qty * item.rate);
      const gstRate = item.gstRate || 3;
      item.cgst = roundAmount(item.amount * gstRate / 200);
      item.sgst = roundAmount(item.amount * gstRate / 200);
    }
    inv.subtotal = inv.items.reduce((s, i) => s + i.amount, 0);
    inv.totalCGST = inv.items.reduce((s, i) => s + i.cgst, 0);
    inv.totalSGST = inv.items.reduce((s, i) => s + i.sgst, 0);
    inv.total = roundAmount(inv.subtotal + inv.totalCGST + inv.totalSGST + inv.totalIGST);
    setEditingIdx(null);
  };

  const statusIcon = (s: string) => {
    if (s === "ready") return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
    if (s === "duplicate") return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    if (s === "missing_customer") return <UserPlus className="w-3.5 h-3.5 text-blue-500" />;
    return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
  };
  const statusLabel = (s: string) => {
    if (s === "ready") return "Ready";
    if (s === "duplicate") return "Duplicate";
    if (s === "missing_customer") return "New Customer";
    return "No Business";
  };

  // Import handler
  const handleImport = async () => {
    setImporting(true);
    try {
      const toImport = validationResults
        .filter(v => selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`) && (v.status === "ready" || v.status === "missing_customer"))
        .map(v => {
          const inv = { ...v.invoice };
          inv.subtotal = roundAmount(inv.subtotal);
          inv.totalCGST = roundAmount(inv.totalCGST);
          inv.totalSGST = roundAmount(inv.totalSGST);
          inv.totalIGST = roundAmount(inv.totalIGST);
          inv.total = roundAmount(inv.total);
          inv.items = inv.items.map(item => ({ ...item, amount: roundAmount(item.amount), cgst: roundAmount(item.cgst), sgst: roundAmount(item.sgst), igst: roundAmount(item.igst) }));
          return inv;
        });

      if (toImport.length === 0) {
        toast({ title: "Nothing to Import", description: "No valid invoices selected.", variant: "destructive" });
        setImporting(false);
        return;
      }

      const { default: api } = await import("@/utils/api");
      const res = await api.post<{ created: number; skipped: number; errors?: string[]; message?: string }>("invoices/bulk-import/", {
        invoices: toImport,
        business_id: bizFilter !== "all" ? bizFilter : undefined,
      });
      const result = res.data;
      const errCount = result.errors?.length || 0;
      // Show actual outcomes — successes AND failures, with details
      if (errCount > 0) {
        const sample = result.errors!.slice(0, 3).join("\n• ");
        toast({
          title: `Imported ${result.created}, ${errCount} failed`,
          description: `• ${sample}${errCount > 3 ? `\n... and ${errCount - 3} more (see Audit Log)` : ""}`,
          variant: errCount === toImport.length ? "destructive" : "default",
          duration: 12000,
        });
      } else {
        toast({ title: "Import Complete", description: `${result.created} imported, ${result.skipped} skipped.` });
      }
      refetchInvoices();
      refetchCustomers();
      navigate("/billing/import/preview", {
        state: { invoices: toImport, result, businessName: businesses.find(b => String(b.id) === bizFilter)?.name || "All Businesses" },
      });
    } catch (err: any) {
      // Surface real backend errors (DRF validation errors, exceptions) instead of generic "Import failed"
      const data = err?.response?.data;
      let msg = err?.message || "Import failed.";
      if (data) {
        if (typeof data === "string") msg = data;
        else if (data.error) msg = data.error;
        else if (data.detail) msg = data.detail;
        else if (data.message) msg = data.message;
        else if (Array.isArray(data.errors)) msg = data.errors.slice(0, 3).join("; ");
        else msg = JSON.stringify(data).slice(0, 300);
      }
      toast({ title: `Import Failed (${err?.response?.status || "network"})`, description: msg, variant: "destructive", duration: 15000 });
    }
    setImporting(false);
  };

  // Compute Outward/Inward totals for selected
  const selectedResults = validationResults.filter(v => selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`));
  const outward = selectedResults.filter(v => v.invoice.type === "OUTWARD");
  const inward = selectedResults.filter(v => v.invoice.type === "INWARD");
  const sumInvs = (arr: ValidationResult[]) => ({
    count: arr.length,
    taxable: arr.reduce((s, v) => s + v.invoice.subtotal, 0),
    cgst: arr.reduce((s, v) => s + v.invoice.totalCGST, 0),
    sgst: arr.reduce((s, v) => s + v.invoice.totalSGST, 0),
    igst: arr.reduce((s, v) => s + v.invoice.totalIGST, 0),
    total: arr.reduce((s, v) => s + v.invoice.total, 0),
  });

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto animate-fade-in p-6 lg:p-8">
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "Import", href: "/billing/invoice/import" }, { label: "Review" }]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-chart-3/10 border border-chart-3/20 flex items-center justify-center">
          <FileSpreadsheet className="w-5 h-5 text-chart-3" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Review Import</h1>
          <p className="text-sm text-muted-foreground">{state.fileName} — {excelPreview.length} invoices parsed</p>
        </div>
        <Link to="/billing/invoice/import" className="premium-btn-ghost text-[13px]">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="elevated-card rounded-xl p-3 border-l-4 border-l-success">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Ready</p>
          <p className="text-xl font-bold text-success">{readyCount}</p>
        </div>
        <div className="elevated-card rounded-xl p-3 border-l-4 border-l-blue-500">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">New Customers</p>
          <p className="text-xl font-bold text-blue-500">{missingCustCount}</p>
        </div>
        <div className="elevated-card rounded-xl p-3 border-l-4 border-l-amber-500">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Duplicates</p>
          <p className="text-xl font-bold text-amber-500">{duplicateCount}</p>
        </div>
        <div className="elevated-card rounded-xl p-3 border-l-4 border-l-destructive">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">No Business</p>
          <p className="text-xl font-bold text-destructive">{missingBizCount}</p>
        </div>
      </div>

      {/* Outward/Inward Totals for selected */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="elevated-card rounded-xl p-4 border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Outward ({outward.length})</span>
          </div>
          <div className="grid grid-cols-5 gap-2 text-[11px]">
            <div><span className="text-muted-foreground block">Taxable</span><span className="font-semibold">{fmt(sumInvs(outward).taxable)}</span></div>
            <div><span className="text-muted-foreground block">CGST</span><span>{fmt(sumInvs(outward).cgst)}</span></div>
            <div><span className="text-muted-foreground block">SGST</span><span>{fmt(sumInvs(outward).sgst)}</span></div>
            <div><span className="text-muted-foreground block">IGST</span><span>{fmt(sumInvs(outward).igst)}</span></div>
            <div><span className="text-muted-foreground block">Total</span><span className="font-bold text-emerald-600">{fmt(sumInvs(outward).total)}</span></div>
          </div>
        </div>
        <div className="elevated-card rounded-xl p-4 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Inward ({inward.length})</span>
          </div>
          <div className="grid grid-cols-5 gap-2 text-[11px]">
            <div><span className="text-muted-foreground block">Taxable</span><span className="font-semibold">{fmt(sumInvs(inward).taxable)}</span></div>
            <div><span className="text-muted-foreground block">CGST</span><span>{fmt(sumInvs(inward).cgst)}</span></div>
            <div><span className="text-muted-foreground block">SGST</span><span>{fmt(sumInvs(inward).sgst)}</span></div>
            <div><span className="text-muted-foreground block">IGST</span><span>{fmt(sumInvs(inward).igst)}</span></div>
            <div><span className="text-muted-foreground block">Total</span><span className="font-bold text-blue-600">{fmt(sumInvs(inward).total)}</span></div>
          </div>
        </div>
      </div>

      {/* Full Invoice Table */}
      <div className="elevated-card rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between">
          <h2 className="text-[13px] font-display font-semibold text-foreground">
            Invoices ({validationResults.length})
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground">{selectedInvoices.size} selected</span>
            <button onClick={toggleAll} className="text-[11px] text-primary hover:underline font-medium">
              {selectedInvoices.size === (readyCount + missingCustCount) ? "Deselect All" : "Select All"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-secondary/50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2.5 text-left w-8">
                  <input type="checkbox" checked={selectedInvoices.size === (readyCount + missingCustCount) && (readyCount + missingCustCount) > 0} onChange={toggleAll} className="rounded" />
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Bill No.</th>
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Date</th>
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Party Name</th>
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">GST</th>
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Firm</th>
                <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground">Items</th>
                <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground">GST %</th>
                <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Taxable</th>
                <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">CGST</th>
                <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">SGST</th>
                <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">IGST</th>
                <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Total</th>
                <th className="px-3 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {validationResults.map((v, idx) => {
                const inv = v.invoice;
                const key = `${inv.firmName}-${inv.invoiceNumber}`;
                const isSelected = selectedInvoices.has(key);
                const canSelect = v.status === "ready" || v.status === "missing_customer";

                return (
                  <tr key={idx} className={cn(
                    "transition-colors border-t border-border/15",
                    v.status === "duplicate" && "bg-amber-500/5 text-muted-foreground line-through",
                    v.status === "missing_business" && "bg-destructive/5",
                    v.status === "missing_customer" && "bg-blue-500/5",
                    v.status === "ready" && (idx % 2 === 0 ? "bg-background" : "bg-secondary/5"),
                  )}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={isSelected} onChange={() => canSelect && toggleInvoice(key)} disabled={!canSelect} className="rounded" />
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">{statusIcon(v.status)}<span className="text-[10px]">{statusLabel(v.status)}</span></span>
                    </td>
                    <td className="px-3 py-2 font-medium text-primary">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {editingIdx === idx
                        ? <input type="date" value={editForm.date} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} className="w-[120px] px-1.5 py-1 rounded bg-input border border-border text-[11px]" />
                        : inv.invoice_date
                      }
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate" title={inv.customerName}>
                      {editingIdx === idx
                        ? <input type="text" value={editForm.party} onChange={e => setEditForm(p => ({ ...p, party: e.target.value }))} className="w-full px-1.5 py-1 rounded bg-input border border-border text-[11px]" />
                        : <>{inv.customerName}{v.customerMatch && <span className="text-[9px] text-success ml-1">(matched)</span>}</>
                      }
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] max-w-[110px] truncate" title={inv.customerGST}>
                      {editingIdx === idx
                        ? <input type="text" value={editForm.gst} onChange={e => setEditForm(p => ({ ...p, gst: e.target.value }))} className="w-full px-1.5 py-1 rounded bg-input border border-border text-[10px] font-mono" />
                        : inv.customerGST || "-"
                      }
                    </td>
                    <td className="px-3 py-2 max-w-[120px] truncate" title={inv.firmName}>
                      {inv.firmName}{v.businessMatch && <span className="text-[9px] text-success ml-1">(ok)</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editingIdx === idx ? (
                        <div className="flex items-center gap-1">
                          <input type="number" value={editForm.qty} onChange={e => setEditForm(p => ({ ...p, qty: e.target.value }))} className="w-[55px] px-1 py-0.5 rounded bg-input border border-border text-[11px]" step="0.01" />
                          <span className="text-[9px] text-muted-foreground">@</span>
                          <input type="number" value={editForm.rate} onChange={e => setEditForm(p => ({ ...p, rate: e.target.value }))} className="w-[65px] px-1 py-0.5 rounded bg-input border border-border text-[11px]" step="0.01" />
                        </div>
                      ) : (
                        <>{inv.items.length}<span className="text-[9px] text-muted-foreground ml-0.5">({inv.items.map(i => `${i.qty}${i.unit || "gms"}`).join(", ")})</span></>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-muted-foreground text-[11px]">
                      {(() => {
                        const rates = Array.from(new Set(inv.items.map(i => i.gstRate))).filter(r => r > 0);
                        if (rates.length === 0) return <span className="text-destructive/70">?</span>;
                        return rates.length === 1 ? `${rates[0]}%` : rates.map(r => `${r}%`).join("/");
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{"\u20b9"}{fmt(inv.subtotal)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", inv.totalCGST === 0 && "text-muted-foreground/50")}>{"\u20b9"}{fmt(inv.totalCGST)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", inv.totalSGST === 0 && "text-muted-foreground/50")}>{"\u20b9"}{fmt(inv.totalSGST)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", inv.totalIGST === 0 && "text-muted-foreground/50")}>{"\u20b9"}{fmt(inv.totalIGST)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{"\u20b9"}{fmt(inv.total)}</td>
                    <td className="px-3 py-2 text-center">
                      {editingIdx === idx ? (
                        <div className="flex items-center gap-0.5">
                          <button onClick={saveEditing} className="w-6 h-6 rounded flex items-center justify-center hover:bg-success/20 text-success"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={cancelEditing} className="w-6 h-6 rounded flex items-center justify-center hover:bg-destructive/20 text-destructive"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button onClick={() => startEditing(idx)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-3 h-3" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-secondary/40 border-t-2 border-border/40">
              <tr className="font-semibold text-[11px]">
                <td colSpan={9} className="px-3 py-2.5 text-right text-muted-foreground uppercase">
                  Selected Total ({selectedInvoices.size} invoices)
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{"\u20b9"}{fmt(selectedResults.reduce((s, v) => s + v.invoice.subtotal, 0))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{"\u20b9"}{fmt(selectedResults.reduce((s, v) => s + v.invoice.totalCGST, 0))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{"\u20b9"}{fmt(selectedResults.reduce((s, v) => s + v.invoice.totalSGST, 0))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{"\u20b9"}{fmt(selectedResults.reduce((s, v) => s + v.invoice.totalIGST, 0))}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-bold">{"\u20b9"}{fmt(selectedResults.reduce((s, v) => s + v.invoice.total, 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Sticky Import Bar */}
      <div className="sticky bottom-0 z-20 elevated-card rounded-2xl p-4 flex items-center gap-4 border-t border-border/30">
        <Link to="/billing/invoice/import" className="premium-btn-ghost text-[13px] h-10">
          <ArrowLeft className="w-4 h-4" /> Cancel
        </Link>
        <div className="flex-1 text-center">
          <span className="text-[12px] text-muted-foreground">
            <span className="font-semibold text-foreground">{selectedInvoices.size}</span> of {validationResults.length} invoices selected
            {" "}({"\u20b9"}{fmt(selectedResults.reduce((s, v) => s + v.invoice.total, 0))})
          </span>
        </div>
        <button
          onClick={handleImport}
          disabled={importing || selectedInvoices.size === 0}
          className={cn(
            "h-10 px-6 rounded-xl text-[13px] font-semibold flex items-center gap-2 transition-all",
            selectedInvoices.size > 0 && !importing
              ? "bg-primary text-primary-foreground hover:brightness-110 glow-sm"
              : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
          )}
        >
          {importing ? (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {importing ? "Importing..." : `Import ${selectedInvoices.size} Invoices`}
        </button>
      </div>
    </div>
  );
}
