import { Link } from "react-router-dom";
import { FileText, Plus, Users, Package, Share2, ArrowRight, IndianRupee, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import { invoices, formatCurrency, formatDate } from "@/utils/mockData";
import { shareInvoice } from "@/utils/shareInvoice";
import { cn } from "@/utils/utils";

interface Props {
  selectedFY: string;
}

export default function EasyDashboard({ selectedFY }: Props) {
  const fyInvoices = invoices.filter((inv) => inv.financialYear === selectedFY);
  const totalOutward = fyInvoices.filter((i) => i.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  const outwardCount = fyInvoices.filter((i) => i.type === "OUTWARD").length;
  const recentInvoices = [...fyInvoices]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  return (
    <div className="p-4 space-y-5 pb-24">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Welcome back 👋</h1>
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
          <p className="text-xl font-display font-bold text-chart-1 tracking-tight">{formatCurrency(totalOutward)}</p>
          <p className="text-[10px] text-muted-foreground/70">{outwardCount} invoices</p>
        </div>
        <div className="stat-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Invoices</p>
            <Receipt className="w-3.5 h-3.5 text-chart-4" />
          </div>
          <p className="text-xl font-display font-bold text-chart-4 tracking-tight">{fyInvoices.length}</p>
          <p className="text-[10px] text-muted-foreground/70">FY {selectedFY}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/billing/customer/new"
          className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground">Add Customer</p>
            <p className="text-[10px] text-muted-foreground">New entry</p>
          </div>
        </Link>
        <Link
          to="/billing/product/new"
          className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground">Add Product</p>
            <p className="text-[10px] text-muted-foreground">New item</p>
          </div>
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
              <p className="text-sm font-medium">No invoices yet</p>
              <p className="text-xs">Create your first invoice above</p>
            </div>
          )}
          {recentInvoices.map((inv) => (
            <div key={inv.id} className="elevated-card rounded-xl p-4 transition-all">
              <div className="flex items-start justify-between mb-2">
                <Link to={`/billing/invoice/${inv.id}`} className="flex-1">
                  <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(inv.date)} · {inv.customerName}</p>
                </Link>
                <button
                  onClick={(e) => { e.preventDefault(); shareInvoice(inv); }}
                  className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className={cn(
                  "premium-badge text-[9px]",
                  inv.type === "OUTWARD" ? "bg-primary/12 text-primary" : "bg-destructive/12 text-destructive"
                )}>{inv.type}</span>
                <p className="text-[15px] font-display font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
