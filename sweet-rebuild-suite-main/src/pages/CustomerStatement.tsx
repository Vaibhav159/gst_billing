import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { invoices, formatCurrency, formatDate } from "@/utils/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import { ArrowLeft, Printer, Calendar, FileText, TrendingUp, TrendingDown, Scale, Hash, MapPin, Building2, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useInvoices, useCustomers, useBusinesses } from "@/hooks/useDataStore";

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } } };
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };

export default function CustomerStatement() {
  const { id } = useParams<{ id: string }>();
  const { items: invoices } = useInvoices();
  const { items: customers } = useCustomers();
  const { items: businesses } = useBusinesses();
  const isMobile = useIsMobile();
  const customer = customers.find((c) => c.id === id);
  const [startDate, setStartDate] = useState("2024-04-01");
  const [endDate, setEndDate] = useState("2025-03-31");
  const [bizFilter, setBizFilter] = useState("all");

  if (!customer) return <div className="p-8 text-muted-foreground">Customer not found.</div>;

  const filtered = invoices.filter((inv) => {
    const d = new Date(inv.invoice_date || "");
    return inv.customerId === id && d >= new Date(startDate) && d <= new Date(endDate) && (bizFilter === "all" || inv.businessId === bizFilter);
  });

  const outward = filtered.filter((i) => i.type === "OUTWARD");
  const inward = filtered.filter((i) => i.type === "INWARD");
  const totalOutward = outward.reduce((s, i) => s + i.total, 0);
  const totalInward = inward.reduce((s, i) => s + i.total, 0);
  const netAmount = totalOutward - totalInward;

  let runningBalance = 0;
  const sortedFiltered = [...filtered].sort((a, b) => new Date(a.invoice_date || "").getTime() - new Date(b.invoice_date || "").getTime());

  return (
    <div className={cn("space-y-5 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-20" : "p-6 lg:p-10 space-y-7")}>
      <Breadcrumbs items={[{ label: "Customers", href: "/billing/customer/list" }, { label: customer.name, href: `/billing/customer/${id}` }, { label: "Statement" }]} />

      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-primary font-display font-bold", isMobile ? "w-10 h-10 text-xs" : "w-12 h-12 text-sm")}>
            {customer.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-3xl")}>Statement</h1>
            <p className="text-xs text-muted-foreground">{customer.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/billing/customer/${id}`} className="premium-btn-ghost text-[12px] h-8"><ArrowLeft className="w-3.5 h-3.5" /> Back</Link>
          <button onClick={() => window.print()} className="premium-btn-primary text-[12px] h-8"><Printer className="w-3.5 h-3.5" /> Print</button>
        </div>
      </div>

      {/* Filters */}
      <div className="elevated-card rounded-2xl p-4">
        <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-3")}>
          <div className="space-y-1"><label className="text-[10px] text-muted-foreground uppercase font-semibold">From</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="premium-input w-full text-[12px]" /></div>
          <div className="space-y-1"><label className="text-[10px] text-muted-foreground uppercase font-semibold">To</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="premium-input w-full text-[12px]" /></div>
          {!isMobile && <div className="space-y-1"><label className="text-[10px] text-muted-foreground uppercase font-semibold">Business</label><select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-full text-[12px]"><option value="all">All</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Invoices", value: filtered.length.toString(), color: "text-chart-1" },
          { label: "Outward", value: formatCurrency(totalOutward), color: "text-success" },
          { label: "Inward", value: formatCurrency(totalInward), color: "text-warning" },
          { label: "Net", value: formatCurrency(netAmount), color: netAmount >= 0 ? "text-success" : "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="elevated-card rounded-2xl p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase">{s.label}</p>
            <p className={cn("font-display font-bold tabular-nums mt-1", s.color, isMobile ? "text-sm" : "text-2xl")}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Transactions */}
      <div className="elevated-card rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border/30">
          <h2 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Transactions ({filtered.length})</h2>
        </div>
        {isMobile ? (
          <div className="divide-y divide-border/30">
            {sortedFiltered.map((inv, idx) => {
              runningBalance += inv.type === "OUTWARD" ? inv.total : -inv.total;
              return (
                <Link key={inv.id} to={`/billing/invoice/${inv.id}`} className="flex items-center gap-3 p-4 hover:bg-secondary/20">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(inv.invoice_date || "")}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</p>
                    <span className={cn("text-[10px] font-bold", inv.type === "OUTWARD" ? "text-success" : "text-warning")}>{inv.type}</span>
                  </div>
                </Link>
              );
            })}
            {filtered.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No invoices in this period</div>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-premium w-full">
              <thead><tr>{["#", "Invoice", "Date", "Business", "Type", "Total", "Balance"].map((h) => <th key={h} className="text-[11px]">{h}</th>)}</tr></thead>
              <tbody>
                {(() => { let rb = 0; return sortedFiltered.map((inv, idx) => {
                  rb += inv.type === "OUTWARD" ? inv.total : -inv.total;
                  return (
                    <tr key={inv.id}>
                      <td className="text-muted-foreground text-[12px]">{idx + 1}</td>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">{inv.invoiceNumber}</Link></td>
                      <td className="text-muted-foreground text-[13px] tabular-nums">{formatDate(inv.invoice_date || "")}</td>
                      <td className="text-[13px]">{inv.businessName}</td>
                      <td><span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{inv.type}</span></td>
                      <td className="tabular-nums text-[13px] font-semibold">{formatCurrency(inv.total)}</td>
                      <td className={cn("tabular-nums text-[13px] font-bold", rb >= 0 ? "text-success" : "text-destructive")}>{formatCurrency(Math.abs(rb))} <span className="text-[10px] font-normal text-muted-foreground">{rb >= 0 ? "Dr" : "Cr"}</span></td>
                    </tr>
                  );
                }); })()}
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No invoices</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
