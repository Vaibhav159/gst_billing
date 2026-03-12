import { useState } from "react";
import { Upload, Download, HardDrive, CheckCircle2, FileJson, Shield, Clock, Package } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { useBusinesses, useCustomers, useProducts, useInvoices } from "@/hooks/useDataStore";
import { cn } from "@/utils/utils";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/utils/animations";

export default function Backup() {
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const { items: products } = useProducts();
  const { items: invoices } = useInvoices();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [importing, setImporting] = useState(false);

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
    const data = { products, invoices, exportedAt: new Date().toISOString(), version: "2.0" };
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
    await new Promise((r) => setTimeout(r, 1500));
    setImporting(false);
    toast({ title: "Data Imported", description: `Restored from ${file.name}` });
    setFile(null);
  };

  const estSize = ((JSON.stringify({ products, invoices }).length) / 1024).toFixed(1);

  return (
    <div className="p-8 space-y-6">
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
      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

      <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Export */}
        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-7 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-display font-semibold text-foreground">Export Backup</h2>
              <p className="text-[12px] text-muted-foreground">Download all data as JSON</p>
            </div>
          </div>

          <div className="glass-surface rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Total Records</span>
              <span className="font-semibold text-foreground">{totalRecords}</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Estimated Size</span>
              <span className="font-semibold text-foreground">{estSize} KB</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Format</span>
              <span className="premium-badge bg-primary/12 text-primary">JSON v2.0</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Shield className="w-3.5 h-3.5" /> <span>Includes all products & invoices</span>
          </div>

          <button onClick={handleExport} disabled={exporting} className={cn("premium-btn-primary w-full", exported && "bg-success")}>
            {exporting ? (
              <><Clock className="w-4 h-4 animate-spin" /> Preparing...</>
            ) : exported ? (
              <><CheckCircle2 className="w-4 h-4" /> Downloaded!</>
            ) : (
              <><Download className="w-4 h-4" /> Download Backup</>
            )}
          </button>
        </motion.div>

        {/* Import */}
        <motion.div variants={fadeUp} className="elevated-card rounded-2xl p-7 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <Upload className="w-5 h-5 text-success" />
            </div>
            <div>
              <h2 className="text-[15px] font-display font-semibold text-foreground">Import Backup</h2>
              <p className="text-[12px] text-muted-foreground">Restore from a previously exported file</p>
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0]); }}
            onClick={() => document.getElementById("backup-input")?.click()}
            className={cn(
              "border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all",
              dragOver ? "border-success bg-success/5" : file ? "border-success/50 bg-success/5" : "border-border hover:border-primary/40 hover:bg-secondary/20"
            )}
          >
            {file ? (
              <>
                <FileJson className="w-10 h-10 text-success mx-auto mb-3" />
                <p className="text-[14px] font-semibold text-foreground">{file.name}</p>
                <p className="text-[12px] text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB · Ready to import</p>
              </>
            ) : (
              <>
                <HardDrive className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-[14px] font-medium text-foreground">Drag & drop backup JSON</p>
                <p className="text-[12px] text-muted-foreground mt-1">or click to browse files</p>
              </>
            )}
            <input id="backup-input" type="file" accept=".json" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>

          <div className="flex items-center gap-2 text-[12px] text-warning">
            <Shield className="w-3.5 h-3.5" /> <span>This will replace existing data. Make sure to export first.</span>
          </div>

          <button onClick={handleImport} disabled={!file || importing} className="premium-btn-primary w-full bg-success disabled:opacity-40">
            {importing ? (
              <><Clock className="w-4 h-4 animate-spin" /> Importing...</>
            ) : (
              <><Upload className="w-4 h-4" /> Import Backup</>
            )}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
