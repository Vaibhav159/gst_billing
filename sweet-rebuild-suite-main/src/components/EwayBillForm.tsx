import { useState, useEffect } from "react";
import { Truck, Save, X, Loader2, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import api from "@/utils/api";

interface Props {
  invoiceId: string;
  onClose: () => void;
  onSaved?: () => void;
}

export default function EwayBillForm({ invoiceId, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    eway_bill_number: "",
    transporter_name: "",
    transporter_gstin: "",
    vehicle_number: "",
    vehicle_type: "Regular",
    transport_mode: "Road",
    distance_km: "",
  });

  useEffect(() => {
    api.get(`invoices/${invoiceId}/eway_bill/`).then(res => {
      const d = res.data;
      setForm({
        eway_bill_number: d.eway_bill_number || "",
        transporter_name: d.transporter_name || "",
        transporter_gstin: d.transporter_gstin || "",
        vehicle_number: d.vehicle_number || "",
        vehicle_type: d.vehicle_type || "Regular",
        transport_mode: d.transport_mode || "Road",
        distance_km: d.distance_km ? String(d.distance_km) : "",
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [invoiceId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(`invoices/${invoiceId}/eway_bill/`, {
        ...form,
        distance_km: form.distance_km ? parseInt(form.distance_km) : null,
      });
      toast({ title: "E-way Bill Saved", description: form.eway_bill_number ? `Bill #${form.eway_bill_number}` : "Details saved" });
      onSaved?.();
      onClose();
    } catch (err: any) {
      toast({ title: "Save Failed", description: err?.response?.data?.error || "Could not save", variant: "destructive" });
    }
    setSaving(false);
  };

  const set = (field: string, val: string) => setForm(p => ({ ...p, [field]: val }));

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="elevated-card rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-chart-2" />
          <h3 className="text-[14px] font-display font-semibold">E-way Bill Details</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">E-way Bill Number</label>
          <input value={form.eway_bill_number} onChange={(e) => set("eway_bill_number", e.target.value)} placeholder="e.g. 123456789012" className="premium-input text-[13px] font-mono" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Transport Mode</label>
          <select value={form.transport_mode} onChange={(e) => set("transport_mode", e.target.value)} className="premium-select w-full text-[13px]">
            <option value="Road">Road</option>
            <option value="Rail">Rail</option>
            <option value="Air">Air</option>
            <option value="Ship">Ship</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Transporter Name</label>
          <input value={form.transporter_name} onChange={(e) => set("transporter_name", e.target.value)} placeholder="Transport company name" className="premium-input text-[13px]" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Transporter GSTIN</label>
          <input value={form.transporter_gstin} onChange={(e) => set("transporter_gstin", e.target.value.toUpperCase())} placeholder="15-digit GSTIN" className="premium-input text-[13px] font-mono uppercase" maxLength={15} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Vehicle Number</label>
          <input value={form.vehicle_number} onChange={(e) => set("vehicle_number", e.target.value.toUpperCase())} placeholder="e.g. RJ14AB1234" className="premium-input text-[13px] font-mono uppercase" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Vehicle Type</label>
          <select value={form.vehicle_type} onChange={(e) => set("vehicle_type", e.target.value)} className="premium-select w-full text-[13px]">
            <option value="Regular">Regular</option>
            <option value="ODC">Over Dimensional Cargo (ODC)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Distance (KM)</label>
          <input type="number" value={form.distance_km} onChange={(e) => set("distance_km", e.target.value)} placeholder="Approx distance" className="premium-input text-[13px]" min={0} />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button onClick={onClose} className="premium-btn-ghost text-[12px]">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="premium-btn-primary text-[12px]">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save E-way Bill
        </button>
      </div>
    </motion.div>
  );
}
