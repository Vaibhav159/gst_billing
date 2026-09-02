import { amountToWords, formatDate, type Business, type Invoice } from "@/utils/mockData";
import type { Customer } from "@/hooks/useDataStore";

/**
 * Compact HTML facsimile of the Tally invoice, for surfaces where the PDF
 * can't render — mobile browsers ignore PDF iframes, which used to leave the
 * print page as a "download to see it" dead end.
 *
 * Deliberately paper-styled (white, black ink, hairline table borders) and
 * theme-independent: it previews a DOCUMENT, not app UI. The PDF stays the
 * printable original; this shows the same figures so they can be checked
 * before sharing.
 */
export default function InvoiceHTMLPreview({ invoice, business, customer }: {
  invoice: Invoice & Record<string, any>;
  business: Business;
  customer: Customer;
}) {
  const items = invoice.items || [];
  const totalTax = items.reduce((s: number, it: any) => s + (it.cgst || 0) + (it.sgst || 0) + (it.igst || 0), 0);
  const hasIgst = items.some((it: any) => (it.igst || 0) > 0);
  const taxable = items.reduce((s: number, it: any) => s + it.qty * it.rate, 0);

  return (
    <div className="mx-auto max-w-xl bg-white text-black rounded-lg shadow-md overflow-hidden text-[12px] leading-snug" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* Header */}
      <div className="border-b-2 border-black p-3 text-center">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500">Tax Invoice</p>
        <p className="text-[15px] font-bold mt-0.5">{business.name}</p>
        {business.address && <p className="text-[10px] text-neutral-600">{business.address}</p>}
        {business.gst_number && <p className="text-[10px] font-semibold mt-0.5">GSTIN/UIN: {business.gst_number}</p>}
      </div>

      {/* Meta + buyer */}
      <div className="grid grid-cols-2 border-b border-black">
        <div className="p-2.5 border-r border-black">
          <p className="text-[9px] uppercase text-neutral-500">Buyer (Bill to)</p>
          <p className="font-bold">{customer.name}</p>
          {customer.address && <p className="text-[10px] text-neutral-600">{customer.address}</p>}
          <p className="text-[10px] mt-0.5">GSTIN/UIN: {customer.gst_number || "—"}</p>
        </div>
        <div className="p-2.5 grid grid-cols-1 gap-1 content-start">
          <div>
            <p className="text-[9px] uppercase text-neutral-500">Invoice No.</p>
            <p className="font-bold">{invoice.invoiceNumber}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase text-neutral-500">Dated</p>
            <p className="font-bold">{formatDate(invoice.invoice_date)}</p>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-neutral-100 text-[10px] uppercase">
              <th className="border-b border-black px-1.5 py-1 text-left w-6">Sl</th>
              <th className="border-b border-black px-1.5 py-1 text-left">Description</th>
              <th className="border-b border-black px-1.5 py-1 text-left">HSN</th>
              <th className="border-b border-black px-1.5 py-1 text-right">Qty</th>
              <th className="border-b border-black px-1.5 py-1 text-right">Rate</th>
              <th className="border-b border-black px-1.5 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={i} className="align-top">
                <td className="border-b border-neutral-300 px-1.5 py-1 text-neutral-500">{i + 1}</td>
                <td className="border-b border-neutral-300 px-1.5 py-1 font-semibold">{it.productName || it.name || "Item"}</td>
                <td className="border-b border-neutral-300 px-1.5 py-1 font-mono text-[10px]">{it.hsn || "—"}</td>
                <td className="border-b border-neutral-300 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{it.qty} {it.unit || ""}</td>
                <td className="border-b border-neutral-300 px-1.5 py-1 text-right tabular-nums">{Number(it.rate).toLocaleString("en-IN")}</td>
                <td className="border-b border-neutral-300 px-1.5 py-1 text-right tabular-nums font-semibold">{Number(it.qty * it.rate).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tax + total */}
      <div className="border-t border-black px-2.5 py-1.5 space-y-0.5">
        <div className="flex justify-between text-[11px]"><span className="text-neutral-600">Taxable Value</span><span className="tabular-nums">₹{taxable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
        {hasIgst ? (
          <div className="flex justify-between text-[11px]"><span className="text-neutral-600">IGST</span><span className="tabular-nums">₹{items.reduce((s: number, it: any) => s + (it.igst || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
        ) : (
          <>
            <div className="flex justify-between text-[11px]"><span className="text-neutral-600">CGST</span><span className="tabular-nums">₹{items.reduce((s: number, it: any) => s + (it.cgst || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
            <div className="flex justify-between text-[11px]"><span className="text-neutral-600">SGST</span><span className="tabular-nums">₹{items.reduce((s: number, it: any) => s + (it.sgst || 0), 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
          </>
        )}
        <div className="flex justify-between font-bold text-[13px] border-t border-black pt-1 mt-1">
          <span>Total</span>
          <span className="tabular-nums">₹{Number(invoice.total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
        </div>
        <p className="text-[10px] text-neutral-600 pt-0.5">
          Amount Chargeable (in words): <span className="font-semibold text-black">INR {amountToWords(Number(invoice.total) || 0)}</span>
        </p>
        <p className="text-[10px] text-neutral-500">Tax Amount: ₹{totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
      </div>

      <p className="text-center text-[9px] text-neutral-400 border-t border-neutral-200 py-1.5">
        Preview — the PDF is the printable original
      </p>
    </div>
  );
}
