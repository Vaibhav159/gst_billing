import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { indianStates, formatCurrency } from "@/utils/mockData";
import { useCustomers, useCustomer, useBusinesses, useInvoices, generateId } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Save, X, AlertTriangle, UserPlus, Pencil, Phone, Mail, MapPin,
  Building2, Hash, CreditCard, FileText, CheckCircle2, Info,
  Search, Users, GitMerge, ChevronDown, ArrowRight, CheckCheck,
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

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items: customers, create: createCustomer, update: updateCustomer } = useCustomers();
  const { items: businesses } = useBusinesses();
  const { items: invoices } = useInvoices();
  const isEdit = !!id;
  const { item: existing, isLoading } = useCustomer(isEdit ? id : undefined);

  const [form, setForm] = useState({
    name: "",
    gst_number: "",
    pan_number: "",
    mobile_number: "",
    email: "",
    state_name: "",
    address: "",
    businesses: [] as string[],
  });

  useEffect(() => {
    if (isEdit && existing) {
      const apiState = existing.state_name || "";
      const matchedState = indianStates.find(s => s.toLowerCase() === apiState.toLowerCase()) || apiState;
      setForm({
        name: existing.name || "",
        gst_number: existing.gst_number || "",
        pan_number: existing.pan_number || "",
        mobile_number: existing.mobile_number || "",
        email: existing.email || "",
        state_name: matchedState,
        address: existing.address || "",
        businesses: (existing.businesses || []).map(String),
      });
    }
  }, [existing, isEdit]);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const nameRef = useRef<HTMLDivElement>(null);

  // Close name suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (nameRef.current && !nameRef.current.contains(e.target as Node)) setShowNameSuggestions(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (field: string, val: string) => {
    // Auto-uppercase for GST and PAN
    const processedVal = (field === "gst_number" || field === "pan_number") ? val.toUpperCase() : val;
    setForm((p) => ({ ...p, [field]: processedVal }));
    setDirty(true);
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));
    if (field === "name" && !isEdit) setShowNameSuggestions(val.length >= 2);
  };

  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Wrap navigate to intercept when dirty
  const safeNavigate = (to: string) => {
    if (dirty) {
      setPendingNavigation(to);
      setShowUnsavedModal(true);
    } else {
      navigate(to);
    }
  };

  // Browser beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const toggleBiz = (bid: string) => {
    setForm((p) => ({
      ...p,
      businesses: p.businesses.includes(String(bid))
        ? p.businesses.filter((b) => b !== String(bid))
        : [...p.businesses, String(bid)],
    }));
    setDirty(true);
  };

  const selectAllBiz = () => {
    const allIds = businesses.map((b) => String(b.id));
    const allSelected = allIds.every((bid) => form.businesses.includes(bid));
    setForm((p) => ({ ...p, businesses: allSelected ? [] : allIds }));
    setDirty(true);
  };

  // Name suggestions for duplicate prevention
  const nameSuggestions = !isEdit && form.name.length >= 2
    ? customers.filter((c) =>
        c.name.toLowerCase().includes(form.name.toLowerCase()) ||
        (c.mobile_number || "").includes(form.name) ||
        (c.gst_number || "").toLowerCase().includes(form.name.toLowerCase())
      ).slice(0, 5)
    : [];

  const duplicate = !isEdit && form.gst_number.length > 5 && customers.find((c) => c.gst_number === form.gst_number);

  const gstStateMap: Record<string, string> = {
    "27": "Maharashtra", "24": "Gujarat", "29": "Karnataka",
    "07": "Delhi", "08": "Rajasthan", "36": "Telangana", "33": "Tamil Nadu",
  };

  const handleGSTChange = (val: string) => {
    const upper = val.toUpperCase();
    handleChange("gst_number", upper);
    if (upper.length >= 2 && !form.state_name) {
      const prefix = upper.substring(0, 2);
      if (gstStateMap[prefix]) setForm((p) => ({ ...p, state_name: gstStateMap[prefix] }));
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (form.mobile_number && form.mobile_number.length !== 10) errs.mobile_number = "Enter 10-digit number";
    if (form.mobile_number && !/^\d+$/.test(form.mobile_number)) errs.mobile_number = "Enter 10-digit number";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter valid email";
    if (form.gst_number && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d$/.test(form.gst_number)) errs.gst_number = "Invalid GSTIN format (e.g. 08AAKPL4741M1Z9)";
    if (form.pan_number && !/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan_number)) errs.pan_number = "Invalid PAN format (e.g. AAKPL4741M)";
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Validation Error", description: "Please fix the highlighted fields.", variant: "destructive" });
      return;
    }
    // Uppercase state_name for backend compatibility
    const payload = { ...form, state_name: form.state_name ? form.state_name.toUpperCase() : "" };
    try {
      if (isEdit) {
        await updateCustomer(id!, payload);
        toast({ title: "Customer Updated", description: form.name });
      } else {
        await createCustomer(payload);
        toast({ title: "Customer Created", description: form.name });
      }
      setDirty(false);
      navigate("/billing/customer/list");
    } catch (err: any) {
      toast({ title: `Save Failed ${errorTag(err)}`, description: formatApiError(err, "Could not save customer."), variant: "destructive", duration: 12000 });
    }
  };

  // Fill form from existing customer (for edit use-case from suggestion)
  const fillFromCustomer = (c: typeof customers[0]) => {
    navigate(`/billing/customer/edit/${c.id}`);
  };

  // Merge logic
  const mergeFilteredCustomers = customers.filter((c) => {
    if (isEdit && String(c.id) === String(id)) return false;
    const q = mergeSearch.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.gst_number.toLowerCase().includes(q) || c.mobile_number.includes(q);
  });

  const handleMerge = async () => {
    if (!mergeTarget || !id) return;
    const target = customers.find((c) => String(c.id) === String(mergeTarget));
    if (!target) return;
    try {
      const { default: api } = await import("@/utils/api");
      const res = await api.post("customers/merge/", {
        source_id: id,
        target_id: mergeTarget,
      });
      toast({
        title: "Customers Merged",
        description: res.data?.message || `${form.name || existing?.name} merged into ${target.name}. All invoices transferred.`,
      });
      setShowMergeModal(false);
      navigate(`/billing/customer/${mergeTarget}`);
    } catch (err: any) {
      toast({
        title: `Merge Failed ${errorTag(err)}`,
        description: formatApiError(err, "Could not merge customers."),
        variant: "destructive",
        duration: 12000,
      });
    }
  };

  const completionFields = ["name", "mobile_number", "gst_number", "pan_number", "email", "state_name", "address"];
  const filledCount = completionFields.filter((f) => (form as any)[f]?.trim()).length;
  const completionPct = Math.round((filledCount / completionFields.length) * 100);
  const allBizSelected = businesses.every((b) => form.businesses.includes(String(b.id)));

  return (
    <div className="p-6 lg:p-10 space-y-7 max-w-[1440px] mx-auto">
      <Breadcrumbs items={[{ label: "Customers", href: "/billing/customer/list" }, { label: isEdit ? "Edit" : "New Customer" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
            {isEdit ? <Pencil className="w-5 h-5 text-primary" /> : <UserPlus className="w-5 h-5 text-primary" />}
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
              {isEdit ? "Edit Customer" : "New Customer"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isEdit ? (isLoading ? "Loading customer..." : `Editing ${existing?.name || ""}`) : "Fill in the details to register a new customer"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {dirty && (
            <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="text-[13px] text-warning flex items-center gap-1.5 bg-warning/8 border border-warning/20 px-3 py-1.5 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" /> Unsaved changes
            </motion.span>
          )}
          {isEdit && (
            <button type="button" onClick={() => setShowMergeModal(true)}
              className="premium-btn-outline text-[13px] h-9 border-chart-4/30 text-chart-4">
              <GitMerge className="w-4 h-4" /> Merge Customer
            </button>
          )}
        </div>
      </motion.div>

      {/* Duplicate warning */}
      {duplicate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-warning/30 bg-warning/8 text-warning text-[13px]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Duplicate GST detected — <strong>{duplicate.name}</strong> already has this GST number.</span>
          <Link to={`/billing/customer/${duplicate.id}`} className="ml-auto text-[12px] font-semibold underline hover:no-underline">
            View existing →
          </Link>
        </motion.div>
      )}

      <form onSubmit={handleSubmit}>
        <motion.div variants={stagger} initial="hidden" animate="visible"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ── Main Form ── */}
          <motion.div variants={fadeUp} className="lg:col-span-8 space-y-6">

            {/* Personal Details */}
            <div className="elevated-card rounded-2xl p-6 lg:p-7 space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">Personal Details</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Name with autocomplete */}
                <div ref={nameRef} className="relative">
                  <FormField label="Full Name" icon={UserPlus} required error={errors.name}>
                    <input type="text" value={form.name}
                      onChange={(e) => handleChange("name", e.target.value)}
                      onFocus={() => { if (form.name.length >= 2 && !isEdit) setShowNameSuggestions(true); }}
                      placeholder="e.g. Rajesh Kumar" autoComplete="off"
                      className={cn("premium-input", errors.name && "border-destructive/50 focus:ring-destructive/30")} />
                  </FormField>
                  {/* Existing customer suggestions dropdown */}
                  <AnimatePresence>
                    {showNameSuggestions && nameSuggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-50 top-full left-0 right-0 mt-1 elevated-card rounded-xl border border-border/60 overflow-hidden shadow-lg"
                      >
                        <div className="px-3 py-2 border-b border-border/30">
                          <p className="text-[10px] text-warning font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3" /> Existing found
                          </p>
                        </div>
                        {nameSuggestions.map((c) => (
                          <button key={c.id} type="button"
                            onClick={() => { fillFromCustomer(c); setShowNameSuggestions(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 transition-colors text-left">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-[11px] font-bold shrink-0">
                              {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-foreground truncate">{c.name}</p>
                              <p className="text-[10px] text-muted-foreground">{c.mobile_number} · {c.state_name}</p>
                            </div>
                            <span className="text-[10px] text-primary font-medium">Edit →</span>
                          </button>
                        ))}
                        <div className="px-3 py-2 border-t border-border/30 bg-secondary/10">
                          <button type="button" onClick={() => setShowNameSuggestions(false)}
                            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                            Continue as new customer
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Mobile */}
                <FormField label="Mobile Number" icon={Phone} error={errors.mobile_number}>
                  <input type="text" value={form.mobile_number} onChange={(e) => handleChange("mobile_number", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit number" maxLength={10} className={cn("premium-input tabular-nums", errors.mobile_number && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                {/* Email */}
                <FormField label="Email Address" icon={Mail} error={errors.email}>
                  <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="email@example.com" className={cn("premium-input", errors.email && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                {/* State */}
                <FormField label="State" icon={MapPin}>
                  <select value={form.state_name} onChange={(e) => handleChange("state_name", e.target.value)} className="premium-select w-full">
                    <option value="">Select State</option>
                    {indianStates.map((s) => <option key={s} value={s}>{s}</option>)}
                    {/* Include the API value if it doesn't match any option */}
                    {form.state_name && !indianStates.includes(form.state_name) && (
                      <option value={form.state_name}>{form.state_name}</option>
                    )}
                  </select>
                </FormField>

                {/* Address */}
                <div className="md:col-span-2">
                  <FormField label="Address" icon={MapPin}>
                    <textarea value={form.address} onChange={(e) => handleChange("address", e.target.value)}
                      placeholder="Full address with pin code..." rows={3}
                      className="premium-input h-auto py-3 resize-none" />
                  </FormField>
                </div>
              </div>
            </div>

            {/* Tax Details */}
            <div className="elevated-card rounded-2xl p-6 lg:p-7 space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-chart-3/10 flex items-center justify-center">
                  <Hash className="w-4 h-4 text-chart-3" />
                </div>
                <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">Tax Information</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField label="GST Number" icon={Hash} error={errors.gst_number}
                  hint={form.gst_number.length >= 2 && gstStateMap[form.gst_number.substring(0, 2)] ? `State: ${gstStateMap[form.gst_number.substring(0, 2)]}` : undefined}>
                  <input type="text" value={form.gst_number} onChange={(e) => handleGSTChange(e.target.value)}
                    placeholder="e.g. 27AABCK5461H1ZO" maxLength={15}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.gst_number && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                <FormField label="PAN Number" icon={CreditCard} error={errors.pan_number}>
                  <input type="text" value={form.pan_number} onChange={(e) => handleChange("pan_number", e.target.value.toUpperCase())}
                    placeholder="e.g. AABCK5461H" maxLength={10}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.pan_number && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>
              </div>
            </div>

            {/* Business Association */}
            <div className="elevated-card rounded-2xl p-6 lg:p-7 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-chart-4/10 flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-chart-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">Associated Businesses</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {form.businesses.length} of {businesses.length} selected
                    </p>
                  </div>
                </div>
                <button type="button" onClick={selectAllBiz}
                  className={cn(
                    "flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all",
                    allBizSelected
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-border/40"
                  )}>
                  <CheckCheck className="w-3.5 h-3.5" />
                  {allBizSelected ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {businesses.map((biz) => {
                  const checked = form.businesses.includes(String(biz.id));
                  return (
                    <label key={biz.id} className={cn(
                      "flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200",
                      checked
                        ? "border-2 border-primary/40 bg-primary/5 shadow-[0_0_16px_-4px_hsl(var(--primary)/0.15)]"
                        : "border border-border/50 hover:bg-secondary/20 hover:border-border"
                    )}>
                      <div className={cn(
                        "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
                        checked ? "bg-primary border-primary" : "border-border"
                      )}>
                        {checked && <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground">{biz.name}</p>
                        <p className="text-[11px] text-muted-foreground">{biz.state_name}</p>
                        <code className="text-[10px] text-muted-foreground/60 font-mono">{biz.gst_number}</code>
                      </div>
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                        checked ? "bg-primary/15" : "bg-secondary/40"
                      )}>
                        <Building2 className={cn("w-3.5 h-3.5", checked ? "text-primary" : "text-muted-foreground")} />
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* ── Sidebar ── */}
          <motion.div variants={fadeUp} className="lg:col-span-4 space-y-5">
            {/* Actions */}
            <div className="elevated-card rounded-2xl p-6 space-y-3 lg:sticky lg:top-24">
              <button type="submit" className="premium-btn-primary w-full h-11 text-[14px] font-semibold">
                <Save className="w-4 h-4" /> {isEdit ? "Update Customer" : "Create Customer"}
              </button>
              <button type="button" onClick={() => safeNavigate("/billing/customer/list")} className="premium-btn-ghost w-full h-11 text-[14px]">
                <X className="w-4 h-4" /> Cancel
              </button>

              {/* Merge button in sidebar for new too */}
              {!isEdit && (
                <button type="button" onClick={() => setShowMergeModal(true)}
                  className="premium-btn-outline w-full h-10 text-[13px] border-chart-4/30 text-chart-4 mt-1">
                  <GitMerge className="w-4 h-4" /> Merge Existing Customers
                </button>
              )}

              {/* Completion meter */}
              <div className="pt-4 border-t border-border/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground font-medium">Profile Completion</span>
                  <span className={cn("text-[13px] font-bold tabular-nums",
                    completionPct === 100 ? "text-success" : completionPct > 50 ? "text-chart-1" : "text-muted-foreground"
                  )}>{completionPct}%</span>
                </div>
                <div className="w-full h-2 bg-secondary/40 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${completionPct}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" as const }}
                    className={cn("h-full rounded-full transition-colors",
                      completionPct === 100 ? "bg-success" : "bg-gradient-to-r from-primary/60 to-primary"
                    )} />
                </div>
                <div className="space-y-1.5">
                  {completionFields.map((f) => {
                    const filled = !!(form as any)[f]?.trim();
                    const labels: Record<string, string> = { name: "Full Name", mobile_number: "Mobile", gst_number: "GST Number", pan_number: "PAN", email: "Email", state_name: "State", address: "Address" };
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
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />GST number auto-detects the state from the first 2 digits.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Typing a name shows existing matches to prevent duplicates.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Use "Merge Customers" to combine duplicate records.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />"Select All" quickly associates all.</li>
              </ul>
            </div>
          </motion.div>
        </motion.div>
      </form>

      {/* ── Merge Customer Modal ── */}
      <AnimatePresence>
        {showMergeModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowMergeModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-border/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-chart-4/10 flex items-center justify-center">
                    <GitMerge className="w-5 h-5 text-chart-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-bold text-foreground">Merge Customers</h2>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {isEdit
                        ? `Select a customer to merge "${existing?.name}" into`
                        : "Select two to merge into one"
                      }
                    </p>
                  </div>
                </div>
                <div className="relative mt-4">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type="text" value={mergeSearch} onChange={(e) => setMergeSearch(e.target.value)}
                    placeholder="Search by name, GST, or phone..."
                    className="premium-input pl-10" autoFocus />
                </div>
              </div>

              {/* Customer List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {mergeFilteredCustomers.map((c) => {
                  const selected = mergeTarget === c.id;
                  const invCount = invoices.filter((inv) => String(inv.customerId) === String(c.id)).length;
                  const revenue = invoices.filter((inv) => String(inv.customerId) === String(c.id) && inv.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setMergeTarget(selected ? null : c.id)}
                      className={cn(
                        "w-full flex items-center gap-3.5 p-3.5 rounded-xl transition-all text-left",
                        selected
                          ? "border-2 border-chart-4/40 bg-chart-4/5"
                          : "border border-border/30 hover:bg-secondary/20 hover:border-border/60"
                      )}>
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0",
                        selected ? "bg-chart-4/15 text-chart-4 border border-chart-4/30" : "bg-primary/10 text-primary border border-primary/15"
                      )}>
                        {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground truncate">{c.name}</p>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                          <span>{c.mobile_number}</span>
                          <span>·</span>
                          <span>{c.state_name}</span>
                          <span>·</span>
                          <span>{invCount} inv</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {(c.tags || []).map((t) => (
                            <span key={t} className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                              t === "VIP" ? "bg-chart-4/12 text-chart-4" :
                              t === "Wholesale" ? "bg-chart-3/12 text-chart-3" :
                              "bg-primary/10 text-primary"
                            )}>{t}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[12px] font-bold text-foreground tabular-nums">{formatCurrency(revenue)}</p>
                        {selected && (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="mt-1">
                            <CheckCircle2 className="w-5 h-5 text-chart-4 ml-auto" />
                          </motion.div>
                        )}
                      </div>
                    </button>
                  );
                })}
                {mergeFilteredCustomers.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                    <Users className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No found</p>
                  </div>
                )}
              </div>

              {/* Merge Preview & Action */}
              <div className="p-5 border-t border-border/30 space-y-3">
                {mergeTarget && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-chart-4/5 border border-chart-4/20 text-[12px]">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-semibold text-foreground">
                        {isEdit ? existing?.name : "Current entry"}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-chart-4" />
                      <span className="font-semibold text-chart-4">
                        {customers.find((c) => String(c.id) === String(mergeTarget))?.name}
                      </span>
                    </div>
                    <span className="text-muted-foreground">All invoices will be transferred</span>
                  </motion.div>
                )}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowMergeModal(false)}
                    className="premium-btn-ghost flex-1 h-10 text-[13px]">
                    Cancel
                  </button>
                  <button type="button" onClick={handleMerge} disabled={!mergeTarget}
                    className={cn(
                      "flex-1 h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all",
                      mergeTarget
                        ? "bg-chart-4 text-primary-foreground hover:brightness-110"
                        : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
                    )}>
                    <GitMerge className="w-4 h-4" /> Merge Customers
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  className="premium-btn-ghost flex-1 h-10 text-[13px]">
                  Stay
                </button>
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
