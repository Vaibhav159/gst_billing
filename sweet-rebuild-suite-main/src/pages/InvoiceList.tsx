import { useState, useMemo, useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  Search, Plus, Download, Upload, Bot, Printer, ArrowUpDown, Eye, Pencil,
  Trash2, Copy, CheckSquare, Square, LayoutGrid, LayoutList, TrendingUp,
  TrendingDown, Receipt, IndianRupee, Calendar, FileText, SlidersHorizontal, Share2, Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { financialYears, formatCurrency, formatDate } from "@/lib/mockData";
import { useInvoices, useBusinesses, useCustomers } from "@/hooks/useDataStore";
import type { InvoiceFilters } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileFilterSheet from "@/components/mobile/MobileFilterSheet";
import { shareInvoice } from "@/lib/shareInvoice";

interface OutletCtx { selectedFY: string }

export default function InvoiceList() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [bizFilter, setBizFilter] = useState("all");
  const [custFilter, setCustFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [fyFilter, setFyFilter] = useState(selectedFY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"date" | "total" | "invoiceNumber">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [view, setView] = useState<"table" | "grid">("table");
  const [monthFilter, setMonthFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);

  // Debounce search input to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Build filters object for the API-driven hook
  const apiFilters: InvoiceFilters = useMemo(() => ({
    search: debouncedSearch || undefined,
    businessId: bizFilter,
    customerId: custFilter,
    typeFilter,
    fyFilter,
    monthFilter,
  }), [debouncedSearch, bizFilter, custFilter, typeFilter, fyFilter, monthFilter]);

  const { items: invoices, remove: removeInvoice, isLoading, isLoadingMore, hasMore, loadMore, totalCount } = useInvoices(apiFilters);

  // Only client-side sorting (filtering is done server-side)
  const filtered = [...invoices].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "date") return dir * (new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime());
    if (sortBy === "total") return dir * (a.total - b.total);
    return dir * a.invoiceNumber.localeCompare(b.invoiceNumber);
  });

  const totalOutward = filtered.filter((i) => i.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  const totalInward = filtered.filter((i) => i.type === "INWARD").reduce((s, i) => s + i.total, 0);
  const outwardCount = filtered.filter((i) => i.type === "OUTWARD").length;
  const inwardCount = filtered.filter((i) => i.type === "INWARD").length;
  const totalTaxCollected = filtered.reduce((s, i) => s + i.totalTax, 0);

  const toggleAll = () => selected.size === filtered.length ? setSelected(new Set()) : setSelected(new Set(filtered.map((i) => i.id)));
  const toggle = (id: string) => { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); setSelected(next); };

  const handleExportCSV = () => {
    const headers = ["Invoice #", "Date", "Customer", "Business", "Type", "Subtotal", "Tax", "Total", "GST Type"];
    const rows = filtered.map((inv) => [inv.invoiceNumber, inv.invoice_date, inv.customerName, inv.businessName, inv.type, inv.subtotal, inv.totalTax, inv.total, inv.isIGST ? "IGST" : "CGST/SGST"]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "invoices-export.csv"; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${filtered.length} invoices exported to CSV` });
  };

  const stats = [
    { label: "Sales", value: formatCurrency(totalOutward), sub: `${outwardCount} inv`, icon: TrendingUp, color: "text-success" },
    { label: "Purchases", value: formatCurrency(totalInward), sub: `${inwardCount} inv`, icon: TrendingDown, color: "text-warning" },
    { label: "Net Revenue", value: formatCurrency(totalOutward - totalInward), sub: "Sales-Purchases", icon: IndianRupee, color: "text-success" },
    { label: "Tax", value: formatCurrency(totalTaxCollected), sub: "GST total", icon: Receipt, color: "text-chart-3" },
  ];

  const clearFilters = () => {
    setBizFilter("all"); setCustFilter("all"); setTypeFilter("all"); setFyFilter(selectedFY); setMonthFilter("all"); setSearch("");
  };

  // ─── MOBILE VIEW ───
  if (isMobile) {
    return (
      <div className="p-4 space-y-4">
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
                <span className="text-[11px] text-muted-foreground">{inv.items.length} items · Tax {formatCurrency(inv.totalTax)}</span>
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
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Receipt className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">No invoices found</p>
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
              <button onClick={() => toast({ title: "Printing", description: `${selected.size} invoices sent to print.` })} className="premium-btn-ghost text-[13px]">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button onClick={() => {
                const selectedInvs = filtered.filter(i => selected.has(i.id));
                const headers = ["Invoice #", "Date", "Customer", "Business", "Type", "Total"];
                const rows = selectedInvs.map(inv => [inv.invoiceNumber, inv.invoice_date, inv.customerName, inv.businessName, inv.type, inv.total]);
                const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = "selected-invoices.csv"; a.click();
                URL.revokeObjectURL(url);
                toast({ title: "Exported", description: `${selected.size} invoices exported` });
              }} className="premium-btn-ghost text-[13px]">
                <Download className="w-4 h-4" /> Export
              </button>
              <button onClick={() => { toast({ title: "Deleted", description: `${selected.size} invoices deleted`, variant: "destructive" }); setSelected(new Set()); }} className="premium-btn-ghost text-[13px] text-destructive">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
          <button onClick={handleExportCSV} className="premium-btn-ghost text-[13px]"><Download className="w-4 h-4" /> Export</button>
          <Link to="/billing/invoice/import" className="premium-btn-ghost text-[13px]"><Upload className="w-4 h-4" /> Import</Link>
          <Link to="/billing/invoice/ai-import" className="premium-btn-outline text-[13px] border-primary/30 text-primary"><Bot className="w-4 h-4" /> AI Import</Link>
          <Link to="/billing/bulk-pdf" className="premium-btn-ghost text-[13px]"><FileText className="w-4 h-4" /> Bulk PDF</Link>
          <Link to="/billing/invoice/add" className="premium-btn-primary text-[13px]"><Plus className="w-4 h-4" /> New Invoice</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.4 }} className="stat-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <s.icon className={cn("w-4 h-4", s.color)} />
            </div>
            <p className={cn("text-xl font-display font-bold", s.color)}>{s.value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{s.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="elevated-card rounded-2xl p-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoices..." className="premium-input pl-10 w-full" />
          </div>
          <select value={fyFilter} onChange={(e) => setFyFilter(e.target.value)} className="premium-select">
            <option value="all">All FY</option>
            {financialYears.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="premium-select">
            <option value="all">All Months</option>
            {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
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
          <button onClick={clearFilters} className="text-[12px] text-destructive hover:underline font-medium">Clear</button>
          <div className="ml-auto flex items-center gap-1.5 bg-secondary/30 rounded-xl p-1">
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
              <th>Tax</th><th>Type</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map((inv, i) => (
                <motion.tr key={inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025, duration: 0.3 }} className={selected.has(inv.id) ? "!bg-primary/5" : ""}>
                  <td><button onClick={() => toggle(inv.id)} className="text-muted-foreground hover:text-primary">{selected.has(inv.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}</button></td>
                  <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold">{inv.invoiceNumber}</Link></td>
                  <td className="text-muted-foreground"><div className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{formatDate(inv.invoice_date)}</div></td>
                  <td className="text-foreground font-medium">{inv.customerName}</td>
                  <td className="text-muted-foreground text-[12px]">{inv.businessName}</td>
                  <td className="font-bold text-foreground">{formatCurrency(inv.total)}</td>
                  <td className="text-muted-foreground text-[12px]">{formatCurrency(inv.totalTax)}</td>
                  <td><span className={cn("premium-badge", inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>{inv.type}</span></td>
                  <td>
                    <div className="flex items-center gap-0.5">
                      <Link to={`/billing/invoice/${inv.id}`} className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"><Eye className="w-4 h-4" /></Link>
                      <Link to={`/billing/invoice/edit/${inv.id}`} className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-4 h-4" /></Link>
                      <Link to={`/billing/invoice/${inv.id}/print`} className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-success transition-colors"><Printer className="w-4 h-4" /></Link>
                      <button onClick={() => toast({ title: "Duplicated", description: inv.invoiceNumber })} className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteTarget({ id: inv.id, name: inv.invoiceNumber })} className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </motion.tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9} className="text-center text-muted-foreground py-16"><Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />No invoices found</td></tr>}
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
                  <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="text-foreground">{inv.items.length}</span></div>
                  <div className="border-t border-border/30 pt-2 flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="text-primary font-display font-bold text-[15px]">{formatCurrency(inv.total)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/20 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link to={`/billing/invoice/${inv.id}`} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground"><Eye className="w-3.5 h-3.5" /></Link>
                  <Link to={`/billing/invoice/edit/${inv.id}`} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></Link>
                  <Link to={`/billing/invoice/${inv.id}/print`} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-success"><Printer className="w-3.5 h-3.5" /></Link>
                  <button onClick={() => toast({ title: "Duplicated", description: inv.invoiceNumber })} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setDeleteTarget({ id: inv.id, name: inv.invoiceNumber })} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </motion.div>
            ))}
          </>
          {filtered.length === 0 && (
            <div className="col-span-full elevated-card rounded-2xl p-16 text-center text-muted-foreground">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />No invoices found
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
