import { logger } from "@/utils/logger";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { formatCurrency } from "@/utils/mockData";
import { useBusinesses } from "@/hooks/useDataStore";
import { useToast } from "@/hooks/use-toast";
import api from "@/utils/api";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Download, FileJson, BarChart3, Loader2 } from "lucide-react";
import DateRangePicker from "@/components/DateRangePicker";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn, pluralize } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";

interface OutletCtx { selectedFY: string }
const MONTHS = ["April","May","June","July","August","September","October","November","December","January","February","March"];
const SHORT = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

type TabKey = "summary" | "gstr1" | "gstr3b" | "gstr2b";

/** Fetch server-side GST summary (rate slabs, HSN breakdown, GSTR-3B totals) */
function useGSTSummary(bizFilter: string, startDate: string, endDate: string) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("start_date", startDate);
      params.set("end_date", endDate);
      if (bizFilter !== "all") params.set("business_id", bizFilter);
      const res = await api.get<any>(`invoices/gst_summary/?${params.toString()}`);
      setData(res.data);
    } catch (e) {
      logger.error("Failed to fetch GST summary", e);
    } finally {
      setIsLoading(false);
    }
  }, [bizFilter, startDate, endDate]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  return { data, isLoading };
}

/** Fetch dashboard stats for the monthly tax-trend chart */
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
      logger.error("Failed to fetch stats", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFY, bizFilter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  return { data, isLoading };
}

/**
 * Lazy-fetch the gstr_export endpoint. Only triggers when `enabled` flips to
 * true — saves a ~1.6s round-trip on initial load when the user is just
 * looking at the Summary tab. Cached per (bizFilter, startDate, endDate).
 */
function useGSTRExport(enabled: boolean, bizFilter: string, startDate: string, endDate: string) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const cacheKey = `${bizFilter}|${startDate}|${endDate}`;
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;
    if (lastKey.current === cacheKey && data) return;
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    const params = new URLSearchParams();
    params.set("start_date", startDate);
    params.set("end_date", endDate);
    if (bizFilter !== "all") params.set("business_id", bizFilter);
    api.get<any>(`invoices/gstr_export/?${params.toString()}`)
      .then((res) => { setData(res.data); lastKey.current = cacheKey; })
      .catch((e) => logger.error("Failed to fetch GSTR export", e))
      .finally(() => setIsLoading(false));
  }, [enabled, cacheKey]);

  return { data, isLoading };
}

