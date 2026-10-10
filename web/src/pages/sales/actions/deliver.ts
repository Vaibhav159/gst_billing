import { useCallback } from "react";
import { useNavigate } from "react-router";
import { waLink } from "@/core/sales/share";
import { useToast } from "@/core/ui";

export type DeliverInput = { billId: number; invoiceNumber: string; mobile: string; message: string; isPhone: boolean };
/** How the bill went (the send's `via`) and the PDF's name when one was made; null when the person stopped (a share sheet closed). */
export type Delivered = { via: "whatsapp" | "share"; file: string | null } | null;

/**
 * Hands a bill to WhatsApp: the chat with the mobile (or WhatsApp's own picker), the shop's message typed in.
 * Plan 1E replaces this body to make the PDF and attach it (the phone's share sheet, or a download beside the chat on
 * a computer), keeping this signature. It runs within the press itself: a browser blocks a window opened after an
 * await, so nothing here may await before window.open.
 */
export async function deliver(input: DeliverInput): Promise<Delivered> {
  window.open(waLink(input.mobile, input.message), "_blank", "noopener");
  return { via: "whatsapp", file: null };
}

/** "Share the PDF…": the print page makes and shares it (plan 1E replaces this with the share sheet or a download, keeping the signature). */
export function useShareBill(): (b: { id: number; invoice_number: string }) => void {
  const navigate = useNavigate();
  return useCallback((b) => navigate(`/sales/${b.id}/print`), [navigate]);
}

/** "Copy link": the bill's address, for anyone signed in (PROTO sales/parts.jsx:376); where copying is refused, the link is shown instead. */
export function useCopyBillLink(): (b: { id: number; invoice_number: string }) => void {
  const { show } = useToast();
  return useCallback((b) => {
    const url = `${window.location.origin}/sales/${b.id}`;
    const shown = () => show({ tone: "brand", title: `${b.invoice_number}'s link`, body: url });
    if (!navigator.clipboard?.writeText) { shown(); return; }
    navigator.clipboard.writeText(url).then(
      () => show({ tone: "brand", title: "Link copied", body: `${b.invoice_number}'s link is copied. Anyone signed in can open the bill from it.` }),
      shown,
    );
  }, [show]);
}
