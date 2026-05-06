import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Package, Save, Hash, Percent, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/utils/utils";
import { useProducts, generateId } from "@/hooks/useDataStore";

interface QuickProductModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (product: { id: string; name: string; hsn: string; gstRate: number; description: string }) => void;
}

export default function QuickProductModal({ open, onClose, onCreated }: QuickProductModalProps) {
  const { toast } = useToast();
  const { create: createProduct } = useProducts();
  const [form, setForm] = useState({ name: "", hsn: "", gstRate: "3", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: string, val: string) => {
    setForm((p) => ({ ...p, [field]: val }));
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.hsn.trim()) errs.hsn = "HSN code is required";
    if (!form.gstRate) errs.gstRate = "GST rate is required";
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    const newId = generateId("p-");
    const newProduct = {
      id: newId,
      name: form.name,
      hsn: form.hsn,
      gstRate: Number(form.gstRate),
      description: form.description,
      createdAt: new Date().toISOString(),
    };
    createProduct(newProduct);
    toast({ title: "Product Created", description: form.name });
    onCreated(newProduct);
    setForm({ name: "", hsn: "", gstRate: "3", description: "" });
    setErrors({});
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ duration: 0.2 }}
            className="glass-panel rounded-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-chart-3/10 flex items-center justify-center">
                  <Package className="w-5 h-5 text-chart-3" />
                </div>
                <div>
                  <h2 className="text-base font-display font-bold text-foreground">Quick Add Product</h2>
                  <p className="text-[12px] text-muted-foreground">Create without leaving the invoice</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-3 h-3 text-muted-foreground" /> Name<span className="text-destructive">*</span>
                  </label>
                  <input type="text" value={form.name} onChange={(e) => handleChange("name", e.target.value)}
                    placeholder="Product name" className={cn("premium-input", errors.name && "border-destructive/50")} />
                  {errors.name && <p className="text-[10px] text-destructive">{errors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Hash className="w-3 h-3 text-muted-foreground" /> HSN Code<span className="text-destructive">*</span>
                  </label>
                  <input type="text" value={form.hsn} onChange={(e) => handleChange("hsn", e.target.value)}
                    placeholder="e.g. 71131910" className={cn("premium-input font-mono", errors.hsn && "border-destructive/50")} />
                  {errors.hsn && <p className="text-[10px] text-destructive">{errors.hsn}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Percent className="w-3 h-3 text-muted-foreground" /> GST Rate<span className="text-destructive">*</span>
                  </label>
                  <select value={form.gstRate} onChange={(e) => handleChange("gstRate", e.target.value)}
                    className={cn("premium-select w-full", errors.gstRate && "border-destructive/50")}>
                    {[0, 3, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                  </select>
                  {errors.gstRate && <p className="text-[10px] text-destructive">{errors.gstRate}</p>}
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3 h-3 text-muted-foreground" /> Description
                  </label>
                  <input type="text" value={form.description} onChange={(e) => handleChange("description", e.target.value)}
                    placeholder="Optional description" className="premium-input" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="premium-btn-ghost flex-1 h-10 text-[13px]">Cancel</button>
                <button type="submit" className="premium-btn-primary flex-1 h-10 text-[13px]"><Save className="w-4 h-4" /> Create Product</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