export default function GSTSummary() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();
  const [searchParams, setSearchParams] = useSearchParams();

  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState(new Date(parseInt(selectedFY.split("-")[0]), 3, 1));
  const [customEnd, setCustomEnd] = useState(new Date(parseInt(selectedFY.split("-")[0]) + 1, 2, 31));
  const [selectedMonth, setSelectedMonth] = useState("All");
  const [bizFilter, setBizFilter] = useState("all");

  // Tab is URL-driven so /billing/gstr-export?tab=gstr1 (etc.) deep-links work.
  const initialTab = (searchParams.get("tab") as TabKey) || "summary";
  const [activeTab, setActiveTab] = useState<TabKey>(
    ["summary", "gstr1", "gstr3b", "gstr2b"].includes(initialTab) ? initialTab : "summary"
  );
  const setTab = (t: TabKey) => {
    setActiveTab(t);
    if (t === "summary") searchParams.delete("tab"); else searchParams.set("tab", t);
    setSearchParams(searchParams, { replace: true });
  };

  const fyStart = parseInt(selectedFY.split("-")[0]);
  const monthIdx = MONTHS.indexOf(selectedMonth);

  const { startDate, endDate } = useMemo(() => {
    if (useCustomRange) {
      return { startDate: format(customStart, "yyyy-MM-dd"), endDate: format(customEnd, "yyyy-MM-dd") };
    }
    if (selectedMonth === "All") {
      return { startDate: `${fyStart}-04-01`, endDate: `${fyStart + 1}-03-31` };
    }
    const y = monthIdx < 9 ? fyStart : fyStart + 1;
    const m = monthIdx < 9 ? monthIdx + 4 : monthIdx - 8;
    const lastDay = new Date(y, m, 0).getDate();
    return { startDate: `${y}-${String(m).padStart(2, "0")}-01`, endDate: `${y}-${String(m).padStart(2, "0")}-${lastDay}` };
  }, [selectedMonth, useCustomRange, customStart, customEnd, fyStart, monthIdx]);

  const { data: gstData, isLoading: gstLoading } = useGSTSummary(bizFilter, startDate, endDate);
  const { data: statsData, isLoading: statsLoading } = useGSTStats(selectedFY, bizFilter);
  const isFilingTab = activeTab !== "summary";
  const { data: exportData, isLoading: exportLoading } = useGSTRExport(isFilingTab, bizFilter, startDate, endDate);

  const summaryLoading = gstLoading || statsLoading;

  // Server-side data for Summary tab
  const gstr1Rows = (gstData?.rate_slabs?.outward || []).filter((r: any) => r.taxable > 0);
  const hsnRows = gstData?.hsn_summary || [];
  const gstr3b = gstData?.gstr3b || { output_tax: { cgst: 0, sgst: 0, igst: 0, total: 0 }, input_tax_credit: { cgst: 0, sgst: 0, igst: 0, total: 0 }, net_payable: { cgst: 0, sgst: 0, igst: 0, total: 0 } };
  const totalOutward = statsData?.totals?.outward || 0;
  const totalOutwardTax = gstr3b.output_tax.total;
  const totalITC = gstr3b.input_tax_credit.total;
  const netTax = gstr3b.net_payable.total;

  // Filing-export data
  const exGstr1 = exportData?.gstr1;
  const exGstr3b = exportData?.gstr3b;
  const exGstr2b = exportData?.gstr2b;

  // Monthly tax trend (always visible above tabs)
  const monthlyTax = SHORT.map((m, idx) => {
    const monthly = statsData?.monthly || [];
    const y = idx < 9 ? fyStart : fyStart + 1;
    const mn = idx < 9 ? idx + 4 : idx - 8;
    const found = monthly.find((r: any) => r.month === mn && r.year === y);
    return { month: m, output: (found?.outward_total || 0) / 1000, itc: (found?.inward_total || 0) / 1000, isCurrent: m === SHORT[monthIdx] };
  });

  const handleDownloadCSV = () => {
    const rows = [["Rate", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices"]];
    gstr1Rows.forEach((r: any) => rows.push([`${r.rate}%`, r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2), r.total.toFixed(2), r.invoice_count.toString()]));
    rows.push([]);
    rows.push(["HSN Code", "Taxable", "CGST", "SGST", "IGST", "Total", "Qty"]);
    hsnRows.forEach((h: any) => rows.push([h.hsn_code, h.taxable.toFixed(2), h.cgst.toFixed(2), h.sgst.toFixed(2), h.igst.toFixed(2), h.total.toFixed(2), h.qty.toFixed(3)]));
    const csv = rows.map((r: any) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `gst-summary-${selectedFY}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = (section: "gstr1" | "gstr3b" | "gstr2b") => {
    if (!exportData) return;
    const payload = section === "gstr1" ? exportData.gstr1 : section === "gstr3b" ? exportData.gstr3b : exportData.gstr2b;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${section.toUpperCase()}_${selectedMonth === "All" ? "FY" + selectedFY : selectedMonth}.json`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: `${section.toUpperCase()} JSON exported` });
  };

  const TABS: { key: TabKey; label: string }[] = [
    { key: "summary", label: "Summary" },
    { key: "gstr1", label: "GSTR-1 (Outward)" },
    { key: "gstr3b", label: "GSTR-3B (Tax)" },
    { key: "gstr2b", label: "GSTR-2B (Inward)" },
  ];

  return (
    <div className={cn("space-y-4", isMobile ? "p-4 pb-20" : "p-6 lg:p-8 space-y-5")}>
      <Breadcrumbs items={[{ label: "Reports", href: "/billing/reports" }, { label: "GST" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-2xl bg-gradient-to-br from-chart-2/20 to-chart-2/5 border border-chart-2/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
            <BarChart3 className="w-5 h-5 text-chart-2" />
          </div>
          <div>
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-2xl")}>GST</h1>
            <p className="text-xs text-muted-foreground">{selectedMonth === "All" ? "Full Year" : selectedMonth} · FY {selectedFY}</p>
          </div>
        </div>
        {activeTab === "summary" && (
          <button onClick={handleDownloadCSV} className={cn("premium-btn-primary text-[12px]", isMobile ? "h-9" : "")}><Download className="w-4 h-4" /> Download CSV</button>
        )}
      </motion.div>

      {/* Period + business filters (drive ALL tabs) */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
        className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={() => setUseCustomRange(false)} className={cn("px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all", !useCustomRange ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted/50 border-border/40 text-muted-foreground hover:text-foreground")}>By Month</button>
            <button onClick={() => setUseCustomRange(true)} className={cn("px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all", useCustomRange ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted/50 border-border/40 text-muted-foreground hover:text-foreground")}>Custom Range</button>
          </div>
          {!isMobile && <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-auto text-[13px]"><option value="all">All Businesses</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        </div>
        {useCustomRange ? (
          <DateRangePicker startDate={customStart} endDate={customEnd} onStartChange={setCustomStart} onEndChange={setCustomEnd} fyStart={fyStart} />
        ) : (
          <div className={cn("flex rounded-xl overflow-hidden border border-border", isMobile ? "overflow-x-auto max-w-full -mx-1 px-1" : "flex-shrink-0")}>
            <button onClick={() => setSelectedMonth("All")} className={cn("px-3 py-2 text-[11px] font-medium transition-all whitespace-nowrap", selectedMonth === "All" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/40")}>All</button>
            {MONTHS.map((m) => (
              <button key={m} onClick={() => setSelectedMonth(m)} className={cn("px-2 py-2 text-[11px] font-medium transition-all whitespace-nowrap", selectedMonth === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/40")}>{m.slice(0, 3)}</button>
            ))}
          </div>
        )}
      </motion.div>

      {/* Stats (always visible) */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {/* Monthly tax trend chart (always visible) */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}
        className="elevated-card rounded-2xl p-5">
        <h2 className="text-[13px] font-display font-semibold text-foreground mb-3">Tax Trend (₹k)</h2>
        <div className={cn(isMobile ? "h-[160px]" : "h-[220px]")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyTax} barGap={2}>
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} tickFormatter={isMobile ? (v: string) => v.slice(0, 1) : undefined} />
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
        <div className="flex border-b border-border/50 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn("px-5 py-3 text-[12px] font-semibold border-b-2 -mb-px transition-all whitespace-nowrap", activeTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Summary tab — rate slab + GSTR-3B + HSN */}
        {activeTab === "summary" && (
          <div className="p-5 space-y-5">
            {/* Rate slab breakdown */}
            <div className="space-y-2">
              <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Rate-wise Breakdown (Outward)</h3>
              <div className="overflow-x-auto rounded-lg border border-border/40">
                <table className="table-premium text-[12px]">
                  <thead><tr>{["Rate", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {gstr1Rows.map((r: any, i: number) => (
                      <motion.tr key={r.rate} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.05 }}>
                        <td><span className="premium-badge bg-primary/12 text-primary">{r.rate}%</span></td><td className="font-medium text-foreground">{formatCurrency(r.taxable)}</td><td>{formatCurrency(r.cgst)}</td><td>{formatCurrency(r.sgst)}</td><td>{formatCurrency(r.igst)}</td><td className="font-semibold text-foreground">{formatCurrency(r.total)}</td><td className="text-muted-foreground">{r.invoice_count}</td>
                      </motion.tr>
                    ))}
                    {gstr1Rows.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">{summaryLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</span> : "No data for selected period"}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* GSTR-3B summary table */}
            <div className="space-y-2">
              <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">GSTR-3B Summary</h3>
              <div className="overflow-x-auto rounded-lg border border-border/40">
                <table className="table-premium text-[12px]">
                  <thead><tr><th></th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    <tr><td className="font-medium">Output Tax (Sales)</td><td className="text-right">{formatCurrency(gstr3b.output_tax.cgst)}</td><td className="text-right">{formatCurrency(gstr3b.output_tax.sgst)}</td><td className="text-right">{formatCurrency(gstr3b.output_tax.igst)}</td><td className="text-right font-semibold">{formatCurrency(gstr3b.output_tax.total)}</td></tr>
                    <tr><td className="font-medium text-success">Input Tax Credit</td><td className="text-right text-success">{formatCurrency(gstr3b.input_tax_credit.cgst)}</td><td className="text-right text-success">{formatCurrency(gstr3b.input_tax_credit.sgst)}</td><td className="text-right text-success">{formatCurrency(gstr3b.input_tax_credit.igst)}</td><td className="text-right font-semibold text-success">{formatCurrency(gstr3b.input_tax_credit.total)}</td></tr>
                    <tr className="border-t-2 border-border"><td className="font-bold">Net Tax Payable</td><td className={cn("text-right font-bold", gstr3b.net_payable.cgst >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(gstr3b.net_payable.cgst)}</td><td className={cn("text-right font-bold", gstr3b.net_payable.sgst >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(gstr3b.net_payable.sgst)}</td><td className={cn("text-right font-bold", gstr3b.net_payable.igst >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(gstr3b.net_payable.igst)}</td><td className={cn("text-right font-bold text-lg", netTax >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(netTax))}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* HSN summary */}
            <div className="space-y-2">
              <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">HSN Summary</h3>
              <div className="overflow-x-auto rounded-lg border border-border/40">
                <table className="table-premium text-[12px]">
                  <thead><tr><th>HSN Code</th><th className="text-right">Qty</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th><th className="text-right">Total</th><th className="text-right">Items</th></tr></thead>
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
                    {hsnRows.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">{summaryLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</span> : "No data"}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* GSTR-1 filing tab */}
        {activeTab === "gstr1" && (
          <div className="p-5">
            {exportLoading || !exGstr1 ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading GSTR-1…</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">GSTR-1 — Outward Supplies</h3>
                  <button onClick={() => handleDownloadJSON("gstr1")} className="premium-btn-primary text-[12px] h-9"><FileJson className="w-3.5 h-3.5" /> Download JSON</button>
                </div>
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">B2B — Registered Dealers ({pluralize(exGstr1.b2b?.length || 0, "party", "parties")})</h4>
                  {(exGstr1.b2b || []).length > 0 ? (
                    <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[480px]">
                      <thead><tr><th>GSTIN</th><th className="text-right">Invoices</th><th className="text-right">Total Value</th></tr></thead>
                      <tbody>
                        {exGstr1.b2b.map((party: any) => (
                          <tr key={party.ctin}>
                            <td className="font-mono">{party.ctin}</td>
                            <td className="text-right">{party.inv.length}</td>
                            <td className="text-right font-semibold">{formatCurrency(party.inv.reduce((s: number, i: any) => s + i.val, 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  ) : <p className="text-[12px] text-muted-foreground">No B2B invoices</p>}
                </div>
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">B2CS — Unregistered Intra-State ({pluralize(exGstr1.b2cs?.length || 0, "entry", "entries")})</h4>
                  {(exGstr1.b2cs || []).length > 0 ? (
                    <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[480px]">
                      <thead><tr><th>State</th><th>Rate</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th></tr></thead>
                      <tbody>
                        {exGstr1.b2cs.map((row: any, i: number) => (
                          <tr key={i}><td>{row.pos}</td><td>{row.rt}%</td><td className="text-right">{formatCurrency(row.txval)}</td><td className="text-right">{formatCurrency(row.camt)}</td><td className="text-right">{formatCurrency(row.samt)}</td></tr>
                        ))}
                      </tbody>
                    </table></div>
                  ) : <p className="text-[12px] text-muted-foreground">No B2CS invoices</p>}
                </div>
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">HSN Summary ({pluralize(exGstr1.hsn?.data?.length || 0, "code")})</h4>
                  {(exGstr1.hsn?.data || []).length > 0 ? (
                    <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[480px]">
                      <thead><tr><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th></tr></thead>
                      <tbody>
                        {exGstr1.hsn.data.map((h: any) => (
                          <tr key={h.hsn_sc}><td className="font-mono">{h.hsn_sc}</td><td className="text-right">{h.qty.toFixed(3)}</td><td className="text-right">{formatCurrency(h.txval)}</td><td className="text-right">{formatCurrency(h.camt)}</td><td className="text-right">{formatCurrency(h.samt)}</td><td className="text-right">{formatCurrency(h.iamt)}</td></tr>
                        ))}
                      </tbody>
                    </table></div>
                  ) : <p className="text-[12px] text-muted-foreground">No HSN data</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* GSTR-3B filing tab */}
        {activeTab === "gstr3b" && (
          <div className="p-5">
            {exportLoading || !exGstr3b ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading GSTR-3B…</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">GSTR-3B — Tax Summary</h3>
                  <button onClick={() => handleDownloadJSON("gstr3b")} className="premium-btn-primary text-[12px] h-9"><FileJson className="w-3.5 h-3.5" /> Download JSON</button>
                </div>
                <div className="overflow-x-auto"><table className="table-premium text-[13px] min-w-[420px]">
                  <thead><tr><th></th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th></tr></thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">3.1 — Outward Supplies</td>
                      <td className="text-right">{formatCurrency(exGstr3b.sup_details?.osup_det?.camt || 0)}</td>
                      <td className="text-right">{formatCurrency(exGstr3b.sup_details?.osup_det?.samt || 0)}</td>
                      <td className="text-right">{formatCurrency(exGstr3b.sup_details?.osup_det?.iamt || 0)}</td>
                    </tr>
                    <tr>
                      <td className="font-medium text-success">4 — Eligible ITC</td>
                      <td className="text-right text-success">{formatCurrency(exGstr3b.itc_elg?.itc_avl?.[0]?.camt || 0)}</td>
                      <td className="text-right text-success">{formatCurrency(exGstr3b.itc_elg?.itc_avl?.[0]?.samt || 0)}</td>
                      <td className="text-right text-success">{formatCurrency(exGstr3b.itc_elg?.itc_avl?.[0]?.iamt || 0)}</td>
                    </tr>
                    <tr className="border-t-2 border-border font-bold">
                      <td>6.1 — Net Tax Payable</td>
                      <td className={cn("text-right", (exGstr3b.tax_pmt?.cgst || 0) >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(exGstr3b.tax_pmt?.cgst || 0))}</td>
                      <td className={cn("text-right", (exGstr3b.tax_pmt?.sgst || 0) >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(exGstr3b.tax_pmt?.sgst || 0))}</td>
                      <td className={cn("text-right", (exGstr3b.tax_pmt?.igst || 0) >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(exGstr3b.tax_pmt?.igst || 0))}</td>
                    </tr>
                  </tbody>
                </table></div>
              </div>
            )}
          </div>
        )}

        {/* GSTR-2B filing tab */}
        {activeTab === "gstr2b" && (
          <div className="p-5">
            {exportLoading || !exGstr2b ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading GSTR-2B…</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">GSTR-2B — Inward Supply Matching</h3>
                  <button onClick={() => handleDownloadJSON("gstr2b")} className="premium-btn-primary text-[12px] h-9"><FileJson className="w-3.5 h-3.5" /> Download JSON</button>
                </div>
                <p className="text-[12px] text-muted-foreground">{exGstr2b.inward_invoices?.length || 0} inward invoices for matching</p>
                {(exGstr2b.inward_invoices || []).length > 0 ? (
                  <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[640px]">
                    <thead><tr><th>Invoice #</th><th>Date</th><th>Supplier</th><th>GSTIN</th><th className="text-right">Taxable</th><th className="text-right">Tax</th><th className="text-right">Total</th></tr></thead>
                    <tbody>
                      {exGstr2b.inward_invoices.map((inv: any, i: number) => (
                        <tr key={i}>
                          <td className="font-medium">{inv.invoice_number}</td>
                          <td>{inv.invoice_date}</td>
                          <td>{inv.supplier_name}</td>
                          <td className="font-mono text-[10px]">{inv.supplier_gstin || "-"}</td>
                          <td className="text-right">{formatCurrency(inv.taxable_value)}</td>
                          <td className="text-right">{formatCurrency(inv.tax_amount)}</td>
                          <td className="text-right font-semibold">{formatCurrency(inv.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                ) : <p className="text-[12px] text-muted-foreground">No inward invoices</p>}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
