import { useState } from "react";
import { Link } from "react-router-dom";
import { } from "@/utils/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Upload, Bot, CheckCircle, ArrowRight, Image, Sparkles, Clock, Shield,
  FileText, ArrowLeft, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/utils";

export default function AIInvoiceImport() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [biz, setBiz] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const features = [
    { icon: Zap, label: "Instant OCR", desc: "Extract text from any invoice image" },
    { icon: Shield, label: "GST Validated", desc: "Auto-detect GST numbers & HSN codes" },
    { icon: Clock, label: "5-10 seconds", desc: "Lightning fast AI processing" },
  ];

  const extractedData = [
    ["Customer", "Rajesh Kumar"],
    ["GSTIN", "29AABCK5461H1ZO"],
    ["Date", "25 Sep 2024"],
    ["Invoice No", "SGJ/2024-25/108"],
    ["Subtotal", "₹2,15,000"],
    ["Tax (GST 3%)", "₹6,450"],
    ["Total", "₹2,21,450"],
    ["Items", "2 line items"],
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "AI Import" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-glow-pulse">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">AI Invoice Import</h1>
              <span className="premium-badge bg-primary/12 text-primary glow-sm">Beta</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">Upload an invoice image — AI extracts all the data</p>
          </div>
        </div>
        <Link to="/billing/invoice/list" className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back to Invoices</Link>
      </div>

      {/* Steps Indicator */}
      <div className="elevated-card rounded-2xl p-4">
        <div className="flex items-center gap-3">
          {[{ n: 1, label: "Upload Image", icon: Upload }, { n: 2, label: "AI Processing", icon: Sparkles }, { n: 3, label: "Review & Create", icon: CheckCircle }].map((s, i) => (
            <div key={s.n} className="flex items-center gap-2.5 flex-1">
              <div className={cn("flex items-center gap-2.5 flex-1 p-3 rounded-xl transition-all",
                step === s.n ? "bg-primary/10 border border-primary/20" : step > s.n ? "bg-success/5 border border-success/20" : "border border-transparent"
              )}>
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center text-[13px] font-bold transition-all shrink-0",
                  step > s.n ? "bg-success text-success-foreground" : step === s.n ? "bg-primary text-primary-foreground glow-sm" : "bg-secondary/50 text-muted-foreground"
                )}>
                  {step > s.n ? <CheckCircle className="w-4 h-4" /> : s.n}
                </div>
                <div className="min-w-0">
                  <p className={cn("text-[12px] font-semibold", step >= s.n ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
                </div>
              </div>
              {i < 2 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="upload" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                className="elevated-card rounded-2xl p-7 space-y-5">
                <h2 className="text-[15px] font-display font-semibold text-foreground">Upload Invoice Image</h2>

                <div className="space-y-2">
                  <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Business</label>
                  <select value={biz} onChange={(e) => setBiz(e.target.value)} className="premium-select w-full">
                    <option value="">Select Business</option>
                    {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0]); }}
                  onClick={() => document.getElementById("ai-file-input")?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-300",
                    dragOver ? "border-primary bg-primary/5 scale-[1.01]" :
                    file ? "border-success/40 bg-success/3" :
                    "border-border hover:border-primary/50 hover:bg-secondary/10"
                  )}
                >
                  {file ? (
                    <div className="space-y-2">
                      <FileText className="w-12 h-12 text-success/70 mx-auto" />
                      <p className="text-[14px] font-semibold text-foreground">{file.name}</p>
                      <p className="text-[12px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Image className="w-12 h-12 text-muted-foreground/40 mx-auto" />
                      <p className="text-[14px] font-semibold text-foreground">Upload invoice image</p>
                      <p className="text-[12px] text-muted-foreground">JPEG, PNG, WebP — max 10MB</p>
                    </div>
                  )}
                  <input id="ai-file-input" type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </div>

                <button disabled={!file || !biz} onClick={() => setStep(2)}
                  className={cn("w-full h-12 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all",
                    file && biz ? "bg-primary text-primary-foreground hover:brightness-110 glow-sm" : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
                  )}>
                  <Bot className="w-5 h-5" /> Process with AI
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
                  <p className="text-xl font-display font-bold text-foreground">AI is extracting invoice data...</p>
                  <p className="text-[13px] text-muted-foreground mt-2">Analyzing text, numbers, GST details, and line items</p>
                </div>
                <div className="flex items-center justify-center gap-6 text-[12px] text-muted-foreground">
                  {["Reading text...", "Detecting GST numbers...", "Extracting line items..."].map((s, i) => (
                    <motion.span key={s} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.5 }}
                      className="flex items-center gap-1.5">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="w-3 h-3 border border-current border-t-transparent rounded-full" />
                      {s}
                    </motion.span>
                  ))}
                </div>
                <button onClick={() => setStep(3)} className="premium-btn-ghost text-[13px] mx-auto">Simulate Complete</button>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="review" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                className="elevated-card rounded-2xl p-7 space-y-5">
                <div className="flex items-center gap-2.5 text-success">
                  <CheckCircle className="w-5 h-5" />
                  <h2 className="text-[16px] font-display font-bold">Extraction Complete</h2>
                </div>
                <p className="text-[13px] text-muted-foreground">Review the extracted data below. Edit any fields if needed before creating the invoice.</p>

                <div className="grid grid-cols-2 gap-3">
                  {extractedData.map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-secondary/20 border border-border/30 p-3.5 hover:bg-secondary/30 transition-colors">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{k}</p>
                      <p className="text-[14px] font-semibold text-foreground mt-1">{v}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button onClick={() => setStep(1)} className="premium-btn-ghost flex-1 text-[13px]"><ArrowLeft className="w-4 h-4" /> Re-upload</button>
                  <Link to="/billing/invoice/add" className="premium-btn-primary flex-[2] text-[13px]"><FileText className="w-4 h-4" /> Create Invoice from Data</Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">How it works</h3>
            <div className="space-y-3">
              {features.map((f, i) => (
                <div key={f.label} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <f.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Supported Formats</h3>
            <div className="flex flex-wrap gap-2">
              {["JPEG", "PNG", "WebP", "PDF"].map((fmt) => (
                <span key={fmt} className="premium-badge bg-secondary/40 text-muted-foreground">{fmt}</span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Max file size: 10MB</p>
          </div>
        </div>
      </div>
    </div>
  );
}
