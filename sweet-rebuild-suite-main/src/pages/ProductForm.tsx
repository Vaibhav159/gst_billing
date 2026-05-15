import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProducts, useProduct, useInvoices, generateId } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Save, X, AlertTriangle, Package, Pencil, Hash, FileText,
  CheckCircle2, Info, Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/utils/utils";
import { formatApiError, errorTag } from "@/utils/apiError";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

// Common HSN codes for jewellery / general
const commonHSNCodes = [
  { hsn: "71131910", name: "Gold Jewellery", gst: 3 },
  { hsn: "71131920", name: "Silver Jewellery", gst: 3 },
  { hsn: "71131990", name: "Other Precious Jewellery", gst: 3 },
  { hsn: "71141910", name: "Gold Articles", gst: 3 },
  { hsn: "71023100", name: "Diamonds (Non-Industrial)", gst: 0.25 },
  { hsn: "71069210", name: "Silver Bars", gst: 3 },
  { hsn: "71081200", name: "Gold (Non-Monetary)", gst: 3 },
  { hsn: "71171900", name: "Imitation Jewellery", gst: 12 },
  { hsn: "96062100", name: "Buttons", gst: 18 },
  { hsn: "48191010", name: "Packaging Boxes", gst: 18 },
];

export default function ProductForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items: products, create: createProduct, update: updateProduct } = useProducts();
  const { items: invoices } = useInvoices();
  const isEdit = !!id;
  const { item: existing, isLoading } = useProduct(isEdit ? id : undefined);

  const [form, setForm] = useState({
    name: "",
    hsn: "",
    gstRate: "3",
    description: "",
  });

  useEffect(() => {
    if (isEdit && existing) {
      setForm({
        name: existing.name || "",
        hsn: existing.hsn || "",
        gstRate: existing.gstRate?.toString() || "3",
        description: existing.description || "",
      });
    }
  }, [existing, isEdit]);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [showHSNSuggestions, setShowHSNSuggestions] = useState(false);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);

  // Browser beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (isEdit && isLoading) return <div className="p-8 text-muted-foreground">Loading product...</div>;

  const safeNavigate = (to: string) => {
    if (dirty) { setPendingNavigation(to); setShowUnsavedModal(true); }
    else navigate(to);
  };

  const handleChange = (field: string, val: string) => {
    setForm((p) => ({ ...p, [field]: val }));
    setDirty(true);
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));

    // Duplicate detection by name
    if (field === "name" && !isEdit && val.length >= 3) {
      const dup = products.find((p) => p.name.toLowerCase() === val.toLowerCase());
      setShowDuplicateWarning(!!dup);
    } else if (field === "name") {
      setShowDuplicateWarning(false);
    }

    // HSN suggestions
    if (field === "hsn") {
      setShowHSNSuggestions(val.length >= 2);
    }
  };

  const selectHSN = (code: typeof commonHSNCodes[0]) => {
    setForm((p) => ({ ...p, hsn: code.hsn, gstRate: code.gst.toString() }));
    setShowHSNSuggestions(false);
    setDirty(true);
  };

  const hsnSuggestions = form.hsn.length >= 2
    ? commonHSNCodes.filter((c) => c.hsn.includes(form.hsn) || c.name.toLowerCase().includes(form.hsn.toLowerCase()))
    : [];

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Product name is required";
    if (!form.hsn.trim()) errs.hsn = "HSN code is required";
    else if (!/^\d{4,8}$/.test(form.hsn)) errs.hsn = "HSN must be 4-8 digits";
    return errs;
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return; // Block double-clicks on the Save button.
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Validation Error", description: "Please fix the highlighted fields.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      if (isEdit) {
        await updateProduct(id!, { name: form.name, hsn: form.hsn, gstRate: Number(form.gstRate), description: form.description });
        toast({ title: "Product Updated", description: form.name });
      } else {
        const newId = generateId("p-");
        await createProduct({ id: newId, name: form.name, hsn: form.hsn, gstRate: Number(form.gstRate), description: form.description, createdAt: new Date().toISOString() });
        toast({ title: "Product Created", description: form.name });
      }
      setDirty(false);
      navigate("/billing/product/list");
    } catch (err: any) {
      // Previously create/update returned a promise but the function wasn't
      // async, so failures (network blip, unique-name conflict) toasted
      // success and then silently navigated away without saving.
      toast({
        title: `${isEdit ? "Update" : "Create"} Failed ${errorTag(err)}`,
        description: formatApiError(err, "Could not save product."),
        variant: "destructive",
        duration: 12000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Completion
  const completionFields = ["name", "hsn", "gstRate", "description"];
  const filledCount = completionFields.filter((f) => (form as any)[f]?.toString().trim()).length;
  const completionPct = Math.round((filledCount / completionFields.length) * 100);

  // Usage stats (edit mode)
  const usageCount = isEdit ? invoices.reduce((c, inv) => c + inv.items.filter((it) => it.productId === id).length, 0) : 0;

  return (
    <div className="p-6 lg:p-10 space-y-7 max-w-[1440px] mx-auto">
      <Breadcrumbs items={[{ label: "Products", href: "/billing/product/list" }, { label: isEdit ? "Edit" : "New Product" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-chart-3/20 to-chart-3/5 border border-chart-3/20 flex items-center justify-center">
            {isEdit ? <Pencil className="w-5 h-5 text-chart-3" /> : <Package className="w-5 h-5 text-chart-3" />}
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
              {isEdit ? "Edit Product" : "New Product"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isEdit ? `Editing ${existing?.name}` : "Add a new product to your catalog"}
            </p>
          </div>
        </div>
        {dirty && (
          <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="text-[13px] text-warning flex items-center gap-1.5 bg-warning/8 border border-warning/20 px-3 py-1.5 rounded-lg">
            <AlertTriangle className="w-3.5 h-3.5" /> Unsaved changes
          </motion.span>
        )}
      </motion.div>

      {/* Duplicate warning */}
      {showDuplicateWarning && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-warning/30 bg-warning/8 text-warning text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>A product with this name already exists. Consider editing the existing one instead.</span>
        </motion.div>
      )}

      <form onSubmit={handleSubmit}>
        <motion.div variants={stagger} initial="hidden" animate="visible"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ── Main Form ── */}
          <motion.div variants={fadeUp} className="lg:col-span-8 space-y-6">

            {/* Product Details */}
            <div className="elevated-card rounded-2xl p-6 lg:p-7 space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-chart-3/10 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-chart-3" />
                </div>
                <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">Product Details</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <FormField label="Product Name" icon={Package} required error={errors.name}>
                    <input type="text" value={form.name} onChange={(e) => handleChange("name", e.target.value.toUpperCase())}
                      placeholder="e.g. DIAMOND RING 22K" className={cn("premium-input uppercase", errors.name && "border-destructive/50 focus:ring-destructive/30")} />
                  </FormField>
                </div>

                {/* HSN with smart lookup */}
                <div className="relative">
                  <FormField label="HSN Code" icon={Hash} required error={errors.hsn}>
                    <input type="text" value={form.hsn}
                      onChange={(e) => handleChange("hsn", e.target.value.replace(/\D/g, ""))}
                      onFocus={() => { if (form.hsn.length >= 2) setShowHSNSuggestions(true); }}
                      placeholder="e.g. 71131910" maxLength={8}
                      className={cn("premium-input font-mono tabular-nums", errors.hsn && "border-destructive/50 focus:ring-destructive/30")} />
                  </FormField>
                  <AnimatePresence>
                    {showHSNSuggestions && hsnSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-50 top-full left-0 right-0 mt-1 elevated-card rounded-xl border border-border/60 overflow-hidden shadow-lg"
                      >
                        <div className="px-3 py-2 border-b border-border/30">
                          <p className="text-[10px] text-chart-3 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            <Search className="w-3 h-3" /> HSN Suggestions
                          </p>
                        </div>
                        {hsnSuggestions.map((code) => (
                          <button key={code.hsn} type="button"
                            onClick={() => selectHSN(code)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 transition-colors text-left">
                            <code className="text-[12px] font-mono text-chart-3 bg-chart-3/10 px-2 py-0.5 rounded-md">{code.hsn}</code>
                            <span className="text-[12px] text-foreground flex-1">{code.name}</span>
                            <span className="text-[11px] text-muted-foreground">{code.gst}%</span>
                          </button>
                        ))}
                        <div className="px-3 py-2 border-t border-border/30 bg-secondary/10">
                          <button type="button" onClick={() => setShowHSNSuggestions(false)}
                            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                            Use custom HSN
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <FormField label="GST Rate (%)" icon={Hash} required>
                  <select value={form.gstRate} onChange={(e) => handleChange("gstRate", e.target.value)} className="premium-select w-full">
                    {["0", "0.25", "3", "5", "12", "18", "28"].map((r) => (
                      <option key={r} value={r}>{r}%</option>
                    ))}
                  </select>
                </FormField>

                <div className="md:col-span-2">
                  <FormField label="Description" icon={FileText}>
                    <textarea value={form.description} onChange={(e) => handleChange("description", e.target.value)}
                      placeholder="Brief description of the product..." rows={3}
                      className="premium-input h-auto py-3 resize-none" />
                  </FormField>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Sidebar ── */}
          <motion.div variants={fadeUp} className="lg:col-span-4 space-y-5">
            <div className="elevated-card rounded-2xl p-6 space-y-3 lg:sticky lg:top-24">
              <button type="submit" disabled={isSaving} className="premium-btn-primary w-full h-11 text-[14px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                <Save className="w-4 h-4" /> {isSaving ? (isEdit ? "Updating…" : "Creating…") : (isEdit ? "Update Product" : "Create Product")}
              </button>
              <button type="button" disabled={isSaving} onClick={() => safeNavigate("/billing/product/list")} className="premium-btn-ghost w-full h-11 text-[14px] disabled:opacity-50">
                <X className="w-4 h-4" /> Cancel
              </button>

              {/* Usage stat in edit mode */}
              {isEdit && usageCount > 0 && (
                <div className="pt-3 border-t border-border/30">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-chart-1/5 border border-chart-1/15 text-[12px]">
                    <Info className="w-3.5 h-3.5 text-chart-1" />
                    <span className="text-muted-foreground">Used in <strong className="text-foreground">{usageCount}</strong> invoice line items</span>
                  </div>
                </div>
              )}

              {/* Completion meter */}
              <div className="pt-4 border-t border-border/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground font-medium">Completion</span>
                  <span className={cn("text-[13px] font-bold tabular-nums",
                    completionPct === 100 ? "text-success" : completionPct > 50 ? "text-chart-1" : "text-muted-foreground"
                  )}>{completionPct}%</span>
                </div>
                <div className="w-full h-2 bg-secondary/40 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${completionPct}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" as const }}
                    className={cn("h-full rounded-full transition-colors",
                      completionPct === 100 ? "bg-success" : "bg-gradient-to-r from-chart-3/60 to-chart-3"
                    )} />
                </div>
                <div className="space-y-1.5">
                  {completionFields.map((f) => {
                    const filled = !!(form as any)[f]?.toString().trim();
                    const labels: Record<string, string> = { name: "Product Name", hsn: "HSN Code", gstRate: "GST Rate", description: "Description" };
                    return (
                      <div key={f} className="flex items-center gap-2 text-[11px]">
                        <div className={cn("w-1.5 h-1.5 rounded-full", filled ? "bg-success" : "bg-border")} />
                        <span className={cn(filled ? "text-muted-foreground line-through" : "text-foreground")}>{labels[f]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Tips */}
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-chart-3" />
                <h3 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Tips</h3>
              </div>
              <ul className="space-y-2 text-[11px] text-muted-foreground">
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Start typing HSN code to see smart suggestions with auto-fill.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Selecting an HSN suggestion auto-sets the GST rate.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Products are shared across all invoices and businesses.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Duplicate names trigger a warning to prevent confusion.</li>
              </ul>
            </div>
          </motion.div>
        </motion.div>
      </form>

      {/* ── Unsaved Changes Modal ── */}
      <AnimatePresence>
        {showUnsavedModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2 }}
              className="glass-panel rounded-2xl w-full max-w-sm p-6 space-y-5"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <h2 className="text-base font-display font-bold text-foreground">Unsaved Changes</h2>
                  <p className="text-[12px] text-muted-foreground mt-0.5">You have unsaved changes that will be lost.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button"
                  onClick={() => { setShowUnsavedModal(false); setPendingNavigation(null); }}
                  className="premium-btn-ghost flex-1 h-10 text-[13px]">Stay</button>
                <button type="button"
                  onClick={() => { setShowUnsavedModal(false); setDirty(false); if (pendingNavigation) navigate(pendingNavigation); setPendingNavigation(null); }}
                  className="flex-1 h-10 rounded-xl text-[13px] font-semibold bg-destructive text-destructive-foreground hover:brightness-110 flex items-center justify-center gap-2 transition-all">
                  Leave Page
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Reusable form field wrapper */
function FormField({ label, icon: Icon, required, error, hint, children }: {
  label: string; icon: React.ElementType; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground uppercase tracking-wider">
        <Icon className="w-3 h-3 text-muted-foreground" />
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-[11px] text-chart-3 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> {hint}
        </p>
      )}
    </div>
  );
}
