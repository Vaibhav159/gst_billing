import { useState, useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { formatCurrency } from "@/utils/mockData";
import { useBusinesses, useCustomers, useDashboardStats, mapDjangoInvoice } from "@/hooks/useDataStore";
import type { InvoiceFilters } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Download, FileSpreadsheet, ExternalLink, TrendingUp, Receipt, ArrowUpRight, ArrowDownLeft, BarChart3, PieChart, FileText, Database, FileDown, Loader2 } from "lucide-react";
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

  const totals = statsData?.totals || { outward: 0, inward: 0, net: 0, tax: 0, inward_tax: 0, count: 0 };
  const totalSales = totals.outward;
  const totalPurchases = totals.inward;
  const totalTaxCollected = totals.tax;
  const totalITC = totals.inward_tax || 0;
  const netTax = totalTaxCollected - totalITC;
  const totalCount = totals.count;

  // Monthly data from server stats
  const monthlyData = useMemo(() => {
    const fyStart = parseInt(selectedFY.split("-")[0]);
    return MONTHS.map((m, idx) => {
      const year = idx < 9 ? fyStart : fyStart + 1;
      const monthNum = idx < 9 ? idx + 4 : idx - 8;
      const match = (statsData?.monthly || []).find((d: any) => d.month === monthNum && d.year === year);
      return {
        month: m,
        sales: match ? (Number(match.outward_total) || 0) / 1000 : 0,
        purchases: match ? (Number(match.inward_total) || 0) / 1000 : 0,
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

  // Top customers from server stats
  const topCustomers = useMemo(() => {
    return (statsData?.top_customers || []).map(c => ({
      name: c.name,
      total: Number(c.total),
      count: (c as any).count || 0,
    })).slice(0, 5);
  }, [statsData?.top_customers]);

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
      console.error("CSV export failed", e);
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
      console.error("Export failed", e);
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
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-5")}>
            {[
              { label: "Sales", value: formatCurrency(totalSales), icon: ArrowUpRight, color: "text-chart-1", count: outwardCount },
              { label: "Purchases", value: formatCurrency(totalPurchases), icon: ArrowDownLeft, color: "text-chart-2", count: inwardCount },
              { label: "Tax Collected", value: formatCurrency(totalTaxCollected), icon: Receipt, color: "text-chart-3", count: null },
              { label: "ITC", value: formatCurrency(totalITC), icon: TrendingUp, color: "text-success", count: null },
              { label: "Net Tax", value: formatCurrency(netTax), icon: BarChart3, color: netTax >= 0 ? "text-destructive" : "text-success", count: null },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <motion.div key={s.label} variants={fadeUp} className="stat-card rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
                    <Icon className={cn("w-3.5 h-3.5", s.color)} />
                  </div>
                  <p className={cn("font-display font-bold mt-1", s.color, isMobile ? "text-sm" : "text-lg")}>{s.value}</p>
                  {s.count !== null && <p className="text-[10px] text-muted-foreground mt-0.5">{s.count} invoices</p>}
                </motion.div>
              );
            })}
          </motion.div>

          {/* Charts */}
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3")}>
            <motion.div variants={fadeUp} className={cn(isMobile ? "" : "lg:col-span-2", "elevated-card rounded-2xl p-5")}>
              <h2 className="text-[13px] font-display font-semibold text-foreground mb-3">Monthly Trend (₹k)</h2>
              <div className={cn(isMobile ? "h-[180px]" : "h-[260px]")}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} barGap={2}>
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                    <Bar dataKey="sales" name="Sales" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="purchases" name="Purchases" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
            <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-5">
              <h2 className="text-[13px] font-display font-semibold text-foreground mb-3">Tax Distribution</h2>
              {pieData.length === 0 ? <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">No data</div> : (
                <div className="h-[180px]"><ResponsiveContainer width="100%" height="100%"><RPieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${formatCurrency(value)}`}>{pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} formatter={(v: number) => formatCurrency(v)} /></RPieChart></ResponsiveContainer></div>
              )}
              <div className="flex items-center justify-center gap-4 mt-2">
                {pieData.map((d, i) => (<div key={d.name} className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} /><span className="text-[11px] text-muted-foreground">{d.name}</span></div>))}
              </div>
            </motion.div>
          </motion.div>

          {/* Top Customers + Quick Links */}
          <motion.div variants={stagger} initial="hidden" animate="visible"
            className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3")}>
            <motion.div variants={fadeUp} className={cn(isMobile ? "" : "lg:col-span-2", "elevated-card rounded-2xl overflow-hidden")}>
              <div className="px-5 py-4 border-b border-border/50"><h2 className="text-[13px] font-display font-semibold text-foreground">Top Customers</h2></div>
              {topCustomers.length === 0 ? <div className="p-8 text-center text-muted-foreground text-sm">No data</div> : (
                <div className="divide-y divide-border/30">
                  {topCustomers.map((c, i) => (
                    <motion.div key={c.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}
                      className="flex items-center gap-3 px-5 py-3">
                      <span className="text-[12px] font-mono text-muted-foreground w-5">#{i + 1}</span>
                      <div className="flex-1 min-w-0"><p className="text-[13px] font-medium text-foreground truncate">{c.name}</p>{c.count > 0 && <p className="text-[10px] text-muted-foreground">{c.count} inv</p>}</div>
                      <span className="text-[13px] font-semibold text-foreground tabular-nums">{formatCurrency(c.total)}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
            <motion.div variants={fadeUp} className="space-y-3">
              {quickLinks.map((l, i) => (
                <motion.div key={l.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.08 }}>
                  <Link to={l.href} className="stat-card rounded-2xl p-4 block group">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", l.bg)}><l.icon className={cn("w-4 h-4", l.color)} /></div>
                      <div className="flex-1"><p className={cn("text-[13px] font-display font-semibold", l.color)}>{l.label}</p><p className="text-[11px] text-muted-foreground">{l.desc}</p></div>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
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
