import type { MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { monthLabel } from "@/core/format";
import { mobileOf } from "@/core/sales/share";
import type { BillDetail } from "@/core/sales/types";
import { LOCKED_REASON } from "@/core/sales/words";
import { useBillDialogs } from "../actions/BillDialogs";
import { useBillMenu } from "../actions/useBillMenu";
import { useSendBill, useSendReady } from "../actions/useSendBill";

/** What both the desktop and the phone page need about a bill (PROTO sales/BillDetail.jsx:52-70). */
export function useDetail(b: BillDetail) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // deleted from its own page: the page goes back to the list, and the toast's Undo still works there
  const dialogs = useBillDialogs({ onDeleted: () => navigate("/sales", { replace: true }) });
  const billMenu = useBillMenu();
  const sendBill = useSendBill();
  // every Send here waits for the shop's settings, so the shop's own WhatsApp message goes with it (as the list's Send)
  const ready = useSendReady();
  const cancelled = b.status === "cancelled";
  const editBlock = !can("bill.edit") ? whyNot("bill.edit") : cancelled ? "Cancelled bills can't be changed." : b.locked ? LOCKED_REASON : "";
  // a customer without a phone (a walk-in) needs a number for the bill first. useSendBill holds a bill while its send is on
  // its way, whichever button pressed it
  const send = (x: BillDetail) => { void sendBill(x, { onNeedNumber: () => dialogs.open("whatsapp", x) }); };
  return {
    can, whyNot, navigate, dialogs, billMenu, send, cancelled, editBlock, ready,
    /** Send's hint while the shop's message loads. */
    sendWait: ready ? undefined : "Getting the shop's WhatsApp message",
    /**
     * A Send button's press. The second click of a double click (detail 2; a key press is 0) sends nothing: a quick record
     * turns the button into Send again (or Resend) under the pointer, so that click would send the bill a second time.
     */
    sendPress: (e: MouseEvent) => { if (e.detail > 1) return; send(b); },
    month: monthLabel(b.invoice_date.slice(0, 7), { long: true }),
    hasNumber: Boolean(mobileOf(b.customer.mobile_number) || mobileOf(b.sent?.to)),
    saved: params.get("saved"), sentNow: params.get("sent") === "1",
    firmName: b.firm.name || b.business_name,
  };
}
export type Detail = ReturnType<typeof useDetail>;
