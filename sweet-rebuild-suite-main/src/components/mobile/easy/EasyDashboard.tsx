import { Link } from "react-router-dom";
import { FileText, Plus, Users, Package, Share2, ArrowRight, IndianRupee, Receipt, Upload, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { formatCurrency, formatDate } from "@/utils/mockData";
import { useDashboardStats, useInvoices, mapDjangoInvoice } from "@/hooks/useDataStore";
import { cn } from "@/utils/utils";
import { useMemo } from "react";

interface Props {
  selectedFY: string;
}

export default function EasyDashboard({ selectedFY }: Props) {
  const { data: statsData, isLoading } = useDashboardStats({ fyFilter: selectedFY });
  const totals = statsData?.totals || { outward: 0, inward: 0, count: 0 };

  const recentInvoices = useMemo(
    () => (statsData?.recent_invoices || []).map(mapDjangoInvoice),
    [statsData?.recent_invoices]
  );

  return (
    <div className="p-4 space-y-5 pb-24">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Welcome back</h1>
        <p className="text-xs text-muted-foreground mt-0.5">FY {selectedFY} · Easy Mode</p>
      </div>

      {/* Hero: Create Invoice */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
        <Link
          to="/billing/invoice/add"
          className="block w-full rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-6 glow-primary transition-all active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary-foreground/20 flex items-center justify-center">
              <Plus className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <p className="text-lg font-display font-bold text-primary-foreground">Create Invoice</p>
              <p className="text-sm text-primary-foreground/70">Tap to generate a new bill</p>
            </div>
          </div>
        </Link>
      </motion.div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="stat-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total Sales</p>
            <IndianRupee className="w-3.5 h-3.5 text-chart-1" />
          </div>
          <p className="text-xl font-display font-bold text-chart-1 tracking-tight">{formatCurrency(totals.outward)}</p>
          <p className="text-[10px] text-muted-foreground/70">FY {selectedFY}</p>
        </div>
        <div className="stat-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Invoices</p>
            <Receipt className="w-3.5 h-3.5 text-chart-4" />
          </div>
          <p className="text-xl font-display font-bold text-chart-4 tracking-tight">{totals.count}</p>
          <p className="text-[10px] text-muted-foreground/70">FY {selectedFY}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/billing/customer/new" className="flex items-center gap-3 p-3.5 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center"><Users className="w-4 h-4 text-primary" /></div>
          <div><p className="text-[12px] font-semibold text-foreground">Add Customer</p></div>
        </Link>
        <Link to="/billing/product/new" className="flex items-center gap-3 p-3.5 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center"><Package className="w-4 h-4 text-primary" /></div>
          <div><p className="text-[12px] font-semibold text-foreground">Add Product</p></div>
        </Link>
        <Link to="/billing/invoice/import" className="flex items-center gap-3 p-3.5 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all">
          <div className="w-9 h-9 rounded-xl bg-chart-2/10 border border-chart-2/15 flex items-center justify-center"><Upload className="w-4 h-4 text-chart-2" /></div>
          <div><p className="text-[12px] font-semibold text-foreground">Import Excel</p></div>
        </Link>
        <Link to="/billing/reports" className="flex items-center gap-3 p-3.5 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all">
          <div className="w-9 h-9 rounded-xl bg-chart-3/10 border border-chart-3/15 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-chart-3" /></div>
          <div><p className="text-[12px] font-semibold text-foreground">Reports</p></div>
        </Link>
      </div>

      {/* Recent Invoices */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-display font-semibold text-foreground">Recent Invoices</h2>
          <Link to="/billing/invoice/list" className="text-[11px] text-primary font-semibold flex items-center gap-1">
            All <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="space-y-2.5">
          {recentInvoices.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <FileText className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">{isLoading ? "Loading..." : "No invoices yet"}</p>
              {!isLoading && <p className="text-xs">Create your first invoice above</p>}
            </div>
          )}
          {recentInvoices.map((inv) => (
            <Link key={inv.id} to={`/billing/invoice/${inv.id}`} className="elevated-card rounded-xl p-4 transition-all block">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(inv.invoice_date || "")} · {inv.customerName}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className={cn(
                  "premium-badge text-[9px]",
                  inv.type === "OUTWARD" ? "bg-primary/12 text-primary" : "bg-destructive/12 text-destructive"
                )}>{inv.type}</span>
                <p className="text-[15px] font-display font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
