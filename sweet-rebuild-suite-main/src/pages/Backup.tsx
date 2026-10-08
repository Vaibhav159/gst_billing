import { logger } from "@/utils/logger";
import { useState, useEffect, useCallback, useRef } from "react";
import { Upload, Download, HardDrive, CheckCircle2, FileJson, Shield, Clock, Package, FileSpreadsheet, Building2, Users, Receipt, Filter, Calendar, ArrowUpRight, Database } from "lucide-react";
import { financialYears, currentFY, formatDate } from "@/utils/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { useCustomers, useBusinesses, mapDjangoInvoice, fetchAllPages } from "@/hooks/useDataStore";
import { restoreBackup } from "@/utils/restoreBackup";
import { backupCounts, describeCounts, restorePrompt, saveFullBackup, type BackupCounts } from "@/utils/fullBackup";
import { formatApiError } from "@/utils/apiError";
import { cn } from "@/utils/utils";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";
import DataExportPanel from "@/components/DataExportPanel";
import DataImportWizard from "@/components/DataImportWizard";
import { useIsMobile } from "@/hooks/use-mobile";
import { downloadReportExcel } from "@/utils/generateReportExcel";
import api from "@/utils/api";
import { todayLocal } from "@/utils/localDate";

const LAST_BACKUP_KEY = "gst_last_backup";

