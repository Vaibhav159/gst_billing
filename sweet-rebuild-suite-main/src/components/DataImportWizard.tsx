import { useState, useCallback } from "react";
import { Upload, FileText, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, Eye, X } from "lucide-react";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { useCustomers, useProducts, useBusinesses, generateId } from "@/hooks/useDataStore";
import { motion, AnimatePresence } from "framer-motion";

type ImportStep = "upload" | "preview" | "mapping" | "result";
type ImportEntity = "customers" | "products" | "businesses";

interface DataImportWizardProps {
  entity: ImportEntity;
  onComplete: () => void;
}

interface ParsedRow {
  [key: string]: string;
}

const entityColumns: Record<ImportEntity, { key: string; label: string; required: boolean }[]> = {
  customers: [
    { key: "name", label: "Name", required: true },
    { key: "gst", label: "GST Number", required: false },
    { key: "pan", label: "PAN", required: false },
    { key: "mobile", label: "Mobile", required: true },
    { key: "email", label: "Email", required: false },
    { key: "state", label: "State", required: false },
    { key: "address", label: "Address", required: false },
  ],
  products: [
    { key: "name", label: "Product Name", required: true },
    { key: "hsn", label: "HSN Code", required: true },
    { key: "gstRate", label: "GST Rate (%)", required: true },
    { key: "description", label: "Description", required: false },
  ],
  businesses: [
    { key: "name", label: "Business Name", required: true },
    { key: "gst", label: "GST Number", required: false },
    { key: "pan", label: "PAN", required: false },
    { key: "state", label: "State", required: false },
    { key: "address", label: "Address", required: false },
    { key: "mobile", label: "Mobile", required: true },
    { key: "email", label: "Email", required: false },
    { key: "bankName", label: "Bank Name", required: false },
    { key: "accountNo", label: "Account No", required: false },
    { key: "ifsc", label: "IFSC", required: false },
    { key: "branch", label: "Branch", required: false },
  ],
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        values.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  values.push(current.trim());
  return values;
}

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.trim().split("\n").map(l => l.replace(/\r$/, ""));
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map((line) => {
    const values = parseCsvLine(line);
    const row: ParsedRow = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
  return { headers, rows };
}

export default function DataImportWizard({ entity, onComplete }: DataImportWizardProps) {
  const { toast } = useToast();
  const { create: createCustomer } = useCustomers();
  const { create: createProduct } = useProducts();
  const { create: createBusiness } = useBusinesses();

  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{ success: number; errors: number; errorRows: number[] }>({ success: 0, errors: 0, errorRows: [] });
  const [dragOver, setDragOver] = useState(false);

  const columns = entityColumns[entity];

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.endsWith(".csv") && !f.name.endsWith(".json")) {
      toast({ title: "Invalid File", description: "Please upload a CSV or JSON file.", variant: "destructive" });
      return;
    }
    setFile(f);
    const text = await f.text();

    if (f.name.endsWith(".json")) {
      try {
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : data[entity] || [];
        if (arr.length > 0) {
          const headers = Object.keys(arr[0]);
          setCsvHeaders(headers);
          setRows(arr.map((item: any) => {
            const row: ParsedRow = {};
            headers.forEach((h) => { row[h] = String(item[h] ?? ""); });
            return row;
          }));
          // Auto-map matching columns
          const autoMap: Record<string, string> = {};
          columns.forEach((col) => {
            const match = headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, "") === col.key.toLowerCase() || h.toLowerCase().includes(col.label.toLowerCase()));
            if (match) autoMap[col.key] = match;
          });
          setMapping(autoMap);
          setStep("preview");
        }
      } catch {
        toast({ title: "Invalid JSON", variant: "destructive" });
      }
      return;
    }

    const { headers, rows: parsed } = parseCSV(text);
    setCsvHeaders(headers);
    setRows(parsed);

    // Auto-map
    const autoMap: Record<string, string> = {};
    columns.forEach((col) => {
      const match = headers.find((h) =>
        h.toLowerCase().replace(/[^a-z0-9]/g, "").includes(col.key.toLowerCase()) ||
        h.toLowerCase().includes(col.label.toLowerCase().replace(/[^a-z0-9]/g, ""))
      );
      if (match) autoMap[col.key] = match;
    });
    setMapping(autoMap);
    setStep("preview");
  }, [entity, columns, toast]);

  const handleImport = () => {
    let success = 0;
    let errors = 0;
    const errorRows: number[] = [];

    rows.forEach((row, idx) => {
      try {
        const mapped: any = {};
        columns.forEach((col) => {
          const csvCol = mapping[col.key];
          mapped[col.key] = csvCol ? row[csvCol] || "" : "";
        });

        // Validate required fields
        const missingRequired = columns.filter((c) => c.required && !mapped[c.key]);
        if (missingRequired.length > 0) {
          errors++;
          errorRows.push(idx + 2); // +2 for header + 1-based
          return;
        }

        const id = generateId(entity.slice(0, 3) + "-");
        const now = new Date().toISOString().split("T")[0];

        if (entity === "customers") {
          createCustomer({
            id, name: mapped.name, gst: mapped.gst || "", pan: mapped.pan || "",
            mobile: mapped.mobile, email: mapped.email || "", state: mapped.state || "",
            address: mapped.address || "", businessIds: [], tags: [], createdAt: now,
          });
        } else if (entity === "products") {
          createProduct({
            id, name: mapped.name, hsn: mapped.hsn, gstRate: parseFloat(mapped.gstRate) || 0,
            description: mapped.description || "", createdAt: now,
          });
        } else if (entity === "businesses") {
          createBusiness({
            id, name: mapped.name, gst: mapped.gst || "", pan: mapped.pan || "",
            state: mapped.state || "", address: mapped.address || "", mobile: mapped.mobile,
            email: mapped.email || "", bankName: mapped.bankName || "", accountNo: mapped.accountNo || "",
            ifsc: mapped.ifsc || "", branch: mapped.branch || "", createdAt: now,
          });
        }
        success++;
      } catch {
        errors++;
        errorRows.push(idx + 2);
      }
    });

    setImportResult({ success, errors, errorRows });
    setStep("result");
    toast({ title: "Import Complete", description: `${success} records imported, ${errors} errors` });
  };

  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {(["upload", "preview", "mapping", "result"] as ImportStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold",
              step === s ? "bg-primary text-primary-foreground" :
              (["upload", "preview", "mapping", "result"].indexOf(step) > i) ? "bg-success text-success-foreground" :
              "bg-secondary/40 text-muted-foreground"
            )}>{i + 1}</div>
            {i < 3 && <div className={cn("flex-1 h-0.5 rounded", step === s || ["upload", "preview", "mapping", "result"].indexOf(step) > i ? "bg-primary/30" : "bg-border/30")} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === "upload" && (
          <motion.div key="upload" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById("import-wizard-input")?.click()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all",
                dragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40 hover:bg-secondary/10"
              )}
            >
              <Upload className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-[14px] font-semibold text-foreground">Drop your CSV or JSON file</p>
              <p className="text-[12px] text-muted-foreground mt-1">Supports CSV and JSON formats · Max 500 rows</p>
            </div>
            <input id="import-wizard-input" type="file" accept=".csv,.json" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
          </motion.div>
        )}

        {step === "preview" && (
          <motion.div key="preview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" /> {file?.name}
                </p>
                <p className="text-[11px] text-muted-foreground">{rows.length} rows · {csvHeaders.length} columns</p>
              </div>
              <button onClick={() => { setStep("upload"); setFile(null); }} className="text-[11px] text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Preview table */}
            <div className="overflow-x-auto max-h-[250px] rounded-xl border border-border/30">
              <table className="w-full text-[11px]">
                <thead className="bg-secondary/30 sticky top-0">
                  <tr>{csvHeaders.map((h) => <th key={h} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>{csvHeaders.map((h) => <td key={h} className="px-3 py-2 text-muted-foreground whitespace-nowrap">{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && <p className="text-center text-[10px] text-muted-foreground py-2">...and {rows.length - 5} more rows</p>}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep("upload")} className="premium-btn-ghost flex-1"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <button onClick={() => setStep("mapping")} className="premium-btn-primary flex-1">Map Columns <ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
          </motion.div>
        )}

        {step === "mapping" && (
          <motion.div key="mapping" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
            <p className="text-[13px] font-semibold text-foreground">Map CSV columns to fields</p>
            <div className="space-y-2.5">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center gap-3">
                  <div className="w-36">
                    <p className="text-[12px] font-semibold text-foreground">
                      {col.label}{col.required && <span className="text-destructive ml-0.5">*</span>}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <select
                    value={mapping[col.key] || ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [col.key]: e.target.value }))}
                    className="premium-select flex-1"
                  >
                    <option value="">— Skip —</option>
                    {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep("preview")} className="premium-btn-ghost flex-1"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
              <button
                onClick={handleImport}
                disabled={!columns.filter((c) => c.required).every((c) => mapping[c.key])}
                className="premium-btn-primary flex-1 disabled:opacity-40"
              >
                Import {rows.length} Records <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}

        {step === "result" && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4 py-6">
            <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
            <div>
              <p className="text-lg font-display font-bold text-foreground">Import Complete!</p>
              <p className="text-[13px] text-muted-foreground mt-1">{importResult.success} records imported successfully</p>
            </div>
            {importResult.errors > 0 && (
              <div className="flex items-start gap-2 text-[12px] text-destructive bg-destructive/5 rounded-xl p-4 text-left mx-auto max-w-sm">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{importResult.errors} rows failed</p>
                  <p className="text-[11px] opacity-70 mt-0.5">Rows: {importResult.errorRows.join(", ")}</p>
                </div>
              </div>
            )}
            <button onClick={onComplete} className="premium-btn-primary">Done</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
