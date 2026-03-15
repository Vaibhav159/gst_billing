import { useState } from "react";
import { Upload, Download, HardDrive, CheckCircle2, FileJson, Shield, Clock, Package } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { useInvoices, useCustomers, useProducts, useBusinesses } from "@/hooks/useDataStore";
import { cn } from "@/utils/utils";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";
import DataExportPanel from "@/components/DataExportPanel";
import DataImportWizard from "@/components/DataImportWizard";
import { useIsMobile } from "@/hooks/use-mobile";

export default function Backup() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const { items: products } = useProducts();
  const { items: invoices } = useInvoices();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState<"customers" | "products" | "businesses" | null>(null);

  const dataItems = [
    { label: "Businesses", count: businesses.length, icon: Package, color: "text-chart-1" },
    { label: "Customers", count: customers.length, icon: Package, color: "text-chart-2" },
    { label: "Products", count: products.length, icon: Package, color: "text-chart-3" },
    { label: "Invoices", count: invoices.length, icon: Package, color: "text-chart-4" },
  ];
  const totalRecords = businesses.length + customers.length + products.length + invoices.length;

  const handleExport = async () => {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 1200));
    const data = { businesses, customers, products, invoices, exportedAt: new Date().toISOString(), version: "3.0" };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `gst-backup-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
    setExported(true);
    toast({ title: "Backup Downloaded", description: `${totalRecords} records exported successfully.` });
    setTimeout(() => setExported(false), 3000);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate expected structure
      const requiredKeys = ["businesses", "customers", "products", "invoices"] as const;
      for (const key of requiredKeys) {
        if (!Array.isArray(data[key])) {
          throw new Error(`Invalid backup: missing or invalid "${key}" array`);
        }
      }

      // Write each array to localStorage under the correct keys
      localStorage.setItem("gst_data_businesses", JSON.stringify(data.businesses));
      localStorage.setItem("gst_data_customers", JSON.stringify(data.customers));
      localStorage.setItem("gst_data_products", JSON.stringify(data.products));
      localStorage.setItem("gst_data_invoices", JSON.stringify(data.invoices));

      toast({ title: "Data Imported", description: `Restored from ${file.name}` });

      // Reload so all hooks pick up the new data
      window.location.reload();
    } catch (err) {
      setImporting(false);
      toast({
        title: "Import Failed",
        description: err instanceof Error ? err.message : "The file is not a valid backup JSON.",
        variant: "destructive",
      });
    }
  };

  const estSize = ((JSON.stringify({ businesses, customers, products, invoices }).length) / 1024).toFixed(1);

  return (
    <div className={cn("space-y-5 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-24" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Backup & Restore" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/20 flex items-center justify-center">
          <HardDrive className="w-5 h-5 text-chart-3" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">Backup & Restore</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Export your complete data or restore from a previous backup</p>
        </div>
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

      <motion.div variants={stagger} initial="hidden" animate="visible" className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2 gap-6")}>
        {/* Advanced Export */}
        <motion.div variants={fadeUp} className={cn("elevated-card rounded-2xl space-y-5", isMobile ? "p-4" : "p-7")}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-display font-semibold text-foreground">Export Data</h2>
              <p className="text-[12px] text-muted-foreground">Download as CSV or JSON</p>
            </div>
          </div>
          <DataExportPanel />
        </motion.div>

        {/* Import */}
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
                      <FileJson className="w-8 h-8 text-success mx-auto mb-2" />
                      <p className="text-[13px] font-semibold text-foreground">{file.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB</p>
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
                  <Shield className="w-3 h-3" /> <span>Replaces existing data</span>
                </div>

                <button onClick={handleImport} disabled={!file || importing} className="premium-btn-primary w-full mt-3 bg-success disabled:opacity-40">
                  {importing ? (
                    <><Clock className="w-4 h-4 animate-spin" /> Importing...</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Restore Backup</>
                  )}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
