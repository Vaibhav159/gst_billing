import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, AlertTriangle, FileSpreadsheet, Plus, Pencil,
  Check, X, UserPlus, AlertCircle,
} from "lucide-react";
import { useBusinesses, useCustomers, useInvoices } from "@/hooks/useDataStore";
import type { Business, Customer } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import type { ImportReadyInvoice } from "@/utils/parseInvoiceExcel";
import { formatApiError, errorTag } from "@/utils/apiError";
import { pushNotification } from "@/hooks/useNotifications";
import { applyRowEdit } from "@/utils/importRowEdit";

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

function StatusChip({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
      className, count === 0 && "opacity-40")}>
      <span className="tabular-nums text-[12px]">{count}</span> {label}
    </span>
  );
}

const LEDGER_NUM = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";

function SummaryLedgerRow({ label, dotClass, count, sums }: {
  label: string; dotClass: string; count: number;
  sums: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
}) {
  return (
    <tr className="border-t border-border/20 first:border-t-0">
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <span className={cn("w-1.5 h-1.5 rounded-full", dotClass)} aria-hidden />
          {label}
        </span>
      </td>
      <td className={cn(LEDGER_NUM, "text-muted-foreground")}>{count}</td>
      <td className={LEDGER_NUM}>{fmt(sums.taxable)}</td>
      <td className={LEDGER_NUM}>{fmt(sums.cgst)}</td>
      <td className={LEDGER_NUM}>{fmt(sums.sgst)}</td>
      <td className={LEDGER_NUM}>{fmt(sums.igst)}</td>
      <td className={cn(LEDGER_NUM, "font-semibold")}>{fmt(sums.total)}</td>
    </tr>
  );
}

// ─── Fuzzy customer-name matching (suggest-only) ───────────────────────
// Indian jewellery customer names have lots of transliteration variants
// and typos: CHARBHUJA JEWLLERS↔JEWELLERS, KISHANLAL CHHOGALAL↔CHOGALAL,
// SATYANARYAN↔SATYANARAYAN, plus "JI" honorifics. Exact match misses all
// of these and flags them as new customers — creating duplicate ledgers.
//
// But naive fuzzy matching is DANGEROUS here: "DARSHAN JEWELLERS" and
// "KRISHNA JEWELLERS" share the " JEWELLERS" suffix and score ~0.7
// overall despite being different shops; "RAMLAL DANGI" and "GAHRILAL
// DANGI" are different people sharing the "DANGI" surname. Auto-merging
// those corrupts GST records by attributing sales to the wrong party.
//
// Defense: require the FIRST token (the distinctive part — given name or
// shop name) to be similar, not just the whole string. The shared suffix
// can't carry a false match on its own. And we only ever SUGGEST — the
// user clicks to adopt, never silent.

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Strip the common honorifics/suffixes that inflate or deflate the
// comparison without changing identity. "JI", "SHRI", "SMT" etc.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ji|shri|sri|smt|shree|m\/s|messrs)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Two tokens "match" when one is a clear truncation of the other —
// e.g. "jew" → "jewellers", "ent" → "enterprises". The 3-char floor
// stops trivially-short prefixes ("a"→"anything") from matching.
function isPrefixAbbrev(x: string, y: string): boolean {
  const [shortT, longT] = x.length <= y.length ? [x, y] : [y, x];
  return shortT.length >= 3 && longT.startsWith(shortT) && shortT !== longT;
}

// Token-aligned score: the precise matcher for this domain. Requires the
// SAME token count (after honorific stripping) and that every aligned
// token pair is identical, a fuzzy near-match (≥0.7), or a prefix
// abbreviation. ANY failing token kills the match outright.
//
// This is what catches the abbreviation case "DARSHAN JEW." ↔ "DARSHAN
// JEWELLERS" (Levenshtein ratio alone scored it 0.75, just under the
// bar, because it penalises the dropped "ELLERS"). It's also stricter
// than the blended score on false positives: different token COUNT or
// any sub-0.7 token returns 0, so "DARSHAN JEWELLERS"↔"KRISHNA
// JEWELLERS" (darshan/krishna ≈0.29) and "RAMLAL DANGI"↔"RAMLAL JI"
// (1 token vs 2 after stripping "ji") both fail cleanly.
function tokenAlignScore(imp: string, cust: string): number {
  const a = normalizeName(imp).split(" ").filter(Boolean);
  const b = normalizeName(cust).split(" ").filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) { sum += 1; continue; }
    if (isPrefixAbbrev(a[i], b[i])) { sum += 0.9; continue; }
    const r = ratio(a[i], b[i]);
    if (r < 0.7) return 0; // one mismatched token ⇒ different entity
    sum += r;
  }
  return sum / a.length;
}

