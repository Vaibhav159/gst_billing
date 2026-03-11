import { useParams } from "react-router-dom";
import { formatCurrency, amountToWords, formatDate } from "@/lib/mockData";
import { useInvoices, useBusinesses, useCustomers } from "@/hooks/useDataStore";
import { Printer, Download, Share2, ArrowLeft, MessageCircle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { downloadInvoicePDF, sharePDFViaWebShare, sharePDFViaWhatsApp } from "@/lib/generatePDF";
import { useToast } from "@/hooks/use-toast";

export default function InvoicePrint() {
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();
  const printRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const { items: invoices } = useInvoices();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();

  const inv = invoices.find((i) => i.id === id);
  if (!inv) return <div className="p-8 text-muted-foreground">Invoice not found.</div>;
  const biz = businesses.find((b) => b.id === inv.businessId);
  const customer = customers.find((c) => c.id === inv.customerId);

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setGenerating(true);
    try {
      await downloadInvoicePDF(printRef.current, inv);
      toast({ title: "PDF Downloaded", description: inv.invoiceNumber });
    } catch { toast({ title: "PDF Error", variant: "destructive" }); }
    setGenerating(false);
  };

  const handleSharePDF = async () => {
    if (!printRef.current) return;
    setGenerating(true);
    try {
      await sharePDFViaWebShare(printRef.current, inv);
    } catch { toast({ title: "Share failed", variant: "destructive" }); }
    setGenerating(false);
  };

  const handleWhatsAppPDF = async () => {
    if (!printRef.current) return;
    setGenerating(true);
    try {
      await sharePDFViaWhatsApp(printRef.current, inv, customer?.mobile_number);
      toast({ title: "PDF ready", description: "Attach the downloaded PDF in WhatsApp" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setGenerating(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className={cn("no-print flex items-center gap-2 border-b border-border bg-card sticky top-0 z-10", isMobile ? "px-4 py-3" : "px-8 py-4 gap-3")}>
        <Link to={`/billing/invoice/${id}`} className="text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back</Link>
        {!isMobile && <span className="text-[14px] font-display font-semibold text-foreground ml-2">{inv.invoiceNumber}</span>}
        <div className={cn("flex items-center gap-2 ml-auto", isMobile ? "gap-1.5" : "gap-2.5")}>
          {generating && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          <button onClick={() => window.print()} className={cn("premium-btn-primary", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")} disabled={generating}>
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={handleDownloadPDF} className={cn("premium-btn-ghost", isMobile ? "text-[11px] h-8 px-3" : "text-[13px]")} disabled={generating}>
            <Download className="w-4 h-4" /> PDF
          </button>
          {isMobile ? (
            <>
              <button onClick={handleWhatsAppPDF} className={cn("premium-btn-outline border-success/30 text-success", "text-[11px] h-8 px-3")} disabled={generating}>
                <MessageCircle className="w-4 h-4" />
              </button>
              <button onClick={handleSharePDF} className={cn("premium-btn-outline border-border text-muted-foreground", "text-[11px] h-8 px-2.5")} disabled={generating}>
                <Share2 className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button onClick={handleWhatsAppPDF} className="premium-btn-outline text-[13px] border-success/30 text-success" disabled={generating}>
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </button>
              <button onClick={handleSharePDF} className="premium-btn-ghost text-[13px]" disabled={generating}>
                <Share2 className="w-4 h-4" /> Share
              </button>
            </>
          )}
        </div>
      </div>
      <div className={cn("mx-auto", isMobile ? "p-4" : "max-w-4xl p-8")}>
        <div ref={printRef} className="bg-white text-gray-900 rounded-xl border border-gray-200 shadow-lg" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>
          {/* Header with logo */}
          <div className={cn("border-b-2 border-gray-800 p-6", isMobile ? "space-y-3" : "flex items-start justify-between")}>
            <div className="flex items-start gap-4">
              <img src="/logo.png" alt="Logo" className="w-14 h-14 rounded-lg object-contain" />
              <div>
                <h1 className={cn("font-bold text-gray-900", isMobile ? "text-lg" : "text-2xl")} style={{ fontFamily: "'Georgia', serif" }}>{biz?.name}</h1>
                <p className="text-xs text-gray-600 mt-1" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>{biz?.address}</p>
                <p className="text-xs text-gray-600" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>Mobile: {biz?.mobile_number}</p>
                <p className="text-xs font-semibold text-gray-700 mt-1" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>GSTIN: {biz?.gst_number}</p>
              </div>
            </div>
            <div className={cn(isMobile ? "" : "text-right")}>
              <div className={cn("inline-block border-2 border-gray-800 px-4 py-2 rounded", isMobile ? "text-sm" : "")}>
                <p className="font-bold tracking-[0.2em] text-sm" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>TAX INVOICE</p>
              </div>
              <div className="mt-3 text-xs space-y-1" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>
                <p><span className="font-semibold text-gray-500">Invoice No:</span> <span className="font-bold text-gray-900">{inv.invoiceNumber}</span></p>
                <p><span className="font-semibold text-gray-500">Date:</span> <span className="font-medium">{formatDate(inv.date)}</span></p>
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="px-6 pt-4 pb-3">
            <div className="bg-gray-50 rounded-lg p-4" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.15em] mb-1.5">Bill To</p>
              <p className="text-sm font-bold text-gray-900">{inv.customerName}</p>
              {customer && <p className="text-xs text-gray-600 mt-1">GSTIN: {customer.gst_number} · {customer.state_name}</p>}
            </div>
          </div>

          {/* Items Table */}
          <div className="px-6 py-3" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>
            {isMobile ? (
              <div className="divide-y divide-gray-200">
                {inv.items.map((item, i) => (
                  <div key={i} className="py-2.5 space-y-1">
                    <div className="flex justify-between"><span className="text-xs font-medium">{item.productName}</span><span className="text-xs font-mono text-gray-500">HSN: {item.hsn}</span></div>
                    <div className="flex justify-between text-xs text-gray-600"><span>{item.qty} × {formatCurrency(item.rate)}</span><span className="font-semibold text-gray-900">{formatCurrency(item.amount)}</span></div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 text-white">
                    {["#", "Description", "HSN", "GST%", "Qty", "Rate", "Amount"].map((h, i) => (
                      <th key={h} className={`px-3 py-2.5 font-medium text-[11px] uppercase tracking-wider ${i > 3 ? "text-right" : i > 2 ? "text-center" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((item, i) => (
                    <tr key={i} className="border-b border-gray-200">
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium">{item.productName}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-500 text-xs">{item.hsn}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600">{item.gstRate}%</td>
                      <td className="px-3 py-2.5 text-right">{item.qty}</td>
                      <td className="px-3 py-2.5 text-right">{formatCurrency(item.rate)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{formatCurrency(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Totals + Amount in words */}
          <div className={cn("px-6 py-4", isMobile ? "space-y-3" : "grid grid-cols-2 gap-6")} style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Amount in Words</p>
              <p className="text-xs text-gray-700 italic leading-relaxed" style={{ fontFamily: "'Georgia', serif" }}>{amountToWords(inv.total)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="tabular-nums">{formatCurrency(inv.subtotal)}</span></div>
              {inv.isIGST ? (
                <div className="flex justify-between"><span className="text-gray-500">IGST</span><span className="tabular-nums">{formatCurrency(inv.totalIGST)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">CGST</span><span className="tabular-nums">{formatCurrency(inv.totalCGST)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">SGST</span><span className="tabular-nums">{formatCurrency(inv.totalSGST)}</span></div>
                </>
              )}
              <div className="border-t-2 border-gray-800 pt-2 flex justify-between font-bold text-base">
                <span>Grand Total</span>
                <span className="tabular-nums">{formatCurrency(inv.total)}</span>
              </div>
            </div>
          </div>

          {/* Bank Details */}
          {biz && (
            <div className="px-6 py-4 border-t border-gray-200" style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Bank Details</p>
              <div className={cn("text-xs text-gray-700", isMobile ? "space-y-0.5" : "grid grid-cols-2 gap-x-8")}>
                <p><span className="font-medium text-gray-500">Bank:</span> {biz.bank_name}</p>
                <p><span className="font-medium text-gray-500">Account:</span> {biz.bank_account_number}</p>
                <p><span className="font-medium text-gray-500">IFSC:</span> {biz.bank_ifsc_code}</p>
                <p><span className="font-medium text-gray-500">Branch:</span> {biz.bank_branch_name}</p>
              </div>
            </div>
          )}

          {/* Authorized Signatory */}
          <div className={cn("px-6 py-5 border-t border-gray-200", isMobile ? "" : "flex items-end justify-between")} style={{ fontFamily: "'Helvetica Neue', sans-serif" }}>
            <div className="text-[10px] text-gray-400">
              <p>This is a computer-generated invoice.</p>
              <p className="mt-0.5">Subject to terms and conditions.</p>
            </div>
            <div className={cn("text-right", isMobile ? "mt-6" : "")}>
              <div className="w-40 border-b border-gray-400 mb-2 ml-auto" />
              <p className="text-xs font-bold text-gray-900">For {biz?.name}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Authorized Signatory</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
