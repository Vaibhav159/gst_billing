import { useState, type ReactNode } from "react";
import { MessageCircle, Plus, XCircle } from "lucide-react";
import { inr } from "@/core/format";
import type { BillDetail } from "@/core/sales/types";
import { Button, SuccessMark } from "@/core/ui";
export type SavedBodyProps = {
  bill: BillDetail; paymentWords: string; canCreate: boolean; canSend: boolean; onNew: () => void;
  paper: ReactNode; sendTo: ReactNode; send: ReactNode; print: ReactNode; cancel: ReactNode; again: ReactNode;
};
/** The route loads BillDetail and supplies 6B's words/paper/actions; this body never sends, prints or fetches.
 *  An unsent paper bill is never asked to be sent (P6-4): Print and Make another bill lead, and the shared send
 *  parts appear only after the quiet Send button is tapped. */
export function SavedBody({ bill, paymentWords, canCreate, canSend, onNew, paper, sendTo, send, print, cancel, again }: SavedBodyProps) {
  const number = bill.counter ?? bill.invoice_number;
  const cancelled = bill.status === "cancelled";
  const quietSend = bill.paper && !bill.sent;
  const [sendOpen, setSendOpen] = useState(false);
  const nextIsMain = Boolean(bill.sent) || !canSend;
  return <div className="min-h-full flex flex-col gap-5 px-4 pt-8 pb-8">
    <div className="flex flex-col items-center text-center gap-3">
      {cancelled ? <span aria-hidden="true" className="anim-ring w-[84px] h-[84px] rounded-full border-2 border-neg-line bg-neg-tint text-neg grid place-items-center"><XCircle size={40} /></span> : <SuccessMark size={84} />}
      <h1 data-page-title="" tabIndex={-1} className="text-2xl font-semibold leading-tight outline-none">Bill {number} {cancelled ? "cancelled" : "saved"}</h1>
      <p className="text-lg text-fg2 leading-snug">{bill.customer.name} · <span className="tnum text-sale">{inr(bill.total_amount)}</span> · {paymentWords}</p>
      {cancelled ? <p className="text-md text-muted">It stays in Bills marked Cancelled and keeps its number for the GST list.</p> : null}
    </div>
    {paper}
    {cancelled ? again : quietSend ? <>
      {print}
      {canCreate ? <Button variant="primary" size="xl" icon={Plus} full onClick={onNew}>Make another bill</Button> : null}
      {!canSend ? null : sendOpen ? <>{sendTo}{send}</> : <Button variant="ghost" size="lg" icon={MessageCircle} full onClick={() => setSendOpen(true)}>Send the bill</Button>}
    </> : <>
      {canSend ? sendTo : null}
      {send}
      {print}
      {canCreate ? <Button variant={nextIsMain ? "primary" : "outline"} size="xl" icon={Plus} full onClick={onNew}>Make another bill</Button> : null}
    </>}
    <div className="mt-auto pt-6 flex flex-col items-center">{cancel}</div>
  </div>;
}
export default SavedBody;