// Blended Levenshtein score — handles same-length typos/transliteration
// where token-align might be slightly off. First-token gate guards
// against shared-suffix false positives.
function blendedScore(imp: string, cust: string): number {
  const a = normalizeName(imp), b = normalizeName(cust);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aFirst = a.split(" ")[0] || "";
  const bFirst = b.split(" ")[0] || "";
  const firstTok = ratio(aFirst, bFirst);
  if (firstTok < 0.6) return 0;
  return ratio(a, b) * 0.7 + firstTok * 0.3;
}

// Returns a 0..1 confidence that `imp` and `cust` are the same entity.
// Max of the two scorers — both independently reject the false
// positives, so taking the max only ever helps recall.
function nameMatchScore(imp: string, cust: string): number {
  const a = normalizeName(imp), b = normalizeName(cust);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(tokenAlignScore(imp, cust), blendedScore(imp, cust));
}

const SUGGEST_THRESHOLD = 0.78;

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
  const [newlyCreatedCustomers] = useState<string[]>([]);
  const [bizFilter] = useState(state?.bizFilter || "all");
  // Bumped when a fuzzy suggestion is adopted (mutates excelPreview in
  // place) — forces the validation memo to recompute against the new name.
  const [adoptTick, setAdoptTick] = useState(0);

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
    // adoptTick: excelPreview rows are mutated in place when a suggestion
    // is adopted, so the reference doesn't change — the tick forces recompute.
  }, [excelPreview, businesses, customers, existingInvoices, bizFilter, customerNameMap, newlyCreatedCustomers, adoptTick]);

  const readyCount = validationResults.filter(v => v.status === "ready").length;
  const missingCustCount = validationResults.filter(v => v.status === "missing_customer").length;
  const duplicateCount = validationResults.filter(v => v.status === "duplicate").length;
  const missingBizCount = validationResults.filter(v => v.status === "missing_business").length;

  // Fuzzy suggestions for "New Customer" rows — best existing customer
  // above the confidence threshold. Suggest-only: the user clicks to
  // adopt (adoptSuggestion below). Keyed by the row's excelPreview index.
  const suggestionByIdx = useMemo(() => {
    const out = new Map<number, { customer: Customer; score: number }>();
    if (customers.length === 0) return out;
    validationResults.forEach((v, idx) => {
      if (v.status !== "missing_customer") return;
      const imp = v.invoice.customerName || "";
      if (!imp.trim()) return;
      let best: { customer: Customer; score: number } | null = null;
      for (const c of customers) {
        const s = nameMatchScore(imp, c.name);
        if (s >= SUGGEST_THRESHOLD && (!best || s > best.score)) {
          best = { customer: c, score: s };
        }
      }
      if (best) out.set(idx, best);
    });
    return out;
  }, [validationResults, customers]);

  const suggestionCount = suggestionByIdx.size;

  // Adopt a suggested customer: rewrite the row's party name (and GST if
  // we have one and the row lacks it) to the canonical DB customer, so
  // the backend's exact-name match links it instead of creating a new
  // one. Mutates excelPreview in place (same pattern as saveEditing) and
  // bumps a counter to force the validation memo to recompute.
  const adoptSuggestion = (idx: number, customer: Customer) => {
    const inv = excelPreview[idx];
    if (!inv) return;
    inv.customerName = customer.name;
    const gst = (customer as any).gst_number;
    if (gst && (!inv.customerGST || inv.customerGST === "-")) inv.customerGST = gst;
    setAdoptTick(t => t + 1);
    toast({ title: "Customer matched", description: `Linked to ${customer.name}` });
  };

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
    // Money math lives in utils/importRowEdit.ts, under test. Rebuilding it
    // here by hand is what produced A7: an unchanged save moved the total.
    const recomputed = applyRowEdit(inv as any, {
      qty: parseFloat(editForm.qty) || 0,
      rate: parseFloat(editForm.rate) || 0,
    });
    inv.items = recomputed.items as typeof inv.items;
    inv.subtotal = recomputed.subtotal;
    inv.totalCGST = recomputed.totalCGST;
    inv.totalSGST = recomputed.totalSGST;
    inv.totalIGST = recomputed.totalIGST;
    inv.total = recomputed.total;
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
        // Persist a partial-failure breadcrumb so the user can revisit the
        // problem from the bell after dismissing the toast.
        pushNotification({
          type: errCount === toImport.length ? "error" : "warning",
          title: `Import: ${result.created} ok · ${errCount} failed`,
          message: `Open Audit Log for the full error list. Skipped: ${result.skipped || 0}.`,
        });
      } else {
        toast({ title: "Import Complete", description: `${result.created} imported, ${result.skipped} skipped.` });
        pushNotification({
          type: "success",
          title: "Import complete",
          message: `${result.created} invoice${result.created === 1 ? "" : "s"} imported${result.skipped ? `, ${result.skipped} skipped` : ""}.`,
        });
      }
      refetchInvoices();
      refetchCustomers();
      navigate("/billing/import/preview", {
        state: { invoices: toImport, result, businessName: businesses.find(b => String(b.id) === bizFilter)?.name || "All Businesses" },
      });
    } catch (err: any) {
      toast({
        title: `Import Failed ${errorTag(err)}`,
        description: formatApiError(err, "Import failed."),
        variant: "destructive",
        duration: 15000,
      });
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

      {/* Parse outcome at a glance: compact chips (zero counts recede),
          then one aligned ledger — five money figures per row only stay
          readable as real table columns, never as per-card mini-grids. */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label="Ready" count={readyCount} className="bg-success/10 text-success" />
        <StatusChip label="New customers" count={missingCustCount} className="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
        <StatusChip label="Duplicates" count={duplicateCount} className="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
        <StatusChip label="No business" count={missingBizCount} className="bg-destructive/10 text-destructive" />
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
        <table className="w-full min-w-[40rem] text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
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
            <SummaryLedgerRow label="Outward" dotClass="bg-success" count={outward.length} sums={sumInvs(outward)} />
            <SummaryLedgerRow label="Inward" dotClass="bg-blue-500" count={inward.length} sums={sumInvs(inward)} />
          </tbody>
        </table>
      </div>

      {/* Full Invoice Table */}
      <div className="elevated-card rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between">
          <h2 className="text-[13px] font-display font-semibold text-foreground">
            Invoices ({validationResults.length})
          </h2>
          <div className="flex items-center gap-3">
            {suggestionCount > 0 && (
              <button
                onClick={() => {
                  // Snapshot first — adopting mutates excelPreview, which
                  // would shrink suggestionByIdx mid-iteration.
                  const toAdopt = Array.from(suggestionByIdx.entries());
                  toAdopt.forEach(([idx, sug]) => {
                    const inv = excelPreview[idx];
                    if (!inv) return;
                    inv.customerName = sug.customer.name;
                    const gst = (sug.customer as any).gst_number;
                    if (gst && (!inv.customerGST || inv.customerGST === "-")) inv.customerGST = gst;
                  });
                  setAdoptTick(t => t + 1);
                  toast({ title: "Suggestions applied", description: `${toAdopt.length} customer${toAdopt.length === 1 ? "" : "s"} linked to existing records.` });
                }}
                className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-2 py-1 text-[11px] text-blue-400 font-medium transition-colors"
                title="Link all near-match names to their suggested existing customers"
              >
                <Check className="w-3 h-3" /> Match all {suggestionCount} suggestion{suggestionCount === 1 ? "" : "s"}
              </button>
            )}
            <span className="text-[11px] text-muted-foreground">{selectedInvoices.size} selected</span>
            <button onClick={toggleAll} className="text-[11px] text-primary hover:underline font-medium">
              {selectedInvoices.size === (readyCount + missingCustCount) ? "Deselect All" : "Select All"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-card border-b border-border/60 sticky top-0 z-10">
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
                <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground whitespace-nowrap">Rate</th>
                <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground whitespace-nowrap">GST&nbsp;%</th>
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
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                      {editingIdx === idx
                        ? <input type="date" value={editForm.date} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} className="w-[120px] px-1.5 py-1 rounded bg-input border border-border text-[11px]" />
                        : inv.invoice_date
                      }
                    </td>
                    <td className="px-3 py-2 max-w-[200px]" title={inv.customerName}>
                      {editingIdx === idx ? (
                        <input type="text" value={editForm.party} onChange={e => setEditForm(p => ({ ...p, party: e.target.value }))} className="w-full px-1.5 py-1 rounded bg-input border border-border text-[11px]" />
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 min-w-0"><span className="truncate">{inv.customerName}</span>{v.customerMatch && <Check className="w-3 h-3 text-success shrink-0" aria-label="Matched to an existing customer" />}</span>
                          {/* Fuzzy suggestion chip — only on unmatched rows.
                              One click rewrites the name to the canonical DB
                              customer so the backend links instead of dupes. */}
                          {(() => {
                            const sug = suggestionByIdx.get(idx);
                            if (!sug || v.status !== "missing_customer") return null;
                            const pct = Math.round(sug.score * 100);
                            return (
                              <button
                                onClick={() => adoptSuggestion(idx, sug.customer)}
                                className="inline-flex items-center gap-1 self-start rounded-md bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.5 text-[9px] text-blue-400 transition-colors"
                                title={`Use existing customer "${sug.customer.name}" (${pct}% match)`}
                              >
                                <Check className="w-2.5 h-2.5" />
                                <span className="truncate max-w-[130px]">≈ {sug.customer.name}</span>
                                <span className="opacity-60">{pct}%</span>
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap">
                      {editingIdx === idx
                        ? <input type="text" value={editForm.gst} onChange={e => setEditForm(p => ({ ...p, gst: e.target.value }))} className="w-full px-1.5 py-1 rounded bg-input border border-border text-[10px] font-mono" />
                        : inv.customerGST || "-"
                      }
                    </td>
                    <td className="px-3 py-2 max-w-[120px] truncate" title={inv.firmName}>
                      <span className="inline-flex items-center gap-1 min-w-0"><span className="truncate">{inv.firmName}</span>{v.businessMatch && <Check className="w-3 h-3 text-success shrink-0" aria-label="Firm matched" />}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editingIdx === idx ? (
                        <div className="flex items-center gap-1">
                          <input type="number" value={editForm.qty} onChange={e => setEditForm(p => ({ ...p, qty: e.target.value }))} className="w-[55px] px-1 py-0.5 rounded bg-input border border-border text-[11px]" step="0.01" />
                          <span className="text-[9px] text-muted-foreground">@</span>
                          <input type="number" value={editForm.rate} onChange={e => setEditForm(p => ({ ...p, rate: e.target.value }))} className="w-[65px] px-1 py-0.5 rounded bg-input border border-border text-[11px]" step="0.01" />
                        </div>
                      ) : (
                        (() => {
                          const totalQty = inv.items.reduce((q, i) => q + (i.qty || 0), 0);
                          const units = Array.from(new Set(inv.items.map(i => i.unit || "gms")));
                          const qtyLabel = units.length === 1 ? `${fmt(totalQty)} ${units[0]}` : `${inv.items.length} units`;
                          return (
                            <span className="whitespace-nowrap" title={inv.items.map(i => `${i.qty} ${i.unit || "gms"} @ ₹${fmt(i.rate)}`).join("\n")}>
                              {inv.items.length} · <span className="text-muted-foreground">{qtyLabel}</span>
                            </span>
                          );
                        })()
                      )}
                    </td>
                    {/* Rate (₹ per unit). In edit mode the value is edited
                        in the Items cell above (qty @ rate); here we mirror
                        the live value muted so the column stays populated. */}
                    <td className="px-3 py-2 text-right tabular-nums text-[11px] text-muted-foreground whitespace-nowrap">
                      {editingIdx === idx ? (
                        <span className="opacity-70">{"₹"}{editForm.rate || 0}</span>
                      ) : (() => {
                        const rates = Array.from(new Set(inv.items.map(i => i.rate))).filter(r => r > 0);
                        if (rates.length === 0) return <span className="text-muted-foreground/50">-</span>;
                        const units = Array.from(new Set(inv.items.map(i => i.unit || "gms")));
                        const suffix = units.length === 1 ? `/${units[0]}` : "";
                        if (rates.length === 1) return <>{"₹"}{fmt(rates[0])}<span className="text-[9px] opacity-50">{suffix}</span></>;
                        const lo = Math.min(...rates), hi = Math.max(...rates);
                        return <span title={rates.map(r => `₹${fmt(r)}`).join(", ")}>{"₹"}{fmt(lo)}<span className="opacity-50">–</span>{fmt(hi)}</span>;
                      })()}
                    </td>
                    <td className="px-3 py-2 text-center text-muted-foreground text-[11px] whitespace-nowrap">
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
                <td colSpan={10} className="px-3 py-2.5 text-right text-muted-foreground uppercase">
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
