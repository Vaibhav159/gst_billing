import jsPDF from "jspdf";
import JSZip from "jszip";
import { type Invoice, formatCurrency } from "./mockData";

/**
 * Generates a single invoice PDF using jsPDF directly (no DOM needed).
 */
export function generateInvoicePDFDirect(inv: Invoice, biz?: any): Blob {
  const pdf = new jsPDF("p", "mm", "a4");
  const w = 210;
  let y = 15;

  // --- Header ---
  pdf.setFontSize(18);
  pdf.setFont("helvetica", "bold");
  pdf.text(biz?.name || inv.businessName || "Business", 14, y);
  y += 7;

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  if (biz?.address) { pdf.text(biz.address, 14, y); y += 4; }
  if (biz?.gst_number) { pdf.text(`GSTIN: ${biz.gst_number}`, 14, y); y += 4; }
  if (biz?.mobile_number) { pdf.text(`Mobile: ${biz.mobile_number}`, 14, y); y += 4; }

  // Tax Invoice label
  pdf.setFontSize(12);
  pdf.setFont("helvetica", "bold");
  pdf.text("TAX INVOICE", w - 14, 15, { align: "right" });

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.text(`Invoice: ${inv.invoiceNumber}`, w - 14, 22, { align: "right" });
  pdf.text(`Date: ${inv.invoice_date || ""}`, w - 14, 27, { align: "right" });
  pdf.text(`Type: ${inv.type}`, w - 14, 32, { align: "right" });

  // Divider
  y = Math.max(y, 37) + 2;
  pdf.setDrawColor(50);
  pdf.setLineWidth(0.5);
  pdf.line(14, y, w - 14, y);
  y += 6;

  // --- Bill To ---
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "bold");
  pdf.text("BILL TO", 14, y);
  y += 5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(inv.customerName || "", 14, y);
  y += 8;

  // --- Items Table ---
  const colX = [14, 24, 100, 120, 135, 150, 170, w - 14];
  const headers = ["#", "Description", "HSN", "GST%", "Qty", "Rate", "Amount"];

  // Table header
  pdf.setFillColor(40, 40, 40);
  pdf.rect(14, y - 4, w - 28, 7, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "bold");
  headers.forEach((h, i) => {
    const x = i === headers.length - 1 ? colX[i] : colX[i];
    const align = i >= 4 ? "right" : "left";
    pdf.text(h, i >= 4 ? colX[i + 1] - 2 : x, y, { align });
  });
  y += 6;
  pdf.setTextColor(0, 0, 0);

  // Table rows
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  (inv.items || []).forEach((item, i) => {
    if (y > 270) { pdf.addPage(); y = 15; }
    pdf.text(`${i + 1}`, colX[0], y);
    const name = item.productName.length > 30 ? item.productName.slice(0, 30) + "…" : item.productName;
    pdf.text(name, colX[1], y);
    pdf.text(item.hsn || "", colX[2], y);
    pdf.text(`${item.gstRate}%`, colX[3], y);
    pdf.text(`${item.qty}`, colX[5] - 2, y, { align: "right" });
    pdf.text(formatCurrency(item.rate), colX[6] - 2, y, { align: "right" });
    pdf.text(formatCurrency(item.amount), colX[7] - 2, y, { align: "right" });
    y += 5;
  });

  // Divider
  y += 2;
  pdf.line(14, y, w - 14, y);
  y += 6;

  // --- Totals ---
  pdf.setFontSize(9);
  const totals = [
    ["Subtotal", formatCurrency(inv.subtotal)],
    ...(inv.isIGST
      ? [["IGST", formatCurrency(inv.totalIGST)]]
      : [["CGST", formatCurrency(inv.totalCGST)], ["SGST", formatCurrency(inv.totalSGST)]]),
    ["Total Tax", formatCurrency(inv.totalTax)],
  ];

  totals.forEach(([label, value]) => {
    pdf.setFont("helvetica", "normal");
    pdf.text(label, w - 70, y);
    pdf.text(value, w - 14, y, { align: "right" });
    y += 5;
  });

  // Grand Total
  y += 2;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Grand Total", w - 70, y);
  pdf.text(formatCurrency(inv.total), w - 14, y, { align: "right" });
  y += 10;

  // --- Footer ---
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(120, 120, 120);
  pdf.text("This is a computer-generated invoice.", 14, 282);

  return pdf.output("blob");
}

/**
 * Generates a ZIP file containing PDFs for multiple invoices.
 */
export async function generateBulkPDFZip(
  invoices: Invoice[],
  businesses: any[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    const biz = businesses.find((b) => String(b.id) === String(inv.businessId));
    const pdfBlob = generateInvoicePDFDirect(inv, biz);
    const filename = `${inv.invoiceNumber.replace(/\//g, "-")}.pdf`;
    zip.file(filename, pdfBlob);
    onProgress?.(i + 1, invoices.length);
  }

  return zip.generateAsync({ type: "blob" });
}
