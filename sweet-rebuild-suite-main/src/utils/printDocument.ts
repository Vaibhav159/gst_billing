/**
 * What a printed document calls itself and its parties, and how a business is
 * handed to the PDF renderer. Shared by the classic, Tally and bulk paths so
 * they cannot drift apart (audit B5, B9).
 */

type Typed = { type?: string };

export function isInwardDocument(inv: Typed): boolean {
  return String(inv.type || "").toUpperCase() === "INWARD";
}

/**
 * A purchase bill is the supplier's invoice recorded in our books; printing it
 * under our own "TAX INVOICE" banner named us as the issuer and the supplier as
 * the buyer.
 */
export function documentTitle(inv: Typed): string {
  return isInwardDocument(inv) ? "PURCHASE RECORD" : "TAX INVOICE";
}

export function partyLabels(inv: Typed): { billTo: string; shipTo: string } {
  return isInwardDocument(inv)
    ? { billTo: "Supplier (Bill from)", shipTo: "Recipient (Ship to)" }
    : { billTo: "Buyer (Bill to)", shipTo: "Consignee (Ship to)" };
}

export function declarationText(inv: Typed, custom?: string | null): string {
  if (custom) return custom;
  return isInwardDocument(inv)
    ? "Record of a purchase from the supplier named above, entered from their invoice. This document is not a tax invoice issued by us."
    : "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";
}

/**
 * The renderer can only embed a signature it does not have to fetch: nginx
 * serves /media/ through signed URLs only, so a raw URL fails inside
 * react-pdf and the whole batch wedges at "Preparing n/N". The API ships the
 * image as base64 for exactly this reason; single print used it, batch and
 * bulk passed the raw URL.
 */
export function withSignatureForPdf<T extends { signature_image?: string | null; signature_image_base64?: string | null }>(biz: T | undefined | null): T {
  const b = (biz || {}) as T;
  const data = b.signature_image_base64 || null;
  return { ...b, signature_image: data && data.startsWith("data:") ? data : null };
}