export default function Backup() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState<"customers" | "products" | "businesses" | null>(null);
  // Invoices the export filters pick (the Excel report, the Invoices export)…
  const [scopeInvoices, setScopeInvoices] = useState<number | null>(null);
  // …and everything on file, all years: what a full backup holds. Null (shown
  // as "…", not 0) until the counts arrive.
  const [onFile, setOnFile] = useState<BackupCounts | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [bizFilter, setBizFilter] = useState("all");
  const [fyFilter, setFyFilter] = useState(currentFY);
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Compute date range from FY
  const fyStartYear = parseInt(fyFilter.split("-")[0]);
  const fyStartDate = dateFrom || `${fyStartYear}-04-01`;
  const fyEndDate = dateTo || `${fyStartYear + 1}-03-31`;

  // Build common API params
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page_size", "200"); // paged; every caller below walks all pages
    params.set("include_items", "true");
    params.set("start_date", fyStartDate);
    params.set("end_date", fyEndDate);
    if (bizFilter !== "all") params.set("business_id", bizFilter);
    if (typeFilter !== "all") params.set("type_of_invoice", typeFilter.toLowerCase());
    return params;
  }, [fyStartDate, fyEndDate, bizFilter, typeFilter]);

  // How many invoices the filters pick
  useEffect(() => {
    setScopeInvoices(null);
    let alive = true;
    const params = buildParams();
    params.delete("include_items");
    params.set("page_size", "1");
    api.get(`invoices/?${params.toString()}`).then(res => {
      if (alive) setScopeInvoices(res.data?.count ?? 0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [buildParams]);

  // Everything on file, all years, each counted with a one-row request (the
  // tiles showed the filtered count; products were all downloaded to count them).
  useEffect(() => {
    const count = (url: string) => api.get(url).then((res) => Number(res.data?.count ?? 0));
    Promise.all(["businesses/", "customers/", "products/", "invoices/", "invoices/?type_of_invoice=inward"]
      .map((path) => count(`${path}${path.includes("?") ? "&" : "?"}page_size=1`)))
      .then(([businesses, customers, products, invoices, inwardBills]) => setOnFile({ businesses, customers, products, invoices, inwardBills }))
      .catch(() => {});
  }, []);

  // Load last backup info
  useEffect(() => {
    setLastBackup(localStorage.getItem(LAST_BACKUP_KEY));
  }, []);

  const shown = (n: number | null | undefined) => (n == null ? "…" : n.toLocaleString("en-IN"));
  const dataItems = [
    { label: "Businesses", count: onFile?.businesses, note: "records", icon: Building2, color: "text-chart-1" },
    { label: "Customers", count: onFile?.customers, note: "records", icon: Users, color: "text-chart-2" },
    { label: "Products", count: onFile?.products, note: "records", icon: Package, color: "text-chart-3" },
    { label: "Invoices", count: onFile?.invoices, note: onFile?.inwardBills ? `all years · incl. ${shown(onFile.inwardBills)} inward` : "all years", icon: Receipt, color: "text-chart-4" },
  ];
  const totalRecords = onFile && onFile.businesses + onFile.customers + onFile.products + onFile.invoices;

  // What the filters pick, in words: "FY 2026-27", "KIRAN GOLD HOUSE · 01 Apr 2026 – 30 Jun 2026 · purchases"
  const bizName = bizFilter === "all" ? "" : businesses.find((b) => String(b.id) === bizFilter)?.name || "";
  const scopeLabel = [
    bizName,
    dateFrom || dateTo ? `${formatDate(fyStartDate)} – ${formatDate(fyEndDate)}` : `FY ${fyFilter}`,
    typeFilter === "OUTWARD" ? "sales" : typeFilter === "INWARD" ? "purchases" : "",
  ].filter(Boolean).join(" · ");
  const scopeQuery = (() => { const p = buildParams(); p.delete("include_items"); return p.toString(); })();

  // Full JSON backup: everything on file, whatever the filters say (UX1).
  // True once the file is saved, for the export panel's "Exported!". One at a
  // time from either button (M3): the ref holds it across a re-render, and
  // `exporting` disables both buttons meanwhile.
  const backupRunning = useRef(false);
  const handleExportJSON = async (): Promise<boolean> => {
    if (backupRunning.current) return false;
    backupRunning.current = true;
    setExporting(true);
    try {
      const { backup, bytes } = await saveFullBackup();
      const backupInfo = `${new Date().toLocaleString("en-IN")} (${backup.totalRecords.toLocaleString("en-IN")} records, ${(bytes / 1024).toFixed(0)} KB)`;
      localStorage.setItem(LAST_BACKUP_KEY, backupInfo);
      setLastBackup(backupInfo);

      toast({ title: "Backup Downloaded", description: `Everything on file, all years: ${describeCounts(backup.counts)}.` });
      return true;
    } catch (err) {
      logger.error("Export failed", err);
      toast({ title: "Export Failed", description: formatApiError(err, "Could not export data."), variant: "destructive" });
      return false;
    } finally {
      backupRunning.current = false;
      setExporting(false);
    }
  };

  // Excel export
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      const results = await fetchAllPages<any>(`invoices/?${params.toString()}`);
      const fullInvoices = results.map(mapDjangoInvoice);

      const includeSplit = (() => { try { return localStorage.getItem("gst_export_split_pref") === "1"; } catch { return false; } })();
      downloadReportExcel({ invoices: fullInvoices, businesses, customers }, `gst-backup-${todayLocal()}.xlsx`, { includePayment: includeSplit });
      toast({ title: "Excel Downloaded", description: `${scopeLabel} · ${fullInvoices.length.toLocaleString("en-IN")} invoices exported.` });
    } catch (err) {
      logger.error("Excel export failed", err);
      toast({ title: "Export Failed", description: "Could not generate Excel.", variant: "destructive" });
    }
    setExporting(false);
  };

  const handleImport = async () => {
    if (!file) return;
    let data: any;
    try {
      data = JSON.parse(await file.text());
      const requiredKeys = ["businesses", "customers", "products", "invoices"] as const;
      for (const key of requiredKeys) {
        if (!Array.isArray(data[key])) {
          throw new Error(`Invalid backup: missing or invalid "${key}" array`);
        }
      }
    } catch (err) {
      toast({ title: "Import Failed", description: err instanceof Error ? err.message : "Invalid backup file.", variant: "destructive" });
      return;
    }
    // Restore is additive: missing masters are created and invoices whose
    // numbers are already on file are skipped by the server. Say so, with
    // what the file holds against everything on file (not one FY's count).
    const inFile = backupCounts(data);
    if (!confirm(restorePrompt(file.name, inFile, onFile))) return;
    setImporting(true);
    try {
      toast({ title: "Backup Loaded", description: `Found: ${describeCounts(inFile)}. Restoring...` });

      // Through the real API. This used to write the arrays into localStorage
      // keys nothing reads, toast "Restore Complete" and reload (E1).
      const report = await restoreBackup(data, api);
      const failed = report.invoices.errors;
      toast({
        title: failed.length ? "Restore finished with errors" : "Restore Complete",
        description: `Created ${report.businesses} businesses, ${report.products} products, ${report.customers} customers · ${report.invoices.created} invoices imported, ${report.invoices.skipped} already on file${failed.length ? ` · ${failed.length} failed: ${failed.slice(0, 3).join(" | ")}` : ""}`,
        variant: failed.length ? "destructive" : undefined,
      });
      setImporting(false);
      // Leave the result on screen long enough to read before the lists refresh.
      window.setTimeout(() => window.location.reload(), failed.length ? 12000 : 5000);
    } catch (err) {
      setImporting(false);
      toast({
        title: "Import Failed",
        description: err instanceof Error ? err.message : "Invalid backup file.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className={cn("space-y-5 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-24" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Backup & Restore" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/20 flex items-center justify-center">
          <HardDrive className="w-5 h-5 text-chart-3" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Backup & Restore</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Export your complete data or restore from a previous backup</p>
        </div>
        {lastBackup && (
          <div className="hidden lg:block text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Backup</p>
            <p className="text-[12px] text-foreground font-medium">{lastBackup}</p>
          </div>
        )}
      </motion.div>

      {/* Data Overview — 5 tiles with thousand-separator on counts (12,345
          beats 12345 for scannability) and a "Total Records" rollup so the
          user has the same number that ends up on the disk after export.
          Last-Backup chip surfaces here on mobile too (was hidden <lg). */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-5")}>
        {[
          ...dataItems,
          { label: "Total", count: totalRecords, note: "records on file", icon: Database, color: "text-primary" },
        ].map((d) => (
          <motion.div key={d.label} variants={fadeUp} className="stat-card rounded-2xl p-4" title={`${shown(d.count)} ${d.label.toLowerCase()} records`}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{d.label}</p>
              <d.icon className={cn("w-3.5 h-3.5", d.color)} />
            </div>
            <p className={cn("text-lg lg:text-xl font-display font-bold tabular-nums", d.color)}>{shown(d.count)}</p>
            <p className="text-[10px] text-muted-foreground/80 mt-0.5">{d.note}</p>
          </motion.div>
        ))}
      </motion.div>
      {lastBackup && (
        <div className="lg:hidden text-[11px] text-muted-foreground">
          Last backup: <span className="text-foreground font-medium">{lastBackup}</span>
        </div>
      )}

      {/* Filters */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
        className="elevated-card rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-4 h-4 text-primary" />
          <h3 className="text-[12px] font-display font-semibold text-foreground">Export Filters</h3>
        </div>
        <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-4")}>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Building2 className="w-3 h-3" /> Business</label>
            <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-full text-[12px]">
              <option value="all">All Businesses</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" /> Financial Year</label>
            <select value={fyFilter} onChange={(e) => setFyFilter(e.target.value)} className="premium-select w-full text-[12px]">
              {financialYears.map((fy) => <option key={fy} value={fy}>FY {fy}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="premium-select w-full text-[12px]">
              <option value="all">All Types</option>
              <option value="OUTWARD">Outward (Sales)</option>
              <option value="INWARD">Inward (Purchases)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Date Range (optional)</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="premium-input text-[11px] flex-1" placeholder="From" />
              <span className="text-[10px] text-muted-foreground">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="premium-input text-[11px] flex-1" placeholder="To" />
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          For the Excel report and the Invoices export: {scopeLabel} · <span className="font-semibold text-primary">{shown(scopeInvoices)} invoices</span>. The JSON backup always holds everything.
        </p>
      </motion.div>

      <motion.div variants={stagger} initial="hidden" animate="visible" className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2 gap-6")}>
        {/* Export Panel */}
        <motion.div variants={fadeUp} className={cn("elevated-card rounded-2xl space-y-5", isMobile ? "p-4" : "p-7")}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-display font-semibold text-foreground">Export Data</h2>
              <p className="text-[12px] text-muted-foreground">Download as CSV, JSON, or Excel</p>
            </div>
          </div>

          <DataExportPanel
            onFile={onFile}
            invoiceScope={{ query: scopeQuery, label: scopeLabel, count: scopeInvoices }}
            onFullBackup={handleExportJSON}
            pageBusy={exporting}
          />

          <div className="border-t border-border/30 pt-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Full Backup</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleExportJSON} disabled={exporting} className="premium-btn-primary text-[12px] h-10 disabled:opacity-40">
                {exporting ? <Clock className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4" />}
                JSON Backup
              </button>
              <button onClick={handleExportExcel} disabled={exporting} className="premium-btn-outline text-[12px] h-10 border-success/30 text-success disabled:opacity-40">
                {exporting ? <Clock className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                Excel Report
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              JSON: everything on file, all years and firms, for restore{onFile ? ` — ${describeCounts(onFile)}` : ""}.
            </p>
            <p className="text-[10px] text-muted-foreground">
              Excel: {scopeLabel} · {shown(scopeInvoices)} invoices, formatted for viewing.
            </p>
          </div>
        </motion.div>

        {/* Import Panel */}
        <motion.div variants={fadeUp} className={cn("elevated-card rounded-2xl space-y-5", isMobile ? "p-4" : "p-7")}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-success" />
            </div>
            <div>
              <h2 className="text-[15px] font-display font-semibold text-foreground">Import Data</h2>
              <p className="text-[12px] text-muted-foreground">Import from CSV or JSON with column mapping</p>
            </div>
          </div>

          {showImportWizard ? (
            <DataImportWizard entity={showImportWizard} onComplete={() => setShowImportWizard(null)} />
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">Choose what to import:</p>
              <div className={cn("grid gap-2", isMobile ? "grid-cols-1" : "grid-cols-3")}>
                {(["customers", "products", "businesses"] as const).map((e) => {
                  // Surface the current row count on each button so the
                  // user sees what's about to grow before clicking.
                  const count = e === "customers" ? onFile?.customers : e === "products" ? onFile?.products : onFile?.businesses;
                  return (
                    <button key={e} onClick={() => setShowImportWizard(e)}
                      className="p-3 rounded-xl border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-center">
                      <p className="text-[12px] font-semibold text-foreground capitalize">{e}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{shown(count)} existing · CSV / JSON</p>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-border/30 pt-4 mt-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Full Backup Restore</p>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0]); }}
                  onClick={() => document.getElementById("backup-input")?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all",
                    dragOver ? "border-success bg-success/5" : file ? "border-success/50 bg-success/5" : "border-border hover:border-primary/40 hover:bg-secondary/20"
                  )}
                >
                  {file ? (
                    <>
                      <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                      <p className="text-[13px] font-semibold text-foreground">{file.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB · Ready to restore</p>
                    </>
                  ) : (
                    <>
                      <HardDrive className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-[13px] font-medium text-foreground">Drop backup JSON</p>
                      <p className="text-[11px] text-muted-foreground mt-1">Full data restore</p>
                    </>
                  )}
                  <input id="backup-input" type="file" accept=".json" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </div>

                <div className="flex items-center gap-2 text-[11px] text-warning mt-3">
                  <Shield className="w-3 h-3" /> <span>Creates missing businesses, products and customers and imports invoices not already on file — nothing is deleted; you'll be asked to confirm</span>
                </div>

                {/* Restore button uses warning-color, not success-green —
                    this is a destructive action (replaces data) and the
                    green color signal was misleading. */}
                <button
                  onClick={handleImport}
                  disabled={!file || importing}
                  className={cn(
                    "premium-btn-primary w-full mt-3 disabled:opacity-40",
                    !file ? "bg-secondary/50 text-muted-foreground" : "bg-warning text-warning-foreground hover:brightness-110"
                  )}
                >
                  {importing ? <><Clock className="w-4 h-4 animate-spin" /> Restoring...</> : <><Upload className="w-4 h-4" /> Restore Backup</>}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
