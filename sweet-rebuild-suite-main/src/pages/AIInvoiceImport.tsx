import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBusinesses } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Upload, Bot, CheckCircle, ArrowRight, Image as ImageIcon, Sparkles,
  Clock, Shield, FileText, ArrowLeft, Zap, Loader2, AlertTriangle,
  Plus, Trash2, RefreshCw, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import api from "@/utils/api";
import { formatCurrency } from "@/utils/mockData";

// Mirrors backend AIInvoiceProcessor._convert_to_dict output (floats, not
// Decimal strings — see billing/utils.py).
type LineItem = {
  product_name: string;
  quantity: number;
  rate: number;
  hsn_code: string;
  gst_tax_rate: number; // decimal: 0.03 for 3%
  amount: number;       // tax-inclusive line subtotal
};

type Extracted = {
  buyer_gst_number: string;
  buyer_name: string;
  seller_gst_number: string;
  seller_name: string;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  customer_name: string;       // backend promotes the "other" party here
  customer_address: string;
  customer_gst_number: string; // backend promotes the "other" party here
  customer_pan_number: string;
  customer_mobile_number: string;
  line_items: LineItem[];
  total_amount: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
};

type MatchedBusiness = { id: number; name: string; gst_number: string } | null;

// Per-file state machine.
//   "duplicate" = backend dedup'd against an existing invoice; we link
//   to the existing row instead of double-creating. Distinct from
//   "created" so the UI shows "ALREADY EXISTS" vs "CREATED".
type FileStatus = "pending" | "processing" | "ready" | "error" | "created" | "duplicate";
type FileEntry = {
  id: string;                  // local-only key
  file: File;
  previewUrl: string;
  type: "outward" | "inward";  // user-toggled per file
  status: FileStatus;
  extracted: Extracted | null;
  matchedBusiness: MatchedBusiness;
  businessOverrideId: string;
  errorMsg: string;
  createdInvoiceId: number | null;
  expanded: boolean;
  // For Gemini multi-key rotation: which key (#1/2/3…) processed this
  // file and how many are configured total. Lets the badge show
  // "Gemini #2/3" so the user can see they're burning through the pool.
  keyIndex: number | null;
  keyTotal: number | null;
};

// HEIC/HEIF added for iPhone uploads — backend's pillow-heif decodes
// then re-encodes to JPEG before Gemini sees it. Browsers vary in MIME
// reporting on .heic (Chrome: image/heic, Safari: blank) — we whitelist
// by extension if the MIME comes through empty.
const ACCEPTED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/heic", "image/heif",
]);
const ACCEPTED_EXT = /\.(jpe?g|png|heic|heif)$/i;
const ACCEPT_ATTR = ".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif";
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

function isAcceptableFile(f: File): boolean {
  if (ACCEPTED_MIME.has(f.type)) return true;
  // Safari often sends no MIME for HEIC — fall back to extension.
  return ACCEPTED_EXT.test(f.name);
}

