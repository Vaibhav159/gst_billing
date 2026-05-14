import { useState, useMemo } from "react";
import { Link, useOutletContext, useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import {
  TrendingUp, TrendingDown, Receipt, FileText,
  Users, Building2, Package, BarChart3, ArrowRight, ArrowUpRight,
  Sparkles, Activity, Eye, Pencil, Printer, Clock, AlertCircle,
  CalendarDays,
} from "lucide-react";
import { motion } from "framer-motion";
import { formatCurrency, formatDate } from "@/utils/mockData";
import { stagger, fadeUp, fadeIn } from "@/utils/animations";
import { useDashboardStats, useBusinesses, mapDjangoInvoice } from "@/hooks/useDataStore";
import { useAuditLog } from "@/hooks/useAuditLog";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileMode } from "@/contexts/MobileModeContext";
import EasyDashboard from "@/components/mobile/easy/EasyDashboard";
import AnimatedCounter from "@/components/AnimatedCounter";
import OnboardingWizard, { shouldShowOnboarding } from "@/components/OnboardingWizard";

const MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

function getMonthlyDataFromStats(fy: string, monthlyRaw: any[]) {
  const fyStart = parseInt(fy.split("-")[0]);
  return MONTHS.map((month, i) => {
    const monthNum = i < 9 ? i + 4 : i - 8;
    const year = i < 9 ? fyStart : fyStart + 1;
    const match = (monthlyRaw || []).find((m: any) => m.month === monthNum && m.year === year);
    return {
      month,
      outward: match ? Number(match.outward_total) || 0 : 0,
      inward: match ? Number(match.inward_total) || 0 : 0,
      outwardCount: match ? Number(match.outward_count) || 0 : 0,
      inwardCount: match ? Number(match.inward_count) || 0 : 0,
    };
  });
}

interface OutletCtx { selectedFY: string }

function getMiniTrend(
  data: { month: string; outward: number; inward: number }[],
  type: "outward" | "inward" | "net",
) {
  return data.map((d, i) => ({
    i,
    month: d.month,
    v: type === "net" ? d.outward - d.inward : d[type],
  }));
}

