import { type Invoice, formatCurrency } from "./mockData";

export async function shareInvoice(invoice: Invoice) {
  const text = `Invoice ${invoice.invoiceNumber}\nCustomer: ${invoice.customerName}\nAmount: ${formatCurrency(invoice.total)}\nDate: ${invoice.date}`;
  const url = `${window.location.origin}/billing/invoice/${invoice.id}/print`;

  if (navigator.share) {
    try {
      await navigator.share({ title: `Invoice ${invoice.invoiceNumber}`, text, url });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  }

  // Fallback: open WhatsApp
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
  window.open(whatsappUrl, "_blank");
  return true;
}

export function shareViaWhatsApp(invoice: Invoice, phone?: string) {
  const text = `Invoice ${invoice.invoiceNumber}\nCustomer: ${invoice.customerName}\nAmount: ${formatCurrency(invoice.total)}\nDate: ${invoice.date}\n${window.location.origin}/billing/invoice/${invoice.id}/print`;
  const base = phone ? `https://wa.me/${phone}` : "https://wa.me/";
  window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank");
}
