import { useState } from "react";
import { Link } from "react-router-dom";
import {
  History, Search, FileText, Users, Package, Building2,
  Settings, Plus, Pencil, Trash2, Printer, Download, Copy, Clock,
} from "lucide-react";
import { motion } from "framer-motion";
import { formatDate } from "@/utils/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";

type AuditAction = "created" | "updated" | "deleted" | "printed" | "exported" | "duplicated";
type AuditEntity = "invoice" | "customer" | "product" | "business" | "settings";

const actionConfig: Record<AuditAction, { label: string; icon: typeof Plus; color: string; bg: string }> = {
  created: { label: "Created", icon: Plus, color: "text-success", bg: "bg-success/12" },
  updated: { label: "Updated", icon: Pencil, color: "text-chart-3", bg: "bg-chart-3/12" },
  deleted: { label: "Deleted", icon: Trash2, color: "text-destructive", bg: "bg-destructive/12" },
  printed: { label: "Printed", icon: Printer, color: "text-chart-4", bg: "bg-chart-4/12" },
  exported: { label: "Exported", icon: Download, color: "text-chart-1", bg: "bg-chart-1/12" },
  duplicated: { label: "Duplicated", icon: Copy, color: "text-primary", bg: "bg-primary/12" },
};

const entityConfig: Record<AuditEntity, { icon: typeof FileText; label: string }> = {
  invoice: { icon: FileText, label: "Invoice" },
  customer: { icon: Users, label: "Customer" },
  product: { icon: Package, label: "Product" },
  business: { icon: Building2, label: "Business" },
  settings: { icon: Settings, label: "Settings" },
};

function getEntityLink(entity: AuditEntity, entityId: string): string | null {
  if (!entityId) return null;
  const map: Record<string, string> = { invoice: `/billing/invoice/${entityId}`, customer: `/billing/customer/${entityId}`, product: `/billing/product/${entityId}`, business: `/billing/business/${entityId}` };
  return map[entity] || null;
}

function formatTime(ts: string) { return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }

const ITEMS_PER_PAGE = 20;

export default function AuditLog() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Audit log API not yet implemented — show empty state
  const auditLog: Array<{ id: string; action: AuditAction; entity: AuditEntity; entityId: string; entityName: string; details?: string; timestamp: string }> = [];
  const filtered = auditLog;
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginatedFiltered = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const grouped = paginatedFiltered.reduce<Record<string, typeof filtered>>((acc, entry) => {
    const date = entry.timestamp.split("T")[0]; if (!acc[date]) acc[date] = []; acc[date].push(entry); return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className={cn("space-y-5 max-w-[1200px] mx-auto animate-fade-in", isMobile ? "p-4 pb-20" : "p-6 lg:p-10 space-y-6")}>
      <Breadcrumbs items={[{ label: "Audit Log" }]} />

      <div className="flex items-center gap-3">
        <div className={cn("rounded-2xl bg-gradient-to-br from-chart-4/20 to-chart-4/5 border border-chart-4/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
          <History className="w-5 h-5 text-chart-4" />
        </div>
        <div>
          <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>Audit Log</h1>
          <p className="text-xs text-muted-foreground">{filtered.length} entries</p>
        </div>
      </div>

      {/* Filters */}
      <div className="elevated-card rounded-2xl p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[150px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="premium-input pl-9 w-full" />
          </div>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="premium-select text-[12px]">
            <option value="all">All Actions</option>
            {Object.entries(actionConfig).map(([key, cfg]) => <option key={key} value={key}>{cfg.label}</option>)}
          </select>
          {!isMobile && (
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="premium-select text-[12px]">
              <option value="all">All Types</option>
              {Object.entries(entityConfig).map(([key, cfg]) => <option key={key} value={key}>{cfg.label}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-5">
        {sortedDates.map((date) => (
          <div key={date}>
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{formatDate(date)}</h3>
              <div className="flex-1 h-px bg-border/40" />
            </div>
            <div className="space-y-2">
              {grouped[date].map((entry, i) => {
                const aCfg = actionConfig[entry.action];
                const eCfg = entityConfig[entry.entity];
                const ActionIcon = aCfg.icon;
                const link = getEntityLink(entry.entity, entry.entityId);
                return (
                  <motion.div key={entry.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="elevated-card rounded-xl p-3 flex items-start gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", aCfg.bg)}><ActionIcon className={cn("w-3.5 h-3.5", aCfg.color)} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("premium-badge text-[9px]", aCfg.bg, aCfg.color)}>{aCfg.label}</span>
                        <span className="premium-badge bg-secondary/40 text-muted-foreground text-[9px]">{eCfg.label}</span>
                      </div>
                      <div className="mt-1">
                        {link ? <Link to={link} className="text-[12px] font-semibold text-foreground hover:text-primary">{entry.entityName}</Link> : <span className="text-[12px] font-semibold text-foreground">{entry.entityName}</span>}
                      </div>
                      {entry.details && <p className="text-[10px] text-muted-foreground mt-0.5">{entry.details}</p>}
                    </div>
                    <p className="text-[10px] text-muted-foreground shrink-0">{formatTime(entry.timestamp)}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="elevated-card rounded-2xl p-12 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-chart-4/10 border border-chart-4/20 flex items-center justify-center">
              <History className="w-8 h-8 text-chart-4/40" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-foreground">No audit entries yet</p>
              <p className="text-[12px] text-muted-foreground mt-1 max-w-sm">
                Audit logging tracks all changes to invoices, customers, products, and businesses.
                Entries will appear here as you use the application.
              </p>
            </div>
            <span className="premium-badge bg-warning/12 text-warning text-[10px] mt-2">Coming Soon</span>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-secondary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, currentPage - 3), currentPage + 2).map((page) => (
              <button key={page} onClick={() => setCurrentPage(page)}
                className={cn("w-8 h-8 rounded-lg text-[12px] font-semibold transition-all",
                  page === currentPage ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
                )}>{page}</button>
            ))}
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-secondary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
