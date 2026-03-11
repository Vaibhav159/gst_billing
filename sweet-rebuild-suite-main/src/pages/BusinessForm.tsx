import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { indianStates } from "@/lib/mockData";
import { useBusinesses, useBusiness, generateId } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Save, X, AlertTriangle, Building2, Pencil, Phone, Mail, MapPin,
  Hash, CreditCard, Landmark, CheckCircle2, Info, FileText,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

const gstStateMap: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "27": "Maharashtra", "29": "Karnataka", "32": "Kerala", "33": "Tamil Nadu",
  "36": "Telangana", "37": "Andhra Pradesh",
};

export default function BusinessForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items: businesses, create: createBusiness, update: updateBusiness } = useBusinesses();
  const isEdit = !!id;
  const { item: existing, isLoading } = useBusiness(isEdit ? id : undefined);

  const [form, setForm] = useState({
    name: "",
    gst: "",
    pan: "",
    state: "",
    address: "",
    mobile: "",
    email: "",
    bankName: "",
    accountNo: "",
    ifsc: "",
    branch: "",
  });

  useEffect(() => {
    if (isEdit && existing) {
      setForm({
        name: existing.name || "",
        gst: existing.gst_number || "",
        pan: existing.pan_number || "",
        state: existing.state_name || "",
        address: existing.address || "",
        mobile: existing.mobile_number || "",
        email: existing.email || "",
        bankName: existing.bank_name || "",
        accountNo: existing.bank_account_number || "",
        ifsc: existing.bank_ifsc_code || "",
        branch: existing.bank_branch_name || "",
      });
    }
  }, [existing, isEdit]);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Browser beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const safeNavigate = (to: string) => {
    if (dirty) {
      setPendingNavigation(to);
      setShowUnsavedModal(true);
    } else {
      navigate(to);
    }
  };

  const handleChange = (field: string, val: string) => {
    const processedVal = (field === "gst" || field === "pan" || field === "ifsc") ? val.toUpperCase() : val;
    setForm((p) => ({ ...p, [field]: processedVal }));
    setDirty(true);
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));
  };

  const handleGSTChange = (val: string) => {
    const upper = val.toUpperCase();
    handleChange("gst", upper);
    if (upper.length >= 2 && !form.state_name) {
      const prefix = upper.substring(0, 2);
      if (gstStateMap[prefix]) setForm((p) => ({ ...p, state: gstStateMap[prefix] }));
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Business name is required";
    if (!form.mobile_number.trim()) errs.mobile_number = "Mobile is required";
    else if (form.mobile_number.length !== 10 || !/^\d+$/.test(form.mobile_number)) errs.mobile_number = "Enter valid 10-digit number";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter valid email";
    if (form.gst_number && form.gst_number.length !== 15) errs.gst_number = "GST must be 15 characters";
    if (form.pan_number && form.pan_number.length !== 10) errs.pan_number = "PAN must be 10 characters";
    if (form.bank_ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank_ifsc_code)) errs.bank_ifsc_code = "Enter valid IFSC code";
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Validation Error", description: "Please fix the highlighted fields.", variant: "destructive" });
      return;
    }
    setDirty(false);
    if (isEdit) {
      updateBusiness(id!, { ...form });
      toast({ title: "Business Updated", description: form.name });
    } else {
      const newId = generateId("b-");
      createBusiness({ id: newId, ...form, createdAt: new Date().toISOString() });
      toast({ title: "Business Created", description: form.name });
    }
    navigate("/billing/business/list");
  };

  // Completion meter
  const completionFields = ["name", "mobile", "gst", "pan", "email", "state", "address", "bankName", "accountNo", "ifsc", "branch"];
  const filledCount = completionFields.filter((f) => (form as any)[f]?.trim()).length;
  const completionPct = Math.round((filledCount / completionFields.length) * 100);

  const gstHint = form.gst_number.length >= 2 && gstStateMap[form.gst_number.substring(0, 2)]
    ? `State: ${gstStateMap[form.gst_number.substring(0, 2)]}`
    : undefined;

  return (
    <div className="p-6 lg:p-10 space-y-7 max-w-[1440px] mx-auto">
      <Breadcrumbs items={[{ label: "Businesses", href: "/billing/business/list" }, { label: isEdit ? "Edit" : "New Business" }]} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-chart-4/20 to-chart-4/5 border border-chart-4/20 flex items-center justify-center">
            {isEdit ? <Pencil className="w-5 h-5 text-chart-4" /> : <Building2 className="w-5 h-5 text-chart-4" />}
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">
              {isEdit ? "Edit Business" : "New Business"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isEdit ? `Editing ${existing?.name}` : "Register a new business entity"}
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

      <form onSubmit={handleSubmit}>
        <motion.div variants={stagger} initial="hidden" animate="visible"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* ── Main Form ── */}
          <motion.div variants={fadeUp} className="lg:col-span-8 space-y-6">

            {/* Basic Information */}
            <div className="elevated-card rounded-2xl p-6 lg:p-7 space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-chart-4/10 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-chart-4" />
                </div>
                <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">Basic Information</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField label="Business Name" icon={Building2} required error={errors.name}>
                  <input type="text" value={form.name} onChange={(e) => handleChange("name", e.target.value)}
                    placeholder="e.g. Sharma Gold Pvt Ltd" className={cn("premium-input", errors.name && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                <FormField label="Mobile Number" icon={Phone} required error={errors.mobile_number}>
                  <input type="text" value={form.mobile_number} onChange={(e) => handleChange("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit number" maxLength={10} className={cn("premium-input tabular-nums", errors.mobile_number && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                <FormField label="Email Address" icon={Mail} error={errors.email}>
                  <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="info@business.com" className={cn("premium-input", errors.email && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                <FormField label="State" icon={MapPin}>
                  <select value={form.state_name} onChange={(e) => handleChange("state", e.target.value)} className="premium-select w-full">
                    <option value="">Select State</option>
                    {indianStates.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </FormField>

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
                <FormField label="GST Number" icon={Hash} error={errors.gst_number} hint={gstHint}>
                  <input type="text" value={form.gst_number} onChange={(e) => handleGSTChange(e.target.value)}
                    placeholder="e.g. 27AABCS1429B1Z1" maxLength={15}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.gst_number && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                <FormField label="PAN Number" icon={CreditCard} error={errors.pan_number}>
                  <input type="text" value={form.pan_number} onChange={(e) => handleChange("pan", e.target.value)}
                    placeholder="e.g. AABCS1429B" maxLength={10}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.pan_number && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>
              </div>
            </div>

            {/* Bank Details */}
            <div className="elevated-card rounded-2xl p-6 lg:p-7 space-y-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Landmark className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-display font-semibold text-foreground uppercase tracking-wider">Bank Details</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormField label="Bank Name" icon={Landmark}>
                  <input type="text" value={form.bank_name} onChange={(e) => handleChange("bankName", e.target.value)}
                    placeholder="e.g. State Bank of India" className="premium-input" />
                </FormField>

                <FormField label="Account Number" icon={CreditCard}>
                  <input type="text" value={form.bank_account_number} onChange={(e) => handleChange("accountNo", e.target.value)}
                    placeholder="Account number" className="premium-input font-mono tabular-nums" />
                </FormField>

                <FormField label="IFSC Code" icon={Hash} error={errors.bank_ifsc_code}>
                  <input type="text" value={form.bank_ifsc_code} onChange={(e) => handleChange("ifsc", e.target.value)}
                    placeholder="e.g. SBIN0001234" maxLength={11}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.bank_ifsc_code && "border-destructive/50 focus:ring-destructive/30")} />
                </FormField>

                <FormField label="Branch" icon={MapPin}>
                  <input type="text" value={form.bank_branch_name} onChange={(e) => handleChange("branch", e.target.value)}
                    placeholder="e.g. Zaveri Bazaar" className="premium-input" />
                </FormField>
              </div>
            </div>
          </motion.div>

          {/* ── Sidebar ── */}
          <motion.div variants={fadeUp} className="lg:col-span-4 space-y-5">
            <div className="elevated-card rounded-2xl p-6 space-y-3 lg:sticky lg:top-24">
              <button type="submit" className="premium-btn-primary w-full h-11 text-[14px] font-semibold">
                <Save className="w-4 h-4" /> {isEdit ? "Update Business" : "Create Business"}
              </button>
              <button type="button" onClick={() => safeNavigate("/billing/business/list")} className="premium-btn-ghost w-full h-11 text-[14px]">
                <X className="w-4 h-4" /> Cancel
              </button>

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
                      completionPct === 100 ? "bg-success" : "bg-gradient-to-r from-chart-4/60 to-chart-4"
                    )} />
                </div>
                <div className="space-y-1.5">
                  {completionFields.map((f) => {
                    const filled = !!(form as any)[f]?.trim();
                    const labels: Record<string, string> = {
                      name: "Business Name", mobile: "Mobile", gst: "GST Number", pan: "PAN",
                      email: "Email", state: "State", address: "Address",
                      bankName: "Bank Name", accountNo: "Account No.", ifsc: "IFSC Code", branch: "Branch",
                    };
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
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />GST number auto-detects state from the first 2 digits.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />GST, PAN & IFSC are auto-uppercased as you type.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Bank details are printed on invoices for payment reference.</li>
                <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Complete all fields for a professional invoice appearance.</li>
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
