import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpenText, MessageCircle, Printer, Send } from "lucide-react";
import { salesKeys, usePaperBook } from "@/core/api/sales";
import { cn } from "@/core/cn";
import { date, inr, mobileText, monthLabel } from "@/core/format";
import type { BillDetail } from "@/core/sales/types";
import { Button, ButtonLink, SuccessMark } from "@/core/ui";
import type { Detail } from "./useDetail";

/**
 * Right after a save (?saved=new|edit, &sent=1 when the save sent it; plan 1D), one panel says what happened and owns
 * the next step: Send, or Print when there's no number to send to (PROTO sales/BillDetail.jsx:137-201). It takes focus,
 * so the keyboard goes on from here. A paper bill's next step is the next paper bill: the same firm and date, and the
 * paper book's next number, once the paper book has answered since the save; when it can't, the panel says so. An unsent
 * paper bill is never asked to be sent: after an edit its step is Print. A send made while it shows, or any time after
 * the edit, changes what it says. The total is the bill's exact one (Ruling 1B-12).
 */
export function SavedPanel({ b, d, phone = false }: { b: BillDetail; d: Detail; phone?: boolean }) {
  const qc = useQueryClient();
  const acts = useRef<HTMLDivElement>(null);
  const paper = b.paper && d.saved !== "edit";
  const ym = b.invoice_date.slice(0, 7);
  const book = usePaperBook(paper ? b.business : null, paper ? ym : null);
  // The paper book's answer from before the panel came up may name the number just saved as the next one: the save
  // marked it stale (invalidateSales), and a failed answer since leaves it so. Only one that came after counts, unless
  // the book had answered since the save already (the panel mounted again, after a switch of layout)
  const [since] = useState(() => { const s = qc.getQueryState(salesKeys.paperBook(b.business, ym)); return s?.data !== undefined && !s.isInvalidated ? 0 : Date.now(); });
  // the bill's last send when the panel came up: a send made while it shows moves it on
  const [lastAtFirst] = useState(() => b.sent?.last_at ?? "");
  // The next step takes focus once, unless the person has put it somewhere: on a paper bill not until the paper book has
  // answered (it would land on the way back, then jump to Next), and Send once the shop's message is in. A later answer
  // leaves focus be, except after Try again (the button goes with the line, once the book answers).
  const landed = useRef(false);
  useEffect(() => {
    const box = acts.current;
    if (landed.current || !box || (paper && (book.fetchStatus !== "idle" || book.isPending))) return;
    const step = box.querySelector<HTMLElement>("a[href], button:not([disabled])");
    if (!step) return;
    landed.current = true;
    const a = document.activeElement;
    if (a && a !== document.body && !a.hasAttribute("data-page-title")) return;
    step.focus({ preventScroll: true });
  }, [book.fetchStatus, book.status, d.ready]);
  const c = b.customer;
  const shell = cn("card border-sale-line anim-rise flex gap-4", phone ? "flex-col items-stretch p-4" : "items-center px-5 py-4");
  if (paper) {
    // Nothing is offered until the paper book has answered since (asked, held offline, or failed). After that, asking
    // again (a reconnect) leaves Next where it is, so a tap can't land on the way back (Ruling 1B-21), and a failure
    // keeps the number it last gave, and says so
    const next = book.data !== undefined && book.dataUpdatedAt >= since && !book.data.locked ? book.data.next : null;
    // Ruling 1B-11: asked again through the client
    const retry = () => { landed.current = false; void qc.refetchQueries({ queryKey: salesKeys.paperBook(b.business, ym) }); };
    return (
      <div role="status" className={shell}>
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <SuccessMark size={phone ? 48 : 56} />
          <div className="min-w-0">
            <p className="text-lg font-semibold">Saved {b.invoice_number}</p>
            <p className="text-fg2">From the paper book, dated {date(b.invoice_date)}: {inr(b.total_amount)} · {c.name}. It goes into {monthLabel(ym, { long: true, year: false })}&apos;s GSTR-1.</p>
            {book.isError ? (
              <p className="text-sm text-muted mt-1">
                {next ? "Couldn't refresh the paper book, so the next number is the one it last gave." : "Couldn't load the paper book's next number."}{" "}
                <Button size="sm" variant="link" loading={book.isFetching} onClick={retry}>Try again</Button>
              </p>
            ) : null}
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
  const sentHere = Boolean(b.sent) && b.sent?.last_at !== lastAtFirst;
  // an edit's corrected copy went if a send came after the bill's latest edit (its history's "updated" rows, "Edited" on
  // the page), whenever that was: a reload, or a switch of layout that mounts the panel again, doesn't ask for it again
  const edits = b.history.activity.filter((a) => a.action === "updated").map((a) => Date.parse(a.at));
  const sentAfterEdit = Boolean(b.sent) && edits.length > 0 && Date.parse(b.sent?.last_at ?? "") > Math.max(...edits);
  // sent: the save sent it (&sent=1), a send was made while the panel shows, or (a new bill) it was sent at all, or (an
  // edit) since the edit. An edited bill sent only before the edit still owes the customer its corrected copy
  const sent = Boolean(b.sent) && (d.sentNow || sentHere || !edit || sentAfterEdit);
  const who = c.type === "walkin" ? (b.sent?.to ? `+91 ${mobileText(b.sent.to)}` : "the customer") : c.name;
  const title = edit ? (sent ? "Changes saved and the corrected bill sent" : "Changes saved") : sent && phone ? "Saved and handed to WhatsApp" : `Saved ${b.invoice_number}`;
  const body = edit
    ? `Written to the audit log, with what changed.${b.sent && !sent ? ` ${who === "the customer" ? "The customer has" : `${who} has`} the old bill; send the corrected one.` : ""}`
    : sent ? (phone ? `WhatsApp opened for ${who}. Check the chat shows the bill, then you're done.` : `WhatsApp opened the chat with ${who}, with the bill's message typed in.`)
      : `${inr(b.total_amount)} · ${c.name}. ${d.hasNumber ? "Send it now, or print it." : "Print it, or give a WhatsApp number to send it."}`;
  const canSend = d.can("bill.send") && !d.cancelled;
  let actions: ReactNode;
  // sent already when the panel came up, or an unsent paper bill (the customer has the paper one): the step is Print.
  // A send made here keeps its button, as Send again, so a double click's second click never lands on a new Print link
  if ((sent && !sentHere) || !canSend || (b.paper && !b.sent)) actions = <ButtonLink to={`/sales/${b.id}/print`} size="lg" icon={Printer} full={phone}>Print</ButtonLink>;
  else if (d.hasNumber) {
    // (and that second click sends nothing either: d.sendPress)
    actions = <Button variant="primary" size="lg" icon={Send} full={phone} disabled={!d.ready} title={d.sendWait} onClick={d.sendPress}>{sent ? "Send again" : b.sent ? "Send the corrected bill" : "Send on WhatsApp"}</Button>;
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
