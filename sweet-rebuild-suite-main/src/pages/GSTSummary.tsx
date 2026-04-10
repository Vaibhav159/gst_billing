import { useState, useMemo, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { format } from "date-fns";
import { formatCurrency } from "@/utils/mockData";
import { useBusinesses } from "@/hooks/useDataStore";
import api from "@/utils/api";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Download, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, BarChart3, Receipt, Loader2, Hash } from "lucide-react";
import DateRangePicker from "@/components/DateRangePicker";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";

interface OutletCtx { selectedFY: string }
const MONTHS = ["April","May","June","July","August","September","October","November","December","January","February","March"];
const SHORT = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

/** Fetch server-side GST summary (rate slabs, HSN breakdown, GSTR-3B) */
function useGSTSummary(selectedFY: string, bizFilter: string, startDate?: string, endDate?: string) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const [startYearStr] = selectedFY.split("-");
      const startYear = parseInt(startYearStr);
      const params = new URLSearchParams();
      params.set("start_date", startDate || `${startYear}-04-01`);
      params.set("end_date", endDate || `${startYear + 1}-03-31`);
      if (bizFilter !== "all") params.set("business_id", bizFilter);

      const res = await api.get<any>(`invoices/gst_summary/?${params.toString()}`);
      setData(res.data);
    } catch (e) {
      console.error("Failed to fetch GST summary", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFY, bizFilter, startDate, endDate]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  return { data, isLoading };
}

