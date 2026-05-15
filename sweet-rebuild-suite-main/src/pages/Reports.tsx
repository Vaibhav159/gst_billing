import { logger } from "@/utils/logger";
import { useState, useMemo, useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { formatCurrency, formatCompactCurrency } from "@/utils/mockData";
import { useBusinesses, useCustomers, useDashboardStats, mapDjangoInvoice } from "@/hooks/useDataStore";
import type { InvoiceFilters } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Download, FileSpreadsheet, ExternalLink, TrendingUp, Receipt, ArrowUpRight, ArrowDownLeft, BarChart3, PieChart, FileText, Database, FileDown, Loader2, Package, Clock, Users } from "lucide-react";
import { downloadReportExcel, generateReportExcel } from "@/utils/generateReportExcel";
import ReportPreviewModal from "@/components/ReportPreviewModal";
import type { Invoice } from "@/hooks/useDataStore";
import DateRangePicker from "@/components/DateRangePicker";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RPieChart, Pie, Cell } from "recharts";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";
import api from "@/utils/api";

interface OutletCtx { selectedFY: string }
const MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

export default function Reports() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const isMobile = useIsMobile();
  const fyStartYear = parseInt(selectedFY.split("-")[0]);
  const [startDate, setStartDate] = useState(new Date(fyStartYear, 3, 1));
  const [endDate, setEndDate] = useState(new Date(fyStartYear + 1, 2, 31));
  const [bizFilter, setBizFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();

  // ─── Server-side stats for accurate totals ───
  const statsFilters: InvoiceFilters = useMemo(() => ({
    startDate: format(startDate, "yyyy-MM-dd"),
    endDate: format(endDate, "yyyy-MM-dd"),
    businessId: bizFilter,
    typeFilter,
    fyFilter: selectedFY,
  }), [startDate, endDate, bizFilter, typeFilter, selectedFY]);

  const { data: statsData, isLoading: statsLoading } = useDashboardStats(statsFilters);

  // Pull carry-forward ITC from gst_summary so the Reports page matches the
  // GST page's effective-net calculation (we want a single source of truth
  // for what the user actually pays). One extra GET; cached at the API
  // layer so it doesn't add round-trips on repeat renders.
  const [carryFwd, setCarryFwd] = useState<{ cgst: number; sgst: number; igst: number; total: number; configured: boolean; business_count: number; as_of: string | null }>({
    cgst: 0, sgst: 0, igst: 0, total: 0, configured: false, business_count: 0, as_of: null,
  });
  useEffect(() => {
    if (!localStorage.getItem("gst_access_token")) return;
    const params = new URLSearchParams();
    params.set("start_date", format(startDate, "yyyy-MM-dd"));
    params.set("end_date", format(endDate, "yyyy-MM-dd"));
    if (bizFilter !== "all") params.set("business_id", bizFilter);
    api.get<any>(`invoices/gst_summary/?${params.toString()}`)
      .then((r) => {
        if (r.data?.carry_forward_itc) {
          setCarryFwd(r.data.carry_forward_itc);
        }
      })
      .catch(() => {});
  }, [startDate, endDate, bizFilter]);

  const totals = statsData?.totals || { outward: 0, inward: 0, net: 0, tax: 0, inward_tax: 0, count: 0 };
  const totalSales = totals.outward;
  const totalPurchases = totals.inward;
  const totalTaxCollected = totals.tax;
  const totalITC = totals.inward_tax || 0;
  const carryFwdTotal = Number(carryFwd.total || 0);
  // Effective net tax mirrors the GST page: Output - (Period ITC + Carry-fwd).
  // Without including the carry-forward, a user with previous-FY credit saw
  // a Net Tax overstated by exactly the ledger amount — confusing.
  const netTax = totalTaxCollected - totalITC - carryFwdTotal;
  const totalCount = totals.count;

  // Monthly data from server stats
  // Round to 3 decimal places to avoid floating-point noise (e.g. 6107.1684000000005)
  // showing in chart tooltips.
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const monthlyData = useMemo(() => {
    const fyStart = parseInt(selectedFY.split("-")[0]);
    return MONTHS.map((m, idx) => {
      const year = idx < 9 ? fyStart : fyStart + 1;
      const monthNum = idx < 9 ? idx + 4 : idx - 8;
      const match = (statsData?.monthly || []).find((d: any) => d.month === monthNum && d.year === year);
      return {
        month: m,
        sales: match ? r3((Number(match.outward_total) || 0) / 1000) : 0,
        purchases: match ? r3((Number(match.inward_total) || 0) / 1000) : 0,
      };
    });
  }, [selectedFY, statsData?.monthly]);

  // Tax distribution from server stats
  const pieData = useMemo(() => {
    if (!statsData?.tax_distribution) return [];
    const dist = statsData.tax_distribution as any;
    return [
      { name: "CGST", value: Number(dist.cgst) || 0 },
      { name: "SGST", value: Number(dist.sgst) || 0 },
      { name: "IGST", value: Number(dist.igst) || 0 },
    ].filter((d) => d.value > 0);
  }, [statsData?.tax_distribution]);
  const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))"];

  // Top customers from server stats. Compute % of period sales so a single
  // glance answers "is one customer ~30% of revenue?" — a real risk signal
  // for the business owner.
  const topCustomers = useMemo(() => {
    const list = (statsData?.top_customers || []).slice(0, 5).map((c: any) => ({
      name: c.name,
      total: Number(c.total),
      count: (c as any).count || 0,
    }));
    const denom = totalSales || list.reduce((s, c) => s + c.total, 0) || 1;
    return list.map((c) => ({ ...c, pct: (c.total / denom) * 100 }));
  }, [statsData?.top_customers, totalSales]);

  // Top products (sales by line-item product_name). Same % treatment.
  const topProducts = useMemo(() => {
    const list = (statsData?.top_products || []).slice(0, 5).map((p: any) => ({
      name: p.name,
      total: Number(p.total),
      qty: Number(p.qty || 0),
      hsn: p.hsn || "",
    }));
    const denom = list.reduce((s, p) => s + p.total, 0) || 1;
    return list.map((p) => ({ ...p, pct: (p.total / denom) * 100 }));
  }, [statsData?.top_products]);

  // Outward/inward counts from monthly data
  const outwardCount = useMemo(() => {
    return (statsData?.monthly || []).reduce((s: number, d: any) => s + (Number(d.outward_count) || 0), 0);
  }, [statsData?.monthly]);
  const inwardCount = useMemo(() => {
    return (statsData?.monthly || []).reduce((s: number, d: any) => s + (Number(d.inward_count) || 0), 0);
  }, [statsData?.monthly]);

  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams();
      params.set("page_size", "1000");
      params.set("start_date", format(startDate, "yyyy-MM-dd"));
      params.set("end_date", format(endDate, "yyyy-MM-dd"));
      if (bizFilter !== "all") params.set("business_id", bizFilter);
      if (typeFilter !== "all") params.set("type_of_invoice", typeFilter.toLowerCase());

      const res = await api.get<any>(`invoices/?${params.toString()}`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      const invoices = results.map(mapDjangoInvoice);

      const headers = ["Invoice #", "Date", "Customer", "Business", "Type", "Subtotal", "Tax", "Total"];
      const rows = invoices.map((i: any) => [i.invoiceNumber, i.invoice_date, i.customerName, i.businessName, i.type, i.subtotal, i.totalTax, i.total]);
      const csv = [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `report-${selectedFY}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      logger.error("CSV export failed", e);
    }
  };

  const [exporting, setExporting] = useState(false);
  const [previewInvoices, setPreviewInvoices] = useState<Invoice[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handlePreviewExcel = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("include_items", "true");
      params.set("page_size", "1000");
      params.set("start_date", format(startDate, "yyyy-MM-dd"));
      params.set("end_date", format(endDate, "yyyy-MM-dd"));
      if (bizFilter !== "all") params.set("business_id", bizFilter);
      if (typeFilter !== "all") params.set("type_of_invoice", typeFilter.toLowerCase());

      const res = await api.get<any>(`invoices/?${params.toString()}`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      const fullInvoices = results.map(mapDjangoInvoice);

      setPreviewInvoices(fullInvoices);
      setShowPreview(true);
    } catch (e) {
      logger.error("Export failed", e);
    } finally {
      setExporting(false);
    }
  };

  const handleConfirmDownload = () => {
    if (!previewInvoices) return;
    const filename = `GST Report ${selectedFY}.xlsx`;
    downloadReportExcel({ invoices: previewInvoices, businesses, customers }, filename);
    setShowPreview(false);
    // Log to audit
    api.post("audit-logs/log/", {
      action: "exported",
      entity: "invoice",
      entity_id: 0,
      entity_name: `Excel Report FY ${selectedFY}`,
      details: `Exported ${previewInvoices.length} invoices as Excel report for FY ${selectedFY}`,
    }).catch(() => {});
  };

  const quickLinks = [
    { label: "GST Summary", href: "/billing/gst-summary", desc: "GSTR-1 & 3B rate-wise breakdown", icon: PieChart, color: "text-chart-1", bg: "bg-chart-1/10" },
    { label: "Sales Invoices", href: "/billing/invoice/list", desc: `${outwardCount} outward invoices this period`, icon: ArrowUpRight, color: "text-success", bg: "bg-success/10" },
    { label: "Purchase Invoices", href: "/billing/invoice/list", desc: `${inwardCount} inward invoices this period`, icon: ArrowDownLeft, color: "text-warning", bg: "bg-warning/10" },
    { label: "Bulk PDF", href: "/billing/bulk-pdf", desc: "Download all PDFs as ZIP", icon: FileText, color: "text-chart-2", bg: "bg-chart-2/10" },
    { label: "Backup", href: "/billing/backup", desc: "Export full database", icon: Database, color: "text-chart-3", bg: "bg-chart-3/10" },
  ];

  return (
    <div className={cn("space-y-5", isMobile ? "p-4 pb-20" : "p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Reports" }]} />

      {/* Header Card */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="elevated-card rounded-2xl p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className={cn("rounded-2xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
              <BarChart3 className="w-5 h-5 text-chart-3" />
            </div>
            <div>
              <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-2xl")}>Reports</h1>
              <p className="text-xs text-muted-foreground">FY {selectedFY} · {totalCount} invoices</p>
            </div>
          </div>
          {!isMobile && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              className="flex items-center gap-2.5">
              <button onClick={handlePreviewExcel} disabled={exporting} className="premium-btn-outline text-[13px] border-success/30 text-success">{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {exporting ? "Loading..." : "Excel Report"}</button>
              <button onClick={handleExportCSV} className="premium-btn-outline text-[13px]"><FileSpreadsheet className="w-4 h-4" /> CSV</button>
              <button className="premium-btn-outline text-[13px] border-success/30 text-success"><Download className="w-4 h-4" /> GSTR-1</button>
            </motion.div>
          )}
        </div>
        <div className="border-t border-border/40 mt-4 pt-4 space-y-3">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            fyStart={fyStartYear}
          />
          <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4")}>
            <div className={cn("space-y-1", isMobile ? "col-span-2" : "xl:col-span-2")}><label className="text-[10px] font-medium text-muted-foreground uppercase">Business</label><select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select !w-full text-[12px]"><option value="all">All</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            {!isMobile && <div className="space-y-1 xl:col-span-2"><label className="text-[10px] font-medium text-muted-foreground uppercase">Type</label><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="premium-select !w-full text-[12px]"><option value="all">All</option><option value="OUTWARD">Sales</option><option value="INWARD">Purchases</option></select></div>}
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      {statsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Loading report data...</span>
        </div>
      ) : (
        <>
          {/* Stat row — compact currency (₹2.86L) keeps the 6-card layout
              readable on 1280px screens. Naming matches the GST page:
              "Output Tax" (was "Tax Collected"), separate "Period ITC" and
              "Carry-fwd ITC" tiles so the user can see what's current vs
              brought forward at a glance. Net Tax is the effective figure
              (Output − Period ITC − Carry-fwd) — same math as the GSTR-3B
              Summary table on /gst-summary. */}
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-6")}>
            {[
              { key: "sales", label: "Sales", raw: totalSales, icon: ArrowUpRight, color: "text-chart-1", sub: outwardCount > 0 ? `${outwardCount} invoice${outwardCount === 1 ? "" : "s"}` : "—" },
              { key: "purchases", label: "Purchases", raw: totalPurchases, icon: ArrowDownLeft, color: "text-chart-2", sub: inwardCount > 0 ? `${inwardCount} invoice${inwardCount === 1 ? "" : "s"}` : "—" },
              { key: "output", label: "Output Tax", raw: totalTaxCollected, icon: Receipt, color: "text-chart-3", sub: "CGST + SGST + IGST" },
              { key: "period_itc", label: "Period ITC", raw: totalITC, icon: TrendingUp, color: "text-success", sub: "Current period only" },
              {
                key: "carry",
                label: "Carry-fwd ITC",
                raw: carryFwdTotal,
                icon: Clock,
                color: carryFwdTotal > 0 ? "text-success" : "text-muted-foreground",
                sub: carryFwd.configured
                  ? (carryFwd.as_of ? `As of ${new Date(carryFwd.as_of).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "From previous FY")
                  : "Set in ITC Ledger →",
                href: "/billing/gst-summary?tab=itc-ledger",
              },
              { key: "net", label: "Net Tax", raw: Math.abs(netTax), icon: BarChart3, color: netTax >= 0 ? "text-destructive" : "text-success", sub: netTax >= 0 ? "Payable (incl. carry-fwd)" : "Carry to next period" },
            ].map((s) => {
              const Icon = s.icon as any;
              const inner = (
                <div className="stat-card rounded-2xl p-4 h-full" title={statsLoading ? "Loading" : formatCurrency(s.raw)}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
                    <Icon className={cn("w-3.5 h-3.5", s.color)} />
                  </div>
                  {statsLoading ? (
                    <div className="mt-1.5 h-6 w-16 rounded bg-muted/40 animate-pulse" />
                  ) : (
                    <p className={cn("font-display font-bold mt-1 tabular-nums", s.color, isMobile ? "text-sm" : "text-lg")}>{formatCompactCurrency(s.raw)}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{s.sub}</p>
                </div>
              );
              return (
                <motion.div key={s.key} variants={fadeUp}>
                  {s.href ? (
                    <Link to={s.href} className="block hover:opacity-90 transition-opacity">{inner}</Link>
                  ) : inner}
                </motion.div>
              );
            })}
          </motion.div>

          {/* Charts — Monthly Trend gets a YTD legend (matches the GST
              page's pattern) so a flat chart (e.g. early FY with one tall
              bar) still conveys useful info at a glance. */}
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3")}>
            <motion.div variants={fadeUp} className={cn(isMobile ? "" : "lg:col-span-2", "elevated-card rounded-2xl p-4")}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <h2 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Monthly Trend</h2>
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[hsl(var(--chart-1))]" />
                    <span className="text-muted-foreground">Sales</span>
                    <span className="font-semibold text-foreground tabular-nums">{formatCompactCurrency(totalSales)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[hsl(var(--chart-2))]" />
                    <span className="text-muted-foreground">Purchases</span>
                    <span className="font-semibold text-foreground tabular-nums">{formatCompactCurrency(totalPurchases)}</span>
                  </span>
                </div>
              </div>
              <div className={cn(isMobile ? "h-[160px]" : "h-[200px]")}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} barGap={2} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} tickFormatter={isMobile ? (v: string) => v.slice(0, 1) : undefined} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v >= 1000 ? (v/1000).toFixed(1) + "L" : v}k`} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))" }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(v: number) => `₹${(Math.round(v * 1000) / 1000).toFixed(1)}k`}
                    />
                    <Bar dataKey="sales" name="Sales" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="purchases" name="Purchases" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
            <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-4">
              <h2 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider mb-2">Tax Distribution</h2>
              {pieData.length === 0 ? <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">No data</div> : (
                <div className="h-[160px]"><ResponsiveContainer width="100%" height="100%"><RPieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={3} dataKey="value">{pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} formatter={(v: number) => formatCurrency(v)} /></RPieChart></ResponsiveContainer></div>
              )}
              <div className="flex items-center justify-center gap-3 mt-1 flex-wrap">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-[11px] text-muted-foreground">{d.name}</span>
                    <span className="text-[11px] font-medium text-foreground tabular-nums">{formatCompactCurrency(d.value)}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>

          {/* Top Customers + Top Products row — two side-by-side panels.
              Each row gets a thin progress bar so concentration risk pops
              out at a glance (e.g. one customer is 40% of revenue). */}
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
            <motion.div variants={fadeUp} className="elevated-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border/50 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-chart-1" />
                <h2 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Top Customers</h2>
              </div>
              {topCustomers.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No data</div> : (
                <div className="divide-y divide-border/30">
                  {topCustomers.map((c, i) => (
                    <motion.div key={c.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}
                      className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{c.name}</p>
                          <p className="text-[10px] text-muted-foreground">{c.count > 0 ? `${c.count} invoice${c.count === 1 ? "" : "s"} · ` : ""}{c.pct.toFixed(1)}% of sales</p>
                        </div>
                        <span className="text-[13px] font-semibold text-foreground tabular-nums shrink-0">{formatCompactCurrency(c.total)}</span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-secondary/30 overflow-hidden">
                        <div className="h-full bg-chart-1/70 rounded-full" style={{ width: `${Math.min(c.pct, 100)}%` }} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
            <motion.div variants={fadeUp} className="elevated-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border/50 flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-chart-2" />
                <h2 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Top Products</h2>
              </div>
              {topProducts.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No data</div> : (
                <div className="divide-y divide-border/30">
                  {topProducts.map((p, i) => (
                    <motion.div key={p.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}
                      className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {p.qty > 0 && <>{p.qty.toFixed(p.qty < 10 ? 2 : 0)} units · </>}
                            {p.hsn && <>HSN {p.hsn} · </>}
                            {p.pct.toFixed(1)}% of top-5
                          </p>
                        </div>
                        <span className="text-[13px] font-semibold text-foreground tabular-nums shrink-0">{formatCompactCurrency(p.total)}</span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-secondary/30 overflow-hidden">
                        <div className="h-full bg-chart-2/70 rounded-full" style={{ width: `${Math.min(p.pct, 100)}%` }} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>

          {/* Quick-link row — horizontal pills, more compact than the
              previous vertical sidebar, and consistent across screen sizes. */}
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-5")}>
            {quickLinks.map((l, i) => (
              <motion.div key={l.label} variants={fadeUp}>
                <Link to={l.href} className="stat-card rounded-2xl p-3.5 block hover:border-primary/30 transition-all">
                  <div className="flex items-center gap-2.5">
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", l.bg)}>
                      <l.icon className={cn("w-3.5 h-3.5", l.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-[12px] font-display font-semibold truncate", l.color)}>{l.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{l.desc}</p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </>
      )}
      <ReportPreviewModal
        isOpen={showPreview}
        invoices={previewInvoices || []}
        businesses={businesses}
        customers={customers}
        onDownload={handleConfirmDownload}
        onClose={() => setShowPreview(false)}
        filename={`GST Report ${selectedFY}.xlsx`}
      />
    </div>
  );
}
