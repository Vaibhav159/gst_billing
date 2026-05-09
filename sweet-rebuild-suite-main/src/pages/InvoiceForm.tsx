import { logger } from "@/utils/logger";
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { formatCurrency, itemUnits, itemUnitLabels, currentFY } from "@/utils/mockData";
import DraftRestoreBanner from "@/components/DraftRestoreBanner";
import type { ItemUnit } from "@/utils/mockData";
import { useInvoices, useBusinesses, useCustomers, useProducts, generateId } from "@/hooks/useDataStore";
import api from "@/utils/api";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Plus, Trash2, Save, X, Info, AlertTriangle, Building2, User,
  FileText, Package, Calculator, CheckCircle2, IndianRupee, UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/utils/utils";
import { motion, AnimatePresence } from "framer-motion";
import QuickCustomerModal from "@/components/QuickCustomerModal";
import SearchableSelect from "@/components/SearchableSelect";
import QuickProductModal from "@/components/QuickProductModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileMode } from "@/contexts/MobileModeContext";
import { formatApiError, errorTag } from "@/utils/apiError";

interface InvoiceFormProps { mode: "create" | "edit" }

export default function InvoiceForm({ mode }: InvoiceFormProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const duplicateFrom = (location.state as any)?.duplicateFrom;
  const { mobileMode } = useMobileMode();
  const { create: createInvoice, update: updateInvoice } = useInvoices();
  const { items: businesses } = useBusinesses();
  const { items: allCustomers } = useCustomers();
  const { items: allProducts } = useProducts();

  const [form, setForm] = useState({
    businessId: "",
    customerId: "",
    invoiceNumber: "",
    date: new Date().toISOString().split("T")[0],
    type: "OUTWARD",
    isIGST: false,
    financialYear: "",
  });

  const [items, setItems] = useState([{ productId: "", qty: 1, rate: 0, unit: "gms" as ItemUnit }]);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(mode === "edit");

  // Pre-fill from duplicate source
  useEffect(() => {
    if (mode !== "create" || !duplicateFrom) return;
    setForm({
      businessId: String(duplicateFrom.businessId || ""),
      customerId: String(duplicateFrom.customerId || ""),
      invoiceNumber: "", // blank — will auto-fetch next number
      date: new Date().toISOString().split("T")[0],
      type: duplicateFrom.type || "OUTWARD",
      isIGST: duplicateFrom.isIGST || false,
      financialYear: "",
    });
    if (duplicateFrom.items?.length > 0) {
      setItems(duplicateFrom.items.map((it: any) => ({
        productId: String(it.productId || it.product || ""),
        qty: it.qty || it.quantity || 1,
        rate: it.rate || 0,
        unit: (it.unit || "gms") as ItemUnit,
      })));
    }
  }, [mode, duplicateFrom]);

  // Fallback names from the invoice API for entities not in the loaded list
  const [fallbackEntities, setFallbackEntities] = useState<{
    customer?: { id: string; name: string };
    business?: { id: string; name: string };
    products: { id: string; name: string; hsn: string; gstRate: number }[];
  }>({ products: [] });

  // Fetch invoice by ID directly from API when editing
  useEffect(() => {
    if (mode !== "edit" || !id) return;
    setIsLoadingInvoice(true);
    api.get<any>(`invoices/${id}/`)
      .then((res) => {
        const inv = res.data;
        setForm({
          businessId: String(inv.business || ""),
          customerId: String(inv.customer || ""),
          invoiceNumber: inv.invoice_number || "",
          date: inv.invoice_date || new Date().toISOString().split("T")[0],
          type: (inv.type_of_invoice || "OUTWARD").toUpperCase(),
          isIGST: inv.is_igst_applicable || false,
          financialYear: inv.financial_year || "2024-25",
        });

        // Store fallback names for dropdown rendering
        setFallbackEntities({
          customer: inv.customer ? { id: String(inv.customer), name: inv.customer_name || `Customer #${inv.customer}` } : undefined,
          business: inv.business ? { id: String(inv.business), name: inv.business_name || `Business #${inv.business}` } : undefined,
          products: (inv.line_items || []).map((li: any) => ({
            id: String(li.product || li.id || ""),
            name: li.product_name || li.item_name || `Product #${li.product || li.id}`,
            hsn: li.hsn_code || "",
            gstRate: li.gst_tax_rate ? (parseFloat(li.gst_tax_rate) > 1 ? parseFloat(li.gst_tax_rate) : parseFloat(li.gst_tax_rate) * 100) : 0,
          })),
        });

        const lineItems = (inv.line_items || []).map((li: any) => ({
          productId: String(li.product || li.id || ""),
          qty: parseFloat(li.quantity) || 1,
          rate: parseFloat(li.rate) || 0,
          unit: (li.unit || "gms") as ItemUnit,
        }));
        if (lineItems.length > 0) setItems(lineItems);
      })
      .catch((err) => {
        logger.error("Failed to fetch invoice", err);
        toast({ title: "Error", description: "Could not load invoice data.", variant: "destructive" });
      })
      .finally(() => setIsLoadingInvoice(false));
  }, [id, mode]);

  // Auto-fetch next invoice number when business or type changes (create mode only)
  useEffect(() => {
    if (mode !== "create" || !form.businessId) return;
    const typeParam = form.type === "INWARD" ? "inward" : "outward";
    api.get<any>(`invoices/next_invoice_number/?business_id=${form.businessId}&type_of_invoice=${typeParam}`)
      .then((res) => {
        const next = res.data?.next_invoice_number;
        if (next) setForm((prev) => ({ ...prev, invoiceNumber: next }));
      })
      .catch(() => {}); // silently fail
  }, [form.businessId, form.type, mode]);

  // ─── Validation state ───
  const [warnings, setWarnings] = useState<Record<string, string>>({});

  // Duplicate invoice check
  useEffect(() => {
    if (mode !== "create" || !form.invoiceNumber || !form.businessId) {
      setWarnings(w => { const n = { ...w }; delete n.invoiceNumber; return n; });
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<any>(`invoices/check_duplicate/?invoice_number=${encodeURIComponent(form.invoiceNumber)}&business_id=${form.businessId}`);
        if (res.data?.exists) {
          setWarnings(w => ({ ...w, invoiceNumber: res.data.message }));
        } else {
          setWarnings(w => { const n = { ...w }; delete n.invoiceNumber; return n; });
        }
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [form.invoiceNumber, form.businessId, mode]);

  // Date validation
  useEffect(() => {
    if (!form.date) return;
    const d = new Date(form.date);
    const today = new Date();
    const warns: Record<string, string> = {};
    if (d > today) warns.date = "Date is in the future";
    const fy = parseInt((form.financialYear || currentFY).split("-")[0]);
    if (fy) {
      const fyStart = new Date(fy, 3, 1);
      const fyEnd = new Date(fy + 1, 2, 31);
      if (d < fyStart || d > fyEnd) warns.date = `Date is outside FY ${fy}-${String(fy + 1).slice(2)}`;
    }
    setWarnings(w => { const n = { ...w }; delete n.date; return warns.date ? { ...n, date: warns.date } : n; });
  }, [form.date, form.financialYear]);

  const [dirty, setDirty] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(false);

  const DRAFT_KEY = "gst_invoice_draft";

  // Check for saved draft on mount (create mode only)
  useEffect(() => {
    if (mode !== "create" || duplicateFrom) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        // Only show if draft has meaningful data
        if (draft.form?.businessId || draft.form?.customerId || draft.items?.some((it: any) => it.rate > 0)) {
          setShowDraftBanner(true);
        }
      }
    } catch { /* ignore */ }
  }, [mode, duplicateFrom]);

  // Auto-save draft when dirty (debounced)
  useEffect(() => {
    if (mode !== "create" || !dirty) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, items, savedAt: new Date().toISOString() }));
      } catch { /* storage full */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [form, items, dirty, mode]);

  const restoreDraft = () => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.form) setForm(draft.form);
        if (draft.items?.length > 0) setItems(draft.items);
        setDirty(true);
        toast({ title: "Draft Restored", description: "Your unsaved invoice has been restored." });
      }
    } catch { /* ignore */ }
    setShowDraftBanner(false);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setShowDraftBanner(false);
  };

  // Clear draft after successful save
  const clearDraft = () => { localStorage.removeItem(DRAFT_KEY); };
  const [showQuickProduct, setShowQuickProduct] = useState(false);

  // Merge fallback entities into the loaded lists so dropdowns always have the selected option
  const localCustomers = (() => {
    const list = [...allCustomers];
    if (fallbackEntities.customer && !list.some(c => String(c.id) === fallbackEntities.customer!.id)) {
      list.push({ id: fallbackEntities.customer.id, name: fallbackEntities.customer.name } as any);
    }
    return list;
  })();

  const localProducts = (() => {
    const list = [...allProducts];
    for (const fp of fallbackEntities.products) {
      if (!list.some(p => String(p.id) === fp.id)) {
        list.push({ id: fp.id, name: fp.name, hsn: fp.hsn, gstRate: fp.gstRate, description: "", createdAt: "" });
      }
    }
    return list;
  })();

  const effectiveBusinesses = (() => {
    const list = [...businesses];
    if (fallbackEntities.business && !list.some(b => String(b.id) === fallbackEntities.business!.id)) {
      list.push({ id: fallbackEntities.business.id, name: fallbackEntities.business.name } as any);
    }
    return list;
  })();

  const safeNavigate = (to: string) => { if (dirty) { setPendingNav(to); setShowUnsavedModal(true); } else navigate(to); };
  const set = (field: string, val: any) => { setForm((p) => ({ ...p, [field]: val })); setDirty(true); };
  const addItem = () => { setItems((p) => [...p, { productId: "", qty: 1, rate: 0, unit: "gms" as ItemUnit }]); setDirty(true); };
  const removeItem = (i: number) => { if (items.length === 1) return; setItems((p) => p.filter((_, idx) => idx !== i)); setDirty(true); };
  const updateItem = (i: number, field: string, val: any) => { setItems((p) => p.map((it, idx) => idx === i ? { ...it, [field]: val } : it)); setDirty(true); };

  const handleProductChange = (i: number, productId: string) => {
    const product = localProducts.find((p) => p.id === productId);
    setItems((p) => p.map((it, idx) => idx === i ? { ...it, productId, rate: product && it.rate === 0 ? 0 : it.rate } : it));
    setDirty(true);
  };

  const calcItem = (item: { productId: string; qty: number; rate: number }) => {
    const product = localProducts.find((p) => p.id === item.productId);
    const amount = Math.round(item.qty * item.rate * 100) / 100;
    const tax = product ? Math.round((amount * product.gstRate) / 100 * 100) / 100 : 0;
    return { amount, tax, gstRate: product?.gstRate || 0 };
  };

  const subtotal = items.reduce((s, it) => s + calcItem(it).amount, 0);
  const totalTax = items.reduce((s, it) => s + calcItem(it).tax, 0);
  const total = subtotal + totalTax;

  const selectedCustomer = localCustomers.find((c) => c.id === form.customerId);
  const selectedBusiness = effectiveBusinesses.find((b) => b.id === form.businessId);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessId || !form.customerId) { toast({ title: "Missing fields", description: "Select business and customer.", variant: "destructive" }); return; }
    if (items.some((it) => !it.productId)) { toast({ title: "Incomplete items", description: "Select a product for all line items.", variant: "destructive" }); return; }
    setDirty(false);

    const selectedBiz = effectiveBusinesses.find(b => b.id === form.businessId);
    const selectedCust = localCustomers.find(c => c.id === form.customerId);
    const invoiceItems = items.map(it => {
      const product = localProducts.find(p => p.id === it.productId);
      const netAmount = Math.round(it.qty * it.rate * 100) / 100;
      const tax = product ? Math.round((netAmount * product.gstRate) / 100 * 100) / 100 : 0;
      const cgst = form.isIGST ? 0 : Math.round(tax / 2 * 100) / 100;
      const sgst = form.isIGST ? 0 : Math.round(tax / 2 * 100) / 100;
      const igst = form.isIGST ? Math.round(tax * 100) / 100 : 0;
      // amount stored on line item is GROSS (net + tax) — Invoice.total_amount
      // is sum(LineItem.amount), so this MUST include the tax.
      const amount = Math.round((netAmount + cgst + sgst + igst) * 100) / 100;
      return {
        productId: it.productId,
        productName: product?.name || "",
        hsn: product?.hsn || "",
        gstRate: product?.gstRate || 0,
        qty: it.qty,
        rate: it.rate,
        unit: it.unit,
        amount,
        cgst,
        sgst,
        igst,
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
        invoice_date: form.date,
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
      try {
        const created = await createInvoice(newInvoice);
        clearDraft();
        toast({ title: "Invoice Created", description: `${form.invoiceNumber} — ${formatCurrency(total)}` });
        const navId = created?.id ? String(created.id) : newId;
        if (isMobile && mobileMode === "easy") {
          navigate(`/billing/invoice/${navId}`);
        } else {
          navigate("/billing/invoice/list");
        }
      } catch (err: any) {
        toast({ title: `Create Failed ${errorTag(err)}`, description: formatApiError(err, "Create failed."), variant: "destructive", duration: 12000 });
        setDirty(true);
      }
    } else if (id) {
      try {
        await updateInvoice(id, {
          invoiceNumber: form.invoiceNumber,
          invoice_date: form.date,
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
      } catch (err: any) {
        toast({ title: `Update Failed ${errorTag(err)}`, description: formatApiError(err, "Update failed."), variant: "destructive", duration: 12000 });
        setDirty(true);
      }
    }
  };

  if (mode === "create" && businesses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-8">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Building2 className="w-8 h-8 text-primary/40" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-display font-bold text-foreground">Create a Business First</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">You need at least one business to start creating invoices. Set up your business with GST details to get started.</p>
        </div>
        <Link to="/billing/business/new" className="premium-btn-primary text-[14px] h-11 px-6">
          <Building2 className="w-4 h-4" /> Create Business
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("space-y-5 animate-fade-in", isMobile ? "p-4 pb-28" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: mode === "create" ? "New Invoice" : "Edit Invoice" }]} />

      {showDraftBanner && <DraftRestoreBanner onRestore={restoreDraft} onDiscard={discardDraft} />}

      <div className="flex items-center gap-3">
        <div className={cn("rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}>
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-3xl")}>{mode === "create" ? "Create Invoice" : "Edit Invoice"}</h1>
          {!isMobile && <p className="text-sm text-muted-foreground mt-0.5">Fill in details to generate a GST-compliant invoice</p>}
        </div>
        {/* Sticky completion indicator in header */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-24 h-2 bg-secondary/50 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${completion}%` }} transition={{ duration: 0.6 }}
              className={cn("h-full rounded-full", completion === 100 ? "bg-success" : "bg-primary")} />
          </div>
          <span className={cn("text-[12px] font-bold font-display tabular-nums", completion === 100 ? "text-success" : "text-primary")}>{completion}%</span>
        </div>
      </div>

      {isLoadingInvoice ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading invoice details...</p>
        </div>
      ) : (
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
                  <SearchableSelect
                    value={form.businessId}
                    onChange={(val) => set("businessId", val)}
                    options={effectiveBusinesses.map((b) => ({ value: String(b.id), label: b.name, sublabel: b.gst_number }))}
                    placeholder="Search Business"
                  />
                  {selectedBusiness && <p className="text-[10px] text-muted-foreground font-mono">{selectedBusiness.gst_number}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1"><User className="w-3 h-3 text-muted-foreground" /> Customer<span className="text-destructive">*</span></label>
                  <SearchableSelect
                    value={form.customerId}
                    onChange={(val) => set("customerId", val)}
                    options={localCustomers.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.gst_number }))}
                    placeholder="Search Customer"
                  />
                  <div className="flex items-center gap-2 mt-1">
                    {selectedCustomer && <p className="text-[10px] text-muted-foreground font-mono flex-1">{selectedCustomer.gst_number}</p>}
                    <button type="button" onClick={() => setShowQuickCustomer(true)} className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1 shrink-0"><UserPlus className="w-3 h-3" /> New</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Invoice Number</label>
                  <input type="text" value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} className={cn("premium-input", warnings.invoiceNumber && "border-amber-500")} />
                  {warnings.invoiceNumber && <p className="text-[10px] text-amber-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{warnings.invoiceNumber}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Date</label>
                  <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={cn("premium-input", warnings.date && "border-amber-500")} />
                  {warnings.date && <p className="text-[10px] text-amber-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{warnings.date}</p>}
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
            <div className="elevated-card rounded-2xl">
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
                        <SearchableSelect
                          value={item.productId}
                          onChange={(val) => handleProductChange(i, val)}
                          options={localProducts.map((p) => ({ value: String(p.id), label: p.name, sublabel: p.hsn }))}
                          placeholder="Search Product"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <div><label className="text-[10px] text-muted-foreground uppercase">Qty</label><input type="number" value={item.qty} min={0.00001} step="0.00001" onChange={(e) => updateItem(i, "qty", Math.max(0, Number(e.target.value)))} className="premium-input h-9 w-full text-center" /></div>
                          <div><label className="text-[10px] text-muted-foreground uppercase">Unit</label><select value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} className="premium-select h-9 w-full text-[11px]">{itemUnits.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
                          <div><label className="text-[10px] text-muted-foreground uppercase">Rate (₹)</label><input type="number" value={item.rate} min={0} step="0.00001" onChange={(e) => updateItem(i, "rate", Math.max(0, Number(e.target.value)))} className="premium-input h-9 w-full" /></div>
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
                <div className="overflow-visible">
                  <table className="table-premium" style={{ tableLayout: "fixed", width: "100%" }}>
                    <colgroup>
                      <col style={{ width: "3%" }} />
                      <col style={{ width: "21%" }} />
                      <col style={{ width: "7%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "6%" }} />
                    </colgroup>
                    <thead><tr>{["#", "Product", "GST%", "Qty", "Unit", "Rate (₹/unit)", "Amount", "Tax", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {items.map((item, i) => {
                        const { amount, tax, gstRate } = calcItem(item);
                        return (
                          <motion.tr key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                            <td className="text-muted-foreground font-mono text-[12px]">{i + 1}</td>
                            <td><SearchableSelect value={item.productId} onChange={(val) => handleProductChange(i, val)} options={localProducts.map((p) => ({ value: String(p.id), label: p.name, sublabel: p.hsn }))} placeholder="Search Product" /></td>
                            <td><span className="premium-badge bg-success/12 text-success">{gstRate}%</span></td>
                            <td><input type="number" value={item.qty} min={0.00001} step="0.00001" onChange={(e) => updateItem(i, "qty", Math.max(0, Number(e.target.value)))} className="premium-input h-9 w-full text-center" /></td>
                            <td><select value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} className="premium-select h-9 w-full text-[12px] !px-2">{itemUnits.map((u) => <option key={u} value={u}>{u}</option>)}</select></td>
                            <td><input type="number" value={item.rate} min={0} step="0.00001" onChange={(e) => updateItem(i, "rate", Math.max(0, Number(e.target.value)))} className="premium-input h-9 w-full" /></td>
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
                {items.map((item, i) => {
                  const product = localProducts.find(p => p.id === item.productId);
                  if (item.qty === 0 && item.rate === 0 && !product) return null;
                  return (
                    <div key={i} className="space-y-1.5 pb-2 border-b border-border/30">
                      {product && <div className="text-[12px] font-medium text-foreground truncate">{product.name}</div>}
                      <div className="flex justify-between"><span className="text-muted-foreground">Qty</span><span className="text-foreground">{item.qty} {item.unit}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="text-foreground">{formatCurrency(item.rate)}/{item.unit}</span></div>
                    </div>
                  );
                })}
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="text-foreground">{formatCurrency(subtotal)}</span></div>
                {form.isIGST ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{formatCurrency(totalTax)}</span></div>
                ) : (
                  <><div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{formatCurrency(totalTax / 2)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{formatCurrency(totalTax / 2)}</span></div></>
                )}
                <div className="border-t border-border/50 pt-3 flex justify-between font-bold">
                  <span className="text-foreground">Grand Total</span>
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
      )}

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
