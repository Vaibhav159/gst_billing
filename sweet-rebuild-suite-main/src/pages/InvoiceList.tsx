import React, { useState, useMemo, useEffect, useCallback } from "react";
import { toCSV, downloadCSV } from "@/utils/csv";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Link, useOutletContext, useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Plus, Download, Upload, Bot, Printer, ArrowUpDown, Eye, Pencil,
  Trash2, Copy, CheckSquare, Square, LayoutGrid, LayoutList, TrendingUp,
  TrendingDown, Receipt, IndianRupee, Calendar, FileText, SlidersHorizontal, Share2, Loader2, FileSpreadsheet, QrCode, MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { financialYears, formatCurrency, formatCompactCurrency, formatDate } from "@/utils/mockData";
import { useInvoices, useBusinesses, useCustomers, useDashboardStats } from "@/hooks/useDataStore";
import type { InvoiceFilters } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";

import { cn, pluralize } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileFilterSheet from "@/components/mobile/MobileFilterSheet";
import { shareInvoice } from "@/utils/shareInvoice";
import { downloadReportExcel } from "@/utils/generateReportExcel";

interface OutletCtx { selectedFY: string }

export default function InvoiceList() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [bizFilter, setBizFilter] = useState("all");
  const [custFilter, setCustFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [fyFilter, setFyFilter] = useState(selectedFY);
  useEffect(() => { setFyFilter(selectedFY); }, [selectedFY]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"date" | "total" | "invoiceNumber">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [view, setView] = useState<"table" | "grid">("table");
  const [monthFilter, setMonthFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);

  // Drill-down URL params from DataQualityBanner.
  // `?dups=1` → only colliding invoice numbers, `?empty=1` → no-item invoices,
  // `?no_hsn=1` → invoices with line items missing HSN. The user lands here
  // already filtered; clearing happens via the existing Clear button below.
  const [searchParams, setSearchParams] = useSearchParams();
  const dupsFilter = searchParams.get("dups") === "1";
  const emptyFilter = searchParams.get("empty") === "1";
  const noHsnFilter = searchParams.get("no_hsn") === "1";
  const hasHygieneFilter = dupsFilter || emptyFilter || noHsnFilter;

  // Build filters object for the API-driven hook.
  //
  // When a hygiene URL drill-down is active (dups / empty / no_hsn), the
  // data_quality scan that produced the count was global across all
  // financial years — but the user might be sitting on FY 2025-26 with
  // the duplicates living in FY 2023-24 / 2024-25. Without this override
  // the list would show 0 rows after clicking the DataQualityBanner chip
  // even though the count said 5. We force fyFilter + monthFilter to
  // "all" for hygiene drill-downs so the listed invoices match the
  // count the user came here from.
  const apiFilters: InvoiceFilters = useMemo(() => ({
    search: debouncedSearch || undefined,
    businessId: bizFilter,
    customerId: custFilter,
    typeFilter,
    fyFilter: hasHygieneFilter ? "all" : fyFilter,
    monthFilter: hasHygieneFilter ? "all" : monthFilter,
    dups: dupsFilter || undefined,
    empty: emptyFilter || undefined,
    noHsn: noHsnFilter || undefined,
  }), [debouncedSearch, bizFilter, custFilter, typeFilter, fyFilter, monthFilter, dupsFilter, emptyFilter, noHsnFilter, hasHygieneFilter]);

  const { items: invoices, remove: removeInvoice, isLoading, isLoadingMore, hasMore, loadMore, totalCount } = useInvoices(apiFilters);
  const { data: statsData, isLoading: isStatsLoading } = useDashboardStats(apiFilters);

  // Only client-side sorting (filtering is done server-side)
  const filtered = [...invoices].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "date") return dir * (new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime());
    if (sortBy === "total") return dir * (a.total - b.total);
    return dir * a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true });
  });

  // Per-day rollups so we can inject "Mon, 12 May 2026 · 4 invoices · ₹X"
  // separator rows when the table is sorted by date. Lets the eye spot
  // busy / quiet days at a glance without leaving the list view.
  const dayHeaderInfo = useMemo(() => {
    const info = new Map<string, { dateLabel: string; count: number; total: number }>();
    for (const inv of filtered) {
      const key = inv.invoice_date;
      if (!key) continue;
      const cur = info.get(key);
      if (cur) {
        cur.count += 1;
        cur.total += Number(inv.total) || 0;
      } else {
        const d = new Date(key);
        const weekday = d.toLocaleDateString("en-IN", { weekday: "short" });
        const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        info.set(key, { dateLabel: `${weekday}, ${day}`, count: 1, total: Number(inv.total) || 0 });
      }
    }
    return info;
  }, [filtered]);

  const statsInfo = statsData?.totals || { outward: 0, inward: 0, net: 0, tax: 0, count: 0 };
  const totalOutward = statsInfo.outward;
  const totalInward = statsInfo.inward;
  const totalTaxCollected = statsInfo.tax;

  const toggleAll = useCallback(() => selected.size === filtered.length ? setSelected(new Set()) : setSelected(new Set(filtered.map((i) => i.id))), [selected.size, filtered]);
  const toggle = useCallback((id: string) => { setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }, []);

  const handleExportCSV = () => {
    const headers = ["Invoice #", "Date", "Customer", "Business", "Type", "Subtotal", "Tax", "Total", "GST Type"];
    const rows = filtered.map((inv) => [inv.invoiceNumber, inv.invoice_date, inv.customerName, inv.businessName, inv.type, inv.subtotal, inv.totalTax, inv.total, inv.isIGST ? "IGST" : "CGST/SGST"]);
    downloadCSV(toCSV([headers, ...rows]), "invoices-export.csv");
    toast({ title: "Exported", description: `${filtered.length} invoices exported to CSV` });
  };

  // Stat cards — match the GST/Reports visual idiom: compact currency on
  // the value (₹61.07L beats ₹61,07,168 for fit + scannability), full value
  // in the title attr for screen readers / hover, and a sub-line that
  // pulls double duty as context AND as an extra figure (count or average).
  // 5 cards: Sales · Purchases · Net Revenue · Tax · Avg Invoice. Avg gives
  // a quick read on whether the period skews toward small or large invoices.
  const outwardInvCount = useMemo(
    () => filtered.filter((i) => i.type === "OUTWARD").length,
    [filtered]
  );
  const inwardInvCount = useMemo(
    () => filtered.filter((i) => i.type === "INWARD").length,
    [filtered]
  );
  const avgInvoice = totalCount > 0 ? (totalOutward + totalInward) / totalCount : 0;
  const stats = [
    { label: "Sales", value: formatCompactCurrency(totalOutward), full: formatCurrency(totalOutward), sub: outwardInvCount > 0 ? `${outwardInvCount} outward inv.` : "—", icon: TrendingUp, color: "text-success" },
    { label: "Purchases", value: formatCompactCurrency(totalInward), full: formatCurrency(totalInward), sub: inwardInvCount > 0 ? `${inwardInvCount} inward inv.` : "—", icon: TrendingDown, color: "text-warning" },
    { label: "Net Revenue", value: formatCompactCurrency(totalOutward - totalInward), full: formatCurrency(totalOutward - totalInward), sub: "Sales − Purchases", icon: IndianRupee, color: "text-success" },
    { label: "Tax", value: formatCompactCurrency(totalTaxCollected), full: formatCurrency(totalTaxCollected), sub: "GST collected", icon: Receipt, color: "text-chart-3" },
    { label: "Avg Invoice", value: formatCompactCurrency(avgInvoice), full: formatCurrency(avgInvoice), sub: totalCount > 0 ? `Across ${totalCount} inv.` : "No invoices", icon: Calendar, color: "text-chart-2" },
  ];

  const clearFilters = () => {
    setBizFilter("all"); setCustFilter("all"); setTypeFilter("all"); setFyFilter(selectedFY); setMonthFilter("all"); setSearch("");
    // Also drop hygiene URL params so "Clear" really does clear everything.
    if (hasHygieneFilter) {
      searchParams.delete("dups"); searchParams.delete("empty"); searchParams.delete("no_hsn");
      setSearchParams(searchParams, { replace: true });
    }
  };

  // Human-readable label for the hygiene filter, used by the chip-style banner
  const hygieneFilterLabel = dupsFilter
    ? "Duplicate invoice numbers"
    : emptyFilter
      ? "Invoices with zero line items"
      : noHsnFilter
        ? "Invoices with HSN-less line items"
        : null;

  // ─── MOBILE VIEW ───
  if (isMobile) {
    return (
      <div className="p-4 pb-40 space-y-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Invoices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{totalCount} invoices · FY {fyFilter === "all" ? "All" : fyFilter}</p>
        </div>

        {/* Stats scroll */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x scrollbar-hide">
          {stats.map((s) => (
            <div key={s.label} className="min-w-[130px] snap-center stat-card rounded-xl p-3 shrink-0">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className={cn("text-lg font-display font-bold mt-1", s.color)}>{s.value}</p>
              <p className="text-[9px] text-muted-foreground">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Search + Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoices..." className="premium-input pl-10 h-11" />
          </div>
          <button onClick={() => setFilterOpen(true)}
            className={cn("w-11 h-11 rounded-xl border flex items-center justify-center transition-all",
              (bizFilter !== "all" || custFilter !== "all" || typeFilter !== "all" || monthFilter !== "all")
                ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-input/50 text-muted-foreground"
            )}>
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Invoice Cards */}
        <div className="space-y-2.5">
          {filtered.map((inv) => (
            <Link key={inv.id} to={`/billing/invoice/${inv.id}`}
              className="block elevated-card rounded-xl p-4 hover:border-primary/30 transition-all">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Calendar className="w-3 h-3" />{formatDate(inv.invoice_date)}
                  </p>
                </div>
                <span className={cn(
                  "premium-badge text-[9px]",
                  inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"
                )}>{inv.type}</span>
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="text-foreground font-medium">{inv.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Business</span>
                  <span className="text-foreground text-[11px]">{inv.businessName}</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-border/30">
                <span className="text-[11px] text-muted-foreground">{pluralize(inv.lineItemCount, "item")} · Tax {formatCurrency(inv.totalTax)}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); shareInvoice(inv); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[15px] font-display font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</span>
                </div>
              </div>
            </Link>
          ))}
          {filtered.length === 0 && !isLoading && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Receipt className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">No invoices found</p>
            </div>
          )}
          {isLoading && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Loading invoices...</p>
            </div>
          )}
        </div>

        {/* Load More - Mobile */}
        {hasMore && (
          <button onClick={loadMore} disabled={isLoadingMore}
            className="w-full py-3 rounded-xl border border-border/50 text-[13px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-all flex items-center justify-center gap-2">
            {isLoadingMore ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</> : <>Load More ({filtered.length} of {totalCount})</>}
          </button>
        )}

        {/* FAB */}
        <Link to="/billing/invoice/add" className="mobile-fab">
          <Plus className="w-6 h-6" />
        </Link>

        <MobileFilterSheet
          open={filterOpen}
          onOpenChange={setFilterOpen}
          onClear={clearFilters}
          filters={[
            {
              label: "Financial Year", value: fyFilter,
              options: [{ label: "All FY", value: "all" }, ...financialYears.map((f) => ({ label: `FY ${f}`, value: f }))],
              onChange: setFyFilter,
            },
            {
              label: "Type", value: typeFilter,
              options: [{ label: "All Types", value: "all" }, { label: "Outward (Sales)", value: "OUTWARD" }, { label: "Inward (Purchases)", value: "INWARD" }],
              onChange: setTypeFilter,
            },
            {
              label: "Business", value: bizFilter,
              options: [{ label: "All Businesses", value: "all" }, ...businesses.map((b) => ({ label: b.name, value: b.id }))],
              onChange: setBizFilter,
            },
            {
              label: "Customer", value: custFilter,
              options: [{ label: "All Customers", value: "all" }, ...customers.map((c) => ({ label: c.name, value: c.id }))],
              onChange: setCustFilter,
            },
          ]}
        />

        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemName={deleteTarget?.name || ""}
          itemType="Invoice"
          onConfirm={() => { removeInvoice(deleteTarget!.id); toast({ title: "Invoice Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
        />
      </div>
    );
  }

  // ─── DESKTOP VIEW (unchanged) ───
  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: "Invoices" }]} />

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Invoices</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{totalCount} invoices · FY {fyFilter === "all" ? "All" : fyFilter}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <>
              <span className="text-[12px] text-muted-foreground font-medium">{selected.size} selected</span>
              <button onClick={() => { sessionStorage.setItem('batch_print_ids', JSON.stringify(Array.from(selected))); navigate('/billing/batch-print'); }} className="premium-btn-ghost text-[13px]">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button onClick={() => {
                const selectedInvs = filtered.filter(i => selected.has(i.id));
                const headers = ["Invoice #", "Date", "Customer", "Business", "Type", "Total"];
                const rows = selectedInvs.map(inv => [inv.invoiceNumber, inv.invoice_date, inv.customerName, inv.businessName, inv.type, inv.total]);
                downloadCSV(toCSV([headers, ...rows]), "selected-invoices.csv");
                toast({ title: "Exported", description: `${selected.size} invoices exported` });
              }} className="premium-btn-ghost text-[13px]">
                <Download className="w-4 h-4" /> Export
              </button>
              <button onClick={() => {
                if (confirm(`Delete ${selected.size} selected invoices? This cannot be undone.`)) {
                  const ids = Array.from(selected);
                  ids.forEach(id => removeInvoice(id));
                  toast({ title: "Deleted", description: `${ids.length} invoices deleted`, variant: "destructive" });
                  setSelected(new Set());
                }
              }} className="premium-btn-ghost text-[13px] text-destructive">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
          {/* AI Import + the three workflow buttons (Import, Bulk PDF, QR
              Verify) stay inline because the user reaches for them often.
              Only the two Export options collapse under "More ▾" — they're
              the rarely-used "send a snapshot to the CA" actions. New
              Invoice keeps the primary spot. */}
          <Link to="/billing/invoice/ai-import" className="premium-btn-outline text-[13px] border-primary/30 text-primary"><Bot className="w-4 h-4" /> AI Import</Link>
          <Link to="/billing/invoice/import" className="premium-btn-ghost text-[13px]"><Upload className="w-4 h-4" /> Import</Link>
          <Link to="/billing/bulk-pdf" className="premium-btn-ghost text-[13px]"><FileText className="w-4 h-4" /> Bulk PDF</Link>
          <Link to="/billing/qr-scanner" className="premium-btn-ghost text-[13px]"><QrCode className="w-4 h-4" /> QR Verify</Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="premium-btn-ghost text-[13px]" title="Export the filtered list">
                <MoreHorizontal className="w-4 h-4" /> Export
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Export ({filtered.length} {filtered.length === 1 ? "invoice" : "invoices"})</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExportCSV}>
                <Download className="w-4 h-4 mr-2" /> Export to CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                downloadReportExcel({ invoices: filtered, businesses, customers }, `GST Invoices ${fyFilter}.xlsx`);
                toast({ title: "Excel Exported", description: `${filtered.length} invoices exported to Excel` });
              }}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to="/billing/invoice/add" className="premium-btn-primary text-[13px]"><Plus className="w-4 h-4" /> New Invoice</Link>
        </div>
      </div>

      {/* Hygiene-filter banner — when the user arrives via a DataQualityBanner
          drill-down, make it explicit *why* the list looks short, and give a
          one-click escape hatch back to the unfiltered view. */}
      {hygieneFilterLabel && (
        <div className="elevated-card rounded-2xl p-3.5 border-l-4 border-l-warning flex items-center gap-3">
          <SlidersHorizontal className="w-4 h-4 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground">Filtered: {hygieneFilterLabel}</p>
            <p className="text-[11px] text-muted-foreground">Showing flagged invoices across all financial years (data-quality scan is global).</p>
          </div>
          <button onClick={clearFilters} className="text-[12px] font-semibold text-primary hover:underline shrink-0">
            Clear filter
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
            className="stat-card rounded-2xl p-4"
            title={s.full}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <s.icon className={cn("w-3.5 h-3.5", s.color)} />
            </div>
            <p className={cn("text-lg lg:text-xl font-display font-bold tabular-nums", s.color)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{s.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Month Pill Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button onClick={() => setMonthFilter("all")}
          className={cn("px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all whitespace-nowrap border",
            monthFilter === "all" ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
          )}>All Months</button>
        {["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"].map((m, i) => {
          const monthNum = String(i < 9 ? i + 4 : i - 8);
          const hasInvoices = invoices.some((inv) => {
            const d = new Date(inv.invoice_date);
            return d.getMonth() + 1 === Number(monthNum);
          });
          return (
            <button key={m} onClick={() => setMonthFilter(monthFilter === monthNum ? "all" : monthNum)}
              className={cn("px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all whitespace-nowrap border relative",
                monthFilter === monthNum ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
              )}>
              {m}
              {hasInvoices && monthFilter !== monthNum && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      <div className="elevated-card rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoices..." className="premium-input pl-10 w-full" />
          </div>
          <select value={fyFilter} onChange={(e) => setFyFilter(e.target.value)} className="premium-select">
            <option value="all">All FY</option>
            {financialYears.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
          <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select">
            <option value="all">All Businesses</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={custFilter} onChange={(e) => setCustFilter(e.target.value)} className="premium-select">
            <option value="all">All Customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="premium-select">
            <option value="all">All Types</option>
            <option value="OUTWARD">Outward (Sales)</option>
            <option value="INWARD">Inward (Purchases)</option>
          </select>
          <button onClick={clearFilters} className="text-[12px] text-destructive hover:underline font-medium shrink-0">Clear</button>
          <div className="flex items-center gap-1.5 bg-secondary/30 rounded-xl p-1 shrink-0">
            <button onClick={() => setView("table")} className={cn("p-2 rounded-lg transition-all", view === "table" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><LayoutList className="w-4 h-4" /></button>
            <button onClick={() => setView("grid")} className={cn("p-2 rounded-lg transition-all", view === "grid" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {view === "table" && (
        <div className="elevated-card rounded-2xl overflow-x-auto">
          <table className="table-premium">
            <thead><tr>
              <th className="w-10"><button onClick={toggleAll} className="text-muted-foreground hover:text-foreground">{selected.size === filtered.length && filtered.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>
              <th><button onClick={() => { setSortBy("invoiceNumber"); setSortDir(d => sortBy === "invoiceNumber" ? (d === "asc" ? "desc" : "asc") : "asc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Invoice # {sortBy === "invoiceNumber" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
              <th><button onClick={() => { setSortBy("date"); setSortDir(d => sortBy === "date" ? (d === "asc" ? "desc" : "asc") : "desc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Date {sortBy === "date" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
              <th>Customer</th><th>Business</th>
              <th><button onClick={() => { setSortBy("total"); setSortDir(d => sortBy === "total" ? (d === "asc" ? "desc" : "asc") : "desc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Amount {sortBy === "total" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
              <th>Tax</th><th title="Effective tax rate inferred from tax÷subtotal — handy for spotting wrong rate slabs at a glance.">Rate</th><th>Type</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map((inv, i) => {
                // When sorted by date, prepend a slim header row whenever the
                // date changes. Skip when sort != date — the headers don't
                // make sense if rows aren't date-ordered.
                const prev = i > 0 ? filtered[i - 1] : null;
                const showDayHeader = sortBy === "date" && (!prev || prev.invoice_date !== inv.invoice_date);
                const dayInfo = showDayHeader ? dayHeaderInfo.get(inv.invoice_date) : null;
                return (
                  <React.Fragment key={inv.id}>
                    {showDayHeader && dayInfo && (
                      <tr className="bg-secondary/20 border-t border-border/40">
                        <td colSpan={10} className="!py-2 !px-4">
                          <div className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="w-3.5 h-3.5 opacity-70" />
                              <span className="font-semibold text-foreground/80">{dayInfo.dateLabel}</span>
                              <span className="text-muted-foreground/70">·</span>
                              <span>{pluralize(dayInfo.count, "invoice")}</span>
                            </div>
                            <span className="font-semibold tabular-nums text-foreground/80">{formatCompactCurrency(dayInfo.total)}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {(() => {
                      // Effective tax rate: tax ÷ subtotal × 100. Useful for spotting
                      // an invoice that should be 3% but somehow rolled out at 5%.
                      // We snap to the nearest GST slab when within 0.3% so 2.997
                      // doesn't display as "3.0%" while 5.4 (a real anomaly) does.
                      const sub = Number(inv.subtotal) || 0;
                      const tax = Number(inv.totalTax) || 0;
                      const ratePct = sub > 0 ? (tax / sub) * 100 : 0;
                      const slabs = [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28];
                      const nearestSlab = slabs.find((s) => Math.abs(ratePct - s) < 0.3);
                      const rateLabel = nearestSlab !== undefined ? `${nearestSlab}%` : `${ratePct.toFixed(1)}%`;
                      const rateAnomalous = nearestSlab === undefined && ratePct > 0;
                      return (
                        <motion.tr initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.025, 0.5), duration: 0.2 }} className={selected.has(inv.id) ? "!bg-primary/5" : ""}>
                          <td><button onClick={() => toggle(inv.id)} className="text-muted-foreground hover:text-primary">{selected.has(inv.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}</button></td>
                          <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold">{inv.invoiceNumber}</Link></td>
                          <td className="text-muted-foreground"><div className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{formatDate(inv.invoice_date)}</div></td>
                          <td className="text-foreground font-medium">{inv.customerName}</td>
                          <td className="text-muted-foreground text-[12px]">{inv.businessName}</td>
                          <td className="font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</td>
                          <td className="text-muted-foreground text-[12px] tabular-nums">{formatCurrency(inv.totalTax)}</td>
                          <td className={cn("text-[12px] tabular-nums", rateAnomalous ? "text-warning font-semibold" : "text-muted-foreground")} title={rateAnomalous ? "Not a standard GST slab — open the invoice to verify" : "Tax ÷ subtotal"}>
                            {ratePct > 0 ? rateLabel : "—"}
                          </td>
                          <td><span className={cn("premium-badge", inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>{inv.type}</span></td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          <Link to={`/billing/invoice/${inv.id}`} aria-label="View invoice" className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"><Eye className="w-4 h-4" /></Link>
                          <Link to={`/billing/invoice/edit/${inv.id}`} aria-label="Edit invoice" className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-4 h-4" /></Link>
                          <Link to={`/billing/invoice/${inv.id}/print`} aria-label="Print invoice" className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-success transition-colors"><Printer className="w-4 h-4" /></Link>
                          <button onClick={() => navigate("/billing/invoice/add", { state: { duplicateFrom: inv } })} aria-label="Duplicate invoice" className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteTarget({ id: inv.id, name: inv.invoiceNumber })} aria-label="Delete invoice" className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </motion.tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && !isLoading && (
                <tr><td colSpan={10} className="text-center text-muted-foreground py-16">
                  <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-[13px] font-medium text-foreground/70">No invoices found</p>
                  {(search || bizFilter !== "all" || custFilter !== "all" || typeFilter !== "all" || monthFilter !== "all" || hasHygieneFilter) ? (
                    <button onClick={clearFilters} className="text-[12px] text-primary hover:underline mt-2 font-medium">Clear filters</button>
                  ) : (
                    <Link to="/billing/invoice/add" className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline mt-2 font-medium">
                      <Plus className="w-3 h-3" /> Create your first invoice
                    </Link>
                  )}
                </td></tr>
              )}
              {isLoading && <tr><td colSpan={10} className="text-center text-muted-foreground py-16"><Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />Loading invoices...</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <>
            {filtered.map((inv, i) => (
              <motion.div key={inv.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
                className={cn("elevated-card rounded-2xl p-5 hover:border-primary/30 transition-all group cursor-pointer", selected.has(inv.id) && "border-primary/40 bg-primary/3")}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Link to={`/billing/invoice/${inv.id}`} className="text-[14px] font-display font-bold text-primary hover:underline">{inv.invoiceNumber}</Link>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(inv.invoice_date)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>{inv.type}</span>
                    <button onClick={() => toggle(inv.id)} className="p-1 text-muted-foreground hover:text-primary">
                      {selected.has(inv.id) ? <CheckSquare className="w-3.5 h-3.5 text-primary" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2 text-[13px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="text-foreground font-medium">{inv.customerName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Business</span><span className="text-foreground text-[12px]">{inv.businessName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="text-foreground">{inv.lineItemCount}</span></div>
                  <div className="border-t border-border/30 pt-2 flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-primary font-display font-bold text-[15px]">{formatCurrency(inv.total)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={`/billing/invoice/${inv.id}`} aria-label="View" className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground"><Eye className="w-3.5 h-3.5" /></Link>
                  <Link to={`/billing/invoice/edit/${inv.id}`} aria-label="Edit" className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></Link>
                  <Link to={`/billing/invoice/${inv.id}/print`} aria-label="Print" className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-success"><Printer className="w-3.5 h-3.5" /></Link>
                  <button onClick={() => navigate("/billing/invoice/add", { state: { duplicateFrom: inv } })} aria-label="Duplicate" className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setDeleteTarget({ id: inv.id, name: inv.invoiceNumber })} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </motion.div>
            ))}
          </>
          {filtered.length === 0 && !isLoading && (
            <div className="col-span-full elevated-card rounded-2xl p-16 text-center text-muted-foreground">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />No invoices found
            </div>
          )}
          {isLoading && (
            <div className="col-span-full elevated-card rounded-2xl p-16 text-center text-muted-foreground">
              <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />Loading invoices...
            </div>
          )}
        </div>
      )}

      {/* Load More - Desktop */}
      {hasMore && (
        <div className="flex justify-center">
          <button onClick={loadMore} disabled={isLoadingMore}
            className="px-8 py-3 rounded-xl border border-border/50 text-[13px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-all flex items-center gap-2">
            {isLoadingMore ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</> : <>Load More ({filtered.length} of {totalCount})</>}
          </button>
        </div>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        itemName={deleteTarget?.name || ""}
        itemType="Invoice"
        onConfirm={() => { removeInvoice(deleteTarget!.id); toast({ title: "Invoice Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
      />
    </div>
  );
}