/** Also fetch stats for monthly chart and totals */
function useGSTStats(selectedFY: string, bizFilter: string) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const [startYearStr] = selectedFY.split("-");
      const startYear = parseInt(startYearStr);
      const params = new URLSearchParams();
      params.set("start_date", `${startYear}-04-01`);
      params.set("end_date", `${startYear + 1}-03-31`);
      if (bizFilter !== "all") params.set("business_id", bizFilter);

      const res = await api.get<any>(`invoices/stats/?${params.toString()}`);
      setData(res.data);
    } catch (e) {
      console.error("Failed to fetch stats", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFY, bizFilter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { data, isLoading };
}

export default function GSTSummary() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const isMobile = useIsMobile();
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(new Date(parseInt(selectedFY.split("-")[0]), 3, 1));
  const [customEnd, setCustomEnd] = useState(new Date(parseInt(selectedFY.split("-")[0]) + 1, 2, 31));
  const [selectedMonth, setSelectedMonth] = useState("All");
  const [bizFilter, setBizFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"gstr1" | "gstr3b" | "hsn">("gstr1");
  const { items: businesses } = useBusinesses();
  const fyStart = parseInt(selectedFY.split("-")[0]);
  const monthIdx = MONTHS.indexOf(selectedMonth);

  // Compute date range for selected month or custom range
  const { gstStartDate, gstEndDate } = useMemo(() => {
    if (useCustomRange) {
      return { gstStartDate: format(customStart, "yyyy-MM-dd"), gstEndDate: format(customEnd, "yyyy-MM-dd") };
    }
    if (selectedMonth === "All") {
      return { gstStartDate: `${fyStart}-04-01`, gstEndDate: `${fyStart + 1}-03-31` };
    }
    // Calculate month-specific range
    const y = monthIdx < 9 ? fyStart : fyStart + 1;
    const m = monthIdx < 9 ? monthIdx + 4 : monthIdx - 8;
    const lastDay = new Date(y, m, 0).getDate();
    return { gstStartDate: `${y}-${String(m).padStart(2, "0")}-01`, gstEndDate: `${y}-${String(m).padStart(2, "0")}-${lastDay}` };
  }, [selectedMonth, selectedFY, useCustomRange, customStart, customEnd, fyStart, monthIdx]);

  const { data: gstData, isLoading: gstLoading } = useGSTSummary(selectedFY, bizFilter, gstStartDate, gstEndDate);
  const { data: statsData, isLoading: statsLoading } = useGSTStats(selectedFY, bizFilter);

  const invoicesLoading = gstLoading || statsLoading;

  // Server-side data
  const gstr1Rows = (gstData?.rate_slabs?.outward || []).filter((r: any) => r.taxable > 0);
  const gstr1InwardRows = (gstData?.rate_slabs?.inward || []).filter((r: any) => r.taxable > 0);
  const hsnRows = gstData?.hsn_summary || [];
  const gstr3b = gstData?.gstr3b || { output_tax: { cgst: 0, sgst: 0, igst: 0, total: 0 }, input_tax_credit: { cgst: 0, sgst: 0, igst: 0, total: 0 }, net_payable: { cgst: 0, sgst: 0, igst: 0, total: 0 } };

  const totalOutward = statsData?.totals?.outward || 0;
  const totalOutwardTax = gstr3b.output_tax.total;
  const totalITC = gstr3b.input_tax_credit.total;
  const netTax = gstr3b.net_payable.total;

  // Monthly chart from stats
  const monthlyTax = SHORT.map((m, idx) => {
    const monthly = statsData?.monthly || [];
    const y = idx < 9 ? fyStart : fyStart + 1;
    const mn = idx < 9 ? idx + 4 : idx - 8;
    const found = monthly.find((r: any) => r.month === mn && r.year === y);
    return { month: m, output: (found?.outward_total || 0) / 1000, itc: (found?.inward_total || 0) / 1000, isCurrent: m === SHORT[monthIdx] };
  });

  const handleDownload = () => {
    const rows = [["Rate", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices"]];
    gstr1Rows.forEach((r: any) => rows.push([`${r.rate}%`, r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2), r.total.toFixed(2), r.invoice_count.toString()]));
    rows.push([]);
    rows.push(["HSN Code", "Taxable", "CGST", "SGST", "IGST", "Total", "Qty"]);
    hsnRows.forEach((h: any) => rows.push([h.hsn_code, h.taxable.toFixed(2), h.cgst.toFixed(2), h.sgst.toFixed(2), h.igst.toFixed(2), h.total.toFixed(2), h.qty.toFixed(3)]));
    const csv = rows.map((r: any) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `gst-summary-${selectedFY}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("space-y-4", isMobile ? "p-4 pb-20" : "p-6 lg:p-8 space-y-5")}>
      <Breadcrumbs items={[{ label: "Reports", href: "/billing/reports" }, { label: "GST Summary" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-2xl bg-gradient-to-br from-chart-2/20 to-chart-2/5 border border-chart-2/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
            <BarChart3 className="w-5 h-5 text-chart-2" />
          </div>
          <div>
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-2xl")}>GST Summary</h1>
            <p className="text-xs text-muted-foreground">{selectedMonth === "All" ? "Full Year" : `${selectedMonth}`} · FY {selectedFY}</p>
          </div>
        </div>
        <button onClick={handleDownload} className={cn("premium-btn-primary text-[12px]", isMobile ? "h-9" : "")}><Download className="w-4 h-4" /> Download</button>
      </motion.div>

      {/* Month filters */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
        className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseCustomRange(false)}
              className={cn("px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all", !useCustomRange ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted/50 border-border/40 text-muted-foreground hover:text-foreground")}
            >By Month</button>
            <button
              onClick={() => setUseCustomRange(true)}
              className={cn("px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all", useCustomRange ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted/50 border-border/40 text-muted-foreground hover:text-foreground")}
            >Custom Range</button>
          </div>
          {!isMobile && <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-auto text-[13px]"><option value="all">All Businesses</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        </div>
        {useCustomRange ? (
          <DateRangePicker
            startDate={customStart}
            endDate={customEnd}
            onStartChange={setCustomStart}
            onEndChange={setCustomEnd}
            fyStart={fyStart}
          />
        ) : (
          <div className={cn("flex rounded-xl overflow-hidden border border-border", isMobile ? "overflow-x-auto max-w-full -mx-1 px-1" : "flex-shrink-0")}>
            <button onClick={() => setSelectedMonth("All")} className={cn("px-3 py-2 text-[11px] font-medium transition-all whitespace-nowrap", selectedMonth === "All" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/40")}>All</button>
            {MONTHS.map((m) => (
              <button key={m} onClick={() => setSelectedMonth(m)} className={cn("px-2 py-2 text-[11px] font-medium transition-all whitespace-nowrap", selectedMonth === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/40")}>{m.slice(0, 3)}</button>
            ))}
          </div>
        )}
      </motion.div>

      {/* Stats */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3">
        {[
          { label: "Outward Supply", value: formatCurrency(totalOutward), color: "text-chart-1" },
          { label: "Output Tax", value: formatCurrency(totalOutwardTax), color: "text-chart-3" },
          { label: "ITC Available", value: formatCurrency(totalITC), color: "text-success" },
          { label: "Net Tax", value: formatCurrency(Math.abs(netTax)), color: netTax >= 0 ? "text-destructive" : "text-success" },
        ].map((s) => (
          <motion.div key={s.label} variants={fadeUp} className="stat-card rounded-2xl p-4">
            <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
            <p className={cn("font-display font-bold mt-1", s.color, isMobile ? "text-sm" : "text-xl")}>{s.value}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Chart */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}
        className="elevated-card rounded-2xl p-5">
        <h2 className="text-[13px] font-display font-semibold text-foreground mb-3">Tax Trend (₹k)</h2>
        <div className={cn(isMobile ? "h-[160px]" : "h-[220px]")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyTax} barGap={2}>
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} formatter={(value: number) => [`₹${value.toFixed(1)}k`, undefined]} />
              <Bar dataKey="output" name="Output" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]}>
                {monthlyTax.map((entry, i) => <Cell key={i} fill={entry.isCurrent ? "hsl(var(--primary))" : "hsl(var(--chart-1))"} opacity={entry.isCurrent ? 1 : 0.6} />)}
              </Bar>
              <Bar dataKey="itc" name="ITC" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }}
        className="elevated-card rounded-2xl overflow-hidden">
        <div className="flex border-b border-border/50">
          {(["gstr1", "gstr3b", "hsn"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={cn("px-5 py-3 text-[12px] font-semibold border-b-2 -mb-px transition-all", activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
              {tab === "gstr1" ? "GSTR-1" : tab === "gstr3b" ? "GSTR-3B" : "HSN Summary"}
            </button>
          ))}
        </div>

        {activeTab === "gstr1" && (
          isMobile ? (
            <div className="divide-y divide-border/30">
              {gstr1Rows.map((r: any, i: number) => (
                <motion.div key={r.rate} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="premium-badge bg-primary/12 text-primary">{r.rate}%</span>
                    <span className="text-[12px] text-muted-foreground">{r.invoice_count} inv</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <div><p className="text-[10px] text-muted-foreground">Taxable</p><p className="font-semibold text-foreground">{formatCurrency(r.taxable)}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Total Tax</p><p className="font-semibold text-foreground">{formatCurrency(r.total)}</p></div>
                  </div>
                </motion.div>
              ))}
              {gstr1Rows.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">{invoicesLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</span> : "No data for selected period"}</div>}
            </div>
          ) : (
            <table className="table-premium">
              <thead><tr>{["Rate", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {gstr1Rows.map((r: any, i: number) => (
                  <motion.tr key={r.rate} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.05 }}>
                    <td><span className="premium-badge bg-primary/12 text-primary">{r.rate}%</span></td><td className="font-medium text-foreground">{formatCurrency(r.taxable)}</td><td>{formatCurrency(r.cgst)}</td><td>{formatCurrency(r.sgst)}</td><td>{formatCurrency(r.igst)}</td><td className="font-semibold text-foreground">{formatCurrency(r.total)}</td><td className="text-muted-foreground">{r.invoice_count}</td>
                  </motion.tr>
                ))}
                {gstr1Rows.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">{invoicesLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</span> : "No data for selected period"}</td></tr>}
              </tbody>
            </table>
          )
        )}

        {activeTab === "gstr3b" && (
          <div className="p-5 space-y-4">
            <table className="table-premium text-[12px]">
              <thead><tr><th></th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                <tr><td className="font-medium">Output Tax (Sales)</td><td className="text-right">{formatCurrency(gstr3b.output_tax.cgst)}</td><td className="text-right">{formatCurrency(gstr3b.output_tax.sgst)}</td><td className="text-right">{formatCurrency(gstr3b.output_tax.igst)}</td><td className="text-right font-semibold">{formatCurrency(gstr3b.output_tax.total)}</td></tr>
                <tr><td className="font-medium text-success">Input Tax Credit</td><td className="text-right text-success">{formatCurrency(gstr3b.input_tax_credit.cgst)}</td><td className="text-right text-success">{formatCurrency(gstr3b.input_tax_credit.sgst)}</td><td className="text-right text-success">{formatCurrency(gstr3b.input_tax_credit.igst)}</td><td className="text-right font-semibold text-success">{formatCurrency(gstr3b.input_tax_credit.total)}</td></tr>
                <tr className="border-t-2 border-border"><td className="font-bold">Net Tax Payable</td><td className={cn("text-right font-bold", gstr3b.net_payable.cgst >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(gstr3b.net_payable.cgst)}</td><td className={cn("text-right font-bold", gstr3b.net_payable.sgst >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(gstr3b.net_payable.sgst)}</td><td className={cn("text-right font-bold", gstr3b.net_payable.igst >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(gstr3b.net_payable.igst)}</td><td className={cn("text-right font-bold text-lg", netTax >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(netTax))}</td></tr>
              </tbody>
            </table>
            <div className="glass-surface rounded-xl p-4 flex items-center justify-between">
              <div><p className="text-[11px] text-muted-foreground">Net Tax</p><p className={cn("text-xl font-display font-bold mt-1", netTax >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(netTax))}</p></div>
              <span className={cn("premium-badge", netTax >= 0 ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>{netTax >= 0 ? "Payable" : "Refundable"}</span>
            </div>
          </div>
        )}

        {activeTab === "hsn" && (
          <div className="overflow-x-auto">
            <table className="table-premium text-[12px]">
              <thead><tr><th>HSN Code</th><th className="text-right">Qty</th><th className="text-right">Taxable Value</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Total</th><th className="text-right">Items</th></tr></thead>
              <tbody>
                {hsnRows.map((h: any, i: number) => (
                  <motion.tr key={h.hsn_code} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <td><span className="premium-badge bg-chart-2/12 text-chart-2 font-mono">{h.hsn_code}</span></td>
                    <td className="text-right tabular-nums">{h.qty.toFixed(3)}</td>
                    <td className="text-right font-medium">{formatCurrency(h.taxable)}</td>
                    <td className="text-right">{formatCurrency(h.cgst)}</td>
                    <td className="text-right">{formatCurrency(h.sgst)}</td>
                    <td className="text-right">{formatCurrency(h.igst)}</td>
                    <td className="text-right font-semibold">{formatCurrency(h.total)}</td>
                    <td className="text-right text-muted-foreground">{h.count}</td>
                  </motion.tr>
                ))}
                {hsnRows.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">{invoicesLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</span> : "No data"}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
