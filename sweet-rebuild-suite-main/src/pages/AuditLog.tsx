import { useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Link } from "react-router-dom";
import {
  History, Search, FileText, Users, Package, Building2,
  Settings, Plus, Pencil, Trash2, Printer, Download, Copy, Clock,
  Loader2, ChevronDown, Undo2, Upload, GitMerge,
} from "lucide-react";
import { motion } from "framer-motion";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuditLog } from "@/hooks/useAuditLog";
import type { AuditLogEntry } from "@/hooks/useAuditLog";
import { useToast } from "@/hooks/use-toast";

type AuditAction = "created" | "updated" | "deleted" | "printed" | "exported" | "duplicated" | "imported" | "merged";
type AuditEntity = "invoice" | "customer" | "product" | "business" | "settings";

const actionConfig: Record<AuditAction, { label: string; icon: typeof Plus; color: string; bg: string }> = {
  created: { label: "Created", icon: Plus, color: "text-success", bg: "bg-success/12" },
  updated: { label: "Updated", icon: Pencil, color: "text-chart-3", bg: "bg-chart-3/12" },
  deleted: { label: "Deleted", icon: Trash2, color: "text-destructive", bg: "bg-destructive/12" },
  printed: { label: "Printed", icon: Printer, color: "text-chart-4", bg: "bg-chart-4/12" },
  exported: { label: "Exported", icon: Download, color: "text-chart-1", bg: "bg-chart-1/12" },
  duplicated: { label: "Duplicated", icon: Copy, color: "text-primary", bg: "bg-primary/12" },
  imported: { label: "Imported", icon: Upload, color: "text-chart-2", bg: "bg-chart-2/12" },
  merged: { label: "Merged", icon: GitMerge, color: "text-amber-500", bg: "bg-amber-500/12" },
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
function formatDate(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Pretty-print snake_case field names */
function prettyField(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    .replace("Gst", "GST").replace("Hsn", "HSN").replace("Igst", "IGST")
    .replace("Cgst", "CGST").replace("Sgst", "SGST").replace("Pan", "PAN");
}

/** Format values nicely based on field type */
function prettyValue(field: string, val: string | null): string {
  if (!val || val === "None" || val === "null") return "\u2014";
  // Currency fields
  if (field.includes("amount") || field.includes("total") || field.includes("cgst") || field.includes("sgst") || field.includes("igst") || field.includes("rate") || field.includes("revenue")) {
    const n = parseFloat(val);
    if (!isNaN(n)) return "\u20b9" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }
  // Boolean
  if (val === "True") return "Yes";
  if (val === "False") return "No";
  // Truncate long values
  if (val.length > 50) return val.slice(0, 47) + "...";
  return val;
}

export default function AuditLog() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");

  const { toast } = useToast();
  const { items: auditLog, isLoading, isLoadingMore, hasMore, totalCount, loadMore, undoEntry } = useAuditLog({
    search: debouncedSearch,
    action: actionFilter,
    entity: entityFilter,
  });
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);

  const handleUndo = async (entryId: string) => {
    setConfirmUndoId(null);
    setUndoingId(entryId);
    try {
      const res = await undoEntry(entryId);
      toast({ title: "Undo Successful", description: res.message || "Action has been reversed." });
    } catch (e: any) {
      toast({ title: "Undo Failed", description: e?.response?.data?.error || "Could not undo this action.", variant: "destructive" });
    } finally {
      setUndoingId(null);
    }
  };

  // Group by date
  const grouped = auditLog.reduce<Record<string, AuditLogEntry[]>>((acc, entry) => {
    const date = entry.timestamp.split("T")[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(entry);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className={cn("space-y-5 max-w-[1200px] mx-auto animate-fade-in", isMobile ? "p-4 pb-20" : "p-6 lg:p-10 space-y-6")}>
      <Breadcrumbs items={[{ label: "Audit Log" }]} />

      <div className="flex items-center gap-3 flex-wrap">
        <div className={cn("rounded-2xl bg-gradient-to-br from-chart-4/20 to-chart-4/5 border border-chart-4/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
          <History className="w-5 h-5 text-chart-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>Audit Log</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${totalCount.toLocaleString("en-IN")} ${totalCount === 1 ? "entry" : "entries"}`}
          </p>
        </div>
        {/* Export currently-loaded entries to CSV. Accountants frequently
            ask "what changed last month?" — this gives them a file they
            can open in Excel. No backend route needed; works off the
            in-memory list. */}
        {auditLog.length > 0 && (
          <button
            onClick={() => {
              const rows = [["Timestamp", "Action", "Type", "Name", "User", "Details"]];
              auditLog.forEach((e) => rows.push([
                e.timestamp,
                e.action,
                e.entity,
                e.entityName || "",
                e.user || "",
                e.details || "",
              ]));
              const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast({ title: "Exported", description: `${auditLog.length} entries to CSV` });
            }}
            className="premium-btn-ghost text-[12px] h-9 shrink-0"
            title="Download currently-loaded audit entries as CSV"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="elevated-card rounded-2xl p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[150px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by entity, user, or details…" className="premium-input pl-9 w-full" />
          </div>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="premium-select text-[12px]">
            <option value="all">All Actions</option>
            {Object.entries(actionConfig).map(([key, cfg]) => <option key={key} value={key}>{cfg.label}</option>)}
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="premium-select text-[12px]">
            <option value="all">All Types</option>
            {Object.entries(entityConfig).map(([key, cfg]) => <option key={key} value={key}>{cfg.label}</option>)}
          </select>
          {(search || actionFilter !== "all" || entityFilter !== "all") && (
            <button
              onClick={() => { setSearch(""); setActionFilter("all"); setEntityFilter("all"); }}
              className="text-[12px] text-destructive hover:underline font-medium px-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Timeline */}
      {!isLoading && (
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
                  const aCfg = actionConfig[entry.action as AuditAction] || actionConfig.updated;
                  const eCfg = entityConfig[entry.entity as AuditEntity] || entityConfig.invoice;
                  const ActionIcon = aCfg.icon;
                  const link = getEntityLink(entry.entity as AuditEntity, entry.entityId);
                  return (
                    <motion.div key={entry.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="elevated-card rounded-xl p-4 flex items-start gap-3">
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5", aCfg.bg)}>
                        <ActionIcon className={cn("w-4 h-4", aCfg.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold", aCfg.bg, aCfg.color)}>{aCfg.label}</span>
                          <span className="px-2 py-0.5 rounded-md bg-secondary/40 text-muted-foreground text-[10px] font-medium">{eCfg.label}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{formatTime(entry.timestamp)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          {link && entry.action !== "deleted"
                            ? <Link to={link} className="text-[13px] font-semibold text-foreground hover:text-primary transition-colors">{entry.entityName}</Link>
                            : <span className="text-[13px] font-semibold text-foreground">{entry.entityName}</span>
                          }
                          {entry.user && <span className="text-[10px] text-muted-foreground/60">by {entry.user}</span>}
                        </div>

                        {/* Changes table */}
                        {entry.changes && Object.keys(entry.changes).length > 0 && (
                          <div className="mt-2.5 rounded-lg border border-border/30 overflow-hidden">
                            <div className="grid grid-cols-3 gap-px bg-border/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                              <div className="bg-secondary/30 px-2.5 py-1.5">Field</div>
                              <div className="bg-secondary/30 px-2.5 py-1.5">Before</div>
                              <div className="bg-secondary/30 px-2.5 py-1.5">After</div>
                            </div>
                            {Object.entries(entry.changes).slice(0, 6).map(([field, { old: oldVal, new: newVal }]) => (
                              <div key={field} className="grid grid-cols-3 gap-px bg-border/10 text-[11px]">
                                <div className="bg-background px-2.5 py-1.5 font-medium text-muted-foreground">{prettyField(field)}</div>
                                <div className="bg-background px-2.5 py-1.5 text-destructive/70">{prettyValue(field, oldVal)}</div>
                                <div className="bg-background px-2.5 py-1.5 text-success font-medium">{prettyValue(field, newVal)}</div>
                              </div>
                            ))}
                            {Object.keys(entry.changes).length > 6 && (
                              <div className="bg-background px-2.5 py-1.5 text-[10px] text-muted-foreground text-center">
                                +{Object.keys(entry.changes).length - 6} more changes
                              </div>
                            )}
                          </div>
                        )}

                        {/* Details text (only if no changes table) */}
                        {entry.details && (!entry.changes || Object.keys(entry.changes).length === 0) && (
                          <p className="text-[11px] text-muted-foreground mt-1">{entry.details}</p>
                        )}

                        {/* Undo button */}
                        {entry.canUndo && (
                          confirmUndoId === entry.id ? (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">Are you sure?</span>
                              <button onClick={() => handleUndo(entry.id)} className="px-2 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">Yes</button>
                              <button onClick={() => setConfirmUndoId(null)} className="px-2 py-0.5 rounded text-[10px] font-medium bg-secondary/30 text-muted-foreground hover:bg-secondary/50 transition-colors">No</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmUndoId(entry.id)}
                              disabled={undoingId === entry.id}
                              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium border border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-all disabled:opacity-40"
                            >
                              {undoingId === entry.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Undo2 className="w-3 h-3" />
                              }
                              {entry.action === "deleted" ? "Restore" : entry.action === "created" ? "Undo Create" : "Revert"}
                            </button>
                          )
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {auditLog.length === 0 && (
            <div className="elevated-card rounded-2xl p-12 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-chart-4/10 border border-chart-4/20 flex items-center justify-center">
                <History className="w-8 h-8 text-chart-4/40" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-foreground">
                  {(search || actionFilter !== "all" || entityFilter !== "all") ? "No entries match these filters" : "No audit entries yet"}
                </p>
                <p className="text-[12px] text-muted-foreground mt-1 max-w-sm">
                  {(search || actionFilter !== "all" || entityFilter !== "all")
                    ? "Try a different action / entity type or clear the search."
                    : "Audit logging tracks all changes to invoices, customers, products, and businesses. Create, edit, or delete a record to see entries appear here."}
                </p>
                {(search || actionFilter !== "all" || entityFilter !== "all") ? (
                  <button onClick={() => { setSearch(""); setActionFilter("all"); setEntityFilter("all"); }} className="mt-3 text-[12px] text-primary hover:underline font-medium">Clear all filters</button>
                ) : (
                  <Link to="/billing/invoice/add" className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline font-medium">
                    Create your first invoice →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className="premium-btn-outline text-[12px] h-9"
              >
                {isLoadingMore
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...</>
                  : <><ChevronDown className="w-3.5 h-3.5" /> Load More</>
                }
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
