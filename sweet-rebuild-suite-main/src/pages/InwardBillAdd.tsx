import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Loader2, AlertTriangle, Trash2, Plus, ArrowLeft, Save, FileCheck,
} from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useBusinesses } from "@/hooks/useDataStore";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/utils/mockData";
import {
  extractInwardBill, createInwardBill, type ExtractResult,
} from "@/hooks/useInwardBills";

interface FormLine {
  product_name: string;
  hsn_code: string;
  quantity: string;
  rate: string;
  gst_tax_rate: string;
  unit: string;
}

const emptyLine: FormLine = {
  product_name: "", hsn_code: "", quantity: "", rate: "", gst_tax_rate: "0.03", unit: "gms",
};

export default function InwardBillAdd() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();

  const [business, setBusiness] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const [supplierName, setSupplierName] = useState("");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ ...emptyLine }]);

  const [warnings, setWarnings] = useState<ExtractResult["warnings"]>({
    gstin_mismatch: false, duplicate: false, extraction_failed: false,
  });
  const [ackMismatch, setAckMismatch] = useState(false);

  const firmGstin = useMemo(
    () => businesses.find((b) => String(b.id) === business)?.gst_number || "",
    [businesses, business],
  );
  const intra = supplierGstin.length >= 2 && firmGstin.length >= 2 &&
    supplierGstin.slice(0, 2) === firmGstin.slice(0, 2);

  const computed = useMemo(() => {
    let taxable = 0, cgst = 0, sgst = 0, igst = 0;
    for (const l of lines) {
      const t = (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0);
      const r = parseFloat(l.gst_tax_rate) || 0;
      taxable += t;
      if (intra) { cgst += t * r / 2; sgst += t * r / 2; }
      else { igst += t * r; }
    }
    return { taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
  }, [lines, intra]);

  async function handleFile(f: File | null) {
    setFile(f);
    if (!f) return;
    if (!business) {
      toast({ title: "Pick a firm first", description: "Choose which firm is buying, then upload.", variant: "destructive" });
      return;
    }
    setExtracting(true);
    try {
      const res = await extractInwardBill(f, business);
      setSupplierName(res.supplier.name || "");
      setSupplierGstin((res.supplier.gstin || "").toUpperCase());
      setSupplierAddress(res.supplier.address || "");
      setInvoiceNumber(res.invoice_number || "");
      setInvoiceDate(normalizeDate(res.invoice_date));
      setLines(
        res.line_items.length
          ? res.line_items.map((li) => ({
              product_name: li.product_name || "",
              hsn_code: li.hsn_code || "",
              quantity: li.quantity ? String(li.quantity) : "",
              rate: li.rate ? String(li.rate) : "",
              gst_tax_rate: li.gst_tax_rate ? String(li.gst_tax_rate) : "0.03",
              unit: "gms",
            }))
          : [{ ...emptyLine }],
      );
      setWarnings(res.warnings);
      setAckMismatch(false);
      setReady(true);
      if (res.warnings.extraction_failed) {
        toast({ title: "Couldn't auto-read this file", description: "Fill the details in manually — the file is still saved with the bill." });
      }
    } catch (e: any) {
      toast({ title: "Extraction failed", description: e?.response?.data?.error || "Upload a PDF, JPEG, PNG, or HEIC.", variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  }

  function setLine(i: number, patch: Partial<FormLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function save(override = false) {
    if (!business || !invoiceNumber || !invoiceDate) {
      toast({ title: "Missing details", description: "Firm, invoice number and date are required.", variant: "destructive" });
      return;
    }
    if (warnings.gstin_mismatch && !ackMismatch) {
      toast({ title: "GSTIN doesn't match this firm", description: "Tick 'Record anyway' to save a bill not addressed to your firm's GSTIN.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("business_id", business);
      fd.append("supplier_name", supplierName);
      fd.append("supplier_gstin", supplierGstin);
      fd.append("supplier_address", supplierAddress);
      fd.append("invoice_number", invoiceNumber);
      fd.append("invoice_date", invoiceDate);
      fd.append("bill_total", computed.total.toFixed(2));
      fd.append(
        "lines",
        JSON.stringify(
          lines.map((l) => ({
            product_name: l.product_name,
            hsn_code: l.hsn_code,
            quantity: l.quantity || "0",
            rate: l.rate || "0",
            gst_tax_rate: l.gst_tax_rate || "0.03",
            unit: l.unit || "gms",
          })),
        ),
      );
      if (override || warnings.gstin_mismatch) fd.append("override_warnings", "true");
      if (file) fd.append("file", file, file.name);
      const bill = await createInwardBill(fd);
      toast({ title: "Inward bill saved", description: `#${bill.invoice_number} recorded.` });
      navigate(`/billing/inward-bills/${bill.id}`);
    } catch (e: any) {
      if (e?.response?.status === 409) {
        setWarnings((w) => ({ ...w, duplicate: true }));
        toast({ title: "Possible duplicate", description: e?.response?.data?.detail || "This invoice # already exists. Save again to record anyway.", variant: "destructive" });
      } else {
        toast({ title: "Could not save", description: e?.response?.data?.detail || e?.response?.data?.error || "Please check the fields.", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <Breadcrumbs items={[{ label: "Inward Bills", href: "/billing/inward-bills" }, { label: "Add" }]} />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/billing/inward-bills")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">Add Inward Bill</h1>
      </div>

      {/* Step 1: firm + file */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Buying firm</Label>
            <Select value={business} onValueChange={setBusiness}>
              <SelectTrigger><SelectValue placeholder="Which firm is buying?" /></SelectTrigger>
              <SelectContent>
                {businesses.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Bill file (PDF / image / HEIC)</Label>
            <label className="flex items-center gap-2 border rounded-md px-3 h-10 cursor-pointer hover:bg-accent text-sm">
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span className="truncate text-muted-foreground">{file ? file.name : "Choose a file…"}</span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        </div>
      </div>

      {ready && (
        <>
          {/* Warnings */}
          {warnings.gstin_mismatch && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Not addressed to this firm's GSTIN</div>
                <div className="text-muted-foreground">This bill's buyer GSTIN doesn't match {firmGstin || "the selected firm"}. It won't reconcile as this firm's input credit.</div>
                <label className="mt-1.5 flex items-center gap-2">
                  <input type="checkbox" checked={ackMismatch} onChange={(e) => setAckMismatch(e.target.checked)} />
                  Record anyway
                </label>
              </div>
            </div>
          )}
          {warnings.duplicate && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span>An inward bill with this number already exists for this firm. Saving will record a second copy.</span>
            </div>
          )}

          {/* Step 2: verify form */}
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Supplier name" value={supplierName} onChange={setSupplierName} />
              <Field label="Supplier GSTIN" value={supplierGstin} onChange={(v) => setSupplierGstin(v.toUpperCase())} />
              <Field label="Invoice #" value={invoiceNumber} onChange={setInvoiceNumber} />
              <div className="space-y-1.5">
                <Label>Invoice date</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Badge variant="outline">{intra ? "Intra-state · CGST + SGST" : "Inter-state · IGST"}</Badge>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-4" placeholder="Product" value={l.product_name} onChange={(e) => setLine(i, { product_name: e.target.value })} />
                  <Input className="col-span-2" placeholder="HSN" value={l.hsn_code} onChange={(e) => setLine(i, { hsn_code: e.target.value })} />
                  <Input className="col-span-2" placeholder="Qty" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <Input className="col-span-2" placeholder="Rate" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                  <div className="col-span-1 text-right text-sm tabular-nums text-muted-foreground">
                    {formatCurrency((parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0))}
                  </div>
                  <Button className="col-span-1" variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}>
                <Plus className="h-4 w-4 mr-1" /> Add line
              </Button>
            </div>

            <div className="border-t pt-3 space-y-1 text-sm max-w-xs ml-auto">
              <Row label="Taxable" value={computed.taxable} />
              {intra ? (
                <>
                  <Row label="CGST" value={computed.cgst} />
                  <Row label="SGST" value={computed.sgst} />
                </>
              ) : (
                <Row label="IGST" value={computed.igst} />
              )}
              <div className="flex justify-between font-semibold text-base pt-1 border-t">
                <span>Total</span><span className="tabular-nums">{formatCurrency(computed.total)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => navigate("/billing/inward-bills")}>Cancel</Button>
              <Button onClick={() => save(warnings.duplicate)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : warnings.duplicate ? <FileCheck className="h-4 w-4 mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
                {warnings.duplicate ? "Record anyway" : "Save inward bill"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span><span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );
}

/** AI may return "14-05-2026" or "2026-05-14"; the date input needs YYYY-MM-DD. */
function normalizeDate(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}
