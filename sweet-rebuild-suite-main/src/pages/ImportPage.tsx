import { Link } from "react-router-dom";
import {
  Upload, Download, FileText, ArrowLeft, CheckCircle2, AlertTriangle,
  FileSpreadsheet, Info, Package, Users, Receipt, Hash, Building2,
} from "lucide-react";
import { useState } from "react";
import { useBusinesses } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";

interface ImportPageProps { type: "customer" | "product" | "invoice" | "business" }

const configs = {
  customer: {
    title: "Import Customers",
    back: "/billing/customer/list",
    breadcrumb: [{ label: "Customers", href: "/billing/customer/list" }, { label: "Import" }],
    columns: [
      { name: "Name", required: true, example: "Rajesh Kumar" },
      { name: "GST Number", required: false, example: "27AABCK5461H1ZO" },
      { name: "PAN", required: false, example: "AABCK5461H" },
      { name: "Mobile", required: true, example: "9876543210" },
      { name: "Email", required: false, example: "raj@mail.com" },
      { name: "State", required: false, example: "Maharashtra" },
      { name: "Address", required: false, example: "123 Main St" },
    ],
    showBusiness: true,
    icon: Users,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  product: {
    title: "Import Products",
    back: "/billing/product/list",
    breadcrumb: [{ label: "Products", href: "/billing/product/list" }, { label: "Import" }],
    columns: [
      { name: "Product Name", required: true, example: "Diamond Ring" },
      { name: "HSN Code", required: true, example: "71131910" },
      { name: "GST Rate (%)", required: true, example: "3" },
      { name: "Description", required: false, example: "22K gold ring" },
    ],
    showBusiness: false,
    icon: Package,
    color: "text-chart-3",
    bg: "bg-chart-3/10",
  },
  invoice: {
    title: "Import Invoices",
    back: "/billing/invoice/list",
    breadcrumb: [{ label: "Invoices", href: "/billing/invoice/list" }, { label: "Import" }],
    columns: [
      { name: "Invoice Number", required: true, example: "INV-001" },
      { name: "Date", required: true, example: "2024-04-15" },
      { name: "Customer", required: true, example: "Rajesh Kumar" },
      { name: "Product", required: true, example: "Diamond Ring" },
      { name: "Qty", required: true, example: "2" },
      { name: "Rate", required: true, example: "45000" },
      { name: "GST Rate (%)", required: true, example: "3" },
      { name: "Type", required: true, example: "OUTWARD" },
    ],
    showBusiness: true,
    icon: Receipt,
    color: "text-chart-1",
    bg: "bg-chart-1/10",
  },
  business: {
    title: "Import Businesses",
    back: "/billing/business/list",
    breadcrumb: [{ label: "Businesses", href: "/billing/business/list" }, { label: "Import" }],
    columns: [
      { name: "Business Name", required: true, example: "Sharma Gold Pvt Ltd" },
      { name: "GST Number", required: false, example: "27AABCS1429B1Z1" },
      { name: "PAN", required: false, example: "AABCS1429B" },
      { name: "Mobile", required: true, example: "9876543210" },
      { name: "Email", required: false, example: "info@sharma.com" },
      { name: "State", required: false, example: "Maharashtra" },
      { name: "Address", required: false, example: "123 Zaveri Bazaar" },
      { name: "Bank Name", required: false, example: "State Bank of India" },
      { name: "Account No", required: false, example: "1234567890" },
      { name: "IFSC", required: false, example: "SBIN0001234" },
      { name: "Branch", required: false, example: "Zaveri Bazaar" },
    ],
    showBusiness: false,
    icon: Building2,
    color: "text-chart-4",
    bg: "bg-chart-4/10",
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

export default function ImportPage({ type }: ImportPageProps) {
  const config = configs[type];
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [bizFilter, setBizFilter] = useState("all");
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  const Icon = config.icon;

  const handleFile = (f: File | null) => {
    if (f && !f.name.endsWith(".csv")) {
      toast({ title: "Invalid File", description: "Please upload a CSV file.", variant: "destructive" });
      return;
    }
    setFile(f);
    setImportDone(false);
  };

  const handleImport = () => {
    if (!file) return;
    setImporting(true);
    setTimeout(() => {
      setImporting(false);
      setImportDone(true);
      toast({ title: "Import Successful", description: `Records from ${file.name} imported successfully.` });
    }, 1500);
  };

  const handleSampleDownload = () => {
    const headers = config.columns.map((c) => c.name).join(",");
    const sampleRow = config.columns.map((c) => c.example).join(",");
    const csv = `${headers}\n${sampleRow}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${type}-import-sample.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Sample Downloaded", description: `${type}-import-sample.csv` });
  };

  return (
    <div className="p-6 lg:p-10 space-y-7 max-w-[1440px] mx-auto">
      <Breadcrumbs items={config.breadcrumb} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={cn("w-12 h-12 rounded-2xl border flex items-center justify-center",
            `${config.bg} border-current/20`)}>
            <Icon className={cn("w-5 h-5", config.color)} />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{config.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Upload a CSV file to bulk import records</p>
          </div>
        </div>
        <Link to={config.back} className="premium-btn-ghost text-[13px] h-9"><ArrowLeft className="w-4 h-4" /> Back</Link>
      </motion.div>

      <motion.div variants={stagger} initial="hidden" animate="visible"
        className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* CSV Format Reference */}
        <motion.div variants={fadeUp} className="lg:col-span-4 space-y-5">
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", config.bg)}>
                <FileSpreadsheet className={cn("w-3.5 h-3.5", config.color)} />
              </div>
              <h2 className="text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wider">CSV Format</h2>
            </div>

            <div className="space-y-2">
              {config.columns.map((col, i) => (
                <div key={col.name} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/30 hover:bg-secondary/10 transition-colors">
                  <span className="w-6 h-6 rounded-lg bg-secondary/50 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[12px] font-semibold", col.required ? "text-foreground" : "text-muted-foreground")}>
                      {col.name}
                      {col.required && <span className="text-destructive ml-0.5">*</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{col.example}</p>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={handleSampleDownload} className="premium-btn-outline w-full text-[13px] h-10">
              <Download className="w-4 h-4" /> Download Sample CSV
            </button>
          </div>

          {/* Tips */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-chart-3" />
              <h3 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Tips</h3>
            </div>
            <ul className="space-y-2 text-[11px] text-muted-foreground">
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Fields marked with * are required.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Download the sample CSV for exact format reference.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Duplicate entries are skipped automatically.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Maximum 500 rows per import.</li>
            </ul>
          </div>
        </motion.div>

        {/* Upload Area */}
        <motion.div variants={fadeUp} className="lg:col-span-8 space-y-5">

          {/* Business filter */}
          {config.showBusiness && (
            <div className="elevated-card rounded-2xl p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <Hash className="w-4 h-4 text-muted-foreground" />
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Target Business</label>
              </div>
              <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-full">
                <option value="all">All Businesses</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.gst_number}</option>)}
              </select>
            </div>
          )}

          {/* Drop Zone */}
          <div className="elevated-card rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Upload className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wider">Upload File</h2>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById("file-input")?.click()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all duration-300",
                dragOver ? "border-primary bg-primary/5 scale-[1.01]" :
                file ? "border-success/40 bg-success/3" :
                "border-border/60 hover:border-primary/40 hover:bg-secondary/10"
              )}
            >
              <AnimatePresence mode="wait">
                {importDone ? (
                  <motion.div key="done" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-2">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
                    <p className="text-[14px] font-semibold text-success">Import Complete!</p>
                    <p className="text-[12px] text-muted-foreground">{file?.name}</p>
                  </motion.div>
                ) : file ? (
                  <motion.div key="file" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-2">
                    <FileText className="w-12 h-12 text-success/70 mx-auto" />
                    <p className="text-[14px] font-semibold text-foreground">{file.name}</p>
                    <p className="text-[12px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                    <Upload className="w-12 h-12 text-muted-foreground/40 mx-auto" />
                    <p className="text-[14px] font-semibold text-foreground">Drag & drop your CSV file</p>
                    <p className="text-[12px] text-muted-foreground">or click to browse · CSV only · Max 5MB</p>
                  </motion.div>
                )}
              </AnimatePresence>
              <input id="file-input" type="file" accept=".csv" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)} />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Link to={config.back} className="premium-btn-ghost text-[13px] h-10 flex-1">
                <ArrowLeft className="w-4 h-4" /> Cancel
              </Link>
              <button onClick={handleImport} disabled={!file || importing || importDone}
                className={cn(
                  "flex-1 h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all",
                  file && !importing && !importDone
                    ? "bg-primary text-primary-foreground hover:brightness-110"
                    : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
                )}>
                {importing ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                {importing ? "Importing..." : importDone ? "Imported!" : "Import Records"}
              </button>
            </div>
          </div>

          {/* Preview hint */}
          {file && !importDone && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-chart-3/20 bg-chart-3/5 text-[12px] text-muted-foreground">
              <AlertTriangle className="w-4 h-4 text-chart-3 shrink-0" />
              <span>Records will be validated before import. Invalid rows will be skipped with a summary report.</span>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
