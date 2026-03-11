import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Search, Plus, Download, Upload, Eye, Pencil, Trash2,
  Building2, TrendingUp, TrendingDown, MapPin, Phone, Mail,
  LayoutGrid, List, Copy, CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/mockData";
import { useBusinesses, useCustomers, useInvoices } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export default function BusinessList() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { items: businesses, remove: removeBusiness, totalCount: bizTotalCount } = useBusinesses();
  const { items: customers } = useCustomers();
  const { items: invoices } = useInvoices();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [copiedGST, setCopiedGST] = useState<string | null>(null);

  const effectiveViewMode = isMobile ? "cards" : viewMode;
  const allStates = [...new Set(businesses.map((b) => b.state_name))].sort();

  const filtered = businesses.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch = !q || b.name.toLowerCase().includes(q) || (b.gst_number && b.gst_number.toLowerCase().includes(q)) || (b.mobile_number && b.mobile_number.includes(q));
    const matchState = stateFilter === "all" || b.state_name === stateFilter;
    return matchSearch && matchState;
  });

  const totalRevenue = businesses.reduce((sum, b) => {
    return sum + invoices.filter((inv) => inv.businessId === b.id && inv.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  }, 0);
  const totalPurchases = businesses.reduce((sum, b) => {
    return sum + invoices.filter((inv) => inv.businessId === b.id && inv.type === "INWARD").reduce((s, i) => s + i.total, 0);
  }, 0);
  const totalCustomers = new Set(businesses.flatMap((b) => customers.filter((c) => (c.businesses || []).some((id: any) => String(id) === String(b.id))).map((c) => c.id))).size;

  const getBizRevenue = (bizId: string) =>
    invoices.filter((inv) => inv.businessId === bizId && inv.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  const getBizPurchases = (bizId: string) =>
    invoices.filter((inv) => inv.businessId === bizId && inv.type === "INWARD").reduce((s, i) => s + i.total, 0);
  const getBizInvoiceCount = (bizId: string) =>
    invoices.filter((inv) => inv.businessId === bizId).length;
  const getBizCustomerCount = (bizId: string) =>
    customers.filter((c) => (c.businesses || []).some((id: any) => String(id) === String(bizId))).length;

  const copyGST = (gst: string) => {
    navigator.clipboard.writeText(gst);
    setCopiedGST(gst);
    setTimeout(() => setCopiedGST(null), 1500);
  };

  return (
    <div className={cn("space-y-5 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-24" : "p-6 lg:p-10 space-y-6")}>
      <Breadcrumbs items={[{ label: "Businesses" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("rounded-2xl bg-gradient-to-br from-chart-4/20 to-chart-4/5 border border-chart-4/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
              <Building2 className="w-5 h-5 text-chart-4" />
            </div>
            <div>
              <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>Businesses</h1>
              <p className="text-xs text-muted-foreground">{bizTotalCount} registered</p>
            </div>
          </div>
          {!isMobile && (
            <div className="flex items-center gap-2.5">
              <Link to="/billing/business/import" className="premium-btn-ghost text-[13px] gap-1.5"><Upload className="w-4 h-4" /> Import</Link>
              <button onClick={() => toast({ title: "CSV Exported", description: `${filtered.length} exported.` })}
                className="premium-btn-ghost text-[13px] gap-1.5"><Download className="w-4 h-4" /> Export</button>
              <Link to="/billing/business/new" className="premium-btn-primary text-[13px]"><Plus className="w-4 h-4" /> Add Business</Link>
            </div>
          )}
        </div>
      </motion.div>

      {/* Stats */}
      <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
        {[
          { label: "Businesses", value: businesses.length.toString(), icon: Building2, color: "text-chart-4" },
          { label: "Revenue", value: formatCurrency(totalRevenue), icon: TrendingUp, color: "text-success" },
          { label: "Purchases", value: formatCurrency(totalPurchases), icon: TrendingDown, color: "text-destructive" },
          { label: "Customers", value: totalCustomers.toString(), icon: MapPin, color: "text-chart-3" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="stat-card rounded-2xl p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
              <p className={cn("font-display font-bold mt-1 tabular-nums", stat.color, isMobile ? "text-lg" : "text-2xl")}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..." className="premium-input pl-10 w-full" />
        </div>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="premium-select text-[13px]">
          <option value="all">All States</option>
          {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {!isMobile && (
          <div className="flex rounded-xl overflow-hidden border border-border/60 text-[13px]">
            {([{ mode: "table" as const, icon: List }, { mode: "cards" as const, icon: LayoutGrid }]).map(({ mode, icon: Icon }) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={cn("px-3 py-1.5 transition-all flex items-center gap-1.5 capitalize font-medium",
                  viewMode === mode ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                )}>
                <Icon className="w-3.5 h-3.5" />{mode}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table View - desktop only */}
      {effectiveViewMode === "table" && !isMobile && (
        <motion.div variants={stagger} initial="hidden" animate="visible" className="elevated-card rounded-2xl overflow-x-auto">
          <table className="table-premium">
            <thead>
              <tr>
                {["#", "Business", "GST Number", "Contact", "Revenue", "Customers", "Invoices", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => {
                const revenue = getBizRevenue(b.id);
                const purchases = getBizPurchases(b.id);
                const invCount = getBizInvoiceCount(b.id);
                const custCount = getBizCustomerCount(b.id);
                return (
                  <motion.tr key={b.id} variants={fadeUp}>
                    <td className="text-muted-foreground text-[13px] w-12">{i + 1}</td>
                    <td className="min-w-[220px]">
                      <Link to={`/billing/business/${b.id}`} className="group">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chart-4/15 to-chart-4/5 border border-chart-4/15 flex items-center justify-center text-chart-4 font-bold text-[14px] shrink-0">
                            {b.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">{b.name}</p>
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-2.5 h-2.5" />{b.state_name}</p>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <button onClick={() => copyGST(b.gst_number)}
                        className="group/gst flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground bg-secondary/30 px-2.5 py-1 rounded-md hover:bg-secondary/50 transition-colors">
                        {b.gst_number}
                        {copiedGST === b.gst_number ? <CheckCircle2 className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 opacity-0 group-hover/gst:opacity-60 transition-opacity" />}
                      </button>
                    </td>
                    <td>
                      <div className="space-y-0.5">
                        <p className="text-[13px] text-foreground font-medium tabular-nums flex items-center gap-1.5"><Phone className="w-3 h-3 text-muted-foreground" />{b.mobile_number}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Mail className="w-3 h-3" />{(b as any).email}</p>
                      </div>
                    </td>
                    <td>
                      <div>
                        <p className="text-[13px] font-bold text-success tabular-nums">{formatCurrency(revenue)}</p>
                        <p className="text-[10px] text-destructive tabular-nums">-{formatCurrency(purchases)}</p>
                      </div>
                    </td>
                    <td><span className="text-[13px] font-semibold text-foreground">{custCount}</span></td>
                    <td><span className="text-[13px] font-semibold text-foreground tabular-nums">{invCount}</span></td>
                    <td>
                      <div className="flex items-center gap-0.5">
                        <Link to={`/billing/business/${b.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"><Eye className="w-4 h-4" /></Link>
                        <Link to={`/billing/business/edit/${b.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-4 h-4" /></Link>
                        <button onClick={() => setDeleteTarget({ id: b.id, name: b.name })} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-16"><Building2 className="w-10 h-10 opacity-30 mx-auto mb-2" /><p className="text-sm text-muted-foreground">No found</p></td></tr>
              )}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* Cards View */}
      {effectiveViewMode === "cards" && (
        <motion.div variants={stagger} initial="hidden" animate="visible" className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4")}>
          {filtered.map((b) => {
            const revenue = getBizRevenue(b.id);
            const invCount = getBizInvoiceCount(b.id);
            const custCount = getBizCustomerCount(b.id);
            return (
              <motion.div key={b.id} variants={fadeUp}>
                <Link to={`/billing/business/${b.id}`}
                  className="block elevated-card rounded-2xl p-4 hover:border-chart-4/30 transition-all group">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chart-4/20 to-chart-4/5 border border-chart-4/15 flex items-center justify-center text-chart-4 font-bold text-sm shrink-0">
                      {b.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground group-hover:text-chart-4 transition-colors truncate">{b.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{b.gst_number}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{b.mobile_number}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{b.state_name}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border/30 text-[12px]">
                    <div><p className="text-[10px] text-muted-foreground uppercase">Revenue</p><p className="font-bold text-success">{formatCurrency(revenue)}</p></div>
                    <div className="text-center"><p className="text-[10px] text-muted-foreground uppercase">Invoices</p><p className="font-bold text-foreground">{invCount}</p></div>
                    <div className="text-right"><p className="text-[10px] text-muted-foreground uppercase">Customers</p><p className="font-bold text-foreground">{custCount}</p></div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Building2 className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">No found</p>
            </div>
          )}
        </motion.div>
      )}

      {/* Mobile FAB */}
      {isMobile && (
        <Link to="/billing/business/new" className="mobile-fab"><Plus className="w-5 h-5" /></Link>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        itemName={deleteTarget?.name || ""}
        itemType="Business"
        onConfirm={() => { removeBusiness(deleteTarget!.id); toast({ title: "Business Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
      />
    </div>
  );
}
