import { useAuditRecord, type AuditEntry, type AuditRecord } from "@/core/api/audit";
import { problemOf, saveFailure } from "@/core/api/errors";
import { dateLong, inr } from "@/core/format";
import { dayOf, timeOf } from "@/core/sales/words";
import { BusyText, ConfirmDialog, FailNote, type DLRow } from "@/core/ui";

export function AuditActionConfirm({ entry, record, busy, error, onClose, onConfirm }: {
  entry: AuditEntry; record?: AuditRecord; busy: boolean; error: unknown; onClose: () => void; onConfirm: () => void;
}) {
  const query = useAuditRecord(entry, record);
  const action = entry.can!.kind;
  const purchase = entry.kind === "purchases";
  const bill = purchase || entry.kind === "sales";
  const name = entry.words.target;
  const b = query.data;
  const loading = bill && query.isPending;
  const gone = bill && query.isSuccess && !b;
  let title = "", label = "", words = "";
  let rows: DLRow[] = [];
  if (action === "revert") {
    title = `Put back ${name} as it was?`; label = "Revert";
    rows = entry.changes.map((change) => [change.field, `${change.to} → ${change.from}`]);
    words = "Only these fields go back. Bills already made keep what they were made with. The revert is recorded too, so it can be reverted in turn.";
  } else if (action === "restore") {
    title = purchase ? `Restore purchase ${name}?` : `Restore ${name}?`;
    label = purchase ? "Restore the purchase bill" : "Restore the bill";
    words = purchase ? "It goes back into Purchases as it was." : "It comes back with its own number, into Sales and the month's GST figures.";
  } else if (bill) {
    title = purchase ? `Undo adding purchase ${name}?` : `Undo making ${name}?`;
    label = purchase ? "Delete the purchase bill" : "Delete the bill";
    words = purchase ? "It moves to the bin, out of Purchases and its month's input tax credit. It can be restored here." : "The bill moves to the bin, out of Sales and its month's GST figures. Its number isn't reused. It can be restored here.";
  } else {
    title = `Undo adding ${name}?`; label = `Remove ${name}`;
    rows = [[entry.entity === "customer" ? "Customer" : entry.entity === "product" ? "Product" : "Firm", name], ["Added", `${dateLong(dayOf(entry.at))}, ${timeOf(entry.at)}`]];
    words = "It goes off the lists and the bill form. It can be restored here.";
  }
  if (bill && b) {
    rows = [[purchase ? "Purchase bill" : "Bill", b.number], ["Date", dateLong(b.date)], [purchase ? "Supplier" : "Customer", b.party], ["Total", inr(b.total)]];
    if (b.deletedAt) rows.push(["Deleted", `${dateLong(dayOf(b.deletedAt))}, ${timeOf(b.deletedAt)}${b.deletedBy ? ` by ${b.deletedBy.name}` : ""}`]);
  }
  return <ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title={title} confirmLabel={label} record={rows} tone={action === "undo" ? "danger" : "primary"}
    busy={busy} busyLabel={action === "restore" ? "Restoring…" : action === "revert" ? "Reverting…" : "Undoing…"} confirmDisabled={loading || query.isError || gone}
    extra={<><FailNote error={query.isError ? saveFailure(problemOf(query.error)) : null} onRetry={() => void query.refetch()} /><FailNote error={error ? saveFailure(problemOf(error)) : null} onRetry={onConfirm} busy={busy} /></>}>
    {loading ? <BusyText>Loading the bill…</BusyText> : null}
    {gone ? <p>That bill changed since this entry. Close this question and load the log again.</p> : null}
    {entry.can?.effect ? <p>{entry.can.effect}</p> : null}<p>{words}</p>
  </ConfirmDialog>;
}
