// Delete several bills at once (owner; PROTO sales/SalesList.jsx:910-993): one at a time to the bin, the ones in a
// filed month left out with the reason. Undo brings back every one that went.
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { useDeleteBill, useRestoreBill } from "@/core/api/sales";
import { date, monthLabel, plural } from "@/core/format";
import { markFresh } from "@/core/sales/fresh";
import type { BillRow } from "@/core/sales/types";
import { andList, billsAnd, failText, restoreFailure, type FailText } from "@/core/sales/words";
import { useFirms } from "@/core/scope";
import { Chip, ConfirmDialog, FailNote, Field, Input, Money, useToast } from "@/core/ui";
import { useHeldValue } from "../actions/held";

const REASONS = ["Entered twice", "Wrong firm", "Test bills"];

export function DeleteManyDialog({ bills, onClose, onDone }: { bills: BillRow[] | null; onClose: () => void; onDone: () => void }) {
  const held = useHeldValue(bills) ?? [];
  const remove = useDeleteBill();
  const restore = useRestoreBill();
  const { firms } = useFirms();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<FailText | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => { if (bills) { setFail(null); setReason(""); } }, [bills]);
  const deletable = held.filter((b) => !b.locked);
  const blocked = held.filter((b) => b.locked);
  const months = [...new Set(blocked.map((b) => monthLabel(b.invoice_date.slice(0, 7), { long: true })))];
  const active = deletable.filter((b) => b.status !== "cancelled").length;
  const what = andList([active ? plural(active, "sales bill") : "", deletable.length > active ? plural(deletable.length - active, "cancelled bill") : ""]);
  const short = (b: BillRow) => firms.find((f) => f.id === b.business)?.short ?? b.business_name;

  // Undo from the toast: each comes back under its own id, in turn; the first that can't says so and the rest stay
  const undoAll = async (done: { bill: BillRow; binId: number }[]) => {
    let n = 0;
    for (const x of done) {
      try { await restore.mutateAsync(x.binId); n += 1; markFresh(x.bill.id); }
      catch (e) {
        const left = done.length - n;
        show(restoreFailure(problemOf(e), n ? `${plural(n, "bill")} came back. The other ${left}` : done.length === 1 ? "The bill" : `All ${done.length} bills`, n ? left > 1 : done.length > 1));
        break;
      }
    }
    if (n) show({ title: `Restored ${plural(n, "bill")}`, body: "Back in Sales and in the GST figures." });
  };

  const confirm = async () => {
    setBusy(true);
    const done: { bill: BillRow; binId: number }[] = [];
    let error: unknown = null;
    for (const b of deletable) {
      try { done.push({ bill: b, binId: (await remove.mutateAsync({ id: b.id, reason: reason.trim() })).id }); }
      catch (e) { error = e; break; }
    }
    setBusy(false);
    if (error) {
      const p = problemOf(error);
      const next = p.kind === "offline" ? "Try again when the internet is back." : p.kind === "unreachable" || p.kind === "server" ? "Try again in a minute." : p.message;
      setFail({ title: failText(p, "deleted").title, body: `${done.length ? `${plural(done.length, "bill")} deleted before it stopped.` : "Nothing was deleted."} ${next}` });
    }
    if (!done.length) return;
    show({
      title: `Deleted ${billsAnd(done.map((x) => x.bill))}`, body: done.length === 1 ? "It's in the Audit log, where it can be restored." : "They're in the Audit log, where they can be restored.",
      action: { label: "Undo", onClick: () => { void undoAll(done); } },
    });
    if (!error) { onClose(); onDone(); }
  };

  return (
    <ConfirmDialog open={Boolean(bills)} onClose={onClose} onConfirm={() => { void confirm(); }} busy={busy} busyLabel="Deleting…" tone="danger" confirmDisabled={!deletable.length}
      title={deletable.length ? `Delete ${what}?` : "These bills can't be deleted"}
      confirmLabel={fail ? "Try again" : `Delete ${billsAnd(deletable)}`} cancelLabel="Keep them"
      extra={deletable.length ? (
        <>
          <Field label="Why delete them?" htmlFor="del-many-reason" hint="Optional. Shown in the Audit log.">
            <Input id="del-many-reason" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2 -mt-1" role="group" aria-label="Common reasons">
            {REASONS.map((r) => <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}
          </div>
          <FailNote error={fail} />
        </>
      ) : <FailNote error={fail} />}>
      {deletable.length ? (
        <ul className="rounded-ctl border border-line bg-field divide-y divide-rule max-h-[220px] overflow-y-auto" aria-label="Bills to delete">
          {deletable.map((b) => (
            <li key={b.id} className="px-3.5 py-2 flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0"><span className="block text-fg font-medium tnum">{short(b)} · {b.invoice_number}</span>
                <span className="block text-muted">{date(b.invoice_date)} · {b.customer.name}</span></span>
              <Money value={b.total_amount} className="text-fg" />
            </li>
          ))}
        </ul>
      ) : null}
      {blocked.length ? (
        <p className="text-sm text-file flex items-start gap-1.5"><Lock size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{blocked.length <= 3 ? blocked.map((b) => `${b.invoice_number} (${b.customer.name})`).join(", ") : plural(blocked.length, "bill")} {blocked.length === 1 ? "stays" : "stay"}: {months.join(" and ")} {months.length === 1 ? "is" : "are"} filed.</span>
        </p>
      ) : null}
      {deletable.length ? (
        <>
          <p className="caps mt-1">What deleting does</p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>Removes them from Sales, the dashboard and the GST figures of their months.</li>
            <li>Their numbers stay used, so no other bill gets them.</li>
            <li>You can restore them from More, then Audit log.</li>
          </ul>
        </>
      ) : null}
    </ConfirmDialog>
  );
}