export default function Dashboard() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const [chartMode, setChartMode] = useState<"amount" | "count">("amount");
  const [selectedBusiness, setSelectedBusiness] = useState("all");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { mobileMode } = useMobileMode();
  const { data: statsData, isLoading: isStatsLoading } = useDashboardStats({ fyFilter: selectedFY, businessId: selectedBusiness });
  const { items: businesses } = useBusinesses();

  const totals = statsData?.totals || { inward: 0, outward: 0, net: 0, tax: 0, inward_tax: 0, count: 0 };
  const monthlyData = useMemo(() => getMonthlyDataFromStats(selectedFY, statsData?.monthly || []), [selectedFY, statsData?.monthly]);
  // Sparklines only show months that have actually started, otherwise the
  // not-yet-happened months render as "0" and a single early-month spike
  // looks like a broken chart with a flat tail. The big Revenue Overview
  // chart below still shows the full 12-month FY for context.
  const elapsedMonthlyData = useMemo(() => {
    const fyStart = parseInt(selectedFY.split("-")[0]);
    const fyEnd = new Date(fyStart + 1, 2, 31);  // 31 Mar of next year
    const now = new Date();
    if (now > fyEnd) return monthlyData;  // past FY → all 12 months
    if (now < new Date(fyStart, 3, 1)) return [];  // future FY → none
    const m = now.getMonth();  // 0-11 calendar month
    const fyMonthIdx = m >= 3 ? m - 3 : m + 9;  // 0=Apr ... 11=Mar
    return monthlyData.slice(0, fyMonthIdx + 1);
  }, [selectedFY, monthlyData]);
  const recentInvoices = useMemo(() => (statsData?.recent_invoices || []).map(mapDjangoInvoice), [statsData?.recent_invoices]);
  const { items: auditEntries } = useAuditLog(undefined, true);

  const totalOutward = totals.outward;
  const totalInward = totals.inward;
  const netAmount = totals.net;
  const totalCount = totals.count;

  const outwardCount = useMemo(() => monthlyData.reduce((s, d) => s + d.outwardCount, 0), [monthlyData]);
  const inwardCount = useMemo(() => monthlyData.reduce((s, d) => s + d.inwardCount, 0), [monthlyData]);

  // Trend calculation: compare last 2 months with data
  const trendPercent = useMemo(() => {
    const nonZero = monthlyData.filter(d => d.outward > 0 || d.inward > 0);
    if (nonZero.length < 2) return { outward: 0, inward: 0, net: 0 };
    const last = nonZero[nonZero.length - 1];
    const prev = nonZero[nonZero.length - 2];
    const calcTrend = (cur: number, prv: number) => prv === 0 ? 0 : Math.round(((cur - prv) / prv) * 100);
    return {
      outward: calcTrend(last.outward, prev.outward),
      inward: calcTrend(last.inward, prev.inward),
      net: calcTrend(last.outward - last.inward, prev.outward - prev.inward),
    };
  }, [monthlyData]);

  // This month at a glance
  const thisMonthData = useMemo(() => {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const match = (statsData?.monthly || []).find((d: any) => d.month === m && d.year === y);
    return {
      count: match ? (Number(match.outward_count) || 0) + (Number(match.inward_count) || 0) : 0,
      outward: match ? Number(match.outward_total) || 0 : 0,
      inward: match ? Number(match.inward_total) || 0 : 0,
      monthName: now.toLocaleString("en", { month: "long", year: "numeric" }),
    };
  }, [statsData?.monthly]);

  const customerTotals = (statsData?.top_customers || []).map(c => ({
    id: String(c.id),
    name: c.name,
    total: Number(c.total)
  })).slice(0, 5);
  const maxCustomerTotal = customerTotals[0]?.total || 1;

  const productTotals = (statsData?.top_products || []).map((p, i) => ({
    id: `p-${i}`,
    name: p.name,
    totalAmt: Number(p.total),
    totalQty: Number(p.qty),
    hsn: p.hsn || ""
  })).slice(0, 5);

  const pieData = [{ name: "Outward", value: totals.outward }, { name: "Inward", value: totals.inward }];
  const PIE_COLORS = ["hsl(var(--success))", "hsl(var(--warning))"];

  const quickActions = [
    { label: "Add Customer", href: "/billing/customer/new", icon: Users, desc: "New customer record" },
    { label: "Add Business", href: "/billing/business/new", icon: Building2, desc: "Register business" },
    { label: "Create Invoice", href: "/billing/invoice/add", icon: FileText, desc: "Generate new invoice" },
    { label: "Add Product", href: "/billing/product/new", icon: Package, desc: "New product entry" },
    { label: "View Reports", href: "/billing/reports", icon: BarChart3, desc: "Analytics & insights" },
    { label: "GST Summary", href: "/billing/gst-summary", icon: Receipt, desc: "Tax overview" },
  ];


  const TrendBadge = ({ value }: { value: number }) => (
    value !== 0 ? (
      <span className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold",
        value > 0 ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive"
      )}>
        {value > 0 ? "↑" : "↓"}{Math.abs(value)}%
      </span>
    ) : null
  );

  const statCards = [
    { label: "Total Outward", value: formatCurrency(totalOutward), sub: `${outwardCount} invoices`, icon: TrendingUp, color: "text-success", bgGlow: "from-success/10 to-transparent", sparkType: "outward" as const, trend: trendPercent.outward },
    { label: "Total Inward", value: formatCurrency(totalInward), sub: `${inwardCount} invoices`, icon: TrendingDown, color: "text-warning", bgGlow: "from-warning/10 to-transparent", sparkType: "inward" as const, trend: trendPercent.inward },
    { label: "Net Amount", value: formatCurrency(netAmount), sub: "Outward − Inward", icon: Activity, color: netAmount >= 0 ? "text-success" : "text-destructive", bgGlow: netAmount >= 0 ? "from-success/10 to-transparent" : "from-destructive/10 to-transparent", sparkType: "net" as const, trend: trendPercent.net },
    { label: "Total Invoices", value: totalCount.toString(), sub: `FY ${selectedFY}`, icon: FileText, color: "text-chart-4", bgGlow: "from-chart-4/10 to-transparent", sparkType: "outward" as const, trend: 0 },
  ];

  if (isStatsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading dashboard stats...</p>
      </div>
    );
  }

  // ─── MOBILE DASHBOARD ───
  if (isMobile && mobileMode === "easy") {
    return <EasyDashboard selectedFY={selectedFY} />;
  }

  if (isMobile) {
    return (
      <div className="p-4 space-y-5">
        {/* Mobile Header */}
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">FY {selectedFY}</p>
        </div>

        {/* Business filter */}
        <select value={selectedBusiness} onChange={(e) => setSelectedBusiness(e.target.value)}
          className="premium-select w-full h-11 text-[13px]">
          <option value="all">All Businesses</option>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {/* Horizontal scrollable stat cards */}
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <motion.div key={card.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="min-w-[160px] snap-center stat-card rounded-2xl p-4 space-y-2 shrink-0">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{card.label}</p>
                  <Icon className={cn("w-4 h-4", card.color)} />
                </div>
                <p className={cn("text-xl font-display font-bold tracking-tight", card.color)}>{card.value}</p>
                <p className="text-[10px] text-muted-foreground/70">{card.sub}</p>
              </motion.div>
            );
          })}
        </div>

        {/* Quick Actions Grid — 2x3 */}
        <div>
          <h2 className="text-sm font-display font-semibold text-foreground mb-3">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <Link key={a.href} to={a.href}
                  className="flex flex-col items-center gap-2 p-3.5 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-[11px] font-semibold text-foreground text-center leading-tight">{a.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Revenue Chart — Single chart */}
        <div className="elevated-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-semibold text-foreground">Revenue Overview</h2>
            <div className="flex rounded-lg overflow-hidden border border-border/60 text-[11px]">
              {(["amount", "count"] as const).map((m) => (
                <button key={m} onClick={() => setChartMode(m)}
                  className={cn("px-3 py-1 capitalize font-medium transition-all",
                    chartMode === m ? "bg-primary/15 text-primary" : "text-muted-foreground"
                  )}>{m}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} barSize={10} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => chartMode === "amount" ? `₹${(v / 100000).toFixed(0)}L` : String(v)} width={40} />
              <Tooltip cursor={{ fill: "hsl(var(--secondary) / 0.3)" }}
                contentStyle={{ backgroundColor: "hsl(var(--elevated-bg))", border: "1px solid hsl(var(--elevated-border))", borderRadius: "12px", fontSize: "11px" }}
                formatter={(v: number, name: string) => [chartMode === "amount" ? formatCurrency(v) : v, name]} />
              <Bar dataKey={chartMode === "amount" ? "outward" : "outwardCount"} fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Outward" />
              <Bar dataKey={chartMode === "amount" ? "inward" : "inwardCount"} fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} name="Inward" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Invoices as Cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-semibold text-foreground">Recent Invoices</h2>
            <Link to="/billing/invoice/list" className="text-[11px] text-primary font-semibold flex items-center gap-1">
              All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2.5">
            {recentInvoices.map((inv) => (
              <Link key={inv.id} to={`/billing/invoice/${inv.id}`}
                className="block elevated-card rounded-xl p-4 hover:border-primary/30 transition-all">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(inv.invoice_date || "")} · {inv.customerName}</p>
                  </div>
                  <span className={cn(
                    "premium-badge text-[9px]",
                    inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"
                  )}>{inv.type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">{inv.businessName}</p>
                  <p className="text-[14px] font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Top Customers */}
        <div className="elevated-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-semibold text-foreground">Top Customers</h2>
            <Link to="/billing/customer/list" className="text-[11px] text-primary font-semibold">All →</Link>
          </div>
          <div className="space-y-3">
            {customerTotals.filter(c => c.total > 0).slice(0, 4).map((c, i) => (
              <Link key={c.id} to={`/billing/customer/${c.id}`} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-foreground truncate">{c.name}</p>
                </div>
                <span className="text-[12px] font-bold text-foreground tabular-nums">{formatCurrency(c.total)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── DESKTOP DASHBOARD (unchanged) ───
  return (
    <div className="p-6 lg:p-10 space-y-7 max-w-[1440px] mx-auto">
      {/* ── Onboarding Wizard ── */}
      {shouldShowOnboarding(businesses.length) && !showOnboarding && (
        <OnboardingWizard onDismiss={() => setShowOnboarding(true)} />
      )}

      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Financial Year {selectedFY} — Overview</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedBusiness} onChange={(e) => setSelectedBusiness(e.target.value)}
            className="premium-select min-w-[200px]">
            <option value="all">All Businesses</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </motion.div>

      {/* ── Summary Cards ── */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          const sparkData = getMiniTrend(elapsedMonthlyData, card.sparkType);
          return (
            <motion.div key={card.label} variants={fadeUp}
              className={cn("group relative overflow-hidden stat-card rounded-2xl p-5 space-y-3 border-l-[3px]",
                card.color === "text-success" ? "border-l-success" :
                card.color === "text-warning" ? "border-l-warning" :
                card.color === "text-chart-4" ? "border-l-chart-4" :
                netAmount >= 0 ? "border-l-success" : "border-l-destructive"
              )}>
              <div className={cn("absolute -top-8 -right-8 w-32 h-32 rounded-full bg-gradient-radial opacity-0 group-hover:opacity-100 transition-opacity duration-500", card.bgGlow)} />
              <div className="relative flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{card.label}</p>
                    <TrendBadge value={card.trend} />
                  </div>
                  <p className={cn("text-2xl lg:text-[28px] font-display font-bold tracking-tight", card.color)}>
                    <AnimatedCounter value={card.value} />
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">{card.sub}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-secondary/60 flex items-center justify-center shrink-0">
                  <Icon className={cn("w-[18px] h-[18px]", card.color)} />
                </div>
              </div>
              <div className="relative h-8 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparkData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                    <defs>
                      <linearGradient id={`spark-${card.label}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={`hsl(var(--${card.color.replace("text-", "")}))`} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={`hsl(var(--${card.color.replace("text-", "")}))`} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      cursor={{ stroke: `hsl(var(--${card.color.replace("text-", "")}))`, strokeOpacity: 0.3, strokeWidth: 1 }}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11, padding: "4px 8px", color: "hsl(var(--foreground))" }}
                      labelFormatter={() => ""}
                      formatter={(v: number, _n: any, p: any) => [formatCurrency(v), p?.payload?.month || ""]}
                    />
                    <Area type="monotone" dataKey="v" stroke={`hsl(var(--${card.color.replace("text-", "")}))`}
                      strokeWidth={1.5} fill={`url(#spark-${card.label})`}
                      dot={{ r: 1.5, fill: `hsl(var(--${card.color.replace("text-", "")}))`, fillOpacity: 0.4, stroke: "none" }}
                      activeDot={{ r: 3, fill: `hsl(var(--${card.color.replace("text-", "")}))`, stroke: "hsl(var(--background))", strokeWidth: 1 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ── This Month at a Glance ── */}
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="elevated-card rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
            <CalendarDays className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-display font-semibold text-foreground">This Month at a Glance</h2>
            <p className="text-[11px] text-muted-foreground">{thisMonthData.monthName}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 rounded-xl bg-secondary/20">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Invoices</p>
            <p className="text-xl font-display font-bold text-foreground"><AnimatedCounter value={thisMonthData.count.toString()} /></p>
          </div>
          <div className="text-center p-3 rounded-xl bg-success/5 border border-success/10">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Sales</p>
            <p className="text-xl font-display font-bold text-success"><AnimatedCounter value={formatCurrency(thisMonthData.outward)} /></p>
          </div>
          <div className="text-center p-3 rounded-xl bg-warning/5 border border-warning/10">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Purchases</p>
            <p className="text-xl font-display font-bold text-warning"><AnimatedCounter value={formatCurrency(thisMonthData.inward)} /></p>
          </div>
        </div>
      </motion.div>

      {/* ── Charts Row ── */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <motion.div variants={fadeUp} className="lg:col-span-3 elevated-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">Revenue Overview</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Monthly outward vs inward comparison</p>
            </div>
            <div className="flex rounded-xl overflow-hidden border border-border/60 text-[13px]">
              {(["amount", "count"] as const).map((m) => (
                <button key={m} onClick={() => setChartMode(m)}
                  className={cn("px-4 py-1.5 transition-all capitalize font-medium",
                    chartMode === m ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                  )}>{m}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyData} barSize={16} barGap={3}
              onClick={(data) => {
                if (data?.activeLabel) {
                  const monthMap: Record<string, string> = { Apr: "4", May: "5", Jun: "6", Jul: "7", Aug: "8", Sep: "9", Oct: "10", Nov: "11", Dec: "12", Jan: "1", Feb: "2", Mar: "3" };
                  const monthNum = monthMap[data.activeLabel];
                  if (monthNum) navigate(`/billing/invoice/list`);
                }
              }}
              style={{ cursor: "pointer" }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                tickFormatter={(v) => chartMode === "amount" ? `₹${(v / 100000).toFixed(0)}L` : String(v)} width={50} />
              <Tooltip cursor={{ fill: "hsl(var(--secondary) / 0.3)" }}
                contentStyle={{ backgroundColor: "hsl(var(--elevated-bg))", border: "1px solid hsl(var(--elevated-border))", borderRadius: "12px", fontSize: "12px", boxShadow: "0 8px 32px -4px rgba(0,0,0,0.3)" }}
                formatter={(v: number, name: string) => [chartMode === "amount" ? formatCurrency(v) : v, name]} />
              <Bar dataKey={chartMode === "amount" ? "outward" : "outwardCount"} fill="hsl(var(--success))" radius={[6, 6, 0, 0]} name="Outward" className="cursor-pointer" />
              <Bar dataKey={chartMode === "amount" ? "inward" : "inwardCount"} fill="hsl(var(--warning))" radius={[6, 6, 0, 0]} name="Inward" className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div variants={fadeUp} className="lg:col-span-2 elevated-card rounded-2xl p-6 flex flex-col">
          <div>
            <h2 className="text-base font-display font-semibold text-foreground">Invoice Distribution</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Outward vs inward breakdown</p>
          </div>
          <div className="flex-1 flex items-center justify-center py-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={82} paddingAngle={4} dataKey="value" strokeWidth={0}
                  onClick={(_, index) => {
                    const type = index === 0 ? "OUTWARD" : "INWARD";
                    navigate(`/billing/invoice/list`);
                  }}
                  className="cursor-pointer">
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} className="cursor-pointer hover:opacity-80 transition-opacity" />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--elevated-bg))", border: "1px solid hsl(var(--elevated-border))", borderRadius: "12px", fontSize: "12px", color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3 pt-2 border-t border-border/30">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full ring-2 ring-offset-1 ring-offset-transparent" style={{ backgroundColor: PIE_COLORS[i], boxShadow: `0 0 8px ${PIE_COLORS[i]}40` }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">{formatCurrency(d.value)}</span>
                  <span className="text-[11px] text-muted-foreground/60">({(totals.outward + totals.inward) > 0 ? Math.round((d.value / (totals.outward + totals.inward)) * 100) : 0}%)</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>

      {/* ── Outstanding / Activity Row ── */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">Recent Activity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Latest actions & events</p>
            </div>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-0">
            {(auditEntries.length > 0 ? auditEntries.slice(0, 8) : recentInvoices).map((entry: any, i: number) => {
              const isAudit = !!entry.action;
              const actionColors: Record<string, { bg: string; text: string }> = {
                created: { bg: "bg-success/15", text: "text-success" },
                updated: { bg: "bg-chart-3/15", text: "text-chart-3" },
                deleted: { bg: "bg-destructive/15", text: "text-destructive" },
                imported: { bg: "bg-chart-2/15", text: "text-chart-2" },
                printed: { bg: "bg-chart-4/15", text: "text-chart-4" },
                exported: { bg: "bg-chart-1/15", text: "text-chart-1" },
              };
              const colors = isAudit ? (actionColors[entry.action] || actionColors.updated) : (entry.type === "OUTWARD" ? actionColors.created : { bg: "bg-warning/15", text: "text-warning" });
              const label = isAudit ? `${entry.action.charAt(0).toUpperCase() + entry.action.slice(1)} ${entry.entity}` : (entry.type === "OUTWARD" ? "Sold to" : "Purchased from");
              const name = isAudit ? entry.entityName : entry.invoiceNumber;
              const detail = isAudit ? entry.details : `${entry.customerName} · ${formatCurrency(entry.total)}`;
              const time = isAudit ? new Date(entry.timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : formatDate(entry.invoice_date || "");
              const link = isAudit && entry.entity !== "settings" && entry.action !== "deleted" ? `/billing/${entry.entity}/${entry.entityId}` : (isAudit ? null : `/billing/invoice/${entry.id}`);

              return (
                <div key={entry.id} className="flex gap-3 pb-3.5 relative">
                  {i < 7 && <div className="absolute left-[11px] top-7 bottom-0 w-px bg-border/40" />}
                  <div className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5", colors.bg)}>
                    {isAudit ? <Activity className={cn("w-3 h-3", colors.text)} /> : <FileText className={cn("w-3 h-3", colors.text)} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      {link ? (
                        <Link to={link} className="text-[13px] font-medium text-foreground hover:text-primary transition-colors truncate">{name}</Link>
                      ) : (
                        <span className="text-[13px] font-medium text-foreground truncate">{name}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground shrink-0">{time}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{isAudit ? label : detail}</p>
                  </div>
                </div>
              );
            })}
            {auditEntries.length === 0 && recentInvoices.length === 0 && (
              <p className="text-[12px] text-muted-foreground text-center py-4">No recent activity</p>
            )}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">Revenue by Customer</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Top revenue contributors</p>
            </div>
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {customerTotals.filter(c => c.total > 0).map((c, i) => (
              <Link key={c.id} to={`/billing/customer/${c.id}`} className="flex items-center gap-3 group p-2 -mx-2 rounded-xl hover:bg-secondary/20 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/15 flex items-center justify-center text-primary text-[11px] font-bold shrink-0">
                  {c.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-[13px] font-medium text-foreground group-hover:text-primary truncate transition-colors">{c.name}</p>
                    <span className="text-[12px] font-bold text-foreground tabular-nums ml-2">{formatCurrency(c.total)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(c.total / maxCustomerTotal) * 100}%` }}
                      transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                      className="h-full bg-gradient-to-r from-success/70 to-success rounded-full" />
                  </div>
                </div>
              </Link>
            ))}
            {customerTotals.filter(c => c.total > 0).length === 0 && (
              <p className="text-[13px] text-muted-foreground text-center py-8">No revenue data for this period</p>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* ── Bottom Row: Customers + Products + Quick Actions ── */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">Top Customers</h2>
              <p className="text-xs text-muted-foreground mt-0.5">By outward revenue</p>
            </div>
            <Link to="/billing/customer/list" className="text-[12px] text-primary flex items-center gap-1 hover:underline font-semibold uppercase tracking-wide">
              All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-3.5">
            {customerTotals.map((c, i) => (
              <Link key={c.id} to={`/billing/customer/${c.id}`} className="flex items-center gap-3 group">
                <span className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-[11px] font-bold shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium text-foreground group-hover:text-primary transition-colors truncate">{c.name}</span>
                    <span className="text-[12px] font-semibold text-muted-foreground tabular-nums ml-2">{formatCurrency(c.total)}</span>
                  </div>
                  <div className="w-full h-1 bg-secondary/40 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(c.total / maxCustomerTotal) * 100}%` }}
                      transition={{ delay: 0.5 + i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">Top Products</h2>
              <p className="text-xs text-muted-foreground mt-0.5">By total amount</p>
            </div>
            <Link to="/billing/product/list" className="text-[12px] text-primary flex items-center gap-1 hover:underline font-semibold uppercase tracking-wide">
              All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {productTotals.map((p, i) => (
              <Link key={p.id} to={`/billing/product/${p.id}`} className="flex items-center gap-3 group p-2 -mx-2 rounded-xl hover:bg-secondary/20 transition-colors">
                <span className="w-7 h-7 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center text-success text-[11px] font-bold shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground group-hover:text-primary transition-colors truncate">{p.name}</p>
                  {p.hsn && <p className="text-[11px] text-muted-foreground">HSN: {p.hsn}</p>}
                  {!p.hsn && <p className="text-[11px] text-muted-foreground/50 italic">No HSN</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-bold text-foreground tabular-nums">{formatCurrency(p.totalAmt)}</p>
                  <p className="text-[10px] text-muted-foreground">{p.totalQty} units</p>
                </div>
              </Link>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-6">
          <div className="mb-5">
            <h2 className="text-base font-display font-semibold text-foreground">Quick Actions</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Shortcuts to common tasks</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {quickActions.map((a, i) => {
              const Icon = a.icon;
              return (
                <motion.div key={a.href} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 + i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                  <Link to={a.href}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 hover:border-primary/30 transition-all duration-300 group">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-center">
                      <span className="text-[12px] font-semibold text-foreground block">{a.label}</span>
                      <span className="text-[10px] text-muted-foreground/60 hidden lg:block">{a.desc}</span>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>

      {/* ── Recent Invoices ── */}
      <motion.div variants={fadeIn} initial="hidden" animate="visible" className="elevated-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border/40">
          <div>
            <h2 className="text-base font-display font-semibold text-foreground">Recent Invoices</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Latest transactions this FY</p>
          </div>
          <Link to="/billing/invoice/list" className="premium-btn-ghost text-[12px] h-8 px-3 gap-1.5">
            View all <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <table className="table-premium">
          <thead>
            <tr>
              {["Invoice #", "Date", "Customer", "Business", "Amount", "Type", "Actions"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentInvoices.map((inv, i) => (
              <motion.tr key={inv.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <td>
                  <Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">
                    {inv.invoiceNumber}
                  </Link>
                </td>
                <td className="text-muted-foreground text-[13px]">{formatDate(inv.invoice_date || "")}</td>
                <td className="text-foreground font-medium text-[13px]">{inv.customerName}</td>
                <td className="text-muted-foreground text-[13px]">{inv.businessName}</td>
                <td className="font-bold text-foreground tabular-nums text-[13px]">{formatCurrency(inv.total)}</td>
                <td>
                  <span className={cn(
                    "inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"
                  )}>{inv.type}</span>
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <Link to={`/billing/invoice/${inv.id}`} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary/40 transition-colors text-muted-foreground hover:text-foreground">
                      <Eye className="w-3.5 h-3.5" />
                    </Link>
                    <Link to={`/billing/invoice/edit/${inv.id}`} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary/40 transition-colors text-muted-foreground hover:text-foreground">
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    <Link to={`/billing/invoice/${inv.id}/print`} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary/40 transition-colors text-muted-foreground hover:text-foreground">
                      <Printer className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </td>
              </motion.tr>
            ))}
            {recentInvoices.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-16 text-sm">No invoices found for this period</td></tr>
            )}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
}
