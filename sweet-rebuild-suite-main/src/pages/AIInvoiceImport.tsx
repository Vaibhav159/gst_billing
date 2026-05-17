import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBusinesses } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Upload, Bot, CheckCircle, ArrowRight, Image as ImageIcon, Sparkles,
  Clock, Shield, FileText, ArrowLeft, Zap, Loader2, AlertTriangle,
  Plus, Trash2, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import api from "@/utils/api";
import { formatCurrency } from "@/utils/mockData";

// What the backend's AIInvoiceProcessor._convert_to_dict actually returns.
// Floats (not Decimal strings) so they're editable as numbers without
// parseFloat on every change. Matches billing/utils.py contract.
type LineItem = {
  product_name: string;
  quantity: number;
  rate: number;
  hsn_code: string;
  gst_tax_rate: number; // decimal: 0.03 for 3%
  amount: number;       // tax-inclusive line subtotal
};

type Extracted = {
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  customer_name: string;
  customer_address: string;
  customer_gst_number: string;
  customer_pan_number: string;
  customer_mobile_number: string;
  line_items: LineItem[];
  total_amount: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
};

// Accept only what NIM officially supports (per docs.api.nvidia.com).
// WebP is undocumented and was failing intermittently in testing.
const ACCEPTED_MIME = ["image/jpeg", "image/jpg", "image/png"];
const ACCEPT_ATTR = ".jpg,.jpeg,.png,image/jpeg,image/png";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB hard cap, matches backend

