import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { formatCurrency } from "@/lib/mockData";
import { useInvoices, useBusinesses, useCustomers, useProducts, generateId } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Plus, Trash2, Save, X, Info, AlertTriangle, Building2, User,
  FileText, Package, Calculator, CheckCircle2, IndianRupee, UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import QuickCustomerModal from "@/components/QuickCustomerModal";
import QuickProductModal from "@/components/QuickProductModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileMode } from "@/contexts/MobileModeContext";

interface InvoiceFormProps { mode: "create" | "edit" }

export default function InvoiceForm({ mode }: InvoiceFormProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { mobileMode } = useMobileMode();
  const { items: invoices, create: createInvoice, update: updateInvoice, getById: getInvoiceById } = useInvoices();
  const { items: businesses } = useBusinesses();
  const { items: allCustomers } = useCustomers();
  const { items: allProducts } = useProducts();
  const existing = mode === "edit" && id ? getInvoiceById(id) : null;

  const [form, setForm] = useState({
    businessId: existing?.businessId || "",
    customerId: existing?.customerId || "",
    invoiceNumber: existing?.invoiceNumber || "SGJ/2024-25/108",
    date: existing?.date || new Date().toISOString().split("T")[0],
    type: existing?.type || "OUTWARD",
    isIGST: existing?.isIGST || false,
    financialYear: existing?.financialYear || "2024-25",
  });

  const [items, setItems] = useState(
    existing?.items.map((it) => ({ productId: it.productId, qty: it.qty, rate: it.rate })) || [{ productId: "", qty: 1, rate: 0 }]
  );

  const [dirty, setDirty] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [showQuickProduct, setShowQuickProduct] = useState(false);
  const localCustomers = allCustomers;
  const localProducts = allProducts;

  const safeNavigate = (to: string) => { if (dirty) { setPendingNav(to); setShowUnsavedModal(true); } else navigate(to); };
  const set = (field: string, val: any) => { setForm((p) => ({ ...p, [field]: val })); setDirty(true); };
  const addItem = () => { setItems((p) => [...p, { productId: "", qty: 1, rate: 0 }]); setDirty(true); };
  const removeItem = (i: number) => { if (items.length === 1) return; setItems((p) => p.filter((_, idx) => idx !== i)); setDirty(true); };
  const updateItem = (i: number, field: string, val: any) => { setItems((p) => p.map((it, idx) => idx === i ? { ...it, [field]: val } : it)); setDirty(true); };

  const handleProductChange = (i: number, productId: string) => {
    const product = localProducts.find((p) => p.id === productId);
    setItems((p) => p.map((it, idx) => idx === i ? { ...it, productId, rate: product && it.rate === 0 ? 0 : it.rate } : it));
    setDirty(true);
  };

  const calcItem = (item: { productId: string; qty: number; rate: number }) => {
    const product = localProducts.find((p) => p.id === item.productId);
    const amount = item.qty * item.rate;
    const tax = product ? (amount * product.gstRate) / 100 : 0;
    return { amount, tax, gstRate: product?.gstRate || 0 };
  };

  const subtotal = items.reduce((s, it) => s + calcItem(it).amount, 0);
  const totalTax = items.reduce((s, it) => s + calcItem(it).tax, 0);
  const total = subtotal + totalTax;

  const selectedCustomer = localCustomers.find((c) => c.id === form.customerId);
  const selectedBusiness = businesses.find((b) => b.id === form.businessId);
  const isInterstate = selectedBusiness && selectedCustomer && selectedBusiness.state_name !== selectedCustomer.state_name;

  useEffect(() => {
    if (isInterstate && !form.isIGST) {
      set("isIGST", true);
      toast({ title: "Auto-detected IGST", description: `${selectedBusiness?.state_name} → ${selectedCustomer?.state_name}` });
    }
  }, [form.businessId, form.customerId]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const completionFields = [
    !!form.businessId, !!form.customerId, !!form.invoiceNumber, !!form.date,
    items.length > 0, items.every((it) => !!it.productId), items.every((it) => it.qty > 0), items.every((it) => it.rate > 0),
  ];
  const completion = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessId || !form.customerId) { toast({ title: "Missing fields", description: "Select business and customer.", variant: "destructive" }); return; }
    if (items.some((it) => !it.productId)) { toast({ title: "Incomplete items", description: "Select a product for all line items.", variant: "destructive" }); return; }
    setDirty(false);

    const selectedBiz = businesses.find(b => b.id === form.businessId);
    const selectedCust = localCustomers.find(c => c.id === form.customerId);
    const invoiceItems = items.map(it => {
      const product = localProducts.find(p => p.id === it.productId);
      const amount = it.qty * it.rate;
      const tax = product ? (amount * product.gstRate) / 100 : 0;
      return {
        productId: it.productId,
        productName: product?.name || "",
        hsn: product?.hsn || "",
        gstRate: product?.gstRate || 0,
        qty: it.qty,
        rate: it.rate,
        amount,
        cgst: form.isIGST ? 0 : tax / 2,
        sgst: form.isIGST ? 0 : tax / 2,
        igst: form.isIGST ? tax : 0,
      };
    });

    const totalCGST = invoiceItems.reduce((s, it) => s + it.cgst, 0);
    const totalSGST = invoiceItems.reduce((s, it) => s + it.sgst, 0);
    const totalIGST = invoiceItems.reduce((s, it) => s + it.igst, 0);

    if (mode === "create") {
      const newId = generateId("inv-");
      const newInvoice = {
        id: newId,
        invoiceNumber: form.invoiceNumber,
        date: form.date,
        customerId: form.customerId,
        customerName: selectedCust?.name || "",
        businessId: form.businessId,
        businessName: selectedBiz?.name || "",
        type: form.type as "OUTWARD" | "INWARD",
        isIGST: form.isIGST,
        items: invoiceItems,
        subtotal,
        totalCGST,
        totalSGST,
        totalIGST,
        totalTax,
        total,
        financialYear: form.financialYear,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      createInvoice(newInvoice);
      toast({ title: "Invoice Created", description: `${form.invoiceNumber} — ${formatCurrency(total)}` });
      if (isMobile && mobileMode === "easy") {
        navigate(`/billing/invoice/${newId}`);
      } else {
        navigate("/billing/invoice/list");
      }
    } else {
      updateInvoice(id!, {
        invoiceNumber: form.invoiceNumber,
        date: form.date,
        customerId: form.customerId,
        customerName: selectedCust?.name || "",
        businessId: form.businessId,
        businessName: selectedBiz?.name || "",
        type: form.type as "OUTWARD" | "INWARD",
        isIGST: form.isIGST,
        items: invoiceItems,
        subtotal,
        totalCGST,
        totalSGST,
        totalIGST,
        totalTax,
        total,
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "Invoice Updated", description: `${form.invoiceNumber} — ${formatCurrency(total)}` });
      navigate("/billing/invoice/list");
    }
  };

  return (
    <div className={cn("space-y-5 animate-fade-in", isMobile ? "p-4 pb-28" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: mode === "create" ? "New Invoice" : "Edit Invoice" }]} />

      <div className="flex items-center gap-3">
        <div className={cn("rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-3xl")}>{mode === "create" ? "Create Invoice" : "Edit Invoice"}</h1>
          {!isMobile && <p className="text-sm text-muted-foreground mt-0.5">Fill in details to generate a GST-compliant invoice</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3")}>
          <div className={cn(isMobile ? "" : "lg:col-span-2", "space-y-5")}>
            {/* Invoice Details */}
            <div className="elevated-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                <h2 className="text-[13px] font-display font-semibold text-foreground">Invoice Details</h2>
              </div>
              <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1"><Building2 className="w-3 h-3 text-muted-foreground" /> Business<span className="text-destructive">*</span></label>
                  <select value={form.businessId} onChange={(e) => set("businessId", e.target.value)} className="premium-select w-full">
                    <option value="">Select Business</option>
                    {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  {selectedBusiness && <p className="text-[10px] text-muted-foreground font-mono">{selectedBusiness.gst_number}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1"><User className="w-3 h-3 text-muted-foreground" /> Customer<span className="text-destructive">*</span></label>
                  <select value={form.customerId} onChange={(e) => set("customerId", e.target.value)} className="premium-select w-full">
                    <option value="">Select Customer</option>
                    {localCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedCustomer && <p className="text-[10px] text-muted-foreground font-mono flex-1">{selectedCustomer.gst_number}</p>}
                    <button type="button" onClick={() => setShowQuickCustomer(true)} className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1 shrink-0"><UserPlus className="w-3 h-3" /> New</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Invoice Number</label>
                  <input type="text" value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} className="premium-input" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Date</label>
                  <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="premium-input" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Type</label>
                  <select value={form.type} onChange={(e) => set("type", e.target.value)} className="premium-select w-full">
                    <option value="OUTWARD">Outward (Sales)</option>
                    <option value="INWARD">Inward (Purchase)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">GST Type</label>
                  <div className="flex items-center gap-3 h-10">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.isIGST} onChange={(e) => set("isIGST", e.target.checked)} className="accent-primary w-4 h-4" />
                      <span className="text-[13px] text-foreground">IGST</span>
                    </label>
                    {isInterstate && <span className="premium-badge bg-warning/12 text-warning text-[10px]">Interstate</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="elevated-card rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-chart-3" />
                  <h2 className="text-[13px] font-display font-semibold text-foreground">Items ({items.length})</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setShowQuickProduct(true)} className="text-[12px] text-chart-3 hover:underline font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Product</button>
                  <button type="button" onClick={addItem} className="text-[12px] text-primary hover:underline font-semibold flex items-center gap-1"><Plus className="w-3 h-3" /> Item</button>
                </div>
              </div>

              {isMobile ? (
                <div className="divide-y divide-border/30">
                  {items.map((item, i) => {
                    const { amount, tax, gstRate } = calcItem(item);
                    return (
                      <div key={i} className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground font-mono">#{i + 1}</span>
                          <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1} className="p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <select value={item.productId} onChange={(e) => handleProductChange(i, e.target.value)} className="premium-select w-full text-[13px]">
                          <option value="">Select Product</option>
                          {localProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.hsn})</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className="text-[10px] text-muted-foreground uppercase">Qty</label><input type="number" value={item.qty} min={1} onChange={(e) => updateItem(i, "qty", Math.max(1, Number(e.target.value)))} className="premium-input h-9 w-full text-center" /></div>
                          <div><label className="text-[10px] text-muted-foreground uppercase">Rate (₹)</label><input type="number" value={item.rate} min={0} onChange={(e) => updateItem(i, "rate", Math.max(0, Number(e.target.value)))} className="premium-input h-9 w-full" /></div>
                        </div>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-muted-foreground">GST: {gstRate}% · Tax: {formatCurrency(tax)}</span>
                          <span className="font-bold text-foreground">{formatCurrency(amount)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-premium">
                    <thead><tr>{["#", "Product", "GST%", "Qty", "Rate (₹)", "Amount", "Tax", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {items.map((item, i) => {
                        const { amount, tax, gstRate } = calcItem(item);
                        return (
                          <motion.tr key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                            <td className="text-muted-foreground font-mono text-[12px]">{i + 1}</td>
                            <td><select value={item.productId} onChange={(e) => handleProductChange(i, e.target.value)} className="premium-select h-9 text-[13px] w-48"><option value="">Select Product</option>{localProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.hsn})</option>)}</select></td>
                            <td><span className="premium-badge bg-success/12 text-success">{gstRate}%</span></td>
                            <td><input type="number" value={item.qty} min={1} onChange={(e) => updateItem(i, "qty", Math.max(1, Number(e.target.value)))} className="premium-input h-9 w-20 text-center" /></td>
                            <td><input type="number" value={item.rate} min={0} onChange={(e) => updateItem(i, "rate", Math.max(0, Number(e.target.value)))} className="premium-input h-9 w-32" /></td>
                            <td className="font-bold text-foreground whitespace-nowrap">{formatCurrency(amount)}</td>
                            <td className="text-muted-foreground whitespace-nowrap text-[12px]">{formatCurrency(tax)}</td>
                            <td><button type="button" onClick={() => removeItem(i)} disabled={items.length === 1} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive disabled:opacity-30"><Trash2 className="w-4 h-4" /></button></td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="px-5 py-2 border-t border-border/30">
                <button type="button" onClick={addItem} className="text-[12px] text-primary hover:underline font-medium flex items-center gap-1"><Plus className="w-3 h-3" /> Add item</button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Completion */}
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Completion</h3>
                <span className={cn("text-[13px] font-bold font-display", completion === 100 ? "text-success" : "text-primary")}>{completion}%</span>
              </div>
              <div className="w-full h-2 bg-secondary/50 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${completion}%` }} transition={{ duration: 0.6 }}
                  className={cn("h-full rounded-full", completion === 100 ? "bg-success" : "bg-primary")} />
              </div>
              {completion === 100 && <p className="text-[11px] text-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Ready</p>}
            </div>

            {/* Summary */}
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2"><Calculator className="w-4 h-4 text-primary" /><h3 className="text-[13px] font-display font-semibold text-foreground">Summary</h3></div>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="text-foreground">{formatCurrency(subtotal)}</span></div>
                {form.isIGST ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{formatCurrency(totalTax)}</span></div>
                ) : (
                  <><div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{formatCurrency(totalTax / 2)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{formatCurrency(totalTax / 2)}</span></div></>
                )}
                <div className="border-t border-border/50 pt-3 flex justify-between font-bold">
                  <span className="text-foreground">Total</span>
                  <span className="text-primary text-lg font-display">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

            {/* Actions - desktop only */}
            {!isMobile && (
              <div className="elevated-card rounded-2xl p-5 space-y-3">
                <button type="submit" className="premium-btn-primary w-full"><Save className="w-4 h-4" />{mode === "create" ? "Create Invoice" : "Update Invoice"}</button>
                <button type="button" onClick={() => safeNavigate("/billing/invoice/list")} className="premium-btn-ghost w-full"><X className="w-4 h-4" /> Cancel</button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile fixed bottom actions */}
        {isMobile && (
          <div className="fixed bottom-16 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/50 px-4 py-3 safe-area-bottom">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => safeNavigate("/billing/invoice/list")} className="premium-btn-ghost flex-1 h-10 text-[13px]"><X className="w-4 h-4" /> Cancel</button>
              <button type="submit" className="premium-btn-primary flex-1 h-10 text-[13px]"><Save className="w-4 h-4" /> {mode === "create" ? "Create" : "Update"}</button>
            </div>
          </div>
        )}
      </form>

      <QuickCustomerModal open={showQuickCustomer} onClose={() => setShowQuickCustomer(false)}
        onCreated={(newCust) => { set("customerId", newCust.id); setShowQuickCustomer(false); }} />
      <QuickProductModal open={showQuickProduct} onClose={() => setShowQuickProduct(false)}
        onCreated={() => { setShowQuickProduct(false); }} />

      <AnimatePresence>
        {showUnsavedModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ duration: 0.2 }} className="glass-panel rounded-2xl w-full max-w-sm p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-warning" /></div>
                <div><h2 className="text-base font-display font-bold text-foreground">Unsaved Changes</h2><p className="text-[12px] text-muted-foreground mt-0.5">Changes will be lost.</p></div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowUnsavedModal(false); setPendingNav(null); }} className="premium-btn-ghost flex-1 h-10 text-[13px]">Stay</button>
                <button onClick={() => { setShowUnsavedModal(false); setDirty(false); if (pendingNav) navigate(pendingNav); setPendingNav(null); }}
                  className="flex-1 h-10 rounded-xl text-[13px] font-semibold bg-destructive text-destructive-foreground hover:brightness-110 flex items-center justify-center gap-2 transition-all">Leave</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