export default function AIInvoiceImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processingAll, setProcessingAll] = useState(false);
  const [creatingAll, setCreatingAll] = useState(false);

  // Cleanup object URLs on unmount.
  useEffect(() => {
    return () => {
      files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((picked: FileList | File[]) => {
    const arr = Array.from(picked);
    const accepted: FileEntry[] = [];
    const rejected: string[] = [];
    for (const f of arr) {
      if (!isAcceptableFile(f)) {
        rejected.push(`${f.name}: unsupported type`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        rejected.push(`${f.name}: ${(f.size / 1024 / 1024).toFixed(1)}MB > 20MB cap`);
        continue;
      }
      // HEIC can't be previewed by <img> directly in most browsers — keep
      // the object URL anyway; the browser will gracefully fall back to
      // showing nothing rather than crashing.
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        type: "inward",  // most AI imports are purchase invoices
        status: "pending",
        extracted: null,
        matchedBusiness: null,
        businessOverrideId: "",
        errorMsg: "",
        createdInvoiceId: null,
        expanded: false,
        keyIndex: null,
        keyTotal: null,
      });
    }
    if (accepted.length) {
      setFiles((prev) => [...prev, ...accepted]);
    }
    if (rejected.length) {
      toast({
        title: `${rejected.length} file${rejected.length === 1 ? "" : "s"} rejected`,
        description: rejected.slice(0, 3).join("\n") + (rejected.length > 3 ? `\n+${rejected.length - 3} more` : ""),
        variant: "destructive",
      });
    }
  }, [toast]);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const updateFile = useCallback((id: string, patch: Partial<FileEntry>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  // Process a single file end-to-end (call /ai/invoice/process/).
  // Used both standalone and from the "Process All" batch.
  const processOne = useCallback(async (entry: FileEntry) => {
    updateFile(entry.id, { status: "processing", errorMsg: "" });
    try {
      const fd = new FormData();
      fd.append("image", entry.file);
      // Don't send business_id — let the backend auto-detect from the
      // extracted recipient GSTIN. If detection fails, the user picks
      // from the dropdown in the review form.
      const res = await api.post<{
        data: Extracted;
        matched_business: MatchedBusiness;
        detected_type: "inward" | "outward" | null;
        key_index: number | null;
        key_total: number | null;
      }>("ai/invoice/process/", fd, { timeout: 120_000 });
      updateFile(entry.id, {
        status: "ready",
        extracted: res.data.data,
        matchedBusiness: res.data.matched_business,
        businessOverrideId: res.data.matched_business
          ? String(res.data.matched_business.id)
          : "",
        type: res.data.detected_type || entry.type,
        keyIndex: res.data.key_index,
        keyTotal: res.data.key_total,
        expanded: true,
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      const msg = err?.response?.data?.error || err?.message || "AI extraction failed.";
      updateFile(entry.id, { status: "error", errorMsg: msg });
    }
  }, [updateFile]);

  const processAll = async () => {
    const pending = files.filter((f) => f.status === "pending" || f.status === "error");
    if (!pending.length) return;
    setProcessingAll(true);
    // Concurrent processing with a sliding window. Gemini free tier is
    // 15 RPM per key and we have multi-key rotation, so 4 in-flight is
    // safe — each key only sees ~1 RPM in the worst case. 4x speedup
    // on bulk uploads vs the old serial flow.
    const CONCURRENCY = 4;
    const queue = [...pending];
    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await processOne(next);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
    );
    setProcessingAll(false);
    toast({
      title: "Processing complete",
      description: `Review extracted data for each file, then create.`,
    });
  };

  // Create one invoice from a ready file.
  const createOne = useCallback(async (entry: FileEntry): Promise<boolean> => {
    if (!entry.extracted) return false;
    const bizId = entry.businessOverrideId
      || (entry.matchedBusiness?.id ? String(entry.matchedBusiness.id) : "");
    if (!bizId) {
      updateFile(entry.id, { errorMsg: "Pick a business before creating." });
      return false;
    }
    try {
      // Multipart so we can ship the original source image alongside
      // the extracted data. Backend saves it as audit trail on
      // invoice.source_file (visible on InvoiceDetail). JSON fields
      // get JSON.stringified — backend parses on the way in.
      const fd = new FormData();
      fd.append("business_id", bizId);
      fd.append("type_of_invoice", entry.type);
      fd.append("invoice_data", JSON.stringify(entry.extracted));
      fd.append("source_file", entry.file, entry.file.name);
      const res = await api.post<{
        invoice_id: number;
        invoice_number: string;
        line_items_created: number;
        duplicate?: boolean;
      }>("ai/invoice/create/", fd);
      updateFile(entry.id, {
        // Distinguish "we created a new one" from "backend dedup'd to
        // an existing one" so the user knows we skipped a duplicate.
        status: res.data.duplicate ? "duplicate" : "created",
        createdInvoiceId: res.data.invoice_id,
        errorMsg: "",
      });
      return true;
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      const msg = err?.response?.data?.error || "Create failed.";
      updateFile(entry.id, { errorMsg: msg });
      return false;
    }
  }, [updateFile]);

  const createAll = async () => {
    const ready = files.filter((f) => f.status === "ready");
    if (!ready.length) return;
    setCreatingAll(true);
    // Concurrent — the create endpoint hits our Django backend (no
    // external rate limits to worry about). 4-way concurrency is a fair
    // balance between speed and DB contention on the Customer auto-create
    // path (which can collide on the unique-name constraint if two
    // parallel calls both try to create the same new supplier).
    const CONCURRENCY = 4;
    let successCount = 0;
    let failCount = 0;
    const queue = [...ready];
    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) {
          const ok = await createOne(next);
          if (ok) successCount++; else failCount++;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ready.length) }, worker)
    );
    setCreatingAll(false);
    if (successCount && !failCount) {
      toast({
        title: `${successCount} invoice${successCount === 1 ? "" : "s"} created`,
        description: failCount ? `${failCount} failed — review and retry.` : "Click an invoice number below to view.",
      });
    } else if (successCount) {
      toast({
        title: `Created ${successCount}, ${failCount} failed`,
        description: "Review the failed entries above.",
        variant: "destructive",
      });
    } else {
      toast({ title: "All creates failed", description: "Check errors and retry.", variant: "destructive" });
    }
  };

  // Aggregate stats for the header summary.
  const stats = useMemo(() => {
    const by: Record<FileStatus, number> = {
      pending: 0, processing: 0, ready: 0, error: 0, created: 0, duplicate: 0,
    };
    files.forEach((f) => { by[f.status]++; });
    return by;
  }, [files]);

  const hasFiles = files.length > 0;
  // "Done" means every file is in a terminal state — created OR
  // dedup'd as duplicate. Both count as success for the user's flow.
  const allDone = hasFiles && (stats.created + stats.duplicate) === files.length;

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-6xl mx-auto">
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "AI Import" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-glow-pulse">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">AI Invoice Import</h1>
              <span className="premium-badge bg-success/15 text-success">Live</span>
              <span className="premium-badge bg-primary/10 text-primary">Bulk</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Drop one or many invoice images — business auto-detected, review &amp; create.
            </p>
          </div>
        </div>
        <Link to="/billing/invoice/list" className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back to Invoices</Link>
      </div>

      {/* Status strip — only shown once at least one file is uploaded so
          the empty-state page stays uncluttered. */}
      {hasFiles && (
        <div className="elevated-card rounded-2xl p-3 flex items-center gap-3 flex-wrap">
          <StatChip label="Pending" value={stats.pending} color="text-muted-foreground bg-secondary/40" />
          <StatChip label="Processing" value={stats.processing} color="text-primary bg-primary/10" spinning={stats.processing > 0} />
          <StatChip label="Ready" value={stats.ready} color="text-warning bg-warning/10" />
          <StatChip label="Created" value={stats.created} color="text-success bg-success/10" />
          <StatChip label="Duplicates" value={stats.duplicate} color="text-chart-3 bg-chart-3/10" />
          {stats.error > 0 && <StatChip label="Errors" value={stats.error} color="text-destructive bg-destructive/10" />}
          <span className="flex-1" />
          {(stats.pending > 0 || stats.error > 0) && (
            <button
              onClick={processAll}
              disabled={processingAll}
              className="premium-btn-primary text-[12px] h-9 disabled:opacity-60"
            >
              {processingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {processingAll ? "Processing…" : `Process ${stats.pending + stats.error} with AI`}
            </button>
          )}
          {stats.ready > 1 && (
            <button
              onClick={createAll}
              disabled={creatingAll}
              className="premium-btn-outline text-[12px] h-9 disabled:opacity-60"
            >
              {creatingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Create All {stats.ready}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Always-visible drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300",
              dragOver ? "border-primary bg-primary/5 scale-[1.01]"
                       : "border-border hover:border-primary/50 hover:bg-secondary/10"
            )}
          >
            <div className="flex flex-col items-center gap-2">
              <ImageIcon className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-[14px] font-semibold text-foreground">
                {hasFiles ? "Drop more or click to add" : "Drop invoice images here"}
              </p>
              <p className="text-[11px] text-muted-foreground">JPEG, PNG, HEIC · max 20MB each · multi-select supported</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {/* Per-file list */}
          {files.length > 0 && (
            <div className="space-y-3">
              {files.map((f) => (
                <FileCard
                  key={f.id}
                  entry={f}
                  businesses={businesses}
                  onRemove={() => removeFile(f.id)}
                  onProcess={() => processOne(f)}
                  onCreate={() => createOne(f)}
                  onUpdate={(patch) => updateFile(f.id, patch)}
                  onUpdateExtracted={(ex) => updateFile(f.id, { extracted: ex })}
                />
              ))}
            </div>
          )}

          {allDone && (
            <div className="elevated-card rounded-2xl p-6 border-l-4 border-l-success text-center">
              <CheckCircle className="w-10 h-10 text-success mx-auto mb-2" />
              <p className="text-[15px] font-semibold text-foreground">
                {stats.created} created
                {stats.duplicate > 0 && `, ${stats.duplicate} already existed (skipped)`}.
              </p>
              <button onClick={() => navigate("/billing/invoice/list")} className="premium-btn-ghost text-[13px] mt-3">
                <FileText className="w-4 h-4" /> View invoice list
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">How it works</h3>
            <div className="space-y-3">
              {[
                { icon: Zap, label: "Gemini 2.5 Flash-Lite", desc: "Multi-key rotation extends daily quota" },
                { icon: Sparkles, label: "Business auto-detected", desc: "From the buyer/seller GSTINs on the invoice" },
                { icon: Shield, label: "Customers auto-created", desc: "If GSTIN doesn't match an existing record" },
                { icon: Clock, label: "Bulk-friendly", desc: "Drop many, process all, review, bulk-create" },
              ].map((f) => (
                <div key={f.label} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <f.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="elevated-card rounded-2xl p-5 space-y-2">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Supported formats</h3>
            <div className="flex flex-wrap gap-2">
              {["JPEG", "PNG", "HEIC", "HEIF"].map((fmt) => (
                <span key={fmt} className="premium-badge bg-secondary/40 text-muted-foreground">{fmt}</span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Max 20MB each · iPhone HEIC photos work natively</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── status chip ─────────────────────────────────────────────────────

function StatChip({ label, value, color, spinning = false }: {
  label: string; value: number; color: string; spinning?: boolean;
}) {
  if (value === 0 && !spinning) return null;
  return (
    <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium", color)}>
      {spinning && <Loader2 className="w-3 h-3 animate-spin" />}
      <span>{label}: {value}</span>
    </div>
  );
}

// ── per-file card ───────────────────────────────────────────────────

type FileCardProps = {
  entry: FileEntry;
  businesses: Array<{ id: number | string; name: string; gst_number?: string }>;
  onRemove: () => void;
  onProcess: () => void;
  onCreate: () => Promise<boolean>;
  onUpdate: (patch: Partial<FileEntry>) => void;
  onUpdateExtracted: (ex: Extracted) => void;
};

function FileCard({ entry, businesses, onRemove, onProcess, onCreate, onUpdate, onUpdateExtracted }: FileCardProps) {
  const statusLabel: Record<FileStatus, string> = {
    pending: "Pending",
    processing: "Extracting…",
    ready: "Review",
    error: "Failed",
    created: "Created",
    duplicate: "Already Exists",
  };
  const statusColor: Record<FileStatus, string> = {
    pending: "bg-secondary/40 text-muted-foreground",
    processing: "bg-primary/10 text-primary",
    ready: "bg-warning/10 text-warning",
    error: "bg-destructive/10 text-destructive",
    created: "bg-success/15 text-success",
    // Tinted differently from "created" — accent/info color so user
    // can scan a bulk list and see how many were actual creates vs
    // dedup'd skips at a glance.
    duplicate: "bg-chart-3/15 text-chart-3",
  };

  const lineItemsTotal = useMemo(() => {
    if (!entry.extracted) return 0;
    return entry.extracted.line_items.reduce((s, li) => s + (li.amount || 0), 0);
  }, [entry.extracted]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="elevated-card rounded-xl overflow-hidden"
    >
      {/* Card header — always visible */}
      <div className="p-3 flex items-center gap-3">
        <img
          src={entry.previewUrl}
          alt=""
          className="w-12 h-12 rounded-lg object-cover shrink-0 bg-secondary/40"
          onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[13px] font-semibold text-foreground truncate">{entry.file.name}</p>
            {/* Key index badge — only when multiple keys are configured.
                With one key the "#1/1" is just noise. */}
            {entry.keyIndex && entry.keyTotal && entry.keyTotal > 1 && (
              <span
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary tracking-wider shrink-0"
                title={`Gemini key ${entry.keyIndex} of ${entry.keyTotal} (others may be cooled down)`}
              >
                Key #{entry.keyIndex}/{entry.keyTotal}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {(entry.file.size / 1024 / 1024).toFixed(2)}MB
            {entry.extracted && ` · ${entry.extracted.line_items.length} item${entry.extracted.line_items.length === 1 ? "" : "s"} · ${formatCurrency(lineItemsTotal)}`}
            {entry.matchedBusiness && ` · ${entry.matchedBusiness.name}`}
          </p>
        </div>
        <span className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-md flex items-center gap-1", statusColor[entry.status])}>
          {entry.status === "processing" && <Loader2 className="w-3 h-3 animate-spin" />}
          {entry.status === "created" && <CheckCircle className="w-3 h-3" />}
          {entry.status === "duplicate" && <CheckCircle className="w-3 h-3" />}
          {entry.status === "error" && <AlertTriangle className="w-3 h-3" />}
          {statusLabel[entry.status]}
        </span>
        {entry.status === "pending" && (
          <button onClick={onProcess} className="premium-btn-outline text-[11px] h-8">
            <Sparkles className="w-3.5 h-3.5" /> Process
          </button>
        )}
        {entry.status === "ready" && (
          <button
            onClick={() => onUpdate({ expanded: !entry.expanded })}
            className="premium-btn-ghost text-[11px] h-8"
          >
            {entry.expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {entry.expanded ? "Collapse" : "Review"}
          </button>
        )}
        {entry.status === "error" && (
          <button onClick={onProcess} className="premium-btn-outline text-[11px] h-8 border-warning/30 text-warning">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        )}
        {(entry.status === "created" || entry.status === "duplicate") && entry.createdInvoiceId && (
          <Link
            to={`/billing/invoice/${entry.createdInvoiceId}`}
            className="text-[11px] text-primary font-semibold hover:underline"
            title={entry.status === "duplicate" ? "Open the existing invoice" : "Open the newly created invoice"}
          >
            View →
          </Link>
        )}
        {entry.status !== "processing" && entry.status !== "created" && entry.status !== "duplicate" && (
          <button
            onClick={onRemove}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Remove"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {entry.status === "error" && entry.errorMsg && (
        <div className="px-3 pb-3 text-[11px] text-destructive bg-destructive/5 -mt-1">
          {entry.errorMsg}
        </div>
      )}

      {/* Inline review form — appears when expanded */}
      <AnimatePresence>
        {entry.expanded && entry.extracted && entry.status === "ready" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/40"
          >
            <ReviewForm
              entry={entry}
              businesses={businesses}
              onUpdate={onUpdate}
              onUpdateExtracted={onUpdateExtracted}
              onCreate={onCreate}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── review form ─────────────────────────────────────────────────────

function ReviewForm({
  entry, businesses, onUpdate, onUpdateExtracted, onCreate,
}: {
  entry: FileEntry;
  businesses: Array<{ id: number | string; name: string; gst_number?: string }>;
  onUpdate: (patch: Partial<FileEntry>) => void;
  onUpdateExtracted: (ex: Extracted) => void;
  onCreate: () => Promise<boolean>;
}) {
  const ex = entry.extracted!;
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    await onCreate();
    setCreating(false);
  };

  const updateLine = (i: number, key: keyof LineItem, val: unknown) => {
    const next = [...ex.line_items];
    next[i] = { ...next[i], [key]: val } as LineItem;
    onUpdateExtracted({ ...ex, line_items: next });
  };

  const lineItemsTotal = ex.line_items.reduce((s, li) => s + (li.amount || 0), 0);

  return (
    <div className="p-4 space-y-4 bg-secondary/5">
      {/* Business + invoice type controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Business {entry.matchedBusiness && <span className="text-success normal-case font-normal">· auto-detected</span>}
          </label>
          <select
            value={entry.businessOverrideId}
            onChange={(e) => onUpdate({ businessOverrideId: e.target.value })}
            className="premium-select w-full text-[12px]"
          >
            <option value="">Select business</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {!entry.matchedBusiness && ex.recipient_gst_number && (
            <p className="text-[10px] text-warning">
              GSTIN {ex.recipient_gst_number} on invoice doesn't match any of your businesses — pick manually.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Invoice Type</label>
          <div className="flex rounded-lg overflow-hidden border border-border/60 h-9">
            <button
              onClick={() => onUpdate({ type: "outward" })}
              className={cn("flex-1 text-[11px] font-semibold transition-all",
                entry.type === "outward" ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-secondary/30")}
            >
              Sale
            </button>
            <button
              onClick={() => onUpdate({ type: "inward" })}
              className={cn("flex-1 text-[11px] font-semibold transition-all",
                entry.type === "inward" ? "bg-warning/15 text-warning" : "text-muted-foreground hover:bg-secondary/30")}
            >
              Purchase
            </button>
          </div>
        </div>
      </div>

      {/* Invoice meta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Invoice Number" value={ex.invoice_number}
          onChange={(v) => onUpdateExtracted({ ...ex, invoice_number: v })} />
        <Field label="Invoice Date" type="date" value={ex.invoice_date}
          onChange={(v) => onUpdateExtracted({ ...ex, invoice_date: v })} />
      </div>

      {/* Customer (supplier for purchase) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Customer Name" value={ex.customer_name}
          onChange={(v) => onUpdateExtracted({ ...ex, customer_name: v })} />
        <Field label="GSTIN" value={ex.customer_gst_number}
          onChange={(v) => onUpdateExtracted({ ...ex, customer_gst_number: v })} />
      </div>

      {/* Line items — compact table */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Line Items · {ex.line_items.length}
        </p>
        <div className="space-y-1.5">
          {ex.line_items.map((li, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-end p-2 rounded-lg bg-background/40">
              <div className="col-span-12 sm:col-span-5">
                <input type="text" value={li.product_name} onChange={(e) => updateLine(i, "product_name", e.target.value)}
                  className="premium-input h-8 w-full text-[11px]" placeholder="Product" />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <input type="number" value={li.quantity} step="0.001" onChange={(e) => updateLine(i, "quantity", Number(e.target.value))}
                  className="premium-input h-8 w-full text-[11px] text-center" placeholder="Qty" />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <input type="number" value={li.rate} step="0.01" onChange={(e) => updateLine(i, "rate", Number(e.target.value))}
                  className="premium-input h-8 w-full text-[11px]" placeholder="Rate" />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <input type="number" value={Math.round((li.gst_tax_rate || 0) * 1000) / 10} step="0.1" onChange={(e) => updateLine(i, "gst_tax_rate", Number(e.target.value) / 100)}
                  className="premium-input h-8 w-full text-[11px] text-center" placeholder="GST%" />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <input type="number" value={li.amount} step="0.01" onChange={(e) => updateLine(i, "amount", Number(e.target.value))}
                  className="premium-input h-8 w-full text-[11px] tabular-nums font-semibold" placeholder="Amount" />
              </div>
              <div className="col-span-12 sm:col-span-1 flex justify-end">
                <button
                  onClick={() => onUpdateExtracted({ ...ex, line_items: ex.line_items.filter((_, idx) => idx !== i) })}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-destructive/70 hover:bg-destructive/10"
                  title="Remove row"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => onUpdateExtracted({
              ...ex,
              line_items: [...ex.line_items, { product_name: "", quantity: 1, rate: 0, hsn_code: "", gst_tax_rate: 0.03, amount: 0 }],
            })}
            className="text-[11px] text-primary font-semibold flex items-center gap-1 hover:underline"
          >
            <Plus className="w-3 h-3" /> Add row
          </button>
        </div>
      </div>

      {/* Totals + action */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
        <div className="text-[11px] text-muted-foreground">
          Total: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(lineItemsTotal)}</span>
          {ex.cgst_total > 0 && <span className="ml-3">CGST: {formatCurrency(ex.cgst_total)}</span>}
          {ex.sgst_total > 0 && <span className="ml-1.5">· SGST: {formatCurrency(ex.sgst_total)}</span>}
          {ex.igst_total > 0 && <span className="ml-1.5">· IGST: {formatCurrency(ex.igst_total)}</span>}
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !entry.businessOverrideId}
          className="premium-btn-primary text-[12px] h-9 disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          {creating ? "Creating…" : "Create Invoice"}
        </button>
      </div>

      {entry.errorMsg && (
        <p className="text-[11px] text-destructive">{entry.errorMsg}</p>
      )}
    </div>
  );
}

// ── small editable field ────────────────────────────────────────────

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="premium-input h-9 w-full text-[12px]"
      />
    </div>
  );
}
