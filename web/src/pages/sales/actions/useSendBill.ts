import { useCallback } from "react";
import { problemOf } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useRecordSent, useShopSettings } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { billMessage, mobileOf, sentToast } from "@/core/sales/share";
import type { BillRow, CustomerRef } from "@/core/sales/types";
import { sendFailure } from "@/core/sales/words";
import { useToast } from "@/core/ui";
import { useView } from "@/core/view";
import { deliver } from "./deliver";

/** What sending needs to know about a bill: a list row and the bill page's bill both are one. */
export type SendableBill = Pick<BillRow, "id" | "invoice_number" | "invoice_date" | "total_amount" | "status" | "sent" | "business_name"> & {
  customer: Pick<CustomerRef, "id" | "name" | "type" | "mobile_number">;
};
/** to: a number typed for this bill; onNeedNumber: there's no number to send to (ask for one); quiet: no toast. */
export type SendOptions = { to?: string; onNeedNumber?: (b: SendableBill) => void; quiet?: boolean };

/**
 * Send a bill on WhatsApp and record it (PROTO sales/parts.jsx:185-205). Someone who can't send is told why; a customer
 * with no mobile on record (a walk-in) needs a number first, and nothing is marked sent without one; offline, nothing
 * opens. The chat opens within the press itself, then the send is recorded. Resolves true once it's recorded.
 */
export function useSendBill(): (b: SendableBill, opts?: SendOptions) => Promise<boolean> {
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const { isPhone } = useView();
  const net = useNetwork();
  const template = useShopSettings().data?.share_message;
  const { mutateAsync: record } = useRecordSent();
  return useCallback((b, opts = {}) => {
    if (!can("bill.send")) { show({ tone: "neg", title: "You can't send bills", body: whyNot("bill.send") }); return Promise.resolve(false); }
    const own = mobileOf(b.customer.mobile_number);
    // a number typed now, else (no number on record) the one this bill went to before
    const to = mobileOf(opts.to) || (own ? "" : mobileOf(b.sent?.to));
    const mobile = to || own;
    if (!mobile) { opts.onNeedNumber?.(b); return Promise.resolve(false); }
    if (net === "offline") { show(sendFailure({ kind: "offline", message: "You're offline" })); return Promise.resolve(false); }
    // the bill's exact total, as its PDF prints it: nothing is rounded to the rupee (Ruling 1B-12)
    const message = billMessage(template, { invoice_number: b.invoice_number, invoice_date: b.invoice_date, total: b.total_amount, firm: b.business_name, customer: b.customer });
    const again = Boolean(b.sent);
    return deliver({ billId: b.id, invoiceNumber: b.invoice_number, mobile, message, isPhone }).then(async (d) => {
      if (!d) return false;
      try {
        await record({ id: b.id, via: d.via, to: to.replace(/\s/g, "") });
        if (!opts.quiet) {
          const who = to ? `+91 ${to}` : b.customer.type === "walkin" ? "the customer" : b.customer.name;
          show(sentToast({ number: b.invoice_number, again, who, mobile: to ? "" : mobile, file: d.file, isPhone }));
        }
        return true;
      } catch (e) {
        show(sendFailure(problemOf(e)));
        return false;
      }
    });
  }, [can, whyNot, show, isPhone, net, template, record]);
}
