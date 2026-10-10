import { useCallback } from "react";
import { problemOf } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useRecordSent, useShopSettings } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { billMessage, mobileOf, sentToast } from "@/core/sales/share";
import type { BillRow, CustomerRef } from "@/core/sales/types";
import { notMarkedSent, SEND_WAITING, sendFailure, STANDARD_MESSAGE } from "@/core/sales/words";
import { useToast } from "@/core/ui";
import { useView } from "@/core/view";
import { deliver } from "./deliver";

/** What sending needs to know about a bill: a list row and the bill page's bill both are one. */
export type SendableBill = Pick<BillRow, "id" | "invoice_number" | "invoice_date" | "total_amount" | "status" | "sent" | "business_name"> & {
  customer: Pick<CustomerRef, "id" | "name" | "type" | "mobile_number">;
};
/**
 * to: a number typed for this bill; onNeedNumber: there's no number to send to (ask for one); quiet: no toast once it's
 * recorded; onOpened: WhatsApp has the bill (from then on a record that failed is marked again from its toast, never by
 * sending again); onRecorded: the send is recorded, at once or later by the toast's Mark as sent.
 */
export type SendOptions = { to?: string; onNeedNumber?: (b: SendableBill) => void; quiet?: boolean; onOpened?: () => void; onRecorded?: () => void };

/**
 * The shop's WhatsApp message: ready once the settings have answered, or failed (then the standard message goes, and the
 * toast says so). Both outlast a second ask: settings with no answer go back to pending while they're asked again (a new
 * row's Send asks), and Send mustn't switch off meanwhile.
 */
function useShopMessage(): { ready: boolean; template: string | undefined; standard: boolean } {
  const s = useShopSettings();
  return { ready: s.isFetched, template: s.data?.share_message, standard: !s.data && s.errorUpdateCount > 0 };
}
/** False while the shop's settings load: Send stays off till then, so it never goes with the standard message instead of the shop's own. */
export function useSendReady(): boolean {
  return useShopMessage().ready;
}

/**
 * Send a bill on WhatsApp and record it (PROTO sales/parts.jsx:185-205). Someone who can't send is told why; a customer
 * with no mobile on record (a walk-in) needs a number first, and nothing is marked sent without one; offline, or before
 * the shop's message has loaded, nothing opens. The chat opens within the press itself, then the send is recorded. A
 * record that fails after the chat opened says so, with Mark as sent, which records it again and never reopens WhatsApp
 * (Ruling 1B-14). Resolves true once it's recorded at the first try.
 */
export function useSendBill(): (b: SendableBill, opts?: SendOptions) => Promise<boolean> {
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const { isPhone } = useView();
  const net = useNetwork();
  const { ready, template, standard } = useShopMessage();
  const { mutateAsync: record } = useRecordSent();
  return useCallback((b, opts = {}) => {
    if (!can("bill.send")) { show({ tone: "neg", title: "You can't send bills", body: whyNot("bill.send") }); return Promise.resolve(false); }
    const own = mobileOf(b.customer.mobile_number);
    // a number typed now, else (no number on record) the one this bill went to before
    const to = mobileOf(opts.to) || (own ? "" : mobileOf(b.sent?.to));
    const mobile = to || own;
    if (!mobile) { opts.onNeedNumber?.(b); return Promise.resolve(false); }
    if (net === "offline") { show(sendFailure({ kind: "offline", message: "You're offline" })); return Promise.resolve(false); }
    if (!ready) { show(SEND_WAITING); return Promise.resolve(false); }
    // the bill's exact total, as its PDF prints it: nothing is rounded to the rupee (Ruling 1B-12)
    const message = billMessage(template, { invoice_number: b.invoice_number, invoice_date: b.invoice_date, total: b.total_amount, firm: b.business_name, customer: b.customer });
    const again = Boolean(b.sent);
    return deliver({ billId: b.id, invoiceNumber: b.invoice_number, mobile, message, isPhone }).then((d) => {
      if (!d) return false;
      opts.onOpened?.();
      const mark = async (retry: boolean): Promise<boolean> => {
        try {
          await record({ id: b.id, via: d.via, to: to.replace(/\s/g, "") });
        } catch (e) {
          const f = notMarkedSent(problemOf(e), b.invoice_number);
          // one press records it once: a quick second press posts nothing (a failure again brings a new toast)
          let pressed = false;
          show({ tone: f.tone, title: f.title, body: f.body, action: f.again ? { label: "Mark as sent", onClick: () => { if (pressed) return; pressed = true; void mark(true); } } : undefined });
          return false;
        }
        opts.onRecorded?.();
        if (retry) show({ title: `${b.invoice_number} marked as sent` });
        else if (!opts.quiet) {
          const who = to ? `+91 ${to}` : b.customer.type === "walkin" ? "the customer" : b.customer.name;
          const t = sentToast({ number: b.invoice_number, again, who, mobile: to ? "" : mobile, file: d.file, isPhone });
          show(standard ? { ...t, body: `${t.body} ${STANDARD_MESSAGE}` } : t);
        }
        return true;
      };
      return mark(false);
    });
  }, [can, whyNot, show, isPhone, net, ready, template, standard, record]);
}
