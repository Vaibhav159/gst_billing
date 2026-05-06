import { useParams, Link } from "react-router-dom";
import { useInvoice, useBusinesses, useCustomers } from "@/hooks/useDataStore";
import { ArrowLeft, Download, Loader2, Printer, Share2, MessageCircle } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/utils/utils";
import { BlobProvider } from "@react-pdf/renderer";
import TallyInvoicePDF from "@/components/TallyInvoicePDF";
import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { useToast } from "@/hooks/use-toast";

export default function InvoicePrintTally() {
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();
  const { item: inv, isLoading: isLoadingInvoice } = useInvoice(id);
  const { items: businesses, isLoading: isLoadingBiz } = useBusinesses();
  const { items: customers, isLoading: isLoadingCust } = useCustomers();
  const [downloading, setDownloading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>();
  const { toast } = useToast();

  const biz = inv ? businesses.find((b) => String(b.id) === String(inv.businessId)) : undefined;
  const customer = inv ? customers.find((c) => String(c.id) === String(inv.customerId)) : undefined;

  useEffect(() => {
    if (!inv || !biz) return;
    const qrText = `${inv.invoiceNumber}|${biz.gst_number || ""}|${inv.invoice_date}|${inv.total}`;
    QRCode.toDataURL(qrText, { width: 150, margin: 1 }).then(setQrDataUrl).catch(() => {});
  }, [inv, biz]);

  if (isLoadingInvoice || isLoadingBiz || isLoadingCust) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground animate-pulse">Preparing invoice for print...</p>
      </div>
    );
  }

  if (!inv) return <div className="p-8 text-muted-foreground">Invoice not found.</div>;
  if (!biz || !customer) return <div className="p-8 text-muted-foreground">Business or customer not found.</div>;

  const fileName = `${inv.invoiceNumber.replace(/\//g, "-")}.pdf`;
  const bizWithSig = biz ? { ...biz, signature_image: biz.signature_image_base64 || null } : biz;
  const document = <TallyInvoicePDF invoice={inv} business={bizWithSig} customer={customer} qrDataUrl={qrDataUrl} />;

  const handleDownload = (blob: Blob | null) => {
    if (!blob) return;
    setDownloading(true);
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setDownloading(false);
    toast({ title: "PDF Downloaded", description: inv.invoiceNumber });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className={cn("no-print flex items-center gap-2 border-b border-border bg-card sticky top-0 z-10", isMobile ? "px-4 py-3" : "px-8 py-4 gap-3")}>
        <Link to={`/billing/invoice/${id}`} className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        {!isMobile && <span className="text-[14px] font-display font-semibold text-foreground ml-2">{inv.invoiceNumber}</span>}
        <div className={cn("flex items-center gap-2 ml-auto", isMobile ? "gap-1.5" : "gap-2.5")}>
          {(downloading) && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          <BlobProvider document={document}>
            {({ blob, loading }) => (
              <>
                <button
                  onClick={() => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const printWindow = window.open(url);
                    if (printWindow) {
                      printWindow.addEventListener("load", () => {
                        printWindow.print();
                      });
                    }
                  }}
                  className={cn("premium-btn-primary", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")}
                  disabled={loading || downloading}
                >
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button
                  onClick={() => handleDownload(blob)}
                  className={cn("premium-btn-ghost", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")}
                  disabled={loading || downloading}
                >
                  <Download className="w-4 h-4" /> PDF
                </button>
                <button
                  onClick={async () => {
                    if (!blob) return;
                    handleDownload(blob);
                    const phone = customer?.mobile_number?.replace(/\D/g, "") || "";
                    const msg = encodeURIComponent(`Invoice ${inv.invoiceNumber} - ₹${inv.total.toLocaleString("en-IN")} — Please find the PDF attached.`);
                    const waUrl = phone
                      ? `https://wa.me/${phone.startsWith("91") ? phone : "91" + phone}?text=${msg}`
                      : `https://wa.me/?text=${msg}`;
                    window.open(waUrl, "_blank");
                    toast({ title: "PDF downloaded", description: "Attach the PDF in WhatsApp" });
                  }}
                  className={cn("premium-btn-outline border-success/30 text-success", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")}
                  disabled={loading || downloading}
                >
                  <MessageCircle className="w-4 h-4" /> {!isMobile && "WhatsApp"}
                </button>
                {isMobile ? (
                  <button
                    onClick={async () => {
                      if (!blob) return;
                      try {
                        const file = new File([blob], fileName, { type: "application/pdf" });
                        if (navigator.share) {
                          await navigator.share({ files: [file], title: inv.invoiceNumber });
                        } else {
                          handleDownload(blob);
                        }
                      } catch { handleDownload(blob); }
                    }}
                    className={cn("premium-btn-outline border-border text-muted-foreground", "text-[11px] h-8 px-2.5")}
                    disabled={loading || downloading}
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      if (!blob) return;
                      try {
                        const file = new File([blob], fileName, { type: "application/pdf" });
                        if (navigator.share) {
                          await navigator.share({ files: [file], title: inv.invoiceNumber });
                        } else {
                          handleDownload(blob);
                        }
                      } catch { handleDownload(blob); }
                    }}
                    className="premium-btn-ghost text-[13px]"
                    disabled={loading || downloading}
                  >
                    <Share2 className="w-4 h-4" /> Share
                  </button>
                )}
              </>
            )}
          </BlobProvider>
        </div>
      </div>

      <div className="flex-1">
        <BlobProvider document={document}>
          {({ url, loading }) => {
            if (loading) {
              return (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Generating PDF preview…</p>
                </div>
              );
            }
            if (!url) {
              return (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
                  <p className="text-sm text-muted-foreground">Could not generate preview. Use the Download button above.</p>
                </div>
              );
            }
            if (isMobile) {
              return (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
                  <p className="text-sm text-muted-foreground">PDF preview is not available on mobile. Use the Download button above to get the PDF.</p>
                </div>
              );
            }
            return (
              <iframe
                src={`${url}#toolbar=0&navpanes=0`}
                title="Invoice PDF Preview"
                className="w-full border-none"
                style={{ minHeight: "calc(100vh - 60px)" }}
              />
            );
          }}
        </BlobProvider>
      </div>
    </div>
  );
}
