import { useState } from "react";
import { AlertTriangle, Camera, Lock, Trash2 } from "lucide-react";
import { useDeletePurchases, useRestorePurchase } from "@/core/api/purchases";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, inr, monthLabel, plural } from "@/core/format";
import type { PurchaseRow } from "@/core/purchases/types";
import { Badge, ConfirmDialog, Field, Input, Money, useToast } from "@/core/ui";

export function purchaseLock(p: PurchaseRow, action: "changed" | "deleted" = "changed"): string {
  const month = monthLabel(p.credit.month, { long: true });
  return `${month}'s GSTR-3B is filed for ${p.business_name}, with this bill's credit in it, so it can't be ${action}. Have the owner unlock ${month} in GST returns first.`;
}

export function PurchaseBadges({ p }: { p: PurchaseRow }) {
  return <span className="flex flex-wrap gap-1.5">
    {p.needs_review ? <Badge tone="brand" icon={AlertTriangle}>Needs a check</Badge> : null}
    {p.has_files ? <Badge icon={Camera}>From a photo</Badge> : null}
    {p.credit.lapsed ? <Badge tone="neg">Credit lapsed</Badge> : !p.credit.eligible ? <Badge>Credit not allowed</Badge> : p.credit.late ? <Badge tone="file">Credit in {monthLabel(p.credit.month)}</Badge> : null}
    {p.locked ? <Badge tone="file" icon={Lock}>GSTR-3B filed</Badge> : null}
    {p.checks.includes("duplicate") ? <Badge tone="neg">Same bill twice</Badge> : null}
    {p.checks.includes("no_lines") ? <Badge tone="neg">No items</Badge> : null}
    {p.checks.includes("no_hsn") ? <Badge tone="neg">No HSN code</Badge> : null}
  </span>;
}

/** Sequential writes stop at the first refusal. A retry only sends the remaining ids. */
export function DeletePurchases({ bills, onClose, onDone }: { bills: PurchaseRow[]; onClose(): void; onDone(): void }) {
  const { can } = useAuth();
  const remove = useDeletePurchases();
  const restore = useRestorePurchase();
  const { show } = useToast();
  const [reason, setReason] = useState("");
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const writable = bills.filter((p) => !p.locked && !gone.has(p.id));
  const closed = bills.filter((p) => p.locked);
  const total = writable.reduce((n, p) => n + p.credit.claimed, 0);
  const confirm = async () => {
    setError("");
    const bins: { billId: number; binId: number }[] = [];
    const removed: number[] = [];
    try {
      await remove.mutateAsync({ ids: writable.map((p) => p.id), reason: reason.trim(), onEach: (id, bin) => { removed.push(id); if (bin) bins.push({ billId: id, binId: bin.id }); } });
      onDone();
      onClose();
    } catch (e) {
      setError(`${removed.length ? `Stopped after ${removed.length} of ${writable.length}. ` : "Nothing was deleted. "}${problemOf(e).message}`);
    } finally {
      setGone((before) => new Set([...before, ...removed]));
      if (bins.length) show({ title: `Deleted ${plural(bins.length, "purchase bill")}`, body: "They're in the Audit log, where they can be restored.", action: { label: "Undo", onClick: () => { void (async () => {
        let returned = 0;
        try { for (const bin of bins) { await restore.mutateAsync(bin.binId); returned++; setGone((before) => new Set([...before].filter((id) => id !== bin.billId))); } show({ title: `Restored ${plural(returned, "purchase bill")}`, body: "Back in Purchases and in the credit figures." }); }
        catch (e) { show({ tone: "neg", title: "Not all purchases were restored", body: `${returned} came back. ${problemOf(e).message}` }); }
      })(); } } });
    }
  };
  return <ConfirmDialog open onClose={onClose} onConfirm={() => void confirm()} title={`Delete ${plural(writable.length, "purchase bill")}?`} tone="danger" busy={remove.isPending} busyLabel="Deleting…" confirmDisabled={!can("purchase.delete") || !writable.length} confirmLabel={error ? "Try again" : `Delete ${plural(writable.length, "purchase bill")}`} cancelLabel="Keep them"
    extra={<><Field label="Why delete them?" htmlFor="purchase-delete-reason" hint="Optional. Shown in the Audit log."><Input id="purchase-delete-reason" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} /></Field>{error ? <p role="alert" className="text-neg">{error}</p> : null}</>}>
    <ul className="rounded-ctl border border-line bg-field divide-y divide-rule max-h-[220px] overflow-y-auto" aria-label="Purchases to delete">{writable.map((p) => <li key={p.id} className="p-3 text-sm"><b>{p.invoice_number}</b> · {p.supplier.name}<span className="block text-muted">{p.business_name} · {date(p.invoice_date)} · {inr(p.total_amount)}</span></li>)}</ul>
    {closed.map((p) => <p key={p.id} className="text-file">{purchaseLock(p, "deleted")}</p>)}
    <p>They leave Purchases and the input tax credit goes down by <Money value={total} />. Each can be restored from the Audit log.</p>
    <p className="flex gap-2"><Trash2 size={16} aria-hidden="true" />Their photos stay with the deleted bills.</p>
  </ConfirmDialog>;
}
