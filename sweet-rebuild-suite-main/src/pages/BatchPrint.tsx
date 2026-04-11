import { logger } from "@/utils/logger";
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Loader2, Printer, FileText, Check } from "lucide-react";
import { useBusinesses, useCustomers, useInvoice, mapDjangoInvoice } from "@/hooks/useDataStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import { BlobProvider } from "@react-pdf/renderer";
import TallyInvoicePDF from "@/components/TallyInvoicePDF";
import QRCode from "qrcode";
import api from "@/utils/api";
import { PDFDocument } from "pdf-lib";
import type { Invoice } from "@/utils/mockData";
import type { Business, Customer } from "@/hooks/useDataStore";

/** Fetch a single invoice with full line items from the API */
async function fetchFullInvoice(id: string): Promise<Invoice> {
  const res = await api.get<any>(`invoices/${id}/`);
  return mapDjangoInvoice(res.data);
}

/** Generate a QR data URL for an invoice */
async function generateQR(inv: Invoice, biz?: Business): Promise<string | undefined> {
  if (!inv || !biz) return undefined;
  const qrText = `${inv.invoiceNumber}|${biz.gst_number || ""}|${inv.invoice_date}|${inv.total}`;
  try {
    return await QRCode.toDataURL(qrText, { width: 150, margin: 1 });
  } catch {
    return undefined;
  }
}

interface InvoiceWithMeta {
  invoice: Invoice;
  business: Business;
  customer: Customer;
  qrDataUrl?: string;
}

