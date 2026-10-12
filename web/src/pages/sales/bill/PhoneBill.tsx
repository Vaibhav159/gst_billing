import type { ReactNode } from "react";
import { Lock, MessageCircle, MoreHorizontal, Pencil, Printer, RefreshCcw, Send } from "lucide-react";
import { cn } from "@/core/cn";
import { date, qty } from "@/core/format";
import type { BillDetail } from "@/core/sales/types";
import { PAY, rateText } from "@/core/sales/words";
import { Button, ButtonLink, Card, DL, IconButton, Menu, Money, Page, type MenuItem } from "@/core/ui";
import { SendStatusBadge, StatusCell, TaxTypeBadge } from "../actions/StatusCell";
import { Activity, EwayCard, OtherBills, Parties, RoleNote, StateBanners, TotalBlock } from "./parts";
import { madeByRow } from "../actions/recordRows";
import { SavedPanel } from "./SavedPanel";
import { useDetail } from "./useDetail";

/**
 * One bill on a phone (PROTO sales/BillDetail.jsx:453-534): the everyday actions in the bar, the rest under More, the
 * links in the header. note: the page's word that a refresh failed, first.
 */
export function PhoneBill({ b, note }: { b: BillDetail; note?: ReactNode }) {
  const d = useDetail(b);
  const saved = Boolean(d.saved);
  // a paper bill's copy lives in More, so the bar never nags to send it
  const moreItems = d.billMenu(b, d.dialogs.open, { open: false, print: false, sendIt: b.paper, edit: false, duplicate: !d.cancelled, remake: false, shareIt: true, link: true, eway: true, renumber: true, move: true, links: false });
  const linkItems: MenuItem[] = [
    ...(b.customer.type !== "walkin" ? [{ label: "Customer's page", onSelect: () => d.navigate(`/customers/${b.customer.id}`) }] : []),
    { label: "Audit log", hint: "Every change to every bill", onSelect: () => d.navigate("/audit") },
  ];
  const more = <Menu title={`Bill ${b.invoice_number}`} items={moreItems} trigger={(p) => <Button {...p} size="lg" icon={MoreHorizontal} aria-label={`More for ${b.invoice_number}`}>More</Button>} />;
  let bar: ReactNode;
  if (d.cancelled) {
    bar = (
      <>
        <ButtonLink to={`/sales/${b.id}/print`} icon={Printer} size="lg">Print</ButtonLink>
        {more}
        {!b.replaced_by && d.can("bill.create") ? <ButtonLink to={`/sales/new?remake=${b.id}`} icon={RefreshCcw} size="lg" variant="primary">Make again</ButtonLink> : null}
      </>
    );
  } else {
    const sendIt = d.can("bill.send");
    const printMain = !b.paper && (!sendIt || (!d.hasNumber && !saved));
    const sendMain = !b.paper && sendIt && !saved && d.hasNumber;
    bar = (
      <>
        {d.can("bill.edit") ? (d.editBlock
          ? <Button size="lg" icon={Lock} disabled aria-label={`Edit: ${d.editBlock}`}>Edit</Button>
          : <ButtonLink to={`/sales/${b.id}/edit`} size="lg" icon={Pencil}>Edit</ButtonLink>) : null}
        <ButtonLink to={`/sales/${b.id}/print`} size="lg" icon={Printer} variant={printMain ? "primary" : "secondary"}>Print</ButtonLink>
        {more}
        {/* Send waits for the shop's message; a double tap's second tap sends nothing (d.sendPress): a quick record turns it into Resend under the finger */}
        {sendIt && !b.paper ? <Button variant={sendMain ? "primary" : "secondary"} size="lg" icon={d.hasNumber ? Send : MessageCircle} disabled={!d.ready} title={d.sendWait} onClick={d.sendPress} {...(d.hasNumber ? {} : { "aria-label": "Send to a number" })}>{b.sent ? "Resend" : "Send"}</Button> : null}
      </>
    );
  }
  return (
    <Page title={`Bill ${b.invoice_number}`} phoneSubtitle={`${d.firmName} · ${date(b.invoice_date)}`} back
      phoneActions={<Menu title={`Bill ${b.invoice_number}`} items={linkItems} trigger={(p) => <IconButton {...p} label={`Links for ${b.invoice_number}`} icon={MoreHorizontal} />} />}
      actionBar={bar}>
      {note}
      {saved ? <SavedPanel b={b} d={d} phone /> : null}
      <StateBanners b={b} d={d} />
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap gap-1.5"><TaxTypeBadge bill={b} /><StatusCell bill={b} max={3} /></span>
            {/* a paper bill the customer already has is On paper, never "Not sent yet" */}
            <SendStatusBadge bill={b} variant="text" />
          </div>
          <TotalBlock b={b} d={d} />
          <DL rows={[
            ["Paid by", b.payment_mode ? PAY[b.payment_mode] : <span key="p" className="text-muted">Not recorded</span>],
            madeByRow(b, true),
          ]} />
        </div>
      </Card>
      <Card title={`Items · ${b.lines.length}`}>
        <div className="flex flex-col">
          {b.lines.length ? b.lines.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-3 py-2.5 border-t border-rule first:border-t-0 first:pt-0">
              <span className="min-w-0">
                <span className="block font-medium">{l.product_name}</span>
                <span className="block text-sm text-muted tnum">{qty(Number(l.quantity), l.unit)} × {rateText(l.rate)}/{l.unit}</span>
                <span className={cn("block text-xs", l.hsn_code ? "text-muted" : "text-neg")}>HSN {l.hsn_code || "missing"} · GST {l.gst_percent}%{b.interstate ? " IGST" : ""} · <Money value={l.tax} />{l.note ? ` · ${l.note}` : ""}</span>
              </span>
              <span className="text-right shrink-0"><Money value={l.taxable} strong /><span className="block text-xs text-muted">before GST</span></span>
            </div>
          )) : <p className="text-neg">No items on this bill.</p>}
          {b.notes ? <p className="text-sm text-fg2 border-t border-rule pt-2.5"><span className="text-muted">Note:</span> {b.notes}</p> : null}
        </div>
      </Card>
      <Card title="Parties"><Parties b={b} stacked /></Card>
      <EwayCard b={b} d={d} />
      <Card title="Activity" subtitle="From the audit log"><Activity b={b} /></Card>
      <OtherBills key={`${b.id}-${b.customer.id}`} b={b} phone />
      <RoleNote />
      {d.dialogs.element}
    </Page>
  );
}
