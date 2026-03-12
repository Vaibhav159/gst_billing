import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserPlus, Phone, Mail, MapPin, Hash, CreditCard, Save } from "lucide-react";
import { indianStates } from "@/utils/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/utils/utils";
import { useCustomers, generateId } from "@/hooks/useDataStore";

interface QuickCustomerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: { id: string; name: string; gst: string; state: string; mobile: string }) => void;
}

export default function QuickCustomerModal({ open, onClose, onCreated }: QuickCustomerModalProps) {
  const { toast } = useToast();
  const { create: createCustomer } = useCustomers();
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
    if (upper.length >= 2 && !form.state_name) {
      const prefix = upper.substring(0, 2);
      if (gstStateMap[prefix]) setForm((p) => ({ ...p, state: gstStateMap[prefix] }));
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.mobile_number.trim()) errs.mobile_number = "Mobile is required";
    else if (form.mobile_number.length !== 10 || !/^\d+$/.test(form.mobile_number)) errs.mobile_number = "Valid 10-digit number";
    if (form.gst_number && form.gst_number.length !== 15) errs.gst_number = "GST must be 15 chars";
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const newId = generateId("c-");
    const newCustomer = {
      id: newId,
      name: form.name,
      gst: form.gst_number,
      pan: form.pan_number,
      mobile: form.mobile_number,
      email: form.email,
      state: form.state_name,
      address: form.address,
      businesses: [] as string[],
      tags: [] as string[],
      createdAt: new Date().toISOString(),
    };
    createCustomer(newCustomer);
    toast({ title: "Customer Created", description: form.name });
    onCreated({ id: newId, name: form.name, gst: form.gst_number, state: form.state_name, mobile: form.mobile_number });
    setForm({ name: "", gst: "", pan: "", mobile: "", email: "", state: "", address: "" });
    setErrors({});
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
                <Field label="Mobile" icon={Phone} required error={errors.mobile_number}>
                  <input type="text" value={form.mobile_number} onChange={(e) => handleChange("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit" maxLength={10} className={cn("premium-input tabular-nums", errors.mobile_number && "border-destructive/50")} />
                </Field>
                <Field label="GST Number" icon={Hash} error={errors.gst_number}>
                  <input type="text" value={form.gst_number} onChange={(e) => handleGSTChange(e.target.value)}
                    placeholder="e.g. 27AABCK5461H1ZO" maxLength={15}
                    className={cn("premium-input font-mono uppercase tracking-wider", errors.gst_number && "border-destructive/50")} />
                </Field>
                <Field label="State" icon={MapPin}>
                  <select value={form.state_name} onChange={(e) => handleChange("state", e.target.value)} className="premium-select w-full">
                    <option value="">Select State</option>
                    {indianStates.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Email" icon={Mail}>
                  <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)}
                    placeholder="email@example.com" className="premium-input" />
                </Field>
                <Field label="PAN" icon={CreditCard}>
                  <input type="text" value={form.pan_number} onChange={(e) => handleChange("pan", e.target.value.toUpperCase())}
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