export default function BatchPrint() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { items: businesses, isLoading: isLoadingBiz } = useBusinesses();
  const { items: customers, isLoading: isLoadingCust } = useCustomers();

  const [invoiceIds, setInvoiceIds] = useState<string[]>([]);
  const [invoiceData, setInvoiceData] = useState<InvoiceWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mergedPdfUrl, setMergedPdfUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pdfBlobs, setPdfBlobs] = useState<Map<string, Blob>>(new Map());
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);

  // Load invoice IDs from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("batch_print_ids");
    if (stored) {
      try {
        const ids = JSON.parse(stored) as string[];
        setInvoiceIds(ids);
      } catch {
        setInvoiceIds([]);
      }
    }
  }, []);

  // Fetch all invoices once businesses/customers are loaded
  useEffect(() => {
    if (invoiceIds.length === 0 || isLoadingBiz || isLoadingCust) return;
    let cancelled = false;

    async function loadAll() {
      setIsLoading(true);
      const results: InvoiceWithMeta[] = [];
      let skipped = 0;
      for (const id of invoiceIds) {
        try {
          const inv = await fetchFullInvoice(id);
          const biz = businesses.find((b) => String(b.id) === String(inv.businessId));
          const cust = customers.find((c) => String(c.id) === String(inv.customerId));
          if (biz && cust) {
            const qrDataUrl = await generateQR(inv, biz);
            results.push({ invoice: inv, business: biz, customer: cust, qrDataUrl });
          } else {
            // Business or customer not in loaded list — fetch directly
            logger.warn(`Invoice ${id}: biz=${inv.businessId} cust=${inv.customerId} not found in loaded lists, fetching...`);
            try {
              const [bizRes, custRes] = await Promise.all([
                biz ? Promise.resolve({ data: biz }) : api.get<any>(`businesses/${inv.businessId}/`),
                cust ? Promise.resolve({ data: cust }) : api.get<any>(`customers/${inv.customerId}/`),
              ]);
              const fetchedBiz = bizRes.data;
              const fetchedCust = custRes.data;
              const qrDataUrl = await generateQR(inv, fetchedBiz);
              results.push({ invoice: inv, business: fetchedBiz, customer: fetchedCust, qrDataUrl });
            } catch (e2) {
              logger.error(`Failed to fetch business/customer for invoice ${id}`, e2);
              skipped++;
            }
          }
        } catch (e) {
          logger.error(`Failed to fetch invoice ${id}`, e);
          skipped++;
        }
      }
      if (skipped > 0) logger.warn(`BatchPrint: ${skipped} invoices skipped due to errors`);
      if (!cancelled) {
        setInvoiceData(results);
        setIsLoading(false);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [invoiceIds, businesses, customers, isLoadingBiz, isLoadingCust]);

  // Track when individual PDFs are ready
  const handleBlobReady = (invoiceId: string, blob: Blob | null) => {
    if (!blob) return;
    setPdfBlobs((prev) => {
      const next = new Map(prev);
      next.set(invoiceId, blob);
      return next;
    });
  };

  // Merge all PDFs when all blobs are ready
  useEffect(() => {
    if (invoiceData.length === 0 || pdfBlobs.size < invoiceData.length) return;
    if (mergedPdfUrl) return; // already merged

    async function mergePDFs() {
      setGenerating(true);
      try {
        const merged = await PDFDocument.create();
        for (const item of invoiceData) {
          const blob = pdfBlobs.get(item.invoice.id);
          if (!blob) continue;
          const arrayBuf = await blob.arrayBuffer();
          const donor = await PDFDocument.load(arrayBuf);
          const pages = await merged.copyPages(donor, donor.getPageIndices());
          pages.forEach((page) => merged.addPage(page));
        }
        const mergedBytes = await merged.save();
        const mergedBlobResult = new Blob([mergedBytes as unknown as ArrayBuffer], { type: "application/pdf" });
        setMergedBlob(mergedBlobResult);
        const url = URL.createObjectURL(mergedBlobResult);
        setMergedPdfUrl(url);
      } catch (err) {
        logger.error("PDF merge failed", err);
        toast({ title: "Merge Failed", description: "Could not combine PDFs", variant: "destructive" });
      }
      setGenerating(false);
    }

    mergePDFs();
  }, [pdfBlobs, invoiceData, mergedPdfUrl, toast]);

  const handlePrint = () => {
    if (!mergedPdfUrl) return;
    const printWindow = window.open(mergedPdfUrl);
    if (printWindow) {
      printWindow.addEventListener("load", () => {
        printWindow.print();
      });
    }
  };

  const handleDownload = () => {
    if (!mergedBlob) return;
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices_batch_${invoiceData.length}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: `${invoiceData.length} invoices combined PDF` });
  };

  if (invoiceIds.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-4">
        <FileText className="w-12 h-12 text-muted-foreground opacity-30" />
        <p className="text-sm font-medium text-muted-foreground">No invoices selected for batch print.</p>
        <Link to="/billing/invoice/list" className="premium-btn-ghost text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Toolbar */}
      <div className={cn("no-print flex items-center gap-2 border-b border-border bg-card sticky top-0 z-10", isMobile ? "px-4 py-3" : "px-8 py-4 gap-3")}>
        <Link to="/billing/invoice/list" className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <span className={cn("font-display font-semibold text-foreground", isMobile ? "text-[13px]" : "text-[14px] ml-2")}>
          Batch Print · {invoiceData.length} invoices
        </span>
        <div className={cn("flex items-center gap-2 ml-auto", isMobile ? "gap-1.5" : "gap-2.5")}>
          {(isLoading || generating) && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          {!isLoading && pdfBlobs.size < invoiceData.length && (
            <span className="text-[11px] text-muted-foreground">
              Preparing {pdfBlobs.size}/{invoiceData.length}...
            </span>
          )}
          {mergedPdfUrl && (
            <>
              <button
                onClick={handlePrint}
                className={cn("premium-btn-primary", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")}
              >
                <Printer className="w-4 h-4" /> Print All
              </button>
              <button
                onClick={handleDownload}
                className={cn("premium-btn-ghost", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")}
              >
                <Download className="w-4 h-4" /> Download
              </button>
            </>
          )}
        </div>
      </div>

      {/* PDF Preview */}
      <div className="flex-1">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading {invoiceIds.length} invoices...</p>
          </div>
        ) : mergedPdfUrl ? (
          isMobile ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
              <Check className="w-10 h-10 text-success" />
              <p className="text-sm font-medium text-foreground">{invoiceData.length} invoices ready</p>
              <p className="text-xs text-muted-foreground">Use the Print All or Download button above</p>
            </div>
          ) : (
            <iframe
              src={`${mergedPdfUrl}#toolbar=0&navpanes=0`}
              title="Batch Invoice Preview"
              className="w-full border-none"
              style={{ minHeight: "calc(100vh - 60px)" }}
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Generating PDFs... {pdfBlobs.size}/{invoiceData.length}
            </p>
          </div>
        )}
      </div>

      {/* Hidden BlobProviders to generate individual PDFs */}
      <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
        {invoiceData.map((item) => (
          <BlobProvider
            key={item.invoice.id}
            document={
              <TallyInvoicePDF
                invoice={item.invoice}
                business={item.business}
                customer={item.customer}
                qrDataUrl={item.qrDataUrl}
              />
            }
          >
            {({ blob }) => {
              if (blob && !pdfBlobs.has(item.invoice.id)) {
                // Use setTimeout to avoid setState during render
                setTimeout(() => handleBlobReady(item.invoice.id, blob), 0);
              }
              return null;
            }}
          </BlobProvider>
        ))}
      </div>
    </div>
  );
}
