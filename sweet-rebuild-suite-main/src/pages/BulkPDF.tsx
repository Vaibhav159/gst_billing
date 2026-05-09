import { logger } from "@/utils/logger";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatCurrency, formatDate, financialYears, currentFY } from "@/utils/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Download, FileArchive, ArrowLeft, Calendar, Building2, Filter,
  FileText, CheckSquare, Square, Printer, Package, Search, Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { useBusinesses, useCustomers, mapDjangoInvoice } from "@/hooks/useDataStore";
import type { Invoice } from "@/utils/mockData";
import api from "@/utils/api";
import { BlobProvider } from "@react-pdf/renderer";
import TallyInvoicePDF from "@/components/TallyInvoicePDF";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import QRCode from "qrcode";

export default function BulkPDF() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const MONTHS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
  // Default to "all" so the page lands with results visible instead of an empty current month.
  const [month, setMonth] = useState("all");
  const [selectedFY, setSelectedFY] = useState(currentFY);
  const [bizFilter, setBizFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // For Tally PDF generation
  const [pdfQueue, setPdfQueue] = useState<Invoice[]>([]);
  const [pdfBlobs, setPdfBlobs] = useState<Map<string, Blob>>(new Map());
  const [zipMode, setZipMode] = useState(false);

  const handleBlobReady = useCallback((invoiceId: string, blob: Blob | null) => {
    if (!blob) return;
    setPdfBlobs(prev => { const next = new Map(prev); next.set(invoiceId, blob); return next; });
  }, []);

  async function generateQR(inv: Invoice, biz: any): Promise<string> {
    try {
      const data = JSON.stringify({ inv: inv.invoiceNumber, biz: biz?.name, total: inv.total });
      return await QRCode.toDataURL(data, { width: 100, margin: 1 });
    } catch { return ""; }
  }

  // Parse FY into date range: "2025-26" → Apr 2025 to Mar 2026
  const fyStartYear = parseInt(selectedFY.split("-")[0], 10);
  const fyStartDate = `${fyStartYear}-04-01`;
  const fyEndDate = `${fyStartYear + 1}-03-31`;

  // Fetch ALL invoices for the selected FY/business/type
  const fetchAllInvoices = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setLoadingInvoices(true);
    try {
      const params = new URLSearchParams();
      params.set("page_size", "1000");
      params.set("include_items", "true");
      params.set("start_date", fyStartDate);
      params.set("end_date", fyEndDate);
      if (bizFilter !== "all") params.set("business_id", bizFilter);
      if (typeFilter !== "all") params.set("type_of_invoice", typeFilter.toLowerCase());

      const res = await api.get<any>(`invoices/?${params.toString()}`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      setInvoices(results.map(mapDjangoInvoice));
    } catch (e) {
      logger.error("Failed to fetch invoices for bulk PDF", e);
    } finally {
      setLoadingInvoices(false);
    }
  }, [fyStartDate, fyEndDate, bizFilter, typeFilter]);

  useEffect(() => { fetchAllInvoices(); }, [fetchAllInvoices]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [invoiceFrom, setInvoiceFrom] = useState("");
  const [invoiceTo, setInvoiceTo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  /** Extract trailing number from invoice number like "SGJ/2024-25/108" → 108, or "45" → 45 */
  function extractNum(invNum: string): number {
    const m = invNum.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Filter invoices based on selections
  const monthIndex = MONTHS.indexOf(month);
  const actualMonth = monthIndex < 9 ? monthIndex + 4 : monthIndex - 8;
  const matchingInvoices = invoices.filter((inv) => {
    const d = new Date(inv.invoice_date || "");
    const monthMatch = month === "all" || d.getMonth() + 1 === actualMonth;
    if (!monthMatch) return false;

    // Invoice number range filter
    if (invoiceFrom || invoiceTo) {
      const num = extractNum(inv.invoiceNumber);
      if (invoiceFrom && num < parseInt(invoiceFrom, 10)) return false;
      if (invoiceTo && num > parseInt(invoiceTo, 10)) return false;
    }
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch = inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.customerName || "").toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }
    return true;
  }).sort((a, b) => extractNum(a.invoiceNumber) - extractNum(b.invoiceNumber));

  const toggleInvoice = (id: string) => {
    const next = new Set(selectedInvoices);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedInvoices(next);
  };
  const toggleAll = () => {
    selectedInvoices.size === matchingInvoices.length
      ? setSelectedInvoices(new Set())
      : setSelectedInvoices(new Set(matchingInvoices.map((i) => i.id)));
  };

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const [downloadMode, setDownloadMode] = useState<"zip" | "print" | null>(null);

  const getTargetInvoices = () => {
    return selectedInvoices.size > 0
      ? matchingInvoices.filter((inv) => selectedInvoices.has(inv.id))
      : matchingInvoices;
  };

  const handleDownload = () => {
    const toDownload = getTargetInvoices();
    if (toDownload.length === 0) return;
    setDownloading(true);
    setProgress({ current: 0, total: toDownload.length });
    setPdfBlobs(new Map());
    setPdfQueue(toDownload);
    setZipMode(true);
    setDownloadMode("zip");
    toast({ title: "Generating PDFs", description: `Creating ${toDownload.length} Tally-format invoice PDFs...` });
  };

  const handlePrint = () => {
    const toPrint = getTargetInvoices();
    if (toPrint.length === 0) return;
    setDownloading(true);
    setProgress({ current: 0, total: toPrint.length });
    setPdfBlobs(new Map());
    setPdfQueue(toPrint);
    setZipMode(true);
    setDownloadMode("print");
    toast({ title: "Generating PDFs", description: `Preparing ${toPrint.length} invoices for print...` });
  };

  const handleBatchPrint = () => {
    const toPrint = getTargetInvoices();
    if (toPrint.length === 0) return;
    sessionStorage.setItem("batch_print_ids", JSON.stringify(toPrint.map(i => i.id)));
    navigate("/billing/batch-print");
  };

  // When all blobs are collected, create ZIP or merged PDF for print
  useEffect(() => {
    if (!zipMode || pdfQueue.length === 0) return;
    if (pdfBlobs.size < pdfQueue.length) {
      setProgress({ current: pdfBlobs.size, total: pdfQueue.length });
      return;
    }

    async function finalize() {
      try {
        if (downloadMode === "print") {
          // Merge all PDFs into one and open for printing
          const merged = await PDFDocument.create();
          for (const inv of pdfQueue) {
            const blob = pdfBlobs.get(inv.id);
            if (!blob) continue;
            const buf = await blob.arrayBuffer();
            const donor = await PDFDocument.load(buf);
            const pages = await merged.copyPages(donor, donor.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          }
          const mergedBytes = await merged.save();
          const mergedBlob = new Blob([mergedBytes], { type: "application/pdf" });
          const url = URL.createObjectURL(mergedBlob);
          const win = window.open(url, "_blank");
          if (win) {
            win.addEventListener("load", () => { setTimeout(() => win.print(), 500); });
          }
          toast({ title: "Print Ready", description: `${pdfQueue.length} invoices merged and opened for print.` });
          // Log to audit
          api.post("audit-logs/log/", {
            action: "printed",
            entity: "invoice",
            entity_id: 0,
            entity_name: `Bulk Print (${pdfQueue.length} invoices)`,
            details: `Printed invoices #${pdfQueue[0]?.invoiceNumber} to #${pdfQueue[pdfQueue.length - 1]?.invoiceNumber} for FY ${selectedFY}`,
          }).catch(() => {});
        } else {
          // ZIP download
          const zip = new JSZip();
          for (const inv of pdfQueue) {
            const blob = pdfBlobs.get(inv.id);
            if (blob) {
              const filename = `${(inv.invoiceNumber || "invoice").replace(/\//g, "-")}.pdf`;
              zip.file(filename, blob);
            }
          }
          const zipBlob = await zip.generateAsync({ type: "blob" });
          const url = window.URL.createObjectURL(zipBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `invoices_FY${selectedFY}${month !== "all" ? `_${month}` : ""}.zip`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          a.remove();
          toast({ title: "Download Complete", description: `${pdfQueue.length} PDFs downloaded as ZIP.` });
          // Log to audit
          api.post("audit-logs/log/", {
            action: "exported",
            entity: "invoice",
            entity_id: 0,
            entity_name: `Bulk PDF Download (${pdfQueue.length} invoices)`,
            details: `Downloaded ZIP with invoices #${pdfQueue[0]?.invoiceNumber} to #${pdfQueue[pdfQueue.length - 1]?.invoiceNumber} for FY ${selectedFY}`,
          }).catch(() => {});
        }
      } catch (err: any) {
        logger.error("PDF finalization failed", err);
        toast({ title: "Failed", description: err?.message || "Could not generate PDFs.", variant: "destructive" });
      }
      setDownloading(false);
      setZipMode(false);
      setPdfQueue([]);
      setDownloadMode(null);
    }

    finalize();
  }, [zipMode, pdfQueue, pdfBlobs.size]);

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "Bulk PDF" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <FileArchive className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Bulk PDF Download</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Download multiple invoices as a ZIP file</p>
          </div>
        </div>
        <Link to="/billing/invoice/list" className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters */}
        <div className="space-y-5">
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-primary" />
              <h2 className="text-[14px] font-display font-semibold text-foreground">Filters</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 text-muted-foreground" /> Month
                </label>
                <select value={month} onChange={(e) => setMonth(e.target.value)} className="premium-select w-full">
                  <option value="all">All Months</option>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Financial Year</label>
                <select value={selectedFY} onChange={(e) => setSelectedFY(e.target.value)} className="premium-select w-full">
                  {financialYears.map((fy) => <option key={fy} value={fy}>FY {fy}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-muted-foreground" /> Business
                </label>
                <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-full">
                  <option value="all">All Businesses</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Type</label>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="premium-select w-full">
                  <option value="all">All Types</option>
                  <option value="OUTWARD">Outward (Sales)</option>
                  <option value="INWARD">Inward (Purchases)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-muted-foreground" /> Invoice # Range
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={invoiceFrom}
                    onChange={(e) => setInvoiceFrom(e.target.value)}
                    placeholder="From"
                    className="premium-input w-full text-[12px]"
                    min="1"
                  />
                  <span className="text-muted-foreground text-[11px] shrink-0">to</span>
                  <input
                    type="number"
                    value={invoiceTo}
                    onChange={(e) => setInvoiceTo(e.target.value)}
                    placeholder="To"
                    className="premium-input w-full text-[12px]"
                    min="1"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">e.g. 50 to 75 for invoices #50–#75</p>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Search className="w-3 h-3 text-muted-foreground" /> Find Invoice
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by # or customer..."
                  className="premium-input w-full text-[12px]"
                />
              </div>
            </div>
          </div>

          {/* Download Action */}
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-3xl font-display font-bold text-primary">{matchingInvoices.length}</p>
              <p className="text-[12px] text-muted-foreground">invoices match your filters</p>
            </div>
            {selectedInvoices.size > 0 && (() => {
              const selectedTotal = matchingInvoices.filter(inv => selectedInvoices.has(inv.id)).reduce((s, inv) => s + inv.total, 0);
              return (
                <div className="text-center space-y-1">
                  <p className="text-[12px] text-chart-3 font-medium">{selectedInvoices.size} selected for download</p>
                  <p className="text-[11px] text-muted-foreground">Total: <span className="font-semibold text-foreground">{formatCurrency(selectedTotal)}</span></p>
                </div>
              );
            })()}
            <button onClick={handleDownload} disabled={matchingInvoices.length === 0 || downloading}
              className={cn("w-full h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all",
                matchingInvoices.length > 0 && !downloading ? "bg-primary text-primary-foreground hover:brightness-110 glow-sm" : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
              )}>
              <Download className="w-4 h-4" /> {downloading && downloadMode === "zip" ? `Generating ${progress.current}/${progress.total}...` : selectedInvoices.size > 0 ? `Download ${selectedInvoices.size} PDFs` : "Download All PDFs"}
            </button>
            <div className="flex gap-2">
              <button onClick={handlePrint} disabled={matchingInvoices.length === 0 || downloading}
                className="flex-1 h-10 rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 border border-border/50 text-foreground hover:bg-secondary/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                <Printer className="w-3.5 h-3.5" /> {downloading && downloadMode === "print" ? `${progress.current}/${progress.total}...` : "Print All"}
              </button>
              <button onClick={handleBatchPrint} disabled={matchingInvoices.length === 0}
                className="flex-1 h-10 rounded-xl text-[12px] font-semibold flex items-center justify-center gap-1.5 border border-border/50 text-foreground hover:bg-secondary/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                <FileText className="w-3.5 h-3.5" /> Batch Print
              </button>
            </div>
          </div>

          {/* How It Works */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">How it works</h3>
            <ol className="space-y-2.5 text-[12px] text-muted-foreground">
              {[
                "Select month, year, and optional filters",
                "Preview matching invoices in the table",
                "Optionally select specific invoices",
                "Click download to get a ZIP file",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Invoice Preview Table */}
        <div className="lg:col-span-2">
          <div className="elevated-card rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-chart-3" />
                <h2 className="text-[14px] font-display font-semibold text-foreground">Matching Invoices ({matchingInvoices.length})</h2>
              </div>
              {matchingInvoices.length > 0 && (
                <button onClick={toggleAll} className="text-[12px] text-primary hover:underline font-medium">
                  {selectedInvoices.size === matchingInvoices.length ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            {loadingInvoices ? (
              <div className="p-16 text-center text-muted-foreground">
                <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-30" />
                <p className="text-[14px] font-medium">Loading invoices...</p>
              </div>
            ) : matchingInvoices.length > 0 ? (
              <table className="table-premium">
                <thead><tr>
                  <th className="w-10"></th><th>Invoice #</th><th>Date</th><th>Customer</th><th>Amount</th><th>Type</th>
                </tr></thead>
                <tbody>
                  {matchingInvoices.map((inv, i) => (
                    <motion.tr key={inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className={cn(selectedInvoices.has(inv.id) && "!bg-primary/5 ")}>
                      <td>
                        <button onClick={() => toggleInvoice(inv.id)} className="text-muted-foreground hover:text-primary">
                          {selectedInvoices.has(inv.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                        </button>
                      </td>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">{inv.invoiceNumber}</Link></td>
                      <td className="text-muted-foreground text-[12px]">{formatDate(inv.invoice_date || "")}</td>
                      <td className="text-foreground text-[13px]">{inv.customerName}</td>
                      <td className="font-bold text-foreground">{formatCurrency(inv.total)}</td>
                      <td><span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>{inv.type}</span></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-16 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-[14px] font-medium">No invoices found</p>
                <p className="text-[12px] mt-1">Try changing the month, year, or filters</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Hidden BlobProviders to generate Tally-format PDFs */}
      {zipMode && pdfQueue.length > 0 && (
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
          {pdfQueue.map((inv) => {
            const biz = businesses.find(b => String(b.id) === String(inv.businessId));
            const cust = customers.find(c => String(c.id) === String(inv.customerId));
            return (
              <BlobProviderWrapper
                key={inv.id}
                invoice={inv}
                business={biz}
                customer={cust}
                onBlob={handleBlobReady}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Wrapper to generate QR and render TallyInvoicePDF via BlobProvider */
function BlobProviderWrapper({ invoice, business, customer, onBlob }: {
  invoice: Invoice; business: any; customer: any;
  onBlob: (id: string, blob: Blob | null) => void;
}) {
  const [qr, setQr] = useState("");
  const called = useRef(false);

  useEffect(() => {
    const data = JSON.stringify({ inv: invoice.invoiceNumber, biz: business?.name, total: invoice.total });
    QRCode.toDataURL(data, { width: 100, margin: 1 }).then(setQr).catch(() => setQr(""));
  }, [invoice, business]);

  if (!qr && !called.current) return null; // wait for QR

  return (
    <BlobProvider
      document={
        <TallyInvoicePDF
          invoice={invoice}
          business={business || {}}
          customer={customer || {}}
          qrDataUrl={qr}
        />
      }
    >
      {({ blob }) => {
        if (blob && !called.current) {
          called.current = true;
          setTimeout(() => onBlob(invoice.id, blob), 0);
        }
        return null;
      }}
    </BlobProvider>
  );
}
