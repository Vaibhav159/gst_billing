// /sales/:id/edit (PROTO pages/sales/BillForm.jsx:48-60, 96-132): the bill form on a saved bill, for those who may change
// bills. A cancelled bill, a bill in a filed month, or someone who can't change bills sees what's on it and why it can't
// change, with the way on; a deleted bill says so. A change to a saved bill keeps no draft: it's saved, or it isn't.
import { useRef } from "react";
import { useLocation, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Landmark, Lock, ReceiptText, SquarePen } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { billQuery, cachedBillNumber, useBill } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, qty } from "@/core/format";
import type { BillDetail, BinRow } from "@/core/sales/types";
import { gstLabel, LOCKED_REASON, rateText, taxLines } from "@/core/sales/words";
import { Banner, ButtonLink, Card, DL, EmptyState, LoadError, Money, Page } from "@/core/ui";
import { useView } from "@/core/view";
import { ItemsTable } from "@/pages/sales/bill/ItemsTable";
import { MissingBill } from "@/pages/sales/bill/MissingBill";
import { BillForm, FormLoading } from "./BillFormPage";
import { idParam, startEdit, type Start } from "./model";

/** /sales/:id/edit (bill.edit). The app's routes load it on demand (plan 1E's lazyPage), so it's this module's default. */
export default function EditBillPage() {
  const { id = "" } = useParams();
  // the route stays mounted from one bill's address to another's: each bill is a form of its own
  return <EditBill key={id} raw={id} />;
}

function EditBill({ raw }: { raw: string }) {
  const billId = idParam(raw);
  const { can, whyNot } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  // once the form is open it stays, whatever the bill's answer says next (cancelled, deleted or filed meanwhile): the
  // save then says what happened, in the server's words. Nor is the bill asked for again behind it
  const opened = useRef<Start | null>(null);
  const q = useBill(opened.current ? null : billId);
  if (opened.current) return <BillForm start={opened.current} formKey={location.key} />;
  if (billId === null) return <MissingBill id={raw} />;
  if (q.data === undefined) {
    // named already when a list or search on this device has it (part 0 carry)
    const title = `Edit ${cachedBillNumber(qc, billId) ?? "bill"}`;
    // offline before it loaded: said so, never a form that waits for good
    if (q.isPending && q.isPaused) return <EditFailed title={title} problem={{ kind: "offline", message: "You're offline" }} />;
    if (q.isPending) return <FormLoading title={title} />;
    const p = problemOf(q.error);
    // Try again asks again through the client, as every page's does (Ruling 1B-11)
    return p.kind === "notfound" ? <MissingBill id={raw} /> : <EditFailed title={title} problem={p} retry={() => { void qc.refetchQueries({ queryKey: billQuery(billId).queryKey }); }} />;
  }
  if (q.data.kind === "deleted") return <WasDeleted binned={q.data.binned} />;
  const bill = q.data.bill;
  // a cancelled bill made again already says what it became, as its page does: a second remake would be refused
  const remade = bill.replaced_by;
  const reason = !can("bill.edit") ? whyNot("bill.edit")
    : bill.status === "cancelled" ? `Cancelled bills can't be changed. ${remade ? `It was made again as ${remade.invoice_number}.` : "Make it again from the bill instead."}`
      : bill.locked ? `${LOCKED_REASON} The change then goes into a revised return.` : "";
  if (reason) return <ReadOnlyBill bill={bill} reason={reason} />;
  opened.current = startEdit(bill);
  return <BillForm start={opened.current} formKey={location.key} />;
}

function EditFailed({ title, problem, retry }: { title: string; problem: ApiProblem; retry?: () => void }) {
  return (
    <Page icon={SquarePen} title={title} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      <LoadError problem={problem} retry={retry} what="this bill" />
    </Page>
  );
}

/** A deleted bill: changed only once it's back, from its own page (where the owner restores it). */
function WasDeleted({ binned }: { binned: BinRow }) {
  const { can } = useAuth();
  return (
    <Page icon={ReceiptText} title={`Edit ${binned.invoice_number}`} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      <Card><EmptyState icon={ReceiptText} title={`${binned.invoice_number} was deleted`}
        actions={<><ButtonLink to={`/sales/${binned.original_id}`} variant="primary">Open the bill</ButtonLink><ButtonLink to="/sales">Go to Sales</ButtonLink></>}>
        {`A deleted bill can't be changed.${can("bill.delete") ? " Restore it from the bill's page first." : " The owner can restore it."}`}
      </EmptyState></Card>
    </Page>
  );
}

/**
 * What's on a bill that can't change here, and why, with the way on (PROTO BillForm.jsx:96-132): the bill itself; a
 * cancelled bill made again, or the bill it became; a filed month's GST returns. Its totals are the bill's own, to the
 * paisa (Ruling 1B-12).
 */
export function ReadOnlyBill({ bill, reason }: { bill: BillDetail; reason: string }) {
  const { isPhone } = useView();
  const { can } = useAuth();
  const totals = (
    <DL className={isPhone ? undefined : "w-[320px]"} rows={[
      ["Taxable value", <Money key="t" value={bill.taxable} />],
      ...taxLines(bill).map((t) => [t.label, <Money key={t.key} value={t.value} />] as const),
      ["Total", <Money key="g" value={bill.total_amount} strong tone="sale" />, { strong: true }],
    ]} />
  );
  return (
    <Page icon={SquarePen} title={`Edit ${bill.invoice_number}`} phoneSubtitle={`${bill.business_name} · ${date(bill.invoice_date)}`} back={`/sales/${bill.id}`}
      breadcrumbs={[{ label: "Sales", to: "/sales" }, { label: bill.invoice_number, to: `/sales/${bill.id}` }]}>
      <Banner tone={bill.locked ? "file" : "muted"} icon={Lock} title="This bill can't be changed"
        actions={<>
          <ButtonLink size="sm" to={`/sales/${bill.id}`}>Open the bill</ButtonLink>
          {bill.locked ? <ButtonLink size="sm" to={`/gst?firm=${bill.business}&month=${bill.invoice_date.slice(0, 7)}`} icon={Landmark}>GST returns</ButtonLink> : null}
          {bill.status !== "cancelled" ? null : bill.replaced_by ? <ButtonLink size="sm" variant="primary" to={`/sales/${bill.replaced_by.id}`}>{`Open ${bill.replaced_by.invoice_number}`}</ButtonLink>
            : can("bill.create") ? <ButtonLink size="sm" variant="primary" to={`/sales/new?remake=${bill.id}`}>Make it again</ButtonLink> : null}
        </>}>
        {reason}
      </Banner>
      <Card title="What's on the bill" subtitle={`${bill.customer.name} · ${date(bill.invoice_date)} · ${gstLabel(bill)}`} pad={isPhone}>
        {isPhone ? (
          <div className="flex flex-col gap-3">
            {bill.lines.map((l) => (
              <div key={l.id} className="flex justify-between gap-3">
                <span className="min-w-0"><span className="block font-medium">{l.product_name}</span><span className="block text-sm text-muted tnum">{`${qty(Number(l.quantity), l.unit)} × ${rateText(l.rate)}`}</span></span>
                <Money value={l.taxable} />
              </div>
            ))}
            {totals}
          </div>
        ) : (
          <>
            <div className="mt-2"><ItemsTable bill={bill} /></div>
            <div className="px-5 py-4 border-t border-rule flex justify-end">{totals}</div>
          </>
        )}
      </Card>
    </Page>
  );
}
