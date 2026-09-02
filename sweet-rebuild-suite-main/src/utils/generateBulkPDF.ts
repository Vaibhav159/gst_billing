import JSZip from "jszip";
import QRCode from "qrcode";
import { createElement, type ReactElement } from "react";
import { pdf, type DocumentProps } from "@react-pdf/renderer";
import TallyInvoicePDF from "@/components/TallyInvoicePDF";
import { withSignatureForPdf } from "@/utils/printDocument";
import type { Invoice } from "./mockData";

/**
 * A ZIP of one PDF per invoice, rendered through the same Tally template the
 * print page and the bulk-PDF page use.
 *
 * This replaced a hand-rolled jsPDF layout that printed only the customer's
 * name under BILL TO (no GSTIN, address or state), had no HSN summary, amount
 * in words or signatory, and drew every rupee sign through Helvetica, which
 * cannot encode it — so all money cells rendered as mojibake. It shipped
 * live from the customer page's "Download All".
 */
export async function generateBulkPDFZip(
  invoices: Invoice[],
  businesses: any[],
  customers: any[],
  onProgress?: (current: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    try {
      const biz = withSignatureForPdf(businesses.find((b) => String(b.id) === String(inv.businessId)));
      const customer = customers.find((c) => String(c.id) === String(inv.customerId)) || {};
      const qrDataUrl = await QRCode.toDataURL(
        `${inv.invoiceNumber}|${biz?.gst_number || ""}|${inv.invoice_date}|${inv.total}`,
        { width: 150, margin: 1 },
      ).catch(() => undefined);
      // TallyInvoicePDF renders a <Document>; pdf() is typed on the Document's
      // props, so the component element needs the same cast BlobProvider makes.
      const element = createElement(TallyInvoicePDF, { invoice: inv, business: biz, customer, qrDataUrl }) as unknown as ReactElement<DocumentProps>;
      const blob = await pdf(element).toBlob();
      zip.file(`${(inv.invoiceNumber || `invoice-${i}`).replace(/\//g, "-")}.pdf`, blob);
    } catch (e) {
      console.error(`Failed to generate PDF for invoice ${inv.invoiceNumber}`, e);
    }
    onProgress?.(i + 1, invoices.length);
  }

  return zip.generateAsync({ type: "blob" });
}
