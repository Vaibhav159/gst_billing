import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search, Plus, Download, Upload, Eye, Pencil, Trash2,
  Building2, Users, TrendingUp, Filter, ChevronDown, Phone, MapPin, Star,
  GitMerge, CheckCircle2, ArrowRight, SlidersHorizontal,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCurrency } from "@/lib/mockData";
import { useCustomers, useBusinesses, useInvoices } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileFilterSheet from "@/components/mobile/MobileFilterSheet";
import { stagger, fadeUp } from "@/lib/animations";

export default function CustomerList() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { items: customers, remove: removeCustomer } = useCustomers();
  const { items: businesses } = useBusinesses();
  const { items: invoices } = useInvoices();
  const [search, setSearch] = useState("");
  const [bizFilter, setBizFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // Collect unique tags
  const allTags = ["VIP", "Wholesale", "Retail"]; // Hardcoded for now since tags are removed from DRF
  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    const cAny = c as any;
    const matchSearch = !q || c.name.toLowerCase().includes(q) || (c.gst_number && c.gst_number.toLowerCase().includes(q)) || (c.mobile_number && c.mobile_number.includes(q)) || (cAny.email && cAny.email.toLowerCase().includes(q));
    const matchBiz = bizFilter === "all" || (c.businesses && c.businesses.includes ? c.businesses.includes(bizFilter) : false);
    const matchTag = tagFilter === "all" || (cAny.tags && cAny.tags.includes(tagFilter));
    return matchSearch && matchBiz && matchTag;
  });

  // Stats
  const totalCustomers = customers.length;
  const vipCustomers = customers.filter((c) => (c as any).tags?.includes("VIP")).length;
  const totalRevenue = customers.reduce((sum, c) => {
    return sum + invoices.filter((inv) => inv.customerId === c.id && inv.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  }, 0);
  const statesCount = new Set(customers.map((c) => c.state_name)).size;

  // Get customer revenue for table
  const getCustomerRevenue = (customerId: string) =>
    invoices.filter((inv) => inv.customerId === customerId && inv.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  const getCustomerInvoiceCount = (customerId: string) =>
    invoices.filter((inv) => inv.customerId === customerId).length;

  // ─── MOBILE VIEW ───
  if (isMobile) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Customers</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{totalCustomers}</p>
        </div>

        {/* Stats scroll */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x scrollbar-hide">
          {[
            { label: "Total", value: totalCustomers.toString(), color: "text-chart-1" },
            { label: "VIP", value: vipCustomers.toString(), color: "text-chart-4" },
            { label: "Revenue", value: formatCurrency(totalRevenue), color: "text-success" },
            { label: "States", value: statesCount.toString(), color: "text-chart-3" },
          ].map((s) => (
            <div key={s.label} className="min-w-[110px] snap-center stat-card rounded-xl p-3 shrink-0">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className={cn("text-lg font-display font-bold mt-1", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search + Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..." className="premium-input pl-10 h-11" />
          </div>
          <button onClick={() => setFilterOpen(true)}
            className={cn("w-11 h-11 rounded-xl border flex items-center justify-center transition-all",
              (bizFilter !== "all" || tagFilter !== "all") ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-input/50 text-muted-foreground"
            )}>
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Customer Cards */}
        <div className="space-y-2.5">
          {filtered.map((c) => {
            const revenue = getCustomerRevenue(c.id);
            const invCount = getCustomerInvoiceCount(c.id);
            return (
              <Link key={c.id} to={`/billing/customer/${c.id}`}
                className="block elevated-card rounded-xl p-4 hover:border-primary/30 transition-all">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/15 flex items-center justify-center text-primary font-bold text-[11px] shrink-0">
                    {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground truncate">{c.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {((c as any).tags || []).map((t: string) => (
                        <span key={t} className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider",
                          t === "VIP" ? "bg-chart-4/12 text-chart-4" :
                          t === "Wholesale" ? "bg-chart-3/12 text-chart-3" :
                          t === "Retail" ? "bg-success/12 text-success" :
                          "bg-primary/10 text-primary"
                        )}>{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5 text-[11px] text-muted-foreground mb-3">
                  <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{c.mobile_number}</p>
                  <p className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{c.state_name}</p>
                </div>
                <div className="flex items-center justify-between pt-2.5 border-t border-border/30">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Revenue</p>
                    <p className="text-[13px] font-bold text-foreground tabular-nums">{formatCurrency(revenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-muted-foreground uppercase">Invoices</p>
                    <p className="text-[13px] font-bold text-foreground">{invCount}</p>
                  </div>
                </div>
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">No found</p>
            </div>
          )}
        </div>

        {/* FAB */}
        <Link to="/billing/customer/new" className="mobile-fab">
          <Plus className="w-6 h-6" />
        </Link>

        <MobileFilterSheet
          open={filterOpen}
          onOpenChange={setFilterOpen}
          onClear={() => { setBizFilter("all"); setTagFilter("all"); }}
          filters={[
            {
              label: "Business", value: bizFilter,
              options: [{ label: "All Businesses", value: "all" }, ...businesses.map((b) => ({ label: b.name, value: b.id }))],
              onChange: setBizFilter,
            },
            {
              label: "Tag", value: tagFilter,
              options: [{ label: "All Tags", value: "all" }, ...allTags.map((t) => ({ label: t, value: t }))],
              onChange: setTagFilter,
            },
          ]}
        />

        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemName={deleteTarget?.name || ""}
          itemType="Customer"
          onConfirm={() => { removeCustomer(deleteTarget!.id); toast({ title: "Customer Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
        />
      </div>
    );
  }

  // ─── DESKTOP VIEW (unchanged) ───
  return (
    <div className="p-6 lg:p-10 space-y-6 max-w-[1440px] mx-auto">
      <Breadcrumbs items={[{ label: "Customers" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Customers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{totalCustomers} registered</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => { setShowMergeModal(true); setMergeSource(null); setMergeTarget(null); setMergeSearch(""); }}
            className="premium-btn-outline text-[13px] gap-1.5 border-chart-4/30 text-chart-4"><GitMerge className="w-4 h-4" /> Merge</button>
          <Link to="/billing/customer/import" className="premium-btn-ghost text-[13px] gap-1.5"><Upload className="w-4 h-4" /> Import</Link>
          <button onClick={() => toast({ title: "CSV Exported", description: `${filtered.length} exported.` })} className="premium-btn-ghost text-[13px] gap-1.5"><Download className="w-4 h-4" /> Export</button>
          <Link to="/billing/customer/new" className="premium-btn-primary text-[13px]"><Plus className="w-4 h-4" /> Add Customer</Link>
        </div>
      </motion.div>

      {/* Stats Row */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Customers", value: totalCustomers.toString(), icon: Users, color: "text-chart-1" },
          { label: "VIP Customers", value: vipCustomers.toString(), icon: Star, color: "text-chart-4" },
          { label: "Total Revenue", value: formatCurrency(totalRevenue), icon: TrendingUp, color: "text-success" },
          { label: "States Covered", value: statesCount.toString(), icon: MapPin, color: "text-chart-3" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <motion.div key={stat.label} variants={fadeUp} className="stat-card rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                  <p className={cn("text-2xl font-display font-bold mt-1.5 tracking-tight", stat.color)}>{stat.value}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-secondary/60 flex items-center justify-center">
                  <Icon className={cn("w-[18px] h-[18px]", stat.color)} />
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Search & Filters */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
        className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, GST, phone, email..." className="premium-input pl-11" />
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select pl-9 pr-8 text-[13px]">
              <option value="all">All Businesses</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="premium-select pl-9 pr-8 text-[13px]">
              <option value="all">All Tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden border border-border/60 text-[13px] ml-auto lg:ml-0">
            {(["table", "cards"] as const).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                className={cn("px-3.5 py-1.5 transition-all capitalize font-medium",
                  viewMode === m ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                )}>{m}</button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Results count */}
      {(search || bizFilter !== "all" || tagFilter !== "all") && (
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {totalCustomers}
          {search && <> matching "<span className="text-primary">{search}</span>"</>}
        </p>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <motion.div variants={stagger} initial="hidden" animate="visible" className="elevated-card rounded-2xl overflow-x-auto">
          <table className="table-premium">
            <thead>
              <tr>
                {["#", "Customer", "GST Number", "PAN", "Contact", "Revenue", "Business", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const revenue = getCustomerRevenue(c.id);
                const invCount = getCustomerInvoiceCount(c.id);
                return (
                  <motion.tr key={c.id} variants={fadeUp}>
                    <td className="text-muted-foreground text-[13px] w-12">{i + 1}</td>
                    <td className="min-w-[200px]">
                      <Link to={`/billing/customer/${c.id}`} className="group">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/15 flex items-center justify-center text-primary font-bold text-[13px] shrink-0">
                            {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">{c.name}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              {((c as any).tags || []).map((t: string) => (
                                <span key={t} className={cn(
                                  "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                                  t === "VIP" ? "bg-chart-4/12 text-chart-4" :
                                  t === "Wholesale" ? "bg-chart-3/12 text-chart-3" :
                                  t === "Retail" ? "bg-success/12 text-success" :
                                  "bg-primary/10 text-primary"
                                )}>{t}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td><code className="text-[11px] text-muted-foreground bg-secondary/30 px-2 py-0.5 rounded-md">{c.gst_number}</code></td>
                    <td><code className="text-[11px] text-muted-foreground bg-secondary/30 px-2 py-0.5 rounded-md">{c.pan_number}</code></td>
                    <td>
                      <div className="space-y-0.5">
                        <p className="text-[13px] text-foreground font-medium tabular-nums">{c.mobile_number}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{c.state_name}</p>
                      </div>
                    </td>
                    <td>
                      <div>
                        <p className="text-[13px] font-bold text-foreground tabular-nums">{formatCurrency(revenue)}</p>
                        <p className="text-[10px] text-muted-foreground">{invCount} invoices</p>
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {(c.businesses || []).map((bid: string | number) => {
                          const biz = businesses.find((b) => String(b.id) === String(bid));
                          return biz ? (
                            <Link key={bid} to={`/billing/business/${bid}`}
                              className="premium-badge bg-secondary/50 text-muted-foreground text-[10px] gap-1 hover:bg-secondary/80 hover:text-foreground transition-colors">
                              <Building2 className="w-2.5 h-2.5" />{biz.name.split(" ")[0]}
                            </Link>
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-0.5">
                        <Link to={`/billing/customer/${c.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors" title="View"><Eye className="w-4 h-4" /></Link>
                        <Link to={`/billing/customer/edit/${c.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground hover:text-primary transition-colors" title="Edit"><Pencil className="w-4 h-4" /></Link>
                        <button onClick={() => setDeleteTarget({ id: c.id, name: c.name })} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Users className="w-10 h-10 opacity-30" />
                      <p className="text-sm font-medium">No found</p>
                      <p className="text-xs">Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* Cards View */}
      {viewMode === "cards" && (
        <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const revenue = getCustomerRevenue(c.id);
            const invCount = getCustomerInvoiceCount(c.id);
            return (
              <motion.div key={c.id} variants={fadeUp}>
                <Link to={`/billing/customer/${c.id}`}
                  className="block elevated-card rounded-2xl p-5 hover:border-primary/30 transition-all duration-300 group">
                  <div className="flex items-start gap-3.5 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/15 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors truncate">{c.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {((c as any).tags || []).map((t: string) => (
                          <span key={t} className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                            t === "VIP" ? "bg-chart-4/12 text-chart-4" :
                            t === "Wholesale" ? "bg-chart-3/12 text-chart-3" :
                            t === "Retail" ? "bg-success/12 text-success" :
                            "bg-primary/10 text-primary"
                          )}>{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 text-[12px] mb-4">
                    <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3 h-3" /><span>{c.mobile_number}</span></div>
                    <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-3 h-3" /><span>{c.state_name}</span></div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border/30">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue</p>
                      <p className="text-[14px] font-bold text-foreground tabular-nums">{formatCurrency(revenue)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Invoices</p>
                      <p className="text-[14px] font-bold text-foreground">{invCount}</p>
                    </div>
                    <div className="flex gap-1">
                      {(c.businesses || []).map((bid: string | number) => {
                        const biz = businesses.find((b) => String(b.id) === String(bid));
                        return biz ? (
                          <span key={bid} className="w-6 h-6 rounded-md bg-secondary/50 flex items-center justify-center text-[9px] font-bold text-muted-foreground" title={biz.name}>
                            {biz.name[0]}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">No found</p>
            </div>
          )}
        </motion.div>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        itemName={deleteTarget?.name || ""}
        itemType="Customer"
        onConfirm={() => { removeCustomer(deleteTarget!.id); toast({ title: "Customer Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
      />

      {/* ── Merge Customers Modal ── */}
      <AnimatePresence>
        {showMergeModal && (() => {
          const mergeFiltered = customers.filter((c) => {
            const q = mergeSearch.toLowerCase();
            return !q || c.name.toLowerCase().includes(q) || (c.gst_number && c.gst_number.toLowerCase().includes(q)) || (c.mobile_number && c.mobile_number.includes(q));
          });
          const sourceCustomer = mergeSource ? customers.find((c) => c.id === mergeSource) : null;
          const targetCustomer = mergeTarget ? customers.find((c) => c.id === mergeTarget) : null;

          const handleMergeSelect = (id: string) => {
            if (!mergeSource) { setMergeSource(id); }
            else if (mergeSource === id) { setMergeSource(null); }
            else if (!mergeTarget) { setMergeTarget(id); }
            else if (mergeTarget === id) { setMergeTarget(null); }
            else { setMergeTarget(id); }
          };

          const handleMerge = () => {
            if (!sourceCustomer || !targetCustomer) return;
            toast({
              title: "Customers Merged",
              description: `${sourceCustomer.name} merged into ${targetCustomer.name}. All invoices transferred.`,
            });
            setShowMergeModal(false);
            navigate(`/billing/customer/${mergeTarget}`);
          };

          return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowMergeModal(false)}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ duration: 0.25 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-panel rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
              >
                {/* Header */}
                <div className="p-6 border-b border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-chart-4/10 flex items-center justify-center">
                      <GitMerge className="w-5 h-5 text-chart-4" />
                    </div>
                    <div>
                      <h2 className="text-lg font-display font-bold text-foreground">Merge Customers</h2>
                      <p className="text-[12px] text-muted-foreground mt-0.5">
                        {!mergeSource ? "Select the source customer (will be removed)" :
                         !mergeTarget ? "Now select the target customer (will be kept)" :
                         "Review and confirm merge"}
                      </p>
                    </div>
                  </div>
                  <div className="relative mt-4">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="text" value={mergeSearch} onChange={(e) => setMergeSearch(e.target.value)}
                      placeholder="Search by name, GST, or phone..."
                      className="premium-input pl-10" autoFocus />
                  </div>
                  <div className="flex items-center gap-2 mt-3 text-[11px]">
                    <span className={cn("px-2 py-1 rounded-lg border", mergeSource ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-secondary/30 border-border/40 text-muted-foreground")}>
                      ① Source: {sourceCustomer?.name || "Select..."}
                    </span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className={cn("px-2 py-1 rounded-lg border", mergeTarget ? "bg-success/10 border-success/20 text-success" : "bg-secondary/30 border-border/40 text-muted-foreground")}>
                      ② Target: {targetCustomer?.name || "Select..."}
                    </span>
                  </div>
                </div>

                {/* Customer List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {mergeFiltered.map((c) => {
                    const isSource = mergeSource === c.id;
                    const isTarget = mergeTarget === c.id;
                    const invCount = invoices.filter((inv) => inv.customerId === c.id).length;
                    const revenue = getCustomerRevenue(c.id);
                    return (
                      <button key={c.id} type="button"
                        onClick={() => handleMergeSelect(c.id)}
                        className={cn(
                          "w-full flex items-center gap-3.5 p-3.5 rounded-xl transition-all text-left",
                          isSource ? "border-2 border-destructive/40 bg-destructive/5" :
                          isTarget ? "border-2 border-success/40 bg-success/5" :
                          "border border-border/30 hover:bg-secondary/20 hover:border-border/60"
                        )}>
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0",
                          isSource ? "bg-destructive/15 text-destructive border border-destructive/30" :
                          isTarget ? "bg-success/15 text-success border border-success/30" :
                          "bg-primary/10 text-primary border border-primary/15"
                        )}>
                          {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-foreground truncate">{c.name}</p>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                            <span>{c.mobile_number}</span><span>·</span><span>{c.state_name}</span><span>·</span><span>{invCount} inv</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {((c as any).tags || []).map((t: string) => (
                              <span key={t} className={cn(
                                "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                                t === "VIP" ? "bg-chart-4/12 text-chart-4" :
                                t === "Wholesale" ? "bg-chart-3/12 text-chart-3" :
                                "bg-primary/10 text-primary"
                              )}>{t}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[12px] font-bold text-foreground tabular-nums">{formatCurrency(revenue)}</p>
                          {(isSource || isTarget) && (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-1">
                              <CheckCircle2 className={cn("w-5 h-5 ml-auto", isSource ? "text-destructive" : "text-success")} />
                            </motion.div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {mergeFiltered.length === 0 && (
                    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                      <Users className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No found</p>
                    </div>
                  )}
                </div>

                {/* Merge Preview & Action */}
                <div className="p-5 border-t border-border/30 space-y-3">
                  {mergeSource && mergeTarget && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-chart-4/5 border border-chart-4/20 text-[12px]">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="font-semibold text-destructive">{sourceCustomer?.name}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-chart-4" />
                        <span className="font-semibold text-success">{targetCustomer?.name}</span>
                      </div>
                      <span className="text-muted-foreground">All invoices will be transferred</span>
                    </motion.div>
                  )}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowMergeModal(false)}
                      className="premium-btn-ghost flex-1 h-10 text-[13px]">Cancel</button>
                    <button type="button" onClick={handleMerge} disabled={!mergeSource || !mergeTarget}
                      className={cn(
                        "flex-1 h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all",
                        mergeSource && mergeTarget
                          ? "bg-chart-4 text-primary-foreground hover:brightness-110"
                          : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
                      )}>
                      <GitMerge className="w-4 h-4" /> Merge Customers
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
