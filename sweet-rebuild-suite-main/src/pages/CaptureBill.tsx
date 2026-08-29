import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera, Check, Loader2 } from "lucide-react";
import { useBusinesses } from "@/hooks/useDataStore";
import { createCapture } from "@/hooks/useInwardBills";
import { useToast } from "@/hooks/use-toast";
import Breadcrumbs from "@/components/Breadcrumbs";

/**
 * Exhibition mode: photograph a supplier bill in seconds and keep selling.
 * Every shot lands in the Captures inbox on the Inward Bills page, where it
 * gets filled in properly later (usually on the laptop). Deliberately no
 * required fields beyond the photo — speed is the whole point.
 */
export default function CaptureBill() {
  const { items: businesses } = useBusinesses();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [business, setBusiness] = useState("");
  const [supplierHint, setSupplierHint] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [session, setSession] = useState<{ id: number; name: string; hint: string }[]>([]);

  const snap = async (f: File | null) => {
    if (!f || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", f, f.name);
      if (business) fd.append("business_id", business);
      if (supplierHint.trim()) fd.append("supplier_hint", supplierHint.trim());
      if (note.trim()) fd.append("note", note.trim());
      const res = await createCapture(fd);
      setSession((p) => [{ id: res.id, name: f.name, hint: supplierHint.trim() }, ...p]);
      setSupplierHint("");
      toast({ title: "Captured", description: "In the inbox — fill it in later from Inward Bills." });
    } catch (e: any) {
      toast({ title: "Capture failed", description: e?.response?.data?.error || "Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-lg mx-auto space-y-4">
      <Breadcrumbs items={[{ label: "Inward Bills", href: "/billing/inward-bills" }, { label: "Capture" }]} />

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-display font-bold">Capture a bill</h1>
          <p className="text-[12px] text-muted-foreground">Snap now, fill in later. Photos wait in the inbox.</p>
        </div>
        <Link to="/billing/inward-bills" className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back</Link>
      </div>

      <div className="elevated-card rounded-2xl p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Buying firm (optional)</label>
          <select value={business} onChange={(e) => setBusiness(e.target.value)} className="premium-select w-full h-11">
            <option value="">— Decide later</option>
            {businesses.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Supplier (optional)</label>
          <input value={supplierHint} onChange={(e) => setSupplierHint(e.target.value)} placeholder="e.g. SOLANKI JEWELLERS" className="premium-input w-full h-11" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. exhibition day 2, stall 14" className="premium-input w-full h-11" />
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => snap(e.target.files?.[0] || null)}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="premium-btn-primary w-full h-14 text-[15px] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          {uploading ? "Saving…" : "Photograph bill"}
        </button>
      </div>

      {session.length > 0 && (
        <div className="elevated-card rounded-2xl p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Captured this session</p>
          {session.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-[13px]">
              <Check className="w-4 h-4 text-success shrink-0" />
              <span className="truncate" title={c.name}>#{c.id}{c.hint ? ` · ${c.hint}` : ""}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            They're waiting in <Link to="/billing/inward-bills" className="text-primary hover:underline">Inward Bills → Captures</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
