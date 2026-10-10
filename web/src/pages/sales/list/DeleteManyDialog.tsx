// Delete several bills at once (owner; PROTO sales/SalesList.jsx:910-993): one at a time to the bin, the ones in a
// filed month left out with the reason, and one refresh of the list at the end. A delete that stops part-way says how
// far it got and is then about what's left, so Try again deletes only those. Undo brings back every one that went.
import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { useDeleteBills, useRestoreBins } from "@/core/api/sales";
import { date, monthLabel, plural } from "@/core/format";
import { markFresh } from "@/core/sales/fresh";
import type { BillRow } from "@/core/sales/types";
import { andList, billsAnd, failText, restoreFailure, type FailText } from "@/core/sales/words";
import { useFirms } from "@/core/scope";
import { Chip, ConfirmDialog, FailNote, Field, Input, Money, useToast } from "@/core/ui";
import { useHeldValue } from "../actions/held";

const REASONS = ["Entered twice", "Wrong firm", "Test bills"];
/** A bill this delete sent to the bin, and its bin row's id, which Undo restores. */
type Deleted = { bill: BillRow; binId: number };

export function DeleteManyDialog({ bills, onClose, onDone }: { bills: BillRow[] | null; onClose: () => void; onDone: () => void }) {
  const held = useHeldValue(bills) ?? [];
  const removeBills = useDeleteBills();
  const restoreBins = useRestoreBins();
  const { firms } = useFirms();
  const { show, dismiss } = useToast();
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<FailText | null>(null);
  const [reason, setReason] = useState("");
  // what this opening of the dialog has deleted (with the bin rows Undo needs), and every bill gone so far: deleted
  // here, or gone already (a 404). The toast it showed last, so a later try's toast takes its place.
  const [done, setDone] = useState<Deleted[]>([]);
  const [gone, setGone] = useState<ReadonlySet<number>>(() => new Set());
  const toastId = useRef<string | null>(null);
  useEffect(() => { if (bills) { setFail(null); setReason(""); setDone([]); setGone(new Set()); toastId.current = null; } }, [bills]);
  // the bills asked to go (a filed month's stay), and what's left of them
  const asked = held.filter((b) => !b.locked);
  const deletable = asked.filter((b) => !gone.has(b.id));
  const blocked = held.filter((b) => b.locked);
  const months = [...new Set(blocked.map((b) => monthLabel(b.invoice_date.slice(0, 7), { long: true })))];
  const active = deletable.filter((b) => b.status !== "cancelled").length;
  const what = andList([active ? plural(active, "sales bill") : "", deletable.length > active ? plural(deletable.length - active, "cancelled bill") : ""]);
  const short = (b: BillRow) => firms.find((f) => f.id === b.business)?.short ?? b.business_name;

  // Undo from the toast: each comes back under its own id, in turn, and the list asks again once. A bin row that has gone
  // (restored or removed already) is passed over; the first other failure says so and the rest stay deleted
  const undoAll = async (list: Deleted[]) => {
    let back = 0;
    let missing = 0;
    let error: unknown = null;
    try {
      await restoreBins.mutateAsync({ binIds: list.map((x) => x.binId), onEach: (_, bill) => { if (bill) { back += 1; markFresh(bill.id); } else missing += 1; } });
    } catch (e) { error = e; }
    const left = list.length - back - missing;
    if (error) show(restoreFailure(problemOf(error), back ? `${plural(back, "bill")} came back. The other ${left}` : left === 1 ? "The bill" : `${left === list.length ? "All " : ""}${left} bills`, left > 1));
    const unbinned = missing ? ` ${plural(missing, "bill")} ${missing === 1 ? "wasn't" : "weren't"} in the bin any more.` : "";
    if (back) show({ title: `Restored ${plural(back, "bill")}`, body: `Back in Sales and in the GST figures.${unbinned}` });
    else if (missing && !error) show({ tone: "neg", title: "Not restored", body: missing === 1 ? "That deleted bill isn't in the bin any more." : `Those ${missing} deleted bills aren't in the bin any more.` });
  };

  const confirm = async () => {
    setBusy(true);
    const goneNow = new Set(gone);
    const doneNow = [...done];
    let error: unknown = null;
    try {
      await removeBills.mutateAsync({ ids: deletable.map((b) => b.id), reason: reason.trim(), onEach: (id, binned) => {
        goneNow.add(id);
        const bill = deletable.find((b) => b.id === id);
        if (binned && bill) doneNow.push({ bill, binId: binned.id });
      } });
    } catch (e) { error = e; }
    setBusy(false);
    setGone(goneNow);
    setDone(doneNow);
    const n = goneNow.size;
    if (error) {
      // how far it got, from the counts: never "Not deleted" once some have gone
      const p = problemOf(error);
      const next = p.kind === "offline" ? "Try again when the internet is back." : p.kind === "unreachable" || p.kind === "server" ? "Try again in a minute." : p.message;
      const left = asked.length - n;
      setFail(n ? { title: `Stopped after ${n} of ${asked.length}`, body: `${left === 1 ? "The other bill is" : `The other ${left} are`} still in Sales. ${next}` }
        : { title: failText(p, "deleted").title, body: `Nothing was deleted. ${next}` });
    } else setFail(null);
    const already = n - doneNow.length;
    if (doneNow.length > done.length) {
      // one toast for all this delete has done, its Undo for every bill: an earlier try's toast gives way to it
      if (toastId.current) dismiss(toastId.current);
      toastId.current = show({
        title: `Deleted ${billsAnd(doneNow.map((x) => x.bill))}`,
        body: `${doneNow.length === 1 ? "It's in the Audit log, where it can be restored." : "They're in the Audit log, where they can be restored."}${already ? ` ${plural(already, "bill")} ${already === 1 ? "was" : "were"} deleted already.` : ""}`,
        action: { label: "Undo", onClick: () => { void undoAll(doneNow); } },
      });
    } else if (!error && !doneNow.length && already) {
      show({ tone: "brand", title: "Deleted already", body: already === 1 ? "That bill was deleted already." : `Those ${already} bills were deleted already.` });
    }
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
