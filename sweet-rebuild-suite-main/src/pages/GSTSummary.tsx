import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { formatCurrency } from "@/lib/mockData";
import { useInvoices, useBusinesses } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Download, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, BarChart3, Receipt } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/lib/animations";

interface OutletCtx { selectedFY: string }
const MONTHS = ["April","May","June","July","August","September","October","November","December","January","February","March"];
const SHORT = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

export default function GSTSummary() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const isMobile = useIsMobile();
  const [selectedMonth, setSelectedMonth] = useState("All");
  const [bizFilter, setBizFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"gstr1" | "gstr3b">("gstr1");
  const { items: invoices } = useInvoices();
  const { items: businesses } = useBusinesses();

  const fyStart = parseInt(selectedFY.split("-")[0]);
  const monthIdx = MONTHS.indexOf(selectedMonth);
  const isAll = selectedMonth === "All";
  const year = !isAll && monthIdx < 9 ? fyStart : fyStart + 1;
  const monthNum = !isAll && monthIdx < 9 ? monthIdx + 4 : monthIdx - 8;
  const prefix = !isAll ? `${year}-${String(monthNum).padStart(2, "0")}` : "";

  const filtered = useMemo(() => invoices.filter(
    (inv) => (isAll || inv.date.startsWith(prefix)) && inv.financialYear === selectedFY && (bizFilter === "all" || inv.businessId === bizFilter)
  ), [prefix, isAll, selectedFY, bizFilter, invoices]);

  const outward = filtered.filter((i) => i.type === "OUTWARD");
  const inward = filtered.filter((i) => i.type === "INWARD");
  const totalOutward = outward.reduce((s, i) => s + i.total, 0);
  const totalOutwardTax = outward.reduce((s, i) => s + i.totalTax, 0);
  const totalITC = inward.reduce((s, i) => s + i.totalTax, 0);
  const netTax = totalOutwardTax - totalITC;

  const gstRates = [3, 5, 12, 18, 28];
  const gstr1Rows = gstRates.map((rate) => {
    const rateInvs = outward.filter((inv) => inv.items.some((it) => it.gstRate === rate));
    const taxable = rateInvs.reduce((s, inv) => s + inv.items.filter((it) => it.gstRate === rate).reduce((ss, it) => ss + it.amount, 0), 0);
    const cgst = rateInvs.reduce((s, inv) => s + inv.items.filter((it) => it.gstRate === rate).reduce((ss, it) => ss + it.cgst, 0), 0);
    const sgst = rateInvs.reduce((s, inv) => s + inv.items.filter((it) => it.gstRate === rate).reduce((ss, it) => ss + it.sgst, 0), 0);
    const igst = rateInvs.reduce((s, inv) => s + inv.items.filter((it) => it.gstRate === rate).reduce((ss, it) => ss + it.igst, 0), 0);
    return { rate, taxable, cgst, sgst, igst, total: cgst + sgst + igst, count: rateInvs.length };
  }).filter((r) => r.taxable > 0);

  const monthlyTax = SHORT.map((m, idx) => {
    const y = idx < 9 ? fyStart : fyStart + 1;
    const mn = idx < 9 ? idx + 4 : idx - 8;
    const p = `${y}-${String(mn).padStart(2, "0")}`;
    const mInvs = invoices.filter((i) => i.date.startsWith(p) && i.financialYear === selectedFY && (bizFilter === "all" || i.businessId === bizFilter));
    const out = mInvs.filter((i) => i.type === "OUTWARD").reduce((s, i) => s + i.totalTax, 0);
    const inp = mInvs.filter((i) => i.type === "INWARD").reduce((s, i) => s + i.totalTax, 0);
    return { month: m, output: out / 1000, itc: inp / 1000, isCurrent: m === SHORT[monthIdx] };
  });

  const handleDownload = () => {
    const rows = [["Rate", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices"]];
    gstr1Rows.forEach((r) => rows.push([`${r.rate}%`, r.taxable.toString(), r.cgst.toString(), r.sgst.toString(), r.igst.toString(), r.total.toString(), r.count.toString()]));
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `gst-${selectedMonth}-${selectedFY}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={cn("space-y-5", isMobile ? "p-4 pb-20" : "p-8 space-y-6")}>
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
            <p className="text-xs text-muted-foreground">{isAll ? "Full Year" : `${selectedMonth}`} · FY {selectedFY}</p>
          </div>
        </div>
        <button onClick={handleDownload} className={cn("premium-btn-primary text-[12px]", isMobile ? "h-9" : "")}><Download className="w-4 h-4" /> Download</button>
      </motion.div>

      {/* Month filters */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
        className="flex items-center gap-3 flex-wrap">
        <div className={cn("flex rounded-xl overflow-hidden border border-border", isMobile ? "overflow-x-auto max-w-full -mx-1 px-1" : "flex-shrink-0")}>
          <button onClick={() => setSelectedMonth("All")} className={cn("px-3 py-2 text-[11px] font-medium transition-all whitespace-nowrap", selectedMonth === "All" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/40")}>All</button>
          {MONTHS.map((m) => (
            <button key={m} onClick={() => setSelectedMonth(m)} className={cn("px-2 py-2 text-[11px] font-medium transition-all whitespace-nowrap", selectedMonth === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/40")}>{m.slice(0, 3)}</button>
          ))}
        </div>
        {!isMobile && <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-auto text-[13px]"><option value="all">All Businesses</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
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
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
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
          {(["gstr1", "gstr3b"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={cn("px-5 py-3 text-[12px] font-semibold border-b-2 -mb-px transition-all", activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
              {tab === "gstr1" ? "GSTR-1" : "GSTR-3B"}
            </button>
          ))}
        </div>

        {activeTab === "gstr1" ? (
          isMobile ? (
            <div className="divide-y divide-border/30">
              {gstr1Rows.map((r, i) => (
                <motion.div key={r.rate} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="premium-badge bg-primary/12 text-primary">{r.rate}%</span>
                    <span className="text-[12px] text-muted-foreground">{r.count} inv</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <div><p className="text-[10px] text-muted-foreground">Taxable</p><p className="font-semibold text-foreground">{formatCurrency(r.taxable)}</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Total Tax</p><p className="font-semibold text-foreground">{formatCurrency(r.total)}</p></div>
                  </div>
                </motion.div>
              ))}
              {gstr1Rows.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">No data</div>}
            </div>
          ) : (
            <table className="table-premium">
              <thead><tr>{["Rate", "Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {gstr1Rows.map((r, i) => (
                  <motion.tr key={r.rate} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.05 }}>
                    <td><span className="premium-badge bg-primary/12 text-primary">{r.rate}%</span></td><td className="font-medium text-foreground">{formatCurrency(r.taxable)}</td><td>{formatCurrency(r.cgst)}</td><td>{formatCurrency(r.sgst)}</td><td>{formatCurrency(r.igst)}</td><td className="font-semibold text-foreground">{formatCurrency(r.total)}</td><td className="text-muted-foreground">{r.count}</td>
                  </motion.tr>
                ))}
                {gstr1Rows.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No data</td></tr>}
              </tbody>
            </table>
          )
        ) : (
          <div className="p-5 space-y-4">
            <motion.div variants={stagger} initial="hidden" animate="visible"
              className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3")}>
              {[
                { label: "Outward taxable", value: formatCurrency(totalOutward), color: "text-chart-1" },
                { label: "Eligible ITC", value: formatCurrency(totalITC), color: "text-success" },
                { label: "Payment of tax", value: formatCurrency(Math.max(netTax, 0)), color: "text-destructive" },
              ].map((item) => (
                <motion.div key={item.label} variants={fadeUp} className="glass-surface rounded-xl p-4">
                  <p className="text-[11px] text-muted-foreground mb-1">{item.label}</p>
                  <p className={cn("text-lg font-display font-bold", item.color)}>{item.value}</p>
                </motion.div>
              ))}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="glass-surface rounded-xl p-4 flex items-center justify-between">
              <div><p className="text-[11px] text-muted-foreground">Net Tax</p><p className={cn("text-xl font-display font-bold mt-1", netTax >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(netTax))}</p></div>
              <span className={cn("premium-badge", netTax >= 0 ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>{netTax >= 0 ? "Payable" : "Refundable"}</span>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
