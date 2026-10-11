import type { ReactNode } from "react";
import { Copy, FileText, Lock, MessageCircle, MoreHorizontal, Pencil, Printer, ReceiptText, Send } from "lucide-react";
import { date, dateLong } from "@/core/format";
import type { BillDetail } from "@/core/sales/types";
import { dayOf, sentWhen, timeOf } from "@/core/sales/words";
import { Badge, Button, ButtonLink, Card, IconButton, Menu, Page } from "@/core/ui";
import { StatusCell, TaxTypeBadge } from "../actions/StatusCell";
import { ItemsTable } from "./ItemsTable";
import { Activity, EwayCard, OtherBills, Parties, PaymentCard, RoleNote, StateBanners, TotalBlock } from "./parts";
import { SavedPanel } from "./SavedPanel";
import { useDetail } from "./useDetail";

/**
 * One bill on a desktop (PROTO sales/BillDetail.jsx:389-451): the items, parties and activity on the left; the total,
 * payment, e-way bill and the customer's other bills on the right. note: the page's word that a refresh failed, first.
 */
export function DesktopBill({ b, note }: { b: BillDetail; note?: ReactNode }) {
  const d = useDetail(b);
  const items = d.billMenu(b, d.dialogs.open, { open: false, print: false, sendIt: false, duplicate: !d.cancelled, remake: false, edit: false, shareIt: true, link: true, eway: true, renumber: true, move: true, links: true });
  const saved = Boolean(d.saved);
  // one primary per view, and Send said once: while the saved panel shows, it owns sending. A paper bill's copy is never the
  // main step. Send waits for the shop's message, and a double click's second click sends nothing (d.sendPress): a quick
  // record turns the button into Send again under the pointer
  const sendBtn = !d.cancelled && d.can("bill.send") && !saved
    ? (d.hasNumber
      ? <Button variant={b.paper ? "secondary" : "primary"} icon={Send} disabled={!d.ready} title={d.sendWait} onClick={d.sendPress}>{b.sent ? "Send again" : b.paper ? "Send a copy" : "Send on WhatsApp"}</Button>
      : <Button icon={MessageCircle} disabled={!d.ready} title={d.sendWait} onClick={d.sendPress}>Send to a number</Button>)
    : null;
  return (
    <Page icon={ReceiptText} title={b.invoice_number} breadcrumbs={[{ label: "Sales", to: "/sales" }]}
      context={b.paper ? `${d.firmName} · ${dateLong(b.invoice_date)} · from the paper book, entered ${date(dayOf(b.created_at))}` : `${d.firmName} · ${dateLong(b.invoice_date)} · ${timeOf(b.created_at)}`}
      actions={<>
        {d.cancelled ? null : <Button icon={Copy} disabled={!d.can("bill.create")} title={d.whyNot("bill.create") || "A new bill with the same customer and items"} onClick={() => d.navigate(`/sales/new?from=${b.id}`)}>Duplicate</Button>}
        {d.cancelled ? null : d.editBlock ? <Button icon={Lock} disabled title={d.editBlock}>Edit</Button> : <ButtonLink to={`/sales/${b.id}/edit`} icon={Pencil}>Edit</ButtonLink>}
        <ButtonLink to={`/sales/${b.id}/print`} icon={Printer} variant={!d.hasNumber && !saved && !d.cancelled && !b.paper ? "primary" : "secondary"}>Print and share</ButtonLink>
        {sendBtn}
        <Menu width={290} title={`Bill ${b.invoice_number}`} items={items} trigger={(p) => <IconButton {...p} variant="secondary" label={`More actions for ${b.invoice_number}`} icon={MoreHorizontal} />} />
      </>}>
      {note}
      {saved ? <SavedPanel b={b} d={d} /> : null}
      <StateBanners b={b} d={d} />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <Card title={`Items · ${b.lines.length}`} subtitle={`${b.interstate ? "IGST" : "CGST + SGST"} worked out on each line and rounded to the paisa`} pad={false}>
            {b.lines.length ? <div className="mt-2"><ItemsTable bill={b} /></div> : <p className="px-5 pb-5 text-neg">No items on this bill.</p>}
            {b.notes ? <p className="px-5 py-3 border-t border-rule text-sm text-fg2"><span className="text-muted">Note on the bill:</span> {b.notes}</p> : null}
          </Card>
          <Card title="Parties"><Parties b={b} /></Card>
          <Card title="Activity" subtitle="From the audit log"><Activity b={b} /></Card>
        </div>
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <div className="flex flex-col gap-4">
              {/* a paper bill the customer already has is On paper, never "Not sent yet" */}
              <div className="flex flex-wrap gap-1.5"><TaxTypeBadge bill={b} /><StatusCell bill={b} max={3} />{!d.cancelled ? (b.sent ? <Badge tone="sale" icon={Send}>Sent {sentWhen(b.sent)}</Badge> : b.paper ? <Badge tone="muted" icon={FileText}>On paper</Badge> : <Badge tone="brand">Not sent yet</Badge>) : null}</div>
              <TotalBlock b={b} d={d} />
            </div>
          </Card>
          <PaymentCard b={b} d={d} />
          <EwayCard b={b} d={d} />
          <OtherBills b={b} />
          <RoleNote />
        </div>
      </div>
      {d.dialogs.element}
    </Page>
  );
}
