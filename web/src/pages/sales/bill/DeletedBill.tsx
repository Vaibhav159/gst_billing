import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ReceiptText, RotateCcw, Trash2 } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { billQuery, useRestoreBill } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, inr, monthLabel } from "@/core/format";
import { markFresh } from "@/core/sales/fresh";
import type { BinRow } from "@/core/sales/types";
import { dayOf, failText, realReason, restoreFailure, timeOf } from "@/core/sales/words";
import { Banner, Button, ButtonLink, Card, DL, FailNote, Money, Page, useToast } from "@/core/ui";

/** Failures worth pressing Restore again for: it didn't get through. A refusal (the customer or firm gone, the number taken) stands. */
const AGAIN: ApiProblem["kind"][] = ["offline", "unreachable", "server", "throttled"];

/**
 * A deleted bill's own page (PROTO sales/BillDetail.jsx:536-568): who deleted it, when and why, and Restore. The bin
 * row is all the server sends for it, so the page shows that, not the items (they come back with the bill). note: the
 * page's word that a refresh failed, first.
 */
export function DeletedBill({ b, note }: { b: BinRow; note?: ReactNode }) {
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const qc = useQueryClient();
  const restore = useRestoreBill();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const ym = b.invoice_date.slice(0, 7);
  // a filed month stays as filed: restoring into it would change a return already on the portal
  const filed = b.locked ? `${monthLabel(ym, { long: true })} is filed and locked, so the bill can't come back into it. The owner can unlock the month in GST returns first.` : "";
  const why = !can("bill.delete") ? whyNot("bill.delete", "restore deleted bills") : filed;
  const reason = realReason(b.reason);
  const go = () => restore.mutate(b.id, {
    onSuccess: () => { markFresh(b.original_id); show({ title: `Restored ${b.invoice_number}`, body: "Back in Sales and in the month's GST figures." }); },
    onError: (e) => {
      const p = problemOf(e);
      setProblem(p);
      // its bin row has gone, or the bill is back already (restored elsewhere): the bill's own answer says which, and
      // shows the bill if it's back, rather than this page and a Try again that can only fail
      if (p.kind === "notfound" || p.code === "already_restored") void qc.refetchQueries({ queryKey: billQuery(b.original_id).queryKey });
    },
  });
  // a bin row that has gone says the server's words (contract §3.2), as an Undo's does; anything else as a change's
  const fail = problem ? (problem.kind === "notfound" ? restoreFailure(problem, b.invoice_number) : failText(problem, "restored")) : null;
  const again = problem !== null && AGAIN.includes(problem.kind);
  return (
    <Page icon={ReceiptText} title={b.invoice_number} phoneTitle={`Bill ${b.invoice_number}`} phoneSubtitle="Deleted" back breadcrumbs={[{ label: "Sales", to: "/sales" }]}
      context={`${b.business_name} · ${date(b.invoice_date)}`}>
      {note}
      <Banner tone="neg" icon={Trash2} title="This bill was deleted"
        actions={<>
          <Button variant="primary" icon={RotateCcw} loading={restore.isPending} disabled={Boolean(why)} title={why || undefined} onClick={go}>{restore.isPending ? "Restoring…" : again ? "Try again" : "Restore it"}</Button>
          <ButtonLink to="/audit">Open the Audit log</ButtonLink>
        </>}>
        {b.customer.name} · {inr(b.total_amount)}. Deleted {b.deleted_at ? `on ${date(dayOf(b.deleted_at))} at ${timeOf(b.deleted_at)}` : ""}{b.deleted_by ? ` by ${b.deleted_by.name}` : ""}{reason ? `, because “${reason}”.` : ". No reason was given."} Its number stays used. {why || "Restoring puts it back in Sales and in its month's GST figures."}
      </Banner>
      <FailNote error={fail} />
      <Card title="What was on the bill" subtitle="Its items come back with it when it's restored">
        <DL rows={[
          ["Firm", b.business_name],
          ["Bill no.", <span key="n" className="tnum">{b.invoice_number}</span>],
          ["Date", date(b.invoice_date)],
          ["Customer", b.customer.name],
          ["Total", <Money key="t" value={b.total_amount} strong />],
        ]} />
      </Card>
    </Page>
  );
}