export default function AIInvoiceImport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [biz, setBiz] = useState("");
  const [type, setType] = useState<"outward" | "inward">("outward");
  const [dragOver, setDragOver] = useState(false);

  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [processing, setProcessing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Default to first business when the list loads.
  useEffect(() => {
    if (!biz && businesses.length > 0) setBiz(String(businesses[0].id));
  }, [businesses, biz]);

  // Object URL for image preview — revoke on unmount/change to avoid leaks.
  useEffect(() => {
    if (!file) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!ACCEPTED_MIME.includes(f.type)) {
      toast({
        title: "Unsupported file type",
        description: `${f.type || "Unknown type"} — upload a JPEG or PNG.`,
        variant: "destructive",
      });
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast({
        title: "File too large",
        description: `${(f.size / 1024 / 1024).toFixed(1)}MB exceeds the 10MB cap.`,
        variant: "destructive",
      });
      return;
    }
    setFile(f);
    setErrorMsg("");
  };

  const handleProcess = async () => {
    if (!file || !biz) return;
    setProcessing(true);
    setErrorMsg("");
    setStep(2);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("business_id", biz);
      // axios attaches Bearer token automatically via the request interceptor.
      // Browser sets multipart Content-Type with boundary.
      const res = await api.post<{ success: boolean; data: Extracted; message: string }>(
        "ai/invoice/process/",
        fd,
        // Vision LLM can take 30-60s; raise the default axios timeout.
        { timeout: 120_000 }
      );
      setExtracted(res.data.data);
      setStep(3);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      const msg = err?.response?.data?.error || err?.message || "AI extraction failed.";
      setErrorMsg(msg);
      toast({ title: "Extraction failed", description: msg, variant: "destructive" });
      setStep(1);
    } finally {
      setProcessing(false);
    }
  };

  const handleCreate = async () => {
    if (!extracted || !biz) return;
    setCreating(true);
    try {
      const res = await api.post<{
        invoice_id: number; invoice_number: string; line_items_created: number;
      }>("ai/invoice/create/", {
        business_id: biz,
        type_of_invoice: type,
        invoice_data: extracted,
      });
      toast({
        title: "Invoice created",
        description: `${res.data.invoice_number} · ${res.data.line_items_created} line item${res.data.line_items_created === 1 ? "" : "s"}`,
      });
      navigate(`/billing/invoice/${res.data.invoice_id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; customer_name?: string } } };
      const data = err?.response?.data;
      const msg = data?.error || "Failed to create invoice.";
      // Customer-not-found is the most common predictable failure — surface
      // a quick "create the customer" link instead of just toasting.
      if (data?.customer_name) {
        setErrorMsg(msg);
        toast({
          title: "Customer not found",
          description: `Create "${data.customer_name}" first, then come back.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Create failed", description: msg, variant: "destructive" });
      }
    } finally {
      setCreating(false);
    }
  };

  // Sum line subtotals so the totals tile always reflects what'll actually
  // be saved — invoice.total_amount on the backend is sum(line_items.amount).
  const lineItemsTotal = useMemo(
    () => (extracted?.line_items || []).reduce((s, li) => s + (li.amount || 0), 0),
    [extracted?.line_items]
  );

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
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Upload an invoice image — Llama 4 Vision extracts fields, you review &amp; create.
            </p>
          </div>
        </div>
        <Link to="/billing/invoice/list" className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back to Invoices</Link>
      </div>

      {/* Steps Indicator */}
      <div className="elevated-card rounded-2xl p-3 sm:p-4">
        <div className="flex items-center gap-1.5 sm:gap-3">
          {[{ n: 1, label: "Upload Image", icon: Upload }, { n: 2, label: "AI Processing", icon: Sparkles }, { n: 3, label: "Review & Create", icon: CheckCircle }].map((s, i) => (
            <div key={s.n} className="flex items-center gap-1.5 sm:gap-2.5 flex-1 min-w-0">
              <div className={cn("flex items-center gap-1.5 sm:gap-2.5 flex-1 min-w-0 p-2 sm:p-3 rounded-xl transition-all",
                step === s.n ? "bg-primary/10 border border-primary/20" : step > s.n ? "bg-success/5 border border-success/20" : "border border-transparent"
              )}>
                <div className={cn("w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-[12px] sm:text-[13px] font-bold transition-all shrink-0",
                  step > s.n ? "bg-success text-success-foreground" : step === s.n ? "bg-primary text-primary-foreground glow-sm" : "bg-secondary/50 text-muted-foreground"
                )}>
                  {step > s.n ? <CheckCircle className="w-4 h-4" /> : s.n}
                </div>
                <div className={cn("min-w-0 flex-1", step !== s.n && "hidden sm:block")}>
                  <p className={cn("text-[11px] sm:text-[12px] font-semibold truncate", step >= s.n ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
                </div>
              </div>
              {i < 2 && <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* Inline error banner — surfaces customer-not-found etc. above the
          step content so users see it before scrolling. */}
      {errorMsg && step !== 2 && (
        <div className="elevated-card rounded-2xl p-4 border-l-4 border-l-destructive flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground">Something went wrong</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="upload" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                className="elevated-card rounded-2xl p-7 space-y-5">
                <h2 className="text-[15px] font-display font-semibold text-foreground">Upload Invoice Image</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Business</label>
                    <select value={biz} onChange={(e) => setBiz(e.target.value)} className="premium-select w-full">
                      <option value="">Select business</option>
                      {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Invoice Type</label>
                    <div className="flex rounded-xl overflow-hidden border border-border/60">
                      <button onClick={() => setType("outward")}
                        className={cn("flex-1 h-10 text-[12px] font-semibold transition-all",
                          type === "outward" ? "bg-success/15 text-success" : "text-muted-foreground hover:bg-secondary/30")}>
                        Sale (Outward)
                      </button>
                      <button onClick={() => setType("inward")}
                        className={cn("flex-1 h-10 text-[12px] font-semibold transition-all",
                          type === "inward" ? "bg-warning/15 text-warning" : "text-muted-foreground hover:bg-secondary/30")}>
                        Purchase (Inward)
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300 min-h-[200px] flex items-center justify-center",
                    dragOver ? "border-primary bg-primary/5 scale-[1.01]" :
                    file ? "border-success/40 bg-success/3" :
                    "border-border hover:border-primary/50 hover:bg-secondary/10"
                  )}
                >
                  {file && previewUrl ? (
                    <div className="space-y-3">
                      <img src={previewUrl} alt="Invoice preview" className="max-h-48 mx-auto rounded-lg shadow-md" />
                      <div>
                        <p className="text-[14px] font-semibold text-foreground">{file.name}</p>
                        <p className="text-[12px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ImageIcon className="w-12 h-12 text-muted-foreground/40 mx-auto" />
                      <p className="text-[14px] font-semibold text-foreground">Drop an invoice image here</p>
                      <p className="text-[12px] text-muted-foreground">JPEG or PNG · max 10MB</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_ATTR}
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                </div>

                <button
                  disabled={!file || !biz || processing}
                  onClick={handleProcess}
                  className={cn(
                    "w-full h-12 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all",
                    file && biz && !processing ? "bg-primary text-primary-foreground hover:brightness-110 glow-sm" : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Bot className="w-5 h-5" />}
                  {processing ? "Processing…" : "Process with AI"}
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="processing" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                className="elevated-card rounded-2xl p-16 text-center space-y-6">
                <div className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto animate-pulse glow-primary">
                  <Bot className="w-10 h-10 text-primary" />
                </div>
                <div>
                  <p className="text-xl font-display font-bold text-foreground">Extracting invoice data…</p>
                  <p className="text-[13px] text-muted-foreground mt-2">Sending image to Llama 4 Vision · typically 5–15s</p>
                </div>
                <div className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Don't close this tab</span>
                </div>
              </motion.div>
            )}

            {step === 3 && extracted && (
              <motion.div key="review" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                className="elevated-card rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5 text-success">
                    <CheckCircle className="w-5 h-5" />
                    <h2 className="text-[16px] font-display font-bold">Extracted — review &amp; edit</h2>
                  </div>
                  <button onClick={() => { setExtracted(null); setStep(1); setErrorMsg(""); }} className="premium-btn-ghost text-[12px]">
                    <RefreshCw className="w-3.5 h-3.5" /> Re-upload
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground -mt-2">
                  AI is a first draft — verify every number before creating the invoice.
                </p>

                {/* Invoice meta */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Invoice Number" value={extracted.invoice_number}
                    onChange={(v) => setExtracted({ ...extracted, invoice_number: v })} />
                  <Field label="Invoice Date" type="date" value={extracted.invoice_date}
                    onChange={(v) => setExtracted({ ...extracted, invoice_date: v })} />
                </div>

                {/* Customer */}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Customer</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Name" value={extracted.customer_name}
                      onChange={(v) => setExtracted({ ...extracted, customer_name: v })} />
                    <Field label="GSTIN" value={extracted.customer_gst_number}
                      onChange={(v) => setExtracted({ ...extracted, customer_gst_number: v })} />
                    <Field label="PAN" value={extracted.customer_pan_number}
                      onChange={(v) => setExtracted({ ...extracted, customer_pan_number: v })} />
                    <Field label="Mobile" value={extracted.customer_mobile_number}
                      onChange={(v) => setExtracted({ ...extracted, customer_mobile_number: v })} />
                  </div>
                  <Field label="Address" value={extracted.customer_address}
                    onChange={(v) => setExtracted({ ...extracted, customer_address: v })} />
                </div>

                {/* Line items */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Line Items · {extracted.line_items.length}
                    </p>
                    <button
                      onClick={() => setExtracted({
                        ...extracted,
                        line_items: [
                          ...extracted.line_items,
                          { product_name: "", quantity: 1, rate: 0, hsn_code: "", gst_tax_rate: 0.03, amount: 0 },
                        ],
                      })}
                      className="text-[11px] text-primary font-semibold flex items-center gap-1 hover:underline"
                    >
                      <Plus className="w-3 h-3" /> Add row
                    </button>
                  </div>
                  <div className="space-y-2">
                    {extracted.line_items.map((li, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end p-2.5 rounded-xl bg-secondary/20">
                        <div className="col-span-12 sm:col-span-4">
                          <label className="text-[10px] text-muted-foreground uppercase">Product</label>
                          <input type="text" value={li.product_name}
                            onChange={(e) => updateItem(extracted, setExtracted, i, "product_name", e.target.value)}
                            className="premium-input h-9 w-full text-[12px]" />
                        </div>
                        <div className="col-span-3 sm:col-span-1">
                          <label className="text-[10px] text-muted-foreground uppercase">Qty</label>
                          <input type="number" value={li.quantity} min={0} step="0.001"
                            onChange={(e) => updateItem(extracted, setExtracted, i, "quantity", Number(e.target.value))}
                            className="premium-input h-9 w-full text-[12px] text-center" />
                        </div>
                        <div className="col-span-3 sm:col-span-2">
                          <label className="text-[10px] text-muted-foreground uppercase">Rate</label>
                          <input type="number" value={li.rate} min={0} step="0.01"
                            onChange={(e) => updateItem(extracted, setExtracted, i, "rate", Number(e.target.value))}
                            className="premium-input h-9 w-full text-[12px]" />
                        </div>
                        <div className="col-span-3 sm:col-span-1">
                          <label className="text-[10px] text-muted-foreground uppercase">GST%</label>
                          <input type="number" value={Math.round((li.gst_tax_rate || 0) * 1000) / 10} min={0} step="0.1"
                            onChange={(e) => updateItem(extracted, setExtracted, i, "gst_tax_rate", Number(e.target.value) / 100)}
                            className="premium-input h-9 w-full text-[12px] text-center" />
                        </div>
                        <div className="col-span-3 sm:col-span-1">
                          <label className="text-[10px] text-muted-foreground uppercase">HSN</label>
                          <input type="text" value={li.hsn_code}
                            onChange={(e) => updateItem(extracted, setExtracted, i, "hsn_code", e.target.value)}
                            className="premium-input h-9 w-full text-[12px] font-mono" />
                        </div>
                        <div className="col-span-9 sm:col-span-2">
                          <label className="text-[10px] text-muted-foreground uppercase">Amount</label>
                          <input type="number" value={li.amount} min={0} step="0.01"
                            onChange={(e) => updateItem(extracted, setExtracted, i, "amount", Number(e.target.value))}
                            className="premium-input h-9 w-full text-[12px] tabular-nums font-semibold" />
                        </div>
                        <div className="col-span-3 sm:col-span-1 flex items-end">
                          <button
                            onClick={() => setExtracted({
                              ...extracted,
                              line_items: extracted.line_items.filter((_, idx) => idx !== i),
                            })}
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
                            title="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/40">
                  <NumField label="CGST" value={extracted.cgst_total}
                    onChange={(v) => setExtracted({ ...extracted, cgst_total: v })} />
                  <NumField label="SGST" value={extracted.sgst_total}
                    onChange={(v) => setExtracted({ ...extracted, sgst_total: v })} />
                  <NumField label="IGST" value={extracted.igst_total}
                    onChange={(v) => setExtracted({ ...extracted, igst_total: v })} />
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Invoice Total</label>
                    <div className="h-9 px-3 rounded-lg bg-success/8 border border-success/20 flex items-center font-semibold text-success tabular-nums text-[13px]"
                         title="Sum of line item amounts — what the invoice will be saved as.">
                      {formatCurrency(lineItemsTotal)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button onClick={() => { setExtracted(null); setStep(1); setErrorMsg(""); }}
                    disabled={creating}
                    className="premium-btn-ghost flex-1 text-[13px]">
                    <ArrowLeft className="w-4 h-4" /> Re-upload
                  </button>
                  <button onClick={handleCreate} disabled={creating}
                    className="premium-btn-primary flex-[2] text-[13px] disabled:opacity-50">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {creating ? "Creating…" : "Create Invoice"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Image preview persists across steps so user can cross-check */}
          {previewUrl && (
            <div className="elevated-card rounded-2xl p-4 space-y-3">
              <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Source Image</h3>
              <img src={previewUrl} alt="Source invoice" className="w-full rounded-lg" />
              {file && <p className="text-[10px] text-muted-foreground text-center">{(file.size / 1024).toFixed(1)} KB</p>}
            </div>
          )}

          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">How it works</h3>
            <div className="space-y-3">
              {[
                { icon: Zap, label: "Llama 4 Vision (NVIDIA NIM)", desc: "OpenAI-compatible, free tier" },
                { icon: Shield, label: "Customer must exist", desc: "Add the customer first; AI matches by name" },
                { icon: Clock, label: "5–15 seconds", desc: "Vision LLM, depends on image size" },
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
        </div>
      </div>
    </div>
  );
}

// ── small editable field helpers ────────────────────────────────────

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

function NumField({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      <input
        type="number"
        value={value || 0}
        min={0}
        step="0.01"
        onChange={(e) => onChange(Number(e.target.value))}
        className="premium-input h-9 w-full text-[12px] tabular-nums"
      />
    </div>
  );
}

// Inlined here (rather than a top-level helper) so the state-shape is
// obvious at call site — we're mutating one field of one line item.
function updateItem<K extends keyof LineItem>(
  ex: Extracted, set: (e: Extracted) => void,
  i: number, key: K, val: LineItem[K]
) {
  const next = [...ex.line_items];
  next[i] = { ...next[i], [key]: val };
  set({ ...ex, line_items: next });
}
