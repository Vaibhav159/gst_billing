import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { type Invoice, formatCurrency } from "./mockData";

/**
 * Generates a PDF blob from the invoice print element on the page.
 */
export async function generateInvoicePDF(
  element: HTMLElement,
  invoice: Invoice
): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgData = canvas.toDataURL("image/png");
  const imgWidth = 210; // A4 width in mm
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const pdf = new jsPDF("p", "mm", "a4");
  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= 297; // A4 height

  // Add extra pages if content overflows
  while (heightLeft > 0) {
    position -= 297;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= 297;
  }

  return pdf.output("blob");
}

/**
 * Downloads the PDF directly.
 */
export async function downloadInvoicePDF(
  element: HTMLElement,
  invoice: Invoice
) {
  const blob = await generateInvoicePDF(element, invoice);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Shares the invoice PDF via Web Share API (mobile native share sheet).
 * Falls back to download if Web Share with files isn't supported.
 */
export async function sharePDFViaWebShare(
  element: HTMLElement,
  invoice: Invoice
): Promise<boolean> {
  const blob = await generateInvoicePDF(element, invoice);
  const file = new File(
    [blob],
    `${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`,
    { type: "application/pdf" }
  );

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: `Invoice ${invoice.invoiceNumber}`,
        text: `Invoice ${invoice.invoiceNumber} — ${formatCurrency(invoice.total)}`,
        files: [file],
      });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  }

  // Fallback: download the PDF
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Shares PDF via WhatsApp with customer phone pre-filled.
 * Since WhatsApp doesn't support file attachments via URL scheme,
 * this downloads the PDF first, then opens WhatsApp with a message.
 */
export async function sharePDFViaWhatsApp(
  element: HTMLElement,
  invoice: Invoice,
  phone?: string
) {
  // Download the PDF for the user
  await downloadInvoicePDF(element, invoice);

  // Open WhatsApp with the invoice message
  const text = `Invoice ${invoice.invoiceNumber}\nAmount: ${formatCurrency(invoice.total)}\nPlease find the PDF attached.`;
  const base = phone ? `https://wa.me/${phone}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank");
}
