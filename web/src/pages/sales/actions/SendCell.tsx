import { useState } from "react";
import { Check, FileText, Printer, Send } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { mobileText, todayIST } from "@/core/format";
import { mobileOf } from "@/core/sales/share";
import type { BillDetail, BillRow } from "@/core/sales/types";
import { sentWhen } from "@/core/sales/words";
import { Button, ButtonLink, Menu } from "@/core/ui";
import { useView } from "@/core/view";
import { useSendBill, useSendReady } from "./useSendBill";
import { WhatsAppDialog } from "./WhatsAppDialog";

/**
 * Send or Sent in lists (PROTO sales/parts.jsx:257-311). "Sent" is a status that opens a small menu (Sent at 12:09 ·
 * Send again), so a tap never sends a bill twice by accident. A paper bill is "On paper": the customer has it, so
 * nothing nags for a send. No mobile on record: Print, never a send from a list. Someone who can't send sees the state
 * as words. Send stays off until the shop's settings answer, so the shop's own message goes with it.
 */
export function SendCell({ bill, compact = false, tabIndex }: { bill: BillRow | BillDetail; compact?: boolean; tabIndex?: number }) {
  const { can } = useAuth();
  const { isPhone } = useView();
  const send = useSendBill();
  const ready = useSendReady();
  const [ask, setAsk] = useState(false);
  if (bill.status === "cancelled") return null;
  if (bill.paper && !bill.sent) {
    return <span className={cn("inline-flex items-center gap-1 text-muted shrink-0", isPhone ? "min-h-11 px-2" : "text-sm px-2")} title="Entered from the paper bill book: the customer has the paper bill"><FileText size={15} aria-hidden="true" />On paper</span>;
  }
  const when = bill.sent ? sentWhen(bill.sent, todayIST()) : "";
  if (!can("bill.send")) {
    return bill.sent
      ? <span className={cn("inline-flex items-center gap-1 text-sale font-semibold shrink-0", isPhone ? "min-h-11 px-2" : "text-sm px-2")} title={`Sent ${when}`}><Check size={15} aria-hidden="true" />Sent<span className="sr-only"> {when}</span></span>
      : <span className={cn("text-muted shrink-0", isPhone ? "px-2" : "text-sm px-2")}>Not sent</span>;
  }
  const c = bill.customer;
  const dialog = <WhatsAppDialog bill={ask ? bill : null} onClose={() => setAsk(false)} />;
  if (bill.sent) {
    const to = bill.sent.to ? `+91 ${mobileText(bill.sent.to)}` : c.type === "walkin" ? "the customer" : c.name;
    return (
      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Menu title={`${bill.invoice_number} was sent`} width={260} items={[
          { label: "Send again on WhatsApp", hint: `Sent ${when} to ${to}${bill.sent.count > 1 ? ` · ${bill.sent.count} times` : ""}`, icon: Send, disabled: !ready, onSelect: () => void send(bill, { onNeedNumber: () => setAsk(true) }) },
        ]} trigger={(p) => (
          <button type="button" {...p} tabIndex={tabIndex} data-row-send="" aria-label={`Sent ${when}. Options for ${bill.invoice_number}`}
            className={cn("inline-flex items-center justify-center gap-1 rounded-ctl text-sale font-semibold hover:bg-sale-tint transition-colors active:scale-[0.97]", isPhone ? "min-h-11 min-w-[72px] px-2" : "h-8 px-2 text-sm")}>
            <Check size={15} aria-hidden="true" />Sent
          </button>
        )} />
        {dialog}
      </span>
    );
  }
  // no mobile to send to (a walk-in, or a landline): a list offers Print, where useSendBill would ask for a number
  if (!mobileOf(c.mobile_number)) {
    return (
      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <ButtonLink size="sm" variant="secondary" icon={compact ? undefined : Printer} to={`/sales/${bill.id}/print`} tabIndex={tabIndex} data-row-send=""
          title="No mobile number: print it, or open the bill to send it to a number" aria-label={`Print ${bill.invoice_number} (no mobile number to send it to)`}>Print</ButtonLink>
      </span>
    );
  }
  return (
    <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="secondary" icon={compact ? undefined : Send} tabIndex={tabIndex} data-row-send="" onClick={() => void send(bill, { onNeedNumber: () => setAsk(true) })}
        disabled={!ready} title={ready ? undefined : "Getting the shop's WhatsApp message"} aria-label={`Send ${bill.invoice_number} on WhatsApp`}>Send</Button>
      {dialog}
    </span>
  );
}
