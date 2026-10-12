import type { ReactNode } from "react";
import { AlertTriangle, Maximize2 } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, inr, qty } from "@/core/format";
import type { BillDetail } from "@/core/sales/types";
import { PAY, rateText, sentWhen, storedIgst } from "@/core/sales/words";
import { Banner, Button, Card, DL, Money } from "@/core/ui";
import { perWord } from "@/pages/sales/form/rules";

export type BillDetailBodyProps = {
  bill: BillDetail; onFullView: (path: string) => void;
  sendTo: ReactNode; send: ReactNode; print: ReactNode; cancel: ReactNode; remake: ReactNode;
};
const PAY_LONG = { ...PAY, credit: "Udhaar · to be paid later" };

/** Plain words around Selling's stored bill; Easy's shared components own each action. */
export function BillDetailBody({ bill: b, onFullView, sendTo, send, print, cancel, remake }: BillDetailBodyProps) {
  const { can } = useAuth();
  const no = String(b.counter ?? b.invoice_number);
  const off = b.status === "cancelled";
  const empty = !b.lines.length;
  const fixer = can("bill.edit");
  const other = b.duplicates.find((x) => x.id !== b.id);
  const duplicate = b.checks.includes("duplicate") || Boolean(other);
  const hsnBlock = Boolean(b.customer.gst_number) && b.lines.some((line) => !line.hsn_code);
  const sendShown = !off && !empty && !hsnBlock;
  const source = b.history.activity.some((entry) => entry.action === "imported") ? "Excel" : "another app";
  return <>
    {off ? <Banner tone="neg" title="This bill is cancelled"><span className="text-md">{b.cancel_reason ? `${b.cancel_reason}. ` : ""}It keeps its number so the GST list stays complete.</span></Banner> : null}
    {off && !empty && can("bill.create") ? remake : null}
    {duplicate ? <Banner tone="neg" title={`Another bill also has number ${no}`} actions={fixer ? <Button icon={Maximize2} onClick={() => onFullView(`/gst?firm=${b.business}&month=${b.invoice_date.slice(0, 7)}&fix=1`)}>Fix it in the full view</Button> : null}><span className="text-md">{fixer ? other ? `${other.customer_name}'s bill of ${date(other.invoice_date)} has the same number.` : "Another bill has the same number." : `Tell the owner: bill ${no} has the same number as ${other ? `${other.customer_name}'s bill of ${date(other.invoice_date)}` : "another bill"}.`}</span></Banner> : null}
    {empty ? <Banner tone="neg" icon={AlertTriangle} title="This bill has no items"><span className="text-md">{`It was brought in from ${source} without them, so it can't be sent. `}{fixer ? "Add the items in the full view." : "Tell the owner; they add the items."}</span></Banner> : null}
    <Card>
      <p className="caps">Total, incl. GST</p>
      {empty ? <p className="text-2xl font-semibold text-fg2 mt-1.5">No items yet</p> : <Money value={b.total_amount} size="4xl" tone={off ? "muted" : "sale"} className="block mt-1.5" />}
      <p className="text-lg font-medium mt-4 break-words">{b.customer.name}</p>
      <p className="text-md text-muted">{b.customer.type === "walkin" ? "No name or phone on the bill" : `${b.customer.mobile_number || "No phone"}${b.customer.city ? ` · ${b.customer.city}` : ""}`}</p>
      <DL className="mt-3" rows={[
        ["Paid by", PAY_LONG[b.payment_mode]],
        !sendShown && ["Sent", b.sent ? <span className="text-sale">Sent {sentWhen(b.sent)}</span> : <span className="text-muted">Not sent yet</span>],
        ["Firm", b.firm.name], ["Bill number", <span key="n" className="tnum">{b.invoice_number}</span>],
      ]} />
    </Card>
    {!empty ? <section aria-labelledby="easy-items-t" className="card">
      <h2 id="easy-items-t" className="px-4 pt-4 pb-2 text-lg font-semibold">What they bought</h2>
      <ul>{b.lines.map((line) => <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3 border-t border-rule">
        <span className="min-w-0">
          <span className="block font-medium">{line.product_name} · <span className="tnum">{qty(Number(line.quantity), line.unit)}</span></span>
          <span className="block text-md text-muted tnum">{rateText(line.rate)} a {perWord(line.unit)}</span>
          {!line.hsn_code ? <span className="block text-md text-neg">No HSN code (the GST code for this item).{hsnBlock ? "" : fixer ? " Add it in the full view." : " Tell the owner; they add it."}</span> : null}
        </span><Money value={line.taxable} className="pt-0.5" />
      </li>)}</ul>
      <div className="px-4 pb-2 border-t border-rule"><DL rows={[["Price before GST", inr(b.taxable)], ...[...b.slabs].sort((a, z) => Number(z.gst_percent) - Number(a.gst_percent)).map((slab) => [`GST ${Number(slab.gst_percent)}% ${storedIgst(b) ? "(IGST, sale to another state)" : "(CGST + SGST)"}`, inr(slab.tax)] as const), ["Total", <Money key="t" value={b.total_amount} tone="sale" strong />, { strong: true }]]} /></div>
    </section> : null}
    {sendShown && can("bill.send") ? sendTo : null}
    {sendShown ? send : null}
    {!off && !empty && hsnBlock ? fixer ? <div className="flex flex-col gap-2 rounded-card border border-neg-line bg-neg-tint px-4 py-3.5">
      <p className="font-semibold">Add the missing HSN code before sending.</p><p className="text-md text-fg2">A shop's bill needs the GST code on every item.</p>
      <Button icon={Maximize2} onClick={() => onFullView(`/sales/${b.id}/edit`)} className="self-start">Add it in the full view</Button>
    </div> : <p className="rounded-card border border-line bg-card px-4 py-3.5 text-md text-fg2">The owner adds the missing HSN code before this bill goes out; a shop's bill needs it on every item.</p> : null}
    {!off && !empty ? print : null}
    {fixer && !off ? <section aria-label="Changing this bill" className="card p-4 flex flex-col gap-3"><p className="text-fg2">Need to change it? Open it in the full view, where you can edit it.</p><Button size="lg" icon={Maximize2} onClick={() => onFullView(`/sales/${b.id}`)}>Open in the full view</Button></section> : !off ? <p className="text-md text-muted text-center">Need to change it? Ask the owner.</p> : null}
    {!off ? <div className="flex flex-col items-center">{cancel}</div> : null}
  </>;
}
