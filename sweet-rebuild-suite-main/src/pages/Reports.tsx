import { useState, useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { formatCurrency } from "@/lib/mockData";
import { useInvoices, useBusinesses, useCustomers } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Download, FileSpreadsheet, ExternalLink, TrendingUp, Receipt, ArrowUpRight, ArrowDownLeft, BarChart3, PieChart, FileText, Database } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RPieChart, Pie, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/lib/animations";

interface OutletCtx { selectedFY: string }
const MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

export default function Reports() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const isMobile = useIsMobile();
  const [startDate, setStartDate] = useState("2024-04-01");
  const [endDate, setEndDate] = useState("2025-03-31");
  const [bizFilter, setBizFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { items: invoices } = useInvoices();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();

  const fyInvoices = useMemo(() => invoices.filter((i) => i.financialYear === selectedFY), [selectedFY, invoices]);
  const filtered = useMemo(() => fyInvoices.filter((i) => {
    if (bizFilter !== "all" && i.businessId !== bizFilter) return false;
    if (typeFilter !== "all" && i.type !== typeFilter) return false;
    if (i.date < startDate || i.date > endDate) return false;
    return true;
  }), [fyInvoices, bizFilter, typeFilter, startDate, endDate]);

  const outward = filtered.filter((i) => i.type === "OUTWARD");
  const inward = filtered.filter((i) => i.type === "INWARD");
  const totalSales = outward.reduce((s, i) => s + i.total, 0);
  const totalPurchases = inward.reduce((s, i) => s + i.total, 0);
  const totalTaxCollected = outward.reduce((s, i) => s + i.totalTax, 0);
  const totalITC = inward.reduce((s, i) => s + i.totalTax, 0);
  const netTax = totalTaxCollected - totalITC;

  const fyStart = parseInt(selectedFY.split("-")[0]);
  const monthlyData = MONTHS.map((m, idx) => {
    const year = idx < 9 ? fyStart : fyStart + 1;
    const monthNum = idx < 9 ? idx + 4 : idx - 8;
    const prefix = `${year}-${String(monthNum).padStart(2, "0")}`;
    const mInvs = filtered.filter((i) => i.date.startsWith(prefix));
    return { month: m, sales: mInvs.filter((i) => i.type === "OUTWARD").reduce((s, i) => s + i.total, 0) / 1000, purchases: mInvs.filter((i) => i.type === "INWARD").reduce((s, i) => s + i.total, 0) / 1000 };
  });

  const pieData = [
    { name: "CGST", value: filtered.reduce((s, i) => s + i.totalCGST, 0) },
    { name: "SGST", value: filtered.reduce((s, i) => s + i.totalSGST, 0) },
    { name: "IGST", value: filtered.reduce((s, i) => s + i.totalIGST, 0) },
  ].filter((d) => d.value > 0);
  const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))"];

  const topCustomers = useMemo(() => {
    const map: Record<string, { name: string; total: number; count: number }> = {};
    outward.forEach((i) => { if (!map[i.customerId]) map[i.customerId] = { name: i.customerName, total: 0, count: 0 }; map[i.customerId].total += i.total; map[i.customerId].count += 1; });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [outward]);

  const handleExportCSV = () => {
    const rows = [["Invoice #", "Date", "Customer", "Business", "Type", "Subtotal", "Tax", "Total"]];
    filtered.forEach((i) => rows.push([i.invoiceNumber, i.date, i.customerName, i.businessName, i.type, i.subtotal.toString(), i.totalTax.toString(), i.total.toString()]));
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `report-${selectedFY}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const quickLinks = [
    { label: "GST Summary", href: "/billing/gst-summary", desc: "GSTR-1 & 3B", icon: PieChart, color: "text-chart-1", bg: "bg-chart-1/10" },
    { label: "Bulk PDF", href: "/billing/bulk-pdf", desc: "Download all PDFs", icon: FileText, color: "text-chart-2", bg: "bg-chart-2/10" },
    { label: "Backup", href: "/billing/backup", desc: "Export full data", icon: Database, color: "text-chart-3", bg: "bg-chart-3/10" },
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
              <p className="text-xs text-muted-foreground">FY {selectedFY} · {filtered.length} invoices</p>
            </div>
          </div>
          {!isMobile && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              className="flex items-center gap-2.5">
              <button onClick={handleExportCSV} className="premium-btn-outline text-[13px]"><FileSpreadsheet className="w-4 h-4" /> CSV</button>
              <button className="premium-btn-outline text-[13px] border-success/30 text-success"><Download className="w-4 h-4" /> GSTR-1</button>
            </motion.div>
          )}
        </div>
        <div className="border-t border-border/40 mt-4 pt-4 space-y-3">
          {/* Preset date filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground uppercase mr-1">Quick:</span>
            {[
              { label: "Current FY", from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` },
              { label: "Current Month", from: (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`; })(), to: (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`; })() },
              { label: "Previous Month", from: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })(), to: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, "0")}`; })() },
              { label: "Q1 (Apr–Jun)", from: `${fyStart}-04-01`, to: `${fyStart}-06-30` },
              { label: "Q2 (Jul–Sep)", from: `${fyStart}-07-01`, to: `${fyStart}-09-30` },
              { label: "Q3 (Oct–Dec)", from: `${fyStart}-10-01`, to: `${fyStart}-12-31` },
              { label: "Q4 (Jan–Mar)", from: `${fyStart + 1}-01-01`, to: `${fyStart + 1}-03-31` },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => { setStartDate(p.from); setEndDate(p.to); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all border",
                  startDate === p.from && endDate === p.to
                    ? "bg-primary/15 border-primary/30 text-primary"
                    : "bg-muted/50 border-border/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-6")}>
            <div className="space-y-1"><label className="text-[10px] font-medium text-muted-foreground uppercase">From</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="premium-input !w-full text-[12px]" /></div>
            <div className="space-y-1"><label className="text-[10px] font-medium text-muted-foreground uppercase">To</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="premium-input !w-full text-[12px]" /></div>
            <div className={cn("space-y-1", isMobile ? "col-span-2" : "xl:col-span-2")}><label className="text-[10px] font-medium text-muted-foreground uppercase">Business</label><select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select !w-full text-[12px]"><option value="all">All</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            {!isMobile && <div className="space-y-1 xl:col-span-2"><label className="text-[10px] font-medium text-muted-foreground uppercase">Type</label><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="premium-select !w-full text-[12px]"><option value="all">All</option><option value="OUTWARD">Sales</option><option value="INWARD">Purchases</option></select></div>}
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={stagger} initial="hidden" animate="visible"
        className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-5")}>
        {[
          { label: "Sales", value: formatCurrency(totalSales), icon: ArrowUpRight, color: "text-chart-1" },
          { label: "Purchases", value: formatCurrency(totalPurchases), icon: ArrowDownLeft, color: "text-chart-2" },
          { label: "Tax Collected", value: formatCurrency(totalTaxCollected), icon: Receipt, color: "text-chart-3" },
          { label: "ITC", value: formatCurrency(totalITC), icon: TrendingUp, color: "text-success" },
          { label: "Net Tax", value: formatCurrency(netTax), icon: BarChart3, color: netTax >= 0 ? "text-destructive" : "text-success" },
        ].map((s) => (
          <motion.div key={s.label} variants={fadeUp} className="stat-card rounded-2xl p-4">
            <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
            <p className={cn("font-display font-bold mt-1", s.color, isMobile ? "text-sm" : "text-lg")}>{s.value}</p>
          </motion.div>
        ))}
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
            <div className="h-[180px]"><ResponsiveContainer width="100%" height="100%"><RPieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={4} dataKey="value">{pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} formatter={(v: number) => formatCurrency(v)} /></RPieChart></ResponsiveContainer></div>
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
                  <div className="flex-1 min-w-0"><p className="text-[13px] font-medium text-foreground truncate">{c.name}</p><p className="text-[10px] text-muted-foreground">{c.count} inv</p></div>
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
    </div>
  );
}
