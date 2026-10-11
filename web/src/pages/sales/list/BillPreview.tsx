// The bill beside the table (PROTO sales/SalesList.jsx:837-907): its figures and status at a glance, its items and who
// made it once its own answer comes. The list's row draws it at once; the bill's answer fills in the rest.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, ChevronDown, ChevronUp, Lock, MoreHorizontal, Printer, Send, X } from "lucide-react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { problemOf } from "@/core/api/errors";
import { billQuery, type BillOutcome } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { dateLong, qty } from "@/core/format";
import type { BillDetail, BillRow } from "@/core/sales/types";
import { LOCKED_REASON, PAY, ewayNumberText, rateText, realReason, sentLine, taxLines, timeOf } from "@/core/sales/words";
import { Banner, Button, ButtonLink, DL, IconButton, Menu, Money, Skeleton, useScrollRegion, type DLRow } from "@/core/ui";
import type { OpenDialog } from "../actions/BillDialogs";
import { SendStatusBadge, StatusCell, TaxTypeBadge } from "../actions/StatusCell";
import { madeByRow } from "../actions/recordRows";
import { useBillMenu } from "../actions/useBillMenu";
import { useSendReady } from "../actions/useSendBill";
import { customerLine } from "@/pages/customers/forBills";

/**
 * The preview's scrolling part, drawn afresh for each bill (its rise), so each bill's is measured afresh. While it
 * overflows with nothing inside for Tab (a walk-in's name is no link; a cancelled bill's banner makes it taller), it's a
 * region the keyboard reaches, so the arrows scroll it (WCAG 2.1.1), as a dialog's body is (Ruling 1D-18). Its focus
 * ring is drawn inside it: the card's edge is right there.
 */
