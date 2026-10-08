import QRCode from "qrcode";
import { createElement, type ReactElement } from "react";
import { pdf, type DocumentProps } from "@react-pdf/renderer";
import TallyInvoicePDF from "@/components/TallyInvoicePDF";
import { withSignatureForPdf } from "@/utils/printDocument";
import { invoicePdfName, zipPdfs } from "@/utils/pdfFileName";
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
 *
 * Each PDF is named for its firm, year and number, uniquely within the ZIP
 * (UX2), and the result says how many it holds and which it couldn't make.
 */
export async function generateBulkPDFZip(
  invoices: Invoice[],
  businesses: any[],
  customers: any[],
  onProgress?: (current: number, total: number) => void,
): Promise<{ blob: Blob; written: number; failed: string[] }> {
  const files: { name: string; blob: Blob }[] = [];
  const failed: string[] = [];

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    try {
      const firm = businesses.find((b) => String(b.id) === String(inv.businessId));
      const biz = withSignatureForPdf(firm);
      const customer = customers.find((c) => String(c.id) === String(inv.customerId)) || {};
      const qrDataUrl = await QRCode.toDataURL(
        `${inv.invoiceNumber}|${biz?.gst_number || ""}|${inv.invoice_date}|${inv.total}`,
        { width: 150, margin: 1 },
      ).catch(() => undefined);
      // TallyInvoicePDF renders a <Document>; pdf() is typed on the Document's
      // props, so the component element needs the same cast BlobProvider makes.
      const element = createElement(TallyInvoicePDF, { invoice: inv, business: biz, customer, qrDataUrl }) as unknown as ReactElement<DocumentProps>;
      const blob = await pdf(element).toBlob();
      files.push({ name: invoicePdfName(inv, firm), blob });
    } catch (e) {
      console.error(`Failed to generate PDF for invoice ${inv.invoiceNumber}`, e);
      failed.push(inv.invoiceNumber || `${i + 1}`);
    }
    onProgress?.(i + 1, invoices.length);
  }

  const { zip, written } = await zipPdfs(files);
  return { blob: zip, written, failed };
}
