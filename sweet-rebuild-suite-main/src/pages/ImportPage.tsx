import { Link, useNavigate } from "react-router-dom";
import {
  Upload, Download, FileText, ArrowLeft, CheckCircle2, AlertTriangle,
  FileSpreadsheet, Info, Package, Users, Receipt, Hash, Building2, Eye,
  UserPlus, X, Plus, AlertCircle, Check, Copy, Pencil, Save,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useBusinesses, useCustomers, useInvoices } from "@/hooks/useDataStore";
import type { Business, Customer } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { parseInvoiceExcel, toImportReadyInvoices } from "@/utils/parseInvoiceExcel";
import type { ImportReadyInvoice } from "@/utils/parseInvoiceExcel";
import { indianStates } from "@/utils/mockData";
import { downloadSampleExcel } from "@/utils/generateSampleExcel";

interface ImportPageProps { type: "customer" | "product" | "invoice" | "business" }

const configs = {
  customer: {
    title: "Import Customers",
    back: "/billing/customer/list",
    breadcrumb: [{ label: "Customers", href: "/billing/customer/list" }, { label: "Import" }],
    columns: [
      { name: "Name", required: true, example: "Rajesh Kumar" },
      { name: "GST Number", required: false, example: "27AABCK5461H1ZO" },
      { name: "PAN", required: false, example: "AABCK5461H" },
      { name: "Mobile", required: true, example: "9876543210" },
      { name: "Email", required: false, example: "raj@mail.com" },
      { name: "State", required: false, example: "Maharashtra" },
      { name: "Address", required: false, example: "123 Main St" },
    ],
    showBusiness: true,
    icon: Users,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  product: {
    title: "Import Products",
    back: "/billing/product/list",
    breadcrumb: [{ label: "Products", href: "/billing/product/list" }, { label: "Import" }],
    columns: [
      { name: "Product Name", required: true, example: "Diamond Ring" },
      { name: "HSN Code", required: true, example: "71131910" },
      { name: "GST Rate (%)", required: true, example: "3" },
      { name: "Description", required: false, example: "22K gold ring" },
    ],
    showBusiness: false,
    icon: Package,
    color: "text-chart-3",
    bg: "bg-chart-3/10",
  },
  invoice: {
    title: "Import Invoices",
    back: "/billing/invoice/list",
    breadcrumb: [{ label: "Invoices", href: "/billing/invoice/list" }, { label: "Import" }],
    columns: [
      { name: "S.No.", required: false, example: "1" },
      { name: "Bill No.", required: true, example: "100" },
      { name: "Invoice Date", required: true, example: "06-02-2026" },
      { name: "Party Name", required: true, example: "Rajesh Kumar" },
      { name: "GST Number", required: false, example: "08AABCK5461H1ZO" },
      { name: "Commodity", required: true, example: "Gold Ornaments" },
      { name: "HSN Code", required: true, example: "711319" },
      { name: "GST Rate", required: true, example: "3%" },
      { name: "Qty (gm)", required: true, example: "37.740" },
      { name: "Rate (\u20b9/gm)", required: true, example: "16397.00" },
      { name: "Taxable Value (\u20b9)", required: false, example: "618661.80" },
      { name: "CGST (\u20b9)", required: false, example: "9279.93" },
      { name: "SGST (\u20b9)", required: false, example: "9279.93" },
      { name: "IGST (\u20b9)", required: false, example: "0.00" },
      { name: "Total Invoice Value (\u20b9)", required: false, example: "637221.66" },
    ],
    showBusiness: true,
    icon: Receipt,
    color: "text-chart-1",
    bg: "bg-chart-1/10",
  },
  business: {
    title: "Import Businesses",
    back: "/billing/business/list",
    breadcrumb: [{ label: "Businesses", href: "/billing/business/list" }, { label: "Import" }],
    columns: [
      { name: "Business Name", required: true, example: "Sharma Gold Pvt Ltd" },
      { name: "GST Number", required: false, example: "27AABCS1429B1Z1" },
      { name: "PAN", required: false, example: "AABCS1429B" },
      { name: "Mobile", required: true, example: "9876543210" },
      { name: "Email", required: false, example: "info@sharma.com" },
      { name: "State", required: false, example: "Maharashtra" },
      { name: "Address", required: false, example: "123 Zaveri Bazaar" },
      { name: "Bank Name", required: false, example: "State Bank of India" },
      { name: "Account No", required: false, example: "1234567890" },
      { name: "IFSC", required: false, example: "SBIN0001234" },
      { name: "Branch", required: false, example: "Zaveri Bazaar" },
    ],
    showBusiness: false,
    icon: Building2,
    color: "text-chart-4",
    bg: "bg-chart-4/10",
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

// ─── Validation types ───
interface ValidationResult {
  invoice: ImportReadyInvoice;
  businessMatch: Business | null;
  customerMatch: Customer | null;
  isDuplicate: boolean;
  status: "ready" | "missing_business" | "missing_customer" | "duplicate";
}

// ─── Rounding: below .5 down, above .5 up (standard Math.round) ───
function roundAmount(val: number): number {
  return Math.round(val * 100) / 100;
}

// ─── Quick Add Customer Modal (inline) ───
function InlineQuickAddCustomer({
  defaultName,
  defaultGST,
  businessIds,
  allCustomers,
  onCreated,
  onCancel,
}: {
  defaultName: string;
  defaultGST: string;
  businessIds: string[];
  allCustomers: Customer[];
  onCreated: (c: Customer) => void;
  onCancel: () => void;
}) {
  const { create: createCustomer } = useCustomers();
  const { toast } = useToast();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [form, setForm] = useState({
    name: defaultName,
    gst: defaultGST.includes("(PAN)") ? "" : defaultGST === "-" ? "" : defaultGST,
    pan: defaultGST.includes("(PAN)") ? defaultGST.replace("(PAN)", "").trim() : "",
    mobile: "",
    state: "Rajasthan",
    address: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState<string>("");
  const [existingSearch, setExistingSearch] = useState(defaultName);

  const gstStateMap: Record<string, string> = {
    "27": "Maharashtra", "24": "Gujarat", "29": "Karnataka",
    "07": "Delhi", "08": "Rajasthan", "36": "Telangana", "33": "Tamil Nadu",
    "09": "Uttar Pradesh", "19": "West Bengal", "32": "Kerala",
  };

  useEffect(() => {
    if (form.gst.length >= 2) {
      const prefix = form.gst.substring(0, 2);
      if (gstStateMap[prefix] && !form.state) {
        setForm(p => ({ ...p, state: gstStateMap[prefix] }));
      }
    }
  }, [form.gst]);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        gst_number: form.gst,
        pan_number: form.pan,
        mobile_number: form.mobile,
        state_name: form.state ? form.state.toUpperCase() : "",
        address: form.address,
        businesses: businessIds,
      };
      const created = await createCustomer(payload);
      toast({ title: "Customer Created", description: form.name });
      onCreated(created as Customer);
    } catch (err: any) {
      const detail = err?.response?.data;
      let errorMsg = "Could not create customer.";
      if (detail && typeof detail === "object") {
        errorMsg = Object.entries(detail)
          .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(", ") : val}`)
          .join("; ");
      }
      toast({ title: "Creation Failed", description: errorMsg, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const handleLinkExisting = () => {
    const customer = allCustomers.find(c => String(c.id) === selectedExistingId);
    if (customer) {
      toast({ title: "Customer Linked", description: customer.name });
      onCreated(customer);
    }
  };

  const filteredCustomers = allCustomers.filter(c => {
    const q = existingSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) ||
      c.gst_number?.toLowerCase().includes(q) ||
      c.pan_number?.toLowerCase().includes(q) ||
      c.mobile_number?.includes(q);
  });

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="border border-primary/30 rounded-xl p-4 bg-primary/5 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary" />
          <span className="text-[12px] font-semibold text-foreground">
            {defaultName}
          </span>
        </div>
        <button onClick={onCancel} className="p-1 rounded hover:bg-secondary/50">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-secondary/30 w-fit">
        <button
          onClick={() => setMode("new")}
          className={cn(
            "px-3 py-1 rounded-md text-[11px] font-medium transition-all",
            mode === "new"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <UserPlus className="w-3 h-3 inline mr-1" />
          Create New
        </button>
        <button
          onClick={() => setMode("existing")}
          className={cn(
            "px-3 py-1 rounded-md text-[11px] font-medium transition-all",
            mode === "existing"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="w-3 h-3 inline mr-1" />
          Link Existing
        </button>
      </div>

      {mode === "new" ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Customer Name *"
              className="premium-input text-[12px] h-8 col-span-2 sm:col-span-1"
            />
            <input
              value={form.gst}
              onChange={e => setForm(p => ({ ...p, gst: e.target.value.toUpperCase() }))}
              placeholder="GST Number"
              maxLength={15}
              className="premium-input text-[12px] h-8 font-mono uppercase"
            />
            <input
              value={form.pan}
              onChange={e => setForm(p => ({ ...p, pan: e.target.value.toUpperCase() }))}
              placeholder="PAN"
              maxLength={10}
              className="premium-input text-[12px] h-8 font-mono uppercase"
            />
            <input
              value={form.mobile}
              onChange={e => setForm(p => ({ ...p, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
              placeholder="Mobile"
              maxLength={10}
              className="premium-input text-[12px] h-8 tabular-nums"
            />
            <select
              value={form.state}
              onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
              className="premium-select text-[12px] h-8"
            >
              <option value="">State</option>
              {indianStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
              placeholder="Address"
              className="premium-input text-[12px] h-8"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancel} className="premium-btn-ghost text-[11px] h-7 px-3">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!form.name.trim() || submitting}
              className="premium-btn-primary text-[11px] h-7 px-3"
            >
              {submitting ? "Creating..." : "Create & Link"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <input
              value={existingSearch}
              onChange={e => { setExistingSearch(e.target.value); setSelectedExistingId(""); }}
              placeholder="Search by name, GST, PAN, or mobile..."
              className="premium-input text-[12px] h-8 w-full"
            />
            <div className="max-h-36 overflow-y-auto rounded-lg border border-border/30 divide-y divide-border/20">
              {filteredCustomers.length === 0 ? (
                <div className="p-3 text-center text-[11px] text-muted-foreground">
                  No matching customers found
                </div>
              ) : (
                filteredCustomers.slice(0, 20).map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedExistingId(String(c.id))}
                    className={cn(
                      "w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors text-[11px]",
                      selectedExistingId === String(c.id)
                        ? "bg-primary/15 border-l-2 border-l-primary"
                        : "hover:bg-secondary/30"
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cn(
                        "font-medium truncate",
                        selectedExistingId === String(c.id) ? "text-primary" : "text-foreground"
                      )}>
                        {c.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {[c.gst_number, c.pan_number, c.mobile_number, c.state_name]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {selectedExistingId === String(c.id) && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
            {filteredCustomers.length > 20 && (
              <p className="text-[10px] text-muted-foreground text-center">
                Showing 20 of {filteredCustomers.length} — type more to narrow down
              </p>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancel} className="premium-btn-ghost text-[11px] h-7 px-3">Cancel</button>
            <button
              onClick={handleLinkExisting}
              disabled={!selectedExistingId}
              className="premium-btn-primary text-[11px] h-7 px-3"
            >
              Link Customer
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

export default function ImportPage({ type }: ImportPageProps) {
  const config = configs[type];
  const { toast } = useToast();
  const navigate = useNavigate();
  const { items: businesses } = useBusinesses();
  const { items: customers, refetch: refetchCustomers } = useCustomers();
  const { items: existingInvoices, refetch: refetchInvoices } = useInvoices(undefined, type === "invoice");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [bizFilter, setBizFilter] = useState("all");
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const [excelPreview, setExcelPreview] = useState<ImportReadyInvoice[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // For inline customer creation
  const [addingCustomerFor, setAddingCustomerFor] = useState<string | null>(null);
  // Track newly created customers during this session
  const [newlyCreatedCustomers, setNewlyCreatedCustomers] = useState<Customer[]>([]);
  // Track manual name→customer mappings (for "Link Existing" where names differ)
  const [customerNameMap, setCustomerNameMap] = useState<Record<string, Customer>>({});
  // Selected invoices for import (checked ones)
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  // Inline editing state: index of row being edited, null if none
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ date: string; party: string; gst: string; qty: string; rate: string }>({ date: "", party: "", gst: "", qty: "", rate: "" });

  const startEditing = (idx: number) => {
    const inv = excelPreview?.[idx];
    if (!inv) return;
    setEditingIdx(idx);
    setEditForm({
      date: inv.invoice_date,
      party: inv.customerName,
      gst: inv.customerGST,
      qty: inv.items[0]?.qty?.toString() || "0",
      rate: inv.items[0]?.rate?.toString() || "0",
    });
  };

  const saveEditing = () => {
    if (editingIdx === null || !excelPreview) return;
    const updated = [...excelPreview];
    const inv = { ...updated[editingIdx] };
    inv.invoice_date = editForm.date;
    inv.customerName = editForm.party;
    inv.customerGST = editForm.gst;
    // Recalculate amounts if qty/rate changed
    const newQty = parseFloat(editForm.qty) || 0;
    const newRate = parseFloat(editForm.rate) || 0;
    if (inv.items.length > 0) {
      const item = { ...inv.items[0] };
      item.qty = newQty;
      item.rate = newRate;
      item.amount = Math.round(newQty * newRate * 100) / 100;
      const gstRate = item.gstRate || 0;
      const halfRate = gstRate / 2;
      item.cgst = Math.round(item.amount * halfRate / 100 * 100) / 100;
      item.sgst = Math.round(item.amount * halfRate / 100 * 100) / 100;
      item.igst = 0;
      inv.items = [item, ...inv.items.slice(1)];
      inv.subtotal = inv.items.reduce((s, i) => s + i.amount, 0);
      inv.totalCGST = inv.items.reduce((s, i) => s + i.cgst, 0);
      inv.totalSGST = inv.items.reduce((s, i) => s + i.sgst, 0);
      inv.totalIGST = inv.items.reduce((s, i) => s + i.igst, 0);
      inv.total = Math.round((inv.subtotal + inv.totalCGST + inv.totalSGST + inv.totalIGST) * 100) / 100;
    }
    updated[editingIdx] = inv;
    setExcelPreview(updated);
    setEditingIdx(null);
  };

  const cancelEditing = () => setEditingIdx(null);

  const Icon = config.icon;

  const isExcelFile = (f: File) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls");

  // ─── Validate parsed invoices against existing data ───
  const validationResults: ValidationResult[] = useMemo(() => {
    if (!excelPreview || excelPreview.length === 0) return [];

    const allCustomers = [...customers, ...newlyCreatedCustomers];

    return excelPreview.map((inv) => {
      // Match business by GSTIN or name
      let businessMatch: Business | null = null;
      if (inv.firmGSTIN) {
        businessMatch = businesses.find(
          b => b.gst_number?.toUpperCase() === inv.firmGSTIN.toUpperCase()
        ) || null;
      }
      if (!businessMatch && inv.firmName) {
        businessMatch = businesses.find(
          b => b.name.toLowerCase().includes(inv.firmName.toLowerCase()) ||
               inv.firmName.toLowerCase().includes(b.name.toLowerCase())
        ) || null;
      }
      // If user selected a specific business, use that
      if (!businessMatch && bizFilter !== "all") {
        businessMatch = businesses.find(b => String(b.id) === bizFilter) || null;
      }

      // Match customer by GST/PAN or name
      let customerMatch: Customer | null = null;
      const custGst = inv.customerGST?.replace("(PAN)", "").trim();
      if (custGst && custGst !== "-" && custGst !== "") {
        const isPan = inv.customerGST?.includes("(PAN)");
        if (isPan) {
          customerMatch = allCustomers.find(
            c => c.pan_number?.toUpperCase() === custGst.toUpperCase()
          ) || null;
        } else {
          customerMatch = allCustomers.find(
            c => c.gst_number?.toUpperCase() === custGst.toUpperCase()
          ) || null;
        }
      }
      if (!customerMatch && inv.customerName) {
        customerMatch = allCustomers.find(
          c => c.name.toLowerCase() === inv.customerName.toLowerCase()
        ) || null;
      }
      // Check manual name→customer mappings (from "Link Existing")
      if (!customerMatch && inv.customerName && customerNameMap[inv.customerName.toLowerCase()]) {
        customerMatch = customerNameMap[inv.customerName.toLowerCase()];
      }

      // Check for duplicate invoice (same invoice number + same business + same date)
      let isDuplicate = false;
      if (businessMatch) {
        isDuplicate = existingInvoices.some(
          existing =>
            existing.invoiceNumber === inv.invoiceNumber &&
            String(existing.businessId) === String(businessMatch!.id) &&
            existing.invoice_date === inv.invoice_date
        );
      }

      // Determine status
      let status: ValidationResult["status"] = "ready";
      if (isDuplicate) status = "duplicate";
      else if (!businessMatch) status = "missing_business";
      else if (!customerMatch) status = "missing_customer";

      return { invoice: inv, businessMatch, customerMatch, isDuplicate, status };
    });
  }, [excelPreview, businesses, customers, newlyCreatedCustomers, existingInvoices, bizFilter, customerNameMap]);

  // ─── Stats ───
  const readyCount = validationResults.filter(v => v.status === "ready").length;
  const missingBizCount = validationResults.filter(v => v.status === "missing_business").length;
  const missingCustCount = validationResults.filter(v => v.status === "missing_customer").length;
  const duplicateCount = validationResults.filter(v => v.status === "duplicate").length;

  // Auto-select all importable invoices when validation results change
  useEffect(() => {
    if (validationResults.length > 0) {
      const importableKeys = new Set(
        validationResults
          .filter(v => v.status === "ready" || v.status === "missing_customer")
          .map(v => `${v.invoice.firmName}-${v.invoice.invoiceNumber}`)
      );
      setSelectedInvoices(importableKeys);
    }
  }, [validationResults]);

  const handleFile = (f: File | null) => {
    if (f && !f.name.endsWith(".csv") && !isExcelFile(f)) {
      toast({ title: "Invalid File", description: "Please upload a CSV or Excel (.xlsx) file.", variant: "destructive" });
      return;
    }
    setFile(f);
    setImportDone(false);
    setImportResult(null);
    setExcelPreview(null);
    setShowPreview(false);
    setNewlyCreatedCustomers([]);
    setAddingCustomerFor(null);

    // If Excel file and invoice type, parse for preview
    if (f && isExcelFile(f) && type === "invoice") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as ArrayBuffer;
          const result = parseInvoiceExcel(data);
          const invoices = toImportReadyInvoices(result);
          setExcelPreview(invoices);
          setShowPreview(true); // auto-show preview
          if (invoices.length > 0) {
            toast({ title: "Excel Parsed", description: `Found ${invoices.length} invoices from ${result.firms.length} firm(s)` });
          } else {
            toast({ title: "No Invoices Found", description: "Could not parse invoices from this Excel file.", variant: "destructive" });
          }
        } catch (err) {
          console.error("Excel parse error:", err);
          toast({ title: "Parse Error", description: "Could not read this Excel file. Check the format.", variant: "destructive" });
        }
      };
      reader.readAsArrayBuffer(f);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      // For Excel invoice import, send only selected & ready invoices
      if (isExcelFile(file) && type === "invoice" && excelPreview && excelPreview.length > 0) {
        const toImport = validationResults
          .filter(v =>
            selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`) &&
            (v.status === "ready" || v.status === "missing_customer") // missing_customer → backend will create
          )
          .map(v => {
            const inv = { ...v.invoice };
            // Round amounts before sending
            inv.subtotal = roundAmount(inv.subtotal);
            inv.totalCGST = roundAmount(inv.totalCGST);
            inv.totalSGST = roundAmount(inv.totalSGST);
            inv.totalIGST = roundAmount(inv.totalIGST);
            inv.total = roundAmount(inv.total);
            inv.items = inv.items.map(item => ({
              ...item,
              amount: roundAmount(item.amount),
              cgst: roundAmount(item.cgst),
              sgst: roundAmount(item.sgst),
              igst: roundAmount(item.igst),
            }));
            return inv;
          });

        if (toImport.length === 0) {
          toast({ title: "Nothing to Import", description: "No valid invoices selected.", variant: "destructive" });
          setImporting(false);
          return;
        }

        const { default: api } = await import("@/utils/api");
        const res = await api.post("invoices/bulk-import/", {
          invoices: toImport,
          business_id: bizFilter !== "all" ? bizFilter : undefined,
        });
        const result = res.data;
        setImportDone(true);
        setImportResult(result);
        toast({
          title: "Import Complete",
          description: `${result.created} imported, ${result.skipped} skipped.`,
        });
        // Refresh data
        refetchInvoices();
        refetchCustomers();
        // Navigate to preview page with import results
        navigate("/billing/import/preview", {
          state: {
            invoices: toImport,
            result,
            businessName: businesses.find(b => String(b.id) === bizFilter)?.name || "All Businesses",
          },
        });
      } else {
        // CSV import (original flow)
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", type);
        if (bizFilter !== "all") formData.append("business_id", bizFilter);
        const { default: api } = await import("@/utils/api");
        await api.post("csv/import/", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setImportDone(true);
        toast({ title: "Import Successful", description: `Records from ${file.name} imported successfully.` });
      }
    } catch (err: any) {
      const data = err?.response?.data;
      let msg = "Import failed. Check your file format.";
      if (data?.error) msg = data.error;
      else if (data?.detail) msg = data.detail;
      else if (data?.message) msg = data.message;
      else if (typeof data === "string") msg = data;
      else if (err?.message) msg = err.message;
      console.error("Import error:", err?.response?.status, data);
      toast({ title: "Import Failed", description: msg, variant: "destructive" });
    }
    setImporting(false);
  };

  const handleSampleDownload = () => {
    const headers = config.columns.map((c) => c.name).join(",");
    const sampleRow = config.columns.map((c) => c.example).join(",");
    const csv = `${headers}\n${sampleRow}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${type}-import-sample.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Sample Downloaded", description: `${type}-import-sample.csv` });
  };

  const toggleInvoice = (key: string) => {
    setSelectedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    const importable = validationResults
      .filter(v => v.status === "ready" || v.status === "missing_customer")
      .map(v => `${v.invoice.firmName}-${v.invoice.invoiceNumber}`);
    if (selectedInvoices.size === importable.length) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(importable));
    }
  };

  // Get unique missing customers
  const missingCustomers = useMemo(() => {
    const seen = new Set<string>();
    return validationResults
      .filter(v => v.status === "missing_customer")
      .filter(v => {
        const key = v.invoice.customerName.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [validationResults]);

  const handleCustomerCreated = (customer: Customer, importName?: string) => {
    setNewlyCreatedCustomers(prev => [...prev, customer]);
    // Store manual name mapping if the import name differs from the linked customer name
    const nameToMap = importName || addingCustomerFor;
    if (nameToMap && customer.name.toLowerCase() !== nameToMap.toLowerCase()) {
      setCustomerNameMap(prev => ({ ...prev, [nameToMap.toLowerCase()]: customer }));
    }
    setAddingCustomerFor(null);
    // The validation will re-run due to dependency on newlyCreatedCustomers / customerNameMap
  };

  const statusIcon = (s: ValidationResult["status"]) => {
    switch (s) {
      case "ready": return <Check className="w-3.5 h-3.5 text-success" />;
      case "duplicate": return <Copy className="w-3.5 h-3.5 text-amber-500" />;
      case "missing_business": return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
      case "missing_customer": return <UserPlus className="w-3.5 h-3.5 text-blue-500" />;
    }
  };

  const statusLabel = (s: ValidationResult["status"]) => {
    switch (s) {
      case "ready": return "Ready";
      case "duplicate": return "Duplicate";
      case "missing_business": return "No Business";
      case "missing_customer": return "New Customer";
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-7 max-w-[1440px] mx-auto">
      <Breadcrumbs items={config.breadcrumb} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={cn("w-12 h-12 rounded-2xl border flex items-center justify-center",
            `${config.bg} border-current/20`)}>
            <Icon className={cn("w-5 h-5", config.color)} />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{config.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Upload a CSV or Excel file to bulk import records</p>
          </div>
        </div>
        <Link to={config.back} className="premium-btn-ghost text-[13px] h-9"><ArrowLeft className="w-4 h-4" /> Back</Link>
      </motion.div>

      <motion.div variants={stagger} initial="hidden" animate="visible"
        className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* CSV Format Reference */}
        <motion.div variants={fadeUp} className="lg:col-span-4 space-y-5">
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", config.bg)}>
                <FileSpreadsheet className={cn("w-3.5 h-3.5", config.color)} />
              </div>
              <h2 className="text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wider">CSV Format</h2>
            </div>

            <div className="space-y-2">
              {config.columns.map((col, i) => (
                <div key={col.name} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/30 hover:bg-secondary/10 transition-colors">
                  <span className="w-6 h-6 rounded-lg bg-secondary/50 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[12px] font-semibold", col.required ? "text-foreground" : "text-muted-foreground")}>
                      {col.name}
                      {col.required && <span className="text-destructive ml-0.5">*</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{col.example}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={handleSampleDownload} className="premium-btn-outline flex-1 text-[12px] h-10">
                <Download className="w-3.5 h-3.5" /> Sample CSV
              </button>
              {type === "invoice" && (
                <button onClick={() => { downloadSampleExcel(); toast({ title: "Template Downloaded", description: "invoice-import-template.xlsx" }); }} className="premium-btn-outline flex-1 text-[12px] h-10">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Excel Template
                </button>
              )}
            </div>
          </div>

          {/* Tips */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-chart-3" />
              <h3 className="text-[12px] font-display font-semibold text-foreground uppercase tracking-wider">Tips</h3>
            </div>
            <ul className="space-y-2 text-[11px] text-muted-foreground">
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Fields marked with * are required.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Supports both CSV and Excel (.xlsx) files.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Excel: One sheet per firm or all firms at once.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Duplicate invoices (same Bill No. + Business) are detected.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Missing customers can be added inline before import.</li>
              <li className="flex items-start gap-2"><span className="w-1 h-1 rounded-full bg-chart-3 mt-1.5 shrink-0" />Preview all data before importing.</li>
            </ul>
          </div>
        </motion.div>

        {/* Upload Area */}
        <motion.div variants={fadeUp} className="lg:col-span-8 space-y-5">

          {/* Business filter */}
          {config.showBusiness && (
            <div className="elevated-card rounded-2xl p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <Hash className="w-4 h-4 text-muted-foreground" />
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Target Business</label>
              </div>
              <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-full">
                <option value="all">Auto-detect from Excel (Match by GSTIN)</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.gst_number}</option>)}
              </select>
            </div>
          )}

          {/* Drop Zone */}
          <div className="elevated-card rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Upload className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wider">Upload File</h2>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById("file-input")?.click()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all duration-300",
                dragOver ? "border-primary bg-primary/5 scale-[1.01]" :
                file ? "border-success/40 bg-success/3" :
                "border-border/60 hover:border-primary/40 hover:bg-secondary/10"
              )}
            >
              <AnimatePresence mode="wait">
                {importDone ? (
                  <motion.div key="done" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-2">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
                    <p className="text-[14px] font-semibold text-success">Import Complete!</p>
                    {importResult && (
                      <p className="text-[12px] text-muted-foreground">
                        {importResult.created} imported, {importResult.skipped} skipped
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">Click to upload another file</p>
                  </motion.div>
                ) : file ? (
                  <motion.div key="file" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="space-y-2">
                    <FileText className="w-12 h-12 text-success/70 mx-auto" />
                    <p className="text-[14px] font-semibold text-foreground">{file.name}</p>
                    <p className="text-[12px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                  </motion.div>
                ) : (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                    <Upload className="w-12 h-12 text-muted-foreground/40 mx-auto" />
                    <p className="text-[14px] font-semibold text-foreground">Drag & drop your file</p>
                    <p className="text-[12px] text-muted-foreground">or click to browse · CSV or Excel (.xlsx) · Max 5MB</p>
                  </motion.div>
                )}
              </AnimatePresence>
              <input id="file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] || null)} />
            </div>
          </div>

          {/* ─── Validation Summary ─── */}
          {validationResults.length > 0 && (
            <div className="elevated-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-chart-1/10 flex items-center justify-center">
                  <Eye className="w-3.5 h-3.5 text-chart-1" />
                </div>
                <h2 className="text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wider">
                  Validation Summary
                </h2>
              </div>

              {/* Status badges */}
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 border border-success/20">
                  <Check className="w-3.5 h-3.5 text-success" />
                  <span className="text-[11px] font-semibold text-success">{readyCount} Ready</span>
                </div>
                {duplicateCount > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Copy className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[11px] font-semibold text-amber-500">{duplicateCount} Duplicate</span>
                  </div>
                )}
                {missingCustCount > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <UserPlus className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-[11px] font-semibold text-blue-500">{missingCustCount} New Customer</span>
                  </div>
                )}
                {missingBizCount > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                    <span className="text-[11px] font-semibold text-destructive">{missingBizCount} No Business</span>
                  </div>
                )}
              </div>

              {/* Missing Business Warning */}
              {missingBizCount > 0 && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-destructive/20 bg-destructive/5">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-[11px] text-muted-foreground">
                    <p className="font-semibold text-destructive mb-1">Business not found</p>
                    <p>
                      {Array.from(new Set(
                        validationResults.filter(v => v.status === "missing_business").map(v => `${v.invoice.firmName} (${v.invoice.firmGSTIN})`)
                      )).join(", ")}
                    </p>
                    <p className="mt-1">Select a Target Business above, or add the business first from the Businesses page.</p>
                  </div>
                </div>
              )}

              {/* Missing Customers - inline add */}
              {missingCustomers.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
                    <UserPlus className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-muted-foreground flex-1">
                      <p className="font-semibold text-blue-600 mb-1">New customers detected</p>
                      <p className="mb-2">These customers don't exist yet. Add them now or they'll be auto-created during import.</p>
                      <div className="flex flex-wrap gap-1.5">
                        {missingCustomers.map(v => {
                          const key = v.invoice.customerName;
                          return (
                            <button
                              key={key}
                              onClick={() => setAddingCustomerFor(addingCustomerFor === key ? null : key)}
                              className={cn(
                                "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                                addingCustomerFor === key
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-secondary/50 hover:bg-secondary text-foreground"
                              )}
                            >
                              <Plus className="w-3 h-3" />
                              {key}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {addingCustomerFor && (
                      <InlineQuickAddCustomer
                        defaultName={addingCustomerFor}
                        defaultGST={
                          validationResults.find(
                            v => v.invoice.customerName === addingCustomerFor
                          )?.invoice.customerGST || ""
                        }
                        allCustomers={customers}
                        businessIds={businesses.map(b => String(b.id))}
                        onCreated={handleCustomerCreated}
                        onCancel={() => setAddingCustomerFor(null)}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {/* ─── Detailed Preview Table ─── */}
          {validationResults.length > 0 && (
            <div className="elevated-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-chart-3/10 flex items-center justify-center">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-chart-3" />
                  </div>
                  <h2 className="text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wider">
                    Invoice Preview ({validationResults.length})
                  </h2>
                </div>
                <button onClick={() => setShowPreview(!showPreview)} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" /> {showPreview ? "Hide" : "Show"}
                </button>
              </div>

              {showPreview && (
                <div className="max-h-[500px] overflow-auto rounded-xl border border-border/40">
                  <table className="w-full text-[11px]">
                    <thead className="bg-secondary/50 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-2 text-left w-8">
                          <input
                            type="checkbox"
                            checked={selectedInvoices.size === (readyCount + missingCustCount) && (readyCount + missingCustCount) > 0}
                            onChange={toggleAll}
                            className="rounded"
                          />
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Status</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Bill No.</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Date</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Party</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">GST</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Firm</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Items</th>
                        <th className="px-2 py-2 text-right font-semibold text-muted-foreground">Taxable</th>
                        <th className="px-2 py-2 text-right font-semibold text-muted-foreground">CGST</th>
                        <th className="px-2 py-2 text-right font-semibold text-muted-foreground">SGST</th>
                        <th className="px-2 py-2 text-right font-semibold text-muted-foreground">Total</th>
                        <th className="px-2 py-2 text-center font-semibold text-muted-foreground w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {validationResults.map((v, idx) => {
                        const inv = v.invoice;
                        const key = `${inv.firmName}-${inv.invoiceNumber}`;
                        const isSelected = selectedInvoices.has(key);
                        const canSelect = v.status === "ready" || v.status === "missing_customer";

                        return (
                          <tr
                            key={idx}
                            className={cn(
                              "transition-colors",
                              v.status === "duplicate" && "bg-amber-500/5 text-muted-foreground line-through",
                              v.status === "missing_business" && "bg-destructive/5",
                              v.status === "missing_customer" && "bg-blue-500/5",
                              v.status === "ready" && (idx % 2 === 0 ? "bg-background" : "bg-secondary/10"),
                            )}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => canSelect && toggleInvoice(key)}
                                disabled={!canSelect}
                                className="rounded"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="inline-flex items-center gap-1">
                                {statusIcon(v.status)}
                                <span className="text-[10px]">{statusLabel(v.status)}</span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5 font-medium text-primary">{inv.invoiceNumber}</td>
                            <td className="px-2 py-1.5 tabular-nums">
                              {editingIdx === idx ? (
                                <input type="date" value={editForm.date} onChange={(e) => setEditForm(p => ({ ...p, date: e.target.value }))}
                                  className="w-[110px] px-1 py-0.5 rounded bg-input border border-border text-[11px]" />
                              ) : (
                                <span className={inv.invoice_date.length > 10 || inv.invoice_date.startsWith("4") ? "text-destructive font-bold" : ""}>{inv.invoice_date}</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 truncate max-w-[120px]" title={inv.customerName}>
                              {editingIdx === idx ? (
                                <input type="text" value={editForm.party} onChange={(e) => setEditForm(p => ({ ...p, party: e.target.value }))}
                                  className="w-full px-1 py-0.5 rounded bg-input border border-border text-[11px]" />
                              ) : (
                                <>
                                  {inv.customerName}
                                  {v.customerMatch && <span className="text-[9px] text-success ml-1">(matched)</span>}
                                </>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-[10px] truncate max-w-[100px]" title={inv.customerGST}>
                              {editingIdx === idx ? (
                                <input type="text" value={editForm.gst} onChange={(e) => setEditForm(p => ({ ...p, gst: e.target.value }))}
                                  className="w-full px-1 py-0.5 rounded bg-input border border-border text-[10px] font-mono" placeholder="GST Number" />
                              ) : (
                                inv.customerGST || "-"
                              )}
                            </td>
                            <td className="px-2 py-1.5 truncate max-w-[100px]" title={inv.firmName}>
                              {inv.firmName}
                              {v.businessMatch && (
                                <span className="text-[9px] text-success ml-1">(ok)</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {editingIdx === idx ? (
                                <div className="flex items-center gap-1">
                                  <input type="number" value={editForm.qty} onChange={(e) => setEditForm(p => ({ ...p, qty: e.target.value }))}
                                    className="w-[50px] px-1 py-0.5 rounded bg-input border border-border text-[11px] tabular-nums" step="0.01" />
                                  <span className="text-[9px] text-muted-foreground">@</span>
                                  <input type="number" value={editForm.rate} onChange={(e) => setEditForm(p => ({ ...p, rate: e.target.value }))}
                                    className="w-[60px] px-1 py-0.5 rounded bg-input border border-border text-[11px] tabular-nums" step="0.01" />
                                </div>
                              ) : (
                                <>
                                  {inv.items.length}
                                  <span className="text-[9px] text-muted-foreground ml-0.5">
                                    ({inv.items.map(i => `${i.qty}${i.unit || "gms"}`).join(", ")})
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {"\u20b9"}{roundAmount(inv.subtotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {"\u20b9"}{roundAmount(inv.totalCGST).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {"\u20b9"}{roundAmount(inv.totalSGST).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                              {"\u20b9"}{roundAmount(inv.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {editingIdx === idx ? (
                                <div className="flex items-center gap-0.5">
                                  <button onClick={saveEditing} className="w-6 h-6 rounded flex items-center justify-center hover:bg-success/20 text-success" title="Save">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={cancelEditing} className="w-6 h-6 rounded flex items-center justify-center hover:bg-destructive/20 text-destructive" title="Cancel">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => startEditing(idx)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors" title="Edit">
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Totals row */}
                    <tfoot className="bg-secondary/40 border-t border-border/40">
                      <tr className="font-semibold">
                        <td colSpan={9} className="px-2 py-2 text-right text-[11px] text-muted-foreground uppercase">
                          Selected Total ({selectedInvoices.size} invoices)
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[11px]">
                          {"\u20b9"}{roundAmount(
                            validationResults
                              .filter(v => selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`))
                              .reduce((s, v) => s + v.invoice.subtotal, 0)
                          ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[11px]">
                          {"\u20b9"}{roundAmount(
                            validationResults
                              .filter(v => selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`))
                              .reduce((s, v) => s + v.invoice.totalCGST, 0)
                          ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[11px]">
                          {"\u20b9"}{roundAmount(
                            validationResults
                              .filter(v => selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`))
                              .reduce((s, v) => s + v.invoice.totalSGST, 0)
                          ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[11px] font-bold">
                          {"\u20b9"}{roundAmount(
                            validationResults
                              .filter(v => selectedInvoices.has(`${v.invoice.firmName}-${v.invoice.invoiceNumber}`))
                              .reduce((s, v) => s + v.invoice.total, 0)
                          ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Import Result Details */}
          {importResult && importResult.errors.length > 0 && (
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h3 className="text-[12px] font-semibold text-foreground">Import Warnings</h3>
              </div>
              <div className="max-h-[150px] overflow-auto space-y-1">
                {importResult.errors.map((err, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    {err}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {file && !importDone && (
            <div className="elevated-card rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <Link to={config.back} className="premium-btn-ghost text-[13px] h-10 flex-1">
                  <ArrowLeft className="w-4 h-4" /> Cancel
                </Link>
                <button
                  onClick={handleImport}
                  disabled={
                    !file || importing || importDone ||
                    (isExcelFile(file) && type === "invoice" && selectedInvoices.size === 0)
                  }
                  className={cn(
                    "flex-1 h-10 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all",
                    file && !importing && !importDone && selectedInvoices.size > 0
                      ? "bg-primary text-primary-foreground hover:brightness-110"
                      : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {importing ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {importing
                    ? "Importing..."
                    : excelPreview
                      ? `Add ${selectedInvoices.size} Invoice${selectedInvoices.size !== 1 ? "s" : ""} to Data`
                      : "Import Records"}
                </button>
              </div>
            </div>
          )}

          {/* Post-import actions */}
          {importDone && (
            <div className="elevated-card rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <Link to="/billing/invoice/list" className="premium-btn-primary text-[13px] h-10 flex-1">
                  <Receipt className="w-4 h-4" /> View Invoices
                </Link>
                <button
                  onClick={() => {
                    setFile(null);
                    setExcelPreview(null);
                    setImportDone(false);
                    setImportResult(null);
                    setShowPreview(false);
                    setNewlyCreatedCustomers([]);
                  }}
                  className="premium-btn-outline text-[13px] h-10 flex-1"
                >
                  <Upload className="w-4 h-4" /> Import More
                </button>
              </div>
            </div>
          )}

          {/* Preview hint */}
          {file && !importDone && !excelPreview && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-chart-3/20 bg-chart-3/5 text-[12px] text-muted-foreground">
              <AlertTriangle className="w-4 h-4 text-chart-3 shrink-0" />
              <span>Records will be validated before import. Invalid rows will be skipped with a summary report.</span>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
