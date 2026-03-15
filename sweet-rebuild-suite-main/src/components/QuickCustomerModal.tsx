import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserPlus, Phone, Mail, MapPin, Hash, CreditCard, Save } from "lucide-react";
import { indianStates } from "@/utils/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/utils/utils";
import { useCustomers, useBusinesses } from "@/hooks/useDataStore";

interface QuickCustomerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: { id: string; name: string; gst: string; state: string; mobile: string }) => void;
}

export default function QuickCustomerModal({ open, onClose, onCreated }: QuickCustomerModalProps) {
  const { toast } = useToast();
  const { create: createCustomer } = useCustomers();
  const { items: businesses } = useBusinesses();
  const [form, setForm] = useState({
    name: "", gst: "", pan: "", mobile: "", email: "", state: "", address: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const gstStateMap: Record<string, string> = {
    "27": "Maharashtra", "24": "Gujarat", "29": "Karnataka",
    "07": "Delhi", "08": "Rajasthan", "36": "Telangana", "33": "Tamil Nadu",
    "09": "Uttar Pradesh", "19": "West Bengal", "32": "Kerala",
  };

  const handleChange = (field: string, val: string) => {
    const processed = (field === "gst" || field === "pan") ? val.toUpperCase() : val;
    setForm((p) => ({ ...p, [field]: processed }));
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));
  };

  const handleGSTChange = (val: string) => {
    const upper = val.toUpperCase();
    handleChange("gst", upper);
    if (upper.length >= 2 && !form.state) {
      const prefix = upper.substring(0, 2);
      if (gstStateMap[prefix]) setForm((p) => ({ ...p, state: gstStateMap[prefix] }));
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (form.mobile && (form.mobile.length !== 10 || !/^\d+$/.test(form.mobile))) errs.mobile = "Valid 10-digit number";
    if (form.gst && form.gst.length !== 15) errs.gst = "GST must be 15 chars";
    return errs;
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    try {
      // Send with correct API field names
      const payload = {
        name: form.name,
        gst_number: form.gst,
        pan_number: form.pan,
        mobile_number: form.mobile,
        email: form.email,
        state_name: form.state ? form.state.toUpperCase() : "",
        address: form.address,
        businesses: businesses.map((b) => b.id),
      };
      const created = await createCustomer(payload);
      toast({ title: "Customer Created", description: form.name });
      onCreated({
        id: String(created.id),
        name: created.name || form.name,
        gst: created.gst_number || form.gst,
        state: created.state_name || form.state,
        mobile: created.mobile_number || form.mobile,
      });
      setForm({ name: "", gst: "", pan: "", mobile: "", email: "", state: "", address: "" });
      setErrors({});
    } catch (err: any) {
      const detail = err?.response?.data;
      let errorMsg = "Could not create customer. Please try again.";
      if (detail && typeof detail === "object") {
        errorMsg = Object.entries(detail)
          .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(", ") : val}`)
          .join("\n");
      }
      toast({ title: "Creation Failed", description: errorMsg, variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.2 }}
            className="glass-panel rounded-2xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-display font-bold text-foreground">Quick Add Customer</h2>
                  <p className="text-[12px] text-muted-foreground">Create without leaving the invoice</p>
                </div>
              </div>
              <button type="button" onClick={onClose}
                className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name" icon={UserPlus} required error={errors.name}>
                  <input type="text" value={form.name} onChange={(e) => handleChange("name", e.target.value)}
                    placeholder="Customer name" className={cn("premium-input", errors.name && "border-destructive/50")} />
                </Field>
                <Field label="Mobile" icon={Phone} error={errors.mobile}>
                  <input type="text" value={form.mobile} onChange={(e) => handleChange("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit (optional)" maxLength={10} className={cn("premium-input tabular-nums", errors.mobile && "border-destructive/50")} />
                </Field>
                <Field label="GST Number" icon={Hash} error={errors.gst}>
                  <input type="text" value={form.gst} onChange={(e) => handleGSTChange(e.target.value)}
                    placeholder="e.g. 27AABCK5461H1ZO" maxLength={15}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.gst && "border-destructive/50")} />
                </Field>
                <Field label="State" icon={MapPin}>
                  <select value={form.state} onChange={(e) => handleChange("state", e.target.value)} className="premium-select w-full">
                    <option value="">Select State</option>
                    {indianStates.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Email" icon={Mail}>
                  <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="email@example.com" className="premium-input" />
                </Field>
                <Field label="PAN" icon={CreditCard}>
                  <input type="text" value={form.pan} onChange={(e) => handleChange("pan", e.target.value.toUpperCase())}
                    placeholder="AABCK5461H" maxLength={10} className="premium-input font-mono uppercase" />
                </Field>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="premium-btn-ghost flex-1 h-10 text-[13px]">Cancel</button>
                <button type="submit" className="premium-btn-primary flex-1 h-10 text-[13px]">
                  <Save className="w-4 h-4" /> Create Customer
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, icon: Icon, required, error, children }: {
  label: string; icon: any; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-muted-foreground" /> {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
