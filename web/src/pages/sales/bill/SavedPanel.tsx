import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, BookOpenText, MessageCircle, Printer, Send } from "lucide-react";
import { usePaperBook } from "@/core/api/sales";
import { cn } from "@/core/cn";
import { date, inr, mobileText, monthLabel } from "@/core/format";
import type { BillDetail } from "@/core/sales/types";
import { Button, ButtonLink, SuccessMark } from "@/core/ui";
import type { Detail } from "./useDetail";

/**
 * Right after a save (?saved=new|edit, &sent=1 when the save sent it; plan 1D), one panel says what happened and owns
 * the next step: Send, or Print when there's no number to send to (PROTO sales/BillDetail.jsx:137-201). It takes focus,
 * so the keyboard goes on from here. A paper bill's next step is the next paper bill: the same firm and date, and the
 * paper book's next number. An unsent paper bill is never asked to be sent: after an edit its step is Print. The total
 * is the bill's exact one (Ruling 1B-12).
 */
export function SavedPanel({ b, d, phone = false }: { b: BillDetail; d: Detail; phone?: boolean }) {
  const acts = useRef<HTMLDivElement>(null);
  const paper = b.paper && d.saved !== "edit";
  const ym = b.invoice_date.slice(0, 7);
  const book = usePaperBook(paper ? b.business : null, paper ? ym : null);
  useEffect(() => {
    const box = acts.current;
    const a = document.activeElement;
    // the next step takes focus (again once the paper book's next number is in, or Send once the shop's message is),
    // unless the person has moved on
    if (!box || (a && a !== document.body && !box.contains(a) && !a.hasAttribute("data-page-title"))) return;
    box.querySelector<HTMLElement>("a[href], button:not([disabled])")?.focus({ preventScroll: true });
  }, [book.data, d.ready]);
  const c = b.customer;
  const shell = cn("card border-sale-line anim-rise flex gap-4", phone ? "flex-col items-stretch p-4" : "items-center px-5 py-4");
  if (paper) {
    const next = book.data && !book.data.locked ? book.data.next : null;
    return (
      <div role="status" className={shell}>
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <SuccessMark size={phone ? 48 : 56} />
          <div className="min-w-0">
            <p className="text-lg font-semibold">Saved {b.invoice_number}</p>
            <p className="text-fg2">From the paper book, dated {date(b.invoice_date)}: {inr(b.total_amount)} · {c.name}. It goes into {monthLabel(ym, { long: true, year: false })}&apos;s GSTR-1.</p>
          </div>
        </div>
        <div ref={acts} className={cn("flex gap-2", phone ? "flex-col" : "shrink-0")}>
          {next ? <ButtonLink to={`/sales/new?paper=1&firm=${b.business}&date=${b.invoice_date}&number=${next.counter}`} variant="primary" size="lg" icon={ArrowRight} full={phone}>{`Next paper bill · ${next.counter}`}</ButtonLink> : null}
          <ButtonLink to={`/sales/paper?firm=${b.business}&month=${ym}`} size="lg" icon={BookOpenText} full={phone}>Back to the paper book</ButtonLink>
        </div>
      </div>
    );
  }
  const edit = d.saved === "edit";
  const sent = Boolean(b.sent) && d.sentNow;
  const who = c.type === "walkin" ? (b.sent?.to ? `+91 ${mobileText(b.sent.to)}` : "the customer") : c.name;
  const title = edit ? (sent ? "Changes saved and the corrected bill sent" : "Changes saved") : sent && phone ? "Saved and handed to WhatsApp" : `Saved ${b.invoice_number}`;
  const body = edit
    ? `Written to the audit log, with what changed.${b.sent && !sent ? ` ${who === "the customer" ? "The customer has" : `${who} has`} the old bill; send the corrected one.` : ""}`
    : sent ? (phone ? `WhatsApp opened for ${who}. Check the chat shows the bill, then you're done.` : `WhatsApp opened the chat with ${who}, with the bill's message typed in.`)
      : `${inr(b.total_amount)} · ${c.name}. ${d.hasNumber ? "Send it now, or print it." : "Print it, or give a WhatsApp number to send it."}`;
  const canSend = d.can("bill.send") && !d.cancelled;
  let actions: ReactNode;
  // an unsent paper bill: the customer has the paper one, so nothing asks to send it
  if (sent || !canSend || (b.paper && !b.sent)) actions = <ButtonLink to={`/sales/${b.id}/print`} size="lg" icon={Printer} full={phone}>Print</ButtonLink>;
  else if (d.hasNumber) {
    // a bill sent from here reads Send again in place (an edited one keeps asking for its corrected copy); a double
    // click's second click sends nothing (d.sendPress)
    actions = <Button variant="primary" size="lg" icon={Send} full={phone} disabled={!d.ready} title={d.sendWait} onClick={d.sendPress}>{b.sent ? (edit ? "Send the corrected bill" : "Send again") : "Send on WhatsApp"}</Button>;
  } else {
    actions = (
      <div className={cn("flex gap-2", phone ? "flex-col" : "")}>
        <ButtonLink to={`/sales/${b.id}/print`} variant="primary" size="lg" icon={Printer} full={phone}>Print</ButtonLink>
        <Button size="lg" icon={MessageCircle} full={phone} disabled={!d.ready} title={d.sendWait} onClick={() => d.dialogs.open("whatsapp", b)}>Send to a number</Button>
      </div>
    );
  }
  return (
    <div role="status" className={shell}>
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <SuccessMark size={phone ? 48 : 56} />
        <div className="min-w-0">
          <p className="text-lg font-semibold">{title}</p>
          <p className="text-fg2">{body}</p>
        </div>
      </div>
      <div ref={acts} className={phone ? "" : "shrink-0"}>{actions}</div>
    </div>
  );
}