function PreviewBody({ number, children }: { number: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const region = useScrollRegion(body, true);
  return (
    <div ref={body} {...(region ? { tabIndex: 0, role: "region", "aria-label": `Details of bill ${number}` } : {})}
      className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5 anim-rise focus-visible:[outline-offset:-2px]">{children}</div>
  );
}

export function BillPreview({ id, row, index, total, onClose, onMove, openDialog, send }: {
  id: number; row: BillRow | null; index: number; total: number; onClose: () => void; onMove: (d: -1 | 1) => void; openDialog: OpenDialog; send: (b: BillRow | BillDetail) => void;
}) {
  const { can } = useAuth();
  const billMenu = useBillMenu();
  // Send stays off until the shop's settings answer, as the list's Send does, so the shop's own message goes with it
  const ready = useSendReady();
  const qc = useQueryClient();
  // Keep this bill's cache subscribed while arrow keys move: its row draws at once, but only a pause reads its items.
  // Each selection gets its own pause, including a quick return to the bill just left.
  const selection = useMemo(() => ({ id }), [id]);
  const [settled, setSettled] = useState<typeof selection | null>(null);
  useEffect(() => { const t = setTimeout(() => setSettled(selection), 200); return () => clearTimeout(t); }, [selection]);
  const detail = useQuery({ ...billQuery(id), enabled: settled === selection, select: (o: BillOutcome) => o.kind === "bill" ? o.bill : null });
  const d = detail.data ?? null;
  // a bill deleted since the list loaded answers null: it's gone, whatever the row still says
  const b: BillRow | BillDetail | null = detail.data === null ? null : d ?? row;
  const close = <IconButton size="sm" label="Close preview" icon={X} onClick={onClose} />;
  // the bill's own answer failed (a deleted bill's answer is null, not a failure): say so, never a skeleton for ever, and
  // ask again through the client (Ruling 1B-11)
  const failed = detail.isError;
  const again = <Button size="sm" variant="link" loading={detail.isFetching} onClick={() => { void qc.refetchQueries({ queryKey: billQuery(id).queryKey }); }}>Try again</Button>;
  if (!b) {
    // not in the rows loaded, and its own answer not here yet, or the bill is gone
    return (
      <aside aria-label="Preview of a bill" className="card sticky top-6 flex flex-col min-w-0 anim-rise">
        <div className="flex items-start gap-1 pl-5 pr-3 pt-4 pb-3 border-b border-rule"><div className="flex-1" />{close}</div>
        <div className="px-5 py-4 flex flex-col gap-3">
          {detail.isPending ? <><Skeleton w={160} h={22} /><Skeleton h={16} /><Skeleton w="60%" h={16} /></>
            : failed && problemOf(detail.error).kind !== "notfound" ? <p className="text-fg2">Couldn&apos;t load this bill. {again}</p>
              : <p className="text-fg2">{detail.data === null ? "This bill was deleted." : "This bill isn't here any more."} <Link to={`/sales/${id}`} className="link">Open it</Link></p>}
        </div>
      </aside>
    );
  }
  const cancelled = b.status === "cancelled";
  const c = b.customer;
  const lines: DLRow[] = [["Taxable value", <Money key="tx" value={b.taxable} />]];
  if (d) for (const t of taxLines(d)) lines.push([t.label, <Money key={t.key} value={t.value} />]);
  else lines.push(["GST", <Money key="gst" value={b.tax} />]);
  lines.push(["Paid by", b.payment_mode ? PAY[b.payment_mode] : <span key="p" className="text-muted">Not recorded</span>]);
  return (
    <aside aria-label={`Preview of bill ${b.invoice_number}`} className="card sticky top-6 flex flex-col max-h-[calc(100vh-150px)] min-w-0 anim-rise">
      <div className="flex items-start gap-1 pl-5 pr-3 pt-4 pb-3 border-b border-rule">
        <div className="flex-1 min-w-0">
          <p className="caps truncate">{b.business_name}</p>
          <h2 className="text-xl font-semibold tnum mt-0.5 break-all">{b.invoice_number}</h2>
          <p className="text-sm text-muted mt-0.5">{dateLong(b.invoice_date)} · {b.paper ? "from the paper book" : timeOf(b.created_at)}</p>
        </div>
        <Menu width={280} title={`Bill ${b.invoice_number}`} items={billMenu(b, openDialog, { open: false, print: false, sendIt: false, shareIt: true, eway: true })}
          trigger={(p) => <IconButton {...p} size="sm" label={`More actions for ${b.invoice_number}`} icon={MoreHorizontal} />} />
        <IconButton size="sm" label="Previous bill" icon={ChevronUp} disabled={index <= 0} onClick={() => onMove(-1)} />
        <IconButton size="sm" label="Next bill" icon={ChevronDown} disabled={index < 0 || index >= total - 1} onClick={() => onMove(1)} />
        {close}
      </div>
      <PreviewBody key={b.id} number={b.invoice_number}>
        <div className="flex flex-wrap gap-1.5">
          <TaxTypeBadge bill={b} />
          <StatusCell bill={b} max={3} />
          <SendStatusBadge bill={b} />
        </div>
        {cancelled ? <Banner tone="neg" icon={Ban} title="Cancelled">{realReason(b.cancel_reason) ? `“${realReason(b.cancel_reason)}”.` : "No reason was given."} It stays in GSTR-1 with its number.</Banner> : null}
        {!cancelled && b.checks.length ? (
          <Banner tone="neg" title="Needs a check">
            {b.checks.includes("no_lines") ? "This bill has no items." : b.checks.includes("no_hsn") ? "A line has no HSN code." : "Its number or tax needs a look."} Open the bill to fix it.
          </Banner>
        ) : null}
        <div>
          <p className="caps">{cancelled ? "Total when issued" : "Total incl. GST"}</p>
          <Money value={b.total_amount} size="3xl" tone={cancelled ? "muted" : "sale"} className="block mt-1" />
          <DL className="mt-2" rows={lines} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="caps">Customer</p>
          {c.type !== "walkin" ? <Link to={`/customers/${c.id}`} className="font-medium hover:text-brand self-start">{c.name}</Link> : <span className="font-medium">{c.name}</span>}
          {d ? <p className="text-sm text-muted">{customerLine(d.customer)}</p> : failed ? null : <Skeleton w="70%" h={14} />}
        </div>
        <div className="flex flex-col gap-2">
          <p className="caps">Items · {b.line_count}</p>
          {!d ? (failed ? <p className="text-sm text-fg2">Couldn&apos;t load its items. {again}</p> : <><Skeleton h={16} /><Skeleton w="80%" h={16} /></>) : d.lines.length ? d.lines.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0"><span className="block">{l.product_name}</span>
                <span className="block text-xs text-muted tnum">{qty(Number(l.quantity), l.unit)} × {rateText(l.rate)}/{l.unit}</span></span>
              <Money value={l.taxable} className="text-sm" />
            </div>
          )) : <p className="text-sm text-neg">No items on this bill.</p>}
        </div>
        {d ? (
          <DL rows={[
            madeByRow(d),
            ["Sent", b.sent ? `${sentLine(b.sent)}${cancelled ? ", before it was cancelled" : ""}` : b.paper ? "The customer has the paper bill" : "Not yet"],
            d.eway.eway_bill_number ? ["E-way bill", <span key="e" className="tnum">{ewayNumberText(d.eway.eway_bill_number)}</span>] : null,
          ]} />
        ) : null}
        {b.locked ? <p className="text-sm text-file flex items-start gap-1.5"><Lock size={15} className="shrink-0 mt-0.5" aria-hidden="true" />{LOCKED_REASON}</p> : null}
      </PreviewBody>
      <div className="px-5 py-3 border-t border-rule flex flex-wrap items-center gap-2">
        <ButtonLink to={`/sales/${b.id}`} variant="primary" size="sm">Open full bill</ButtonLink>
        <ButtonLink to={`/sales/${b.id}/print`} size="sm" icon={Printer}>Print or PDF</ButtonLink>
        {/* the second click of a double click (detail 2) sends nothing: a quick record turns this button into Send again under it */}
        {!cancelled && !(b.paper && !b.sent) && can("bill.send") ? <Button size="sm" icon={Send} disabled={!ready} title={ready ? undefined : "Getting the shop's WhatsApp message"} onClick={(e) => { if (e.detail > 1) return; send(b); }}>{b.sent ? "Send again" : "Send"}</Button> : null}
      </div>
    </aside>
  );
}
