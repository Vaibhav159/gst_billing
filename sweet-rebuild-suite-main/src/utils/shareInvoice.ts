import { type Invoice, formatCurrency } from "./mockData";

/** wa.me wants country code + number, digits only. Indian mobiles are 10 digits. */
export function whatsappNumber(phone?: string | null): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  return digits;
}

/**
 * The message a customer receives. Deliberately carries no link: the print
 * route is behind login, so a recipient who tapped the old link hit a login
 * wall. The document travels as an attached PDF (see the print pages).
 */
export function invoiceShareText(invoice: Invoice): string {
  return `Invoice ${invoice.invoiceNumber}\nCustomer: ${invoice.customerName}\nAmount: ${formatCurrency(invoice.total)}\nDate: ${invoice.invoice_date}`;
}

export async function shareInvoice(invoice: Invoice) {
  const text = invoiceShareText(invoice);

  if (navigator.share) {
    try {
      await navigator.share({ title: `Invoice ${invoice.invoiceNumber}`, text });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  }

  // Fallback: open WhatsApp
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  return true;
}

export function shareViaWhatsApp(invoice: Invoice, phone?: string) {
  const to = whatsappNumber(phone);
  const base = to ? `https://wa.me/${to}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(invoiceShareText(invoice))}`, "_blank");
}
