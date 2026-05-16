import { useState, useMemo } from "react";
import { toCSV, downloadCSV } from "@/utils/csv";
import { Link, useOutletContext } from "react-router-dom";
import {
  Search, Plus, Download, Upload, Eye, Pencil, Trash2,
  Package, TrendingUp, Hash, Filter, LayoutGrid, List, Receipt,
  Copy, CheckCircle2, BarChart3, SlidersHorizontal, Loader2,
  ArrowUpDown, AlertTriangle,
} from "lucide-react";
import { motion } from "framer-motion";
import { formatCurrency, formatCompactCurrency } from "@/utils/mockData";
import { useProducts, useInvoices } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn, pluralize } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import MobileFilterSheet from "@/components/mobile/MobileFilterSheet";
import { stagger, fadeUp } from "@/utils/animations";

export default function ProductList() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { selectedFY } = useOutletContext<{ selectedFY: string }>();
  const { items: products, remove: removeProduct, totalCount: productTotalCount, hasMore, loadMore, isLoadingMore } = useProducts(selectedFY);
  const { items: invoices } = useInvoices({ fyFilter: selectedFY }, false);
  const [search, setSearch] = useState("");
  const [gstFilter, setGstFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [copiedHSN, setCopiedHSN] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "revenue" | "usage" | "gst" | "qty">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const gstRates = [...new Set(products.map((p) => p.gstRate))].sort((a, b) => a - b);

  // Detect duplicate product names (case-insensitive). Returns both the set
  // of names involved (for display) and a count of distinct collision groups
  // (so "3 names colliding on one casing" = 1 duplicate, not 3 halves of
  // anything — the previous Math.floor(size / 2) miscounted 3-way collisions
  // as 1.5 → 1).
  const { duplicateNames, duplicateGroupCount } = useMemo(() => {
    const nameMap = new Map<string, string[]>();
    products.forEach((p) => {
      const lower = p.name.toLowerCase();
      if (!nameMap.has(lower)) nameMap.set(lower, []);
      nameMap.get(lower)!.push(p.name);
    });
    const dupes = new Set<string>();
    let groups = 0;
    nameMap.forEach((names) => {
      if (names.length > 1) {
        groups += 1;
        names.forEach((n) => dupes.add(n));
      }
    });
    return { duplicateNames: dupes, duplicateGroupCount: groups };
  }, [products]);

  const getProductRevenue = (p: any) => Number(p.total_revenue) || 0;
  const getProductUsageCount = (p: any) => p.usage_count || 0;
  const getProductQtySold = (p: any) => Number(p.qty_sold) || 0;

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.hsn.includes(q) || p.description.toLowerCase().includes(q);
    const matchGST = gstFilter === "all" || p.gstRate === Number(gstFilter);
    return matchSearch && matchGST;
  }).sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "name") return dir * a.name.localeCompare(b.name);
    if (sortBy === "revenue") return dir * (getProductRevenue(a) - getProductRevenue(b));
    if (sortBy === "usage") return dir * (getProductUsageCount(a) - getProductUsageCount(b));
    if (sortBy === "qty") return dir * (getProductQtySold(a) - getProductQtySold(b));
    if (sortBy === "gst") return dir * (a.gstRate - b.gstRate);
    return 0;
  });

  const totalProducts = productTotalCount;
  const totalRevenue = products.reduce((sum, p) => sum + getProductRevenue(p), 0);
  const totalUsage = products.reduce((count, p) => count + getProductUsageCount(p), 0);
  const avgGSTRate = products.length > 0 ? (products.reduce((s, p) => s + p.gstRate, 0) / products.length).toFixed(1) : "0";

  const copyHSN = (hsn: string) => {
    navigator.clipboard.writeText(hsn);
    setCopiedHSN(hsn);
    setTimeout(() => setCopiedHSN(null), 1500);
  };

  const handleExport = () => {
    const headers = ["Name", "HSN Code", "GST Rate (%)", "Description", "Revenue", "Times Used"];
    const rows = filtered.map((p) => [
      p.name, p.hsn, p.gstRate, p.description,
      getProductRevenue(p), getProductUsageCount(p),
    ]);
    // downloadCSV creates + cleans up its own blob URL — the previous
    // URL.revokeObjectURL(url) line referenced an undefined `url` and threw
    // ReferenceError on Export click.
    downloadCSV(toCSV([headers, ...rows]), "products-export.csv");
    toast({ title: "CSV Exported", description: `${filtered.length} products exported.` });
  };

  // ─── MOBILE VIEW ───
  if (isMobile) {
    return (
      <div className="p-4 pb-40 space-y-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Products</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{pluralize(totalProducts, "item")} in catalog</p>
        </div>

        {/* Stats scroll */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x scrollbar-hide">
          {[
            { label: "Products", value: totalProducts.toString(), color: "text-chart-3" },
            { label: "Revenue", value: formatCurrency(totalRevenue), color: "text-success" },
            { label: "Used", value: totalUsage.toString(), color: "text-chart-1" },
            { label: "Avg GST", value: `${avgGSTRate}%`, color: "text-chart-4" },
          ].map((s) => (
            <div key={s.label} className="min-w-[120px] snap-center stat-card rounded-xl p-3 shrink-0">
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className={cn("text-lg font-display font-bold mt-1", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Search + Filter button */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..." className="premium-input pl-10 h-11" />
          </div>
          <button onClick={() => setFilterOpen(true)}
            className={cn("w-11 h-11 rounded-xl border flex items-center justify-center transition-all",
              gstFilter !== "all" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-input/50 text-muted-foreground"
            )}>
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {filtered.map((p) => {
            const revenue = getProductRevenue(p);
            const qtySold = getProductQtySold(p);
            return (
              <Link key={p.id} to={`/billing/product/${p.id}`}
                className="block elevated-card rounded-xl p-4 hover:border-chart-3/30 transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/15 flex items-center justify-center text-chart-3 font-bold text-[11px] shrink-0">
                      {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">HSN: {p.hsn}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "px-2 py-0.5 rounded-lg text-[10px] font-bold",
                    p.gstRate <= 5 ? "bg-success/10 text-success" :
                    p.gstRate <= 12 ? "bg-chart-1/10 text-chart-1" :
                    "bg-chart-4/10 text-chart-4"
                  )}>{p.gstRate}%</span>
                </div>
                <div className="flex items-center justify-between pt-2.5 border-t border-border/30">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Revenue</p>
                    <p className="text-[13px] font-bold text-success tabular-nums">{formatCurrency(revenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-muted-foreground uppercase">Qty Sold</p>
                    <p className="text-[13px] font-bold text-foreground tabular-nums">{qtySold}</p>
                  </div>
                </div>
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Package className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">No products found</p>
            </div>
          )}
        </div>

        {/* FAB */}
        <Link to="/billing/product/new" className="mobile-fab">
          <Plus className="w-6 h-6" />
        </Link>

        <MobileFilterSheet
          open={filterOpen}
          onOpenChange={setFilterOpen}
          onClear={() => setGstFilter("all")}
          filters={[{
            label: "GST Rate",
            value: gstFilter,
            options: [{ label: "All GST Rates", value: "all" }, ...gstRates.map((r) => ({ label: `${r}%`, value: r.toString() }))],
            onChange: setGstFilter,
          }]}
        />

        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemName={deleteTarget?.name || ""}
          itemType="Product"
          onConfirm={() => { removeProduct(deleteTarget!.id); toast({ title: "Product Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
        />
      </div>
    );
  }

  // ─── DESKTOP VIEW (unchanged) ───
  return (
    <div className="p-6 lg:p-10 space-y-6 max-w-[1440px] mx-auto">
      <Breadcrumbs items={[{ label: "Products" }]} />

      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/20 flex items-center justify-center">
            <Package className="w-5 h-5 text-chart-3" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Products</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{pluralize(totalProducts, "item")} in catalog</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Link to="/billing/product/import" className="premium-btn-ghost text-[13px] gap-1.5"><Upload className="w-4 h-4" /> Import</Link>
          <button onClick={handleExport} className="premium-btn-ghost text-[13px] gap-1.5"><Download className="w-4 h-4" /> Export</button>
          <Link to="/billing/product/new" className="premium-btn-primary text-[13px]"><Plus className="w-4 h-4" /> Add Product</Link>
        </div>
      </motion.div>

      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Products", value: totalProducts.toLocaleString("en-IN"), full: `${totalProducts} products`, icon: Package, color: "text-chart-3", bg: "bg-chart-3/10" },
          { label: "Total Revenue", value: formatCompactCurrency(totalRevenue), full: formatCurrency(totalRevenue), icon: TrendingUp, color: "text-success", bg: "bg-success/10" },
          { label: "Times Used", value: totalUsage.toLocaleString("en-IN"), full: `${totalUsage} line items across all invoices`, icon: BarChart3, color: "text-chart-1", bg: "bg-chart-1/10" },
          { label: "Avg Revenue/Product", value: formatCompactCurrency(totalProducts > 0 ? totalRevenue / totalProducts : 0), full: formatCurrency(totalProducts > 0 ? totalRevenue / totalProducts : 0), icon: Receipt, color: "text-chart-2", bg: "bg-chart-2/10" },
          { label: "Avg GST Rate", value: `${avgGSTRate}%`, full: `Across ${products.length} catalogued products`, icon: Hash, color: "text-chart-4", bg: "bg-chart-4/10" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <motion.div key={stat.label} variants={fadeUp} className="stat-card rounded-2xl p-4" title={stat.full}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                <Icon className={cn("w-3.5 h-3.5", stat.color)} />
              </div>
              <p className={cn("text-lg lg:text-xl font-display font-bold tabular-nums", stat.color)}>{stat.value}</p>
            </motion.div>
          );
        })}
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
        className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, HSN, description..." className="premium-input pl-11" />
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <select value={gstFilter} onChange={(e) => setGstFilter(e.target.value)} className="premium-select pl-9 pr-8 text-[13px]">
              <option value="all">All GST Rates</option>
              {gstRates.map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
          </div>
          <div className="flex rounded-xl overflow-hidden border border-border/60 text-[13px] ml-auto lg:ml-0">
            {([{ mode: "table" as const, icon: List }, { mode: "cards" as const, icon: LayoutGrid }]).map(({ mode, icon: Icon }) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={cn("px-3 py-1.5 transition-all flex items-center gap-1.5 capitalize font-medium",
                  viewMode === mode ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                )}>
                <Icon className="w-3.5 h-3.5" />{mode}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {(search || gstFilter !== "all") && (
        <p className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {totalProducts} products
          {search && <> matching "<span className="text-primary">{search}</span>"</>}
        </p>
      )}

      {/* Duplicate Warning */}
      {duplicateNames.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-4 rounded-xl border border-warning/30 bg-warning/5">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-foreground">Possible duplicate products detected</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {duplicateGroupCount} product name{duplicateGroupCount === 1 ? "" : "s"} may be duplicated with different casing: {[...duplicateNames].slice(0, 4).join(", ")}{duplicateNames.size > 4 ? "…" : ""}
            </p>
          </div>
        </motion.div>
      )}

      {viewMode === "table" && (
        <motion.div variants={stagger} initial="hidden" animate="visible" className="elevated-card rounded-2xl overflow-x-auto">
          <table className="table-premium">
            <thead>
              <tr>
                <th>#</th>
                <th><button onClick={() => { setSortBy("name"); setSortDir(d => sortBy === "name" ? (d === "asc" ? "desc" : "asc") : "asc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Product {sortBy === "name" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
                <th>HSN Code</th>
                <th><button onClick={() => { setSortBy("gst"); setSortDir(d => sortBy === "gst" ? (d === "asc" ? "desc" : "asc") : "asc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">GST Rate {sortBy === "gst" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
                <th><button onClick={() => { setSortBy("revenue"); setSortDir(d => sortBy === "revenue" ? (d === "asc" ? "desc" : "asc") : "desc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Revenue {sortBy === "revenue" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
                <th><button onClick={() => { setSortBy("qty"); setSortDir(d => sortBy === "qty" ? (d === "asc" ? "desc" : "asc") : "desc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Qty Sold {sortBy === "qty" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
                <th><button onClick={() => { setSortBy("usage"); setSortDir(d => sortBy === "usage" ? (d === "asc" ? "desc" : "asc") : "desc"); }} className="flex items-center gap-1 hover:text-foreground uppercase tracking-wider">Usage {sortBy === "usage" && <ArrowUpDown className="w-3 h-3 text-primary" />}</button></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const revenue = getProductRevenue(p);
                const usageCount = getProductUsageCount(p);
                const qtySold = getProductQtySold(p);
                return (
                  <motion.tr key={p.id} variants={fadeUp}>
                    <td className="text-muted-foreground text-[13px] w-12">{i + 1}</td>
                    <td className="min-w-[220px]">
                      <Link to={`/billing/product/${p.id}`} className="group">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chart-3/15 to-chart-3/5 border border-chart-3/15 flex items-center justify-center text-chart-3 font-bold text-[12px] shrink-0">
                            {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">{p.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{p.description}</p>
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <button onClick={() => copyHSN(p.hsn)}
                        className="group/hsn flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground bg-secondary/30 px-2.5 py-1 rounded-md hover:bg-secondary/50 transition-colors">
                        {p.hsn}
                        {copiedHSN === p.hsn
                          ? <CheckCircle2 className="w-3 h-3 text-success" />
                          : <Copy className="w-3 h-3 opacity-0 group-hover/hsn:opacity-60 transition-opacity" />}
                      </button>
                    </td>
                    <td>
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold tabular-nums",
                        p.gstRate <= 5 ? "bg-success/10 text-success border border-success/20" :
                        p.gstRate <= 12 ? "bg-chart-1/10 text-chart-1 border border-chart-1/20" :
                        p.gstRate <= 18 ? "bg-chart-4/10 text-chart-4 border border-chart-4/20" :
                        "bg-destructive/10 text-destructive border border-destructive/20"
                      )}>{p.gstRate}%</span>
                    </td>
                    <td>
                      <p className="text-[13px] font-bold text-success tabular-nums">{formatCurrency(revenue)}</p>
                    </td>
                    <td>
                      <p className="text-[13px] font-semibold text-foreground tabular-nums">{qtySold}</p>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                          <div className="h-full bg-chart-3 rounded-full" style={{ width: `${Math.min((usageCount / Math.max(...products.map((pr) => getProductUsageCount(pr)), 1)) * 100, 100)}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{usageCount}×</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-0.5">
                        <Link to={`/billing/product/${p.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors" title="View">
                          <Eye className="w-4 h-4" />
                        </Link>
                        <Link to={`/billing/product/edit/${p.id}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button onClick={() => setDeleteTarget({ id: p.id, name: p.name })} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Package className="w-10 h-10 opacity-30" />
                      <p className="text-sm font-medium text-foreground/70">No products found</p>
                      {(search || gstFilter !== "all") ? (
                        <button onClick={() => { setSearch(""); setGstFilter("all"); }} className="text-[12px] text-primary hover:underline font-medium">Clear filters</button>
                      ) : (
                        <Link to="/billing/product/new" className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline font-medium">
                          <Plus className="w-3 h-3" /> Add your first product
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </motion.div>
      )}

      {viewMode === "cards" && (
        <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const revenue = getProductRevenue(p);
            const usageCount = getProductUsageCount(p);
            const qtySold = getProductQtySold(p);
            return (
              <motion.div key={p.id} variants={fadeUp}>
                <Link to={`/billing/product/${p.id}`}
                  className="block elevated-card rounded-2xl p-5 hover:border-chart-3/30 transition-all duration-300 group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/15 flex items-center justify-center text-chart-3 font-bold text-sm shrink-0">
                        {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-foreground group-hover:text-chart-3 transition-colors truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">HSN: {p.hsn}</p>
                      </div>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded-lg text-[10px] font-bold tabular-nums shrink-0",
                      p.gstRate <= 5 ? "bg-success/10 text-success" :
                      p.gstRate <= 12 ? "bg-chart-1/10 text-chart-1" :
                      p.gstRate <= 18 ? "bg-chart-4/10 text-chart-4" :
                      "bg-destructive/10 text-destructive"
                    )}>{p.gstRate}%</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mb-4 line-clamp-2">{p.description}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-border/30">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue</p>
                      <p className="text-[14px] font-bold text-success tabular-nums">{formatCurrency(revenue)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Qty Sold</p>
                      <p className="text-[14px] font-bold text-foreground tabular-nums">{qtySold}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Used</p>
                      <p className="text-[14px] font-bold text-foreground">{usageCount}×</p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Package className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium text-foreground/70">No products found</p>
              {(search || gstFilter !== "all") ? (
                <button onClick={() => { setSearch(""); setGstFilter("all"); }} className="text-[12px] text-primary hover:underline font-medium">Clear filters</button>
              ) : (
                <Link to="/billing/product/new" className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline font-medium">
                  <Plus className="w-3 h-3" /> Add your first product
                </Link>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center">
          <button onClick={loadMore} disabled={isLoadingMore}
            className="px-8 py-3 rounded-xl border border-border/50 text-[13px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-all flex items-center gap-2">
            {isLoadingMore ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</> : <>Load More ({products.length} of {productTotalCount})</>}
          </button>
        </div>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        itemName={deleteTarget?.name || ""}
        itemType="Product"
        onConfirm={() => { removeProduct(deleteTarget!.id); toast({ title: "Product Deleted", description: deleteTarget?.name, variant: "destructive" }); setDeleteTarget(null); }}
      />
    </div>
  );
}
