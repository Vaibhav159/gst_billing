import { logger } from "@/utils/logger";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Upload, Download, HardDrive, CheckCircle2, FileJson, Shield, Clock, Package, FileSpreadsheet, Building2, Users, Receipt, Filter, Calendar, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { financialYears, currentFY } from "@/utils/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { useCustomers, useProducts, useBusinesses, mapDjangoInvoice } from "@/hooks/useDataStore";
import { cn } from "@/utils/utils";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";
import DataExportPanel from "@/components/DataExportPanel";
import DataImportWizard from "@/components/DataImportWizard";
import { useIsMobile } from "@/hooks/use-mobile";
import { downloadReportExcel } from "@/utils/generateReportExcel";
import api from "@/utils/api";

const LAST_BACKUP_KEY = "gst_last_backup";

export default function Backup() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const { items: products } = useProducts();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState<"customers" | "products" | "businesses" | null>(null);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [bizFilter, setBizFilter] = useState("all");
  const [fyFilter, setFyFilter] = useState(currentFY);
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportEntity, setExportEntity] = useState<"all" | "invoices" | "customers" | "products" | "businesses">("all");

  // Compute date range from FY
  const fyStartYear = parseInt(fyFilter.split("-")[0]);
  const fyStartDate = dateFrom || `${fyStartYear}-04-01`;
  const fyEndDate = dateTo || `${fyStartYear + 1}-03-31`;

  // Build common API params
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page_size", "5000");
    params.set("include_items", "true");
    params.set("start_date", fyStartDate);
    params.set("end_date", fyEndDate);
    if (bizFilter !== "all") params.set("business_id", bizFilter);
    if (typeFilter !== "all") params.set("type_of_invoice", typeFilter.toLowerCase());
    return params;
  }, [fyStartDate, fyEndDate, bizFilter, typeFilter]);

  // Fetch real invoice count from API
  useEffect(() => {
    const params = buildParams();
    params.delete("include_items");
    params.set("page_size", "1");
    api.get(`invoices/?${params.toString()}`).then(res => {
      setTotalInvoices(res.data?.count || res.data?.results?.length || 0);
    }).catch(() => {});
  }, [buildParams]);

  // Load last backup info
  useEffect(() => {
    setLastBackup(localStorage.getItem(LAST_BACKUP_KEY));
  }, []);

  const dataItems = [
    { label: "Businesses", count: businesses.length, icon: Building2, color: "text-chart-1" },
    { label: "Customers", count: customers.length, icon: Users, color: "text-chart-2" },
    { label: "Products", count: products.length, icon: Package, color: "text-chart-3" },
    { label: "Invoices", count: totalInvoices, icon: Receipt, color: "text-chart-4" },
  ];
  const totalRecords = businesses.length + customers.length + products.length + totalInvoices;

  // Full JSON backup via API
  const handleExportJSON = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      const [invRes] = await Promise.all([
        api.get(`invoices/?${params.toString()}`),
      ]);
      const invData = invRes.data;
      const allInvoices = Array.isArray(invData) ? invData : (invData.results || []);

      const data = {
        businesses,
        customers,
        products,
        invoices: allInvoices,
        exportedAt: new Date().toISOString(),
        version: "4.0",
        totalRecords: businesses.length + customers.length + products.length + allInvoices.length,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `gst-backup-${new Date().toISOString().split("T")[0]}.json`; a.click();
      URL.revokeObjectURL(url);

      const backupInfo = `${new Date().toLocaleString("en-IN")} (${data.totalRecords} records, ${(blob.size / 1024).toFixed(0)} KB)`;
      localStorage.setItem(LAST_BACKUP_KEY, backupInfo);
      setLastBackup(backupInfo);

      toast({ title: "Backup Downloaded", description: `${data.totalRecords} records exported.` });
    } catch (err) {
      logger.error("Export failed", err);
      toast({ title: "Export Failed", description: "Could not export data.", variant: "destructive" });
    }
    setExporting(false);
  };

  // Excel export
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      const res = await api.get(`invoices/?${params.toString()}`);
      const results = Array.isArray(res.data) ? res.data : (res.data.results || []);
      const fullInvoices = results.map(mapDjangoInvoice);

      downloadReportExcel({ invoices: fullInvoices, businesses, customers }, `gst-backup-${new Date().toISOString().split("T")[0]}.xlsx`);
      toast({ title: "Excel Downloaded", description: `${fullInvoices.length} invoices exported.` });
    } catch (err) {
      logger.error("Excel export failed", err);
      toast({ title: "Export Failed", description: "Could not generate Excel.", variant: "destructive" });
    }
    setExporting(false);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const requiredKeys = ["businesses", "customers", "products", "invoices"] as const;
      for (const key of requiredKeys) {
        if (!Array.isArray(data[key])) {
          throw new Error(`Invalid backup: missing or invalid "${key}" array`);
        }
      }

      // Show summary before restoring
      const summary = `${data.businesses.length} businesses, ${data.customers.length} customers, ${data.products.length} products, ${data.invoices.length} invoices`;
      toast({ title: "Backup Loaded", description: `Found: ${summary}. Restoring...` });

      // TODO: When backend bulk-import endpoint exists, use that instead
      localStorage.setItem("gst_data_businesses", JSON.stringify(data.businesses));
      localStorage.setItem("gst_data_customers", JSON.stringify(data.customers));
      localStorage.setItem("gst_data_products", JSON.stringify(data.products));
      localStorage.setItem("gst_data_invoices", JSON.stringify(data.invoices));

      toast({ title: "Restore Complete", description: `${summary} restored from ${file.name}` });
      window.location.reload();
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

      {/* Data Overview */}
      <motion.div variants={stagger} initial="hidden" animate="visible" className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4 gap-4")}>
        {dataItems.map((d) => (
          <motion.div key={d.label} variants={fadeUp} className="stat-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] text-muted-foreground font-medium">{d.label}</p>
              <d.icon className={cn("w-4 h-4", d.color)} />
            </div>
            <p className={cn("text-xl font-display font-bold", d.color)}>{d.count}</p>
            <p className="text-[11px] text-muted-foreground mt-1">records</p>
          </motion.div>
        ))}
      </motion.div>

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
          Showing: {bizFilter === "all" ? "All businesses" : businesses.find(b => String(b.id) === bizFilter)?.name} · FY {fyFilter} · {typeFilter === "all" ? "All types" : typeFilter} · <span className="font-semibold text-primary">{totalInvoices} invoices</span>
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

          <DataExportPanel />

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
              JSON: full backup with all data for restore. Excel: formatted report for viewing.
              {bizFilter !== "all" && " (filtered by selected business)"}
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
                {(["customers", "products", "businesses"] as const).map((e) => (
                  <button key={e} onClick={() => setShowImportWizard(e)}
                    className="p-3 rounded-xl border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all text-center">
                    <p className="text-[12px] font-semibold text-foreground capitalize">{e}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">CSV / JSON</p>
                  </button>
                ))}
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
                  <Shield className="w-3 h-3" /> <span>Replaces existing local data</span>
                </div>

                <button onClick={handleImport} disabled={!file || importing} className="premium-btn-primary w-full mt-3 bg-success disabled:opacity-40">
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
