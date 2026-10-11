import { useState } from "react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useOpeningPreview, useSaveOpeningCredit } from "@/core/api/gstCredit";
import { problemOf, saveFailure } from "@/core/api/errors";
import type { OpeningCredit, OpeningInput } from "@/core/gst/creditTypes";
import { date, inr, monthLabel, paiseToDecimal, parseRupees, plural } from "@/core/format";
import { Button, Dialog, FailNote, Field, Input } from "@/core/ui";

type Props = { opening: OpeningCredit; businessId: number; firmName: string; firmGstin: string; open: boolean; onClose: () => void };
export function OpeningCreditDialog(props: Props) {
  const { can } = useAuth();
  // Each opening starts a new form; query refreshes never replace what the owner typed.
  return props.open && can("settings.edit") ? <OpeningForm key={props.businessId} {...props} /> : null;
}
function OpeningForm({ opening, businessId, firmName, firmGstin, onClose }: Props) {
  const { can } = useAuth();
  const [original] = useState(opening);
  const [raw, setRaw] = useState({ igst: paiseToDecimal(opening.igst), cgst: paiseToDecimal(opening.cgst), sgst: paiseToDecimal(opening.sgst) });
  const preview = useOpeningPreview();
  const save = useSaveOpeningCredit();
  const busy = preview.isPending || save.isPending;
  const p = save.error ? problemOf(save.error) : preview.error ? problemOf(preview.error) : null;
  const vals = { igst: parseRupees(raw.igst), cgst: parseRupees(raw.cgst), sgst: parseRupees(raw.sgst) };
  const fields = (["igst", "cgst", "sgst"] as const).map(h => ({ h, label: h.toUpperCase(), error:
    /^\s*-/.test(raw[h]) ? "A credit balance can't be below zero." : vals[h] === null || !Number.isSafeInteger(vals[h]) || !/\d/.test(raw[h]) ? `Type the ${h.toUpperCase()} balance, or 0.` : p?.fields?.[h] ?? "" }));
  const bad = fields.some(f => f.error);
  const changed = !original.typed || fields.some(({ h }) => vals[h] !== original[h]);
  const body = (): OpeningInput => ({ business: businessId, igst: vals.igst!, cgst: vals.cgst!, sgst: vals.sgst! });
  const effect = preview.data;
  const ask = () => { if (!busy && !bad && changed && can("settings.edit")) { save.reset(); preview.mutate(body()); } };
  const commit = () => { if (!busy && !bad && changed && effect && can("settings.edit")) save.mutate(body(), { onSuccess: onClose }); };
  return (
    <Dialog open onClose={busy ? () => {} : onClose} title="Credit carried into FY 2025-26"
      description={`${firmName} · ${firmGstin} · the balance of the credit ledger on ${date(original.as_of)}, when the app's records start`}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button loading={preview.isPending} disabled={busy || bad || !changed} onClick={ask}>{preview.isPending ? "Working out the change…" : "Preview the change"}</Button>
        <Button variant="primary" loading={save.isPending} disabled={busy || bad || !changed || !effect} onClick={commit}>{save.isPending ? "Saving…" : save.error ? "Try again" : "Save opening credit"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {fields.map(({ h, label, error }) => <Field key={h} label={`${label} credit`} htmlFor={`oc-${h}`} error={error}>
            <Input id={`oc-${h}`} prefix="₹" inputMode="decimal" autoComplete="off" value={raw[h]} disabled={busy}
              onChange={e => { setRaw(v => ({ ...v, [h]: e.target.value })); preview.reset(); save.reset(); }} />
          </Field>)}
        </div>
        <p className="text-sm text-muted">Take these from the GST portal's electronic credit ledger as it stood on {date(original.as_of)} (the closing balance of FY 2024-25). Was {inr(original.total)}; now {bad ? "—" : inr(vals.igst! + vals.cgst! + vals.sgst!)}.</p>
        {effect ? <div className="rounded-ctl border border-line bg-field px-4 py-3 flex flex-col gap-1.5 anim-rise" role="status">
          <p className="font-medium">What this changes</p>
          <p className="text-sm text-muted">A change here moves only the months before the first filed GSTR-3B.</p>
          <p className="text-sm text-fg2 tnum">Credit carried out of {monthLabel(effect.reaches, { long: true })}: {inr(effect.carried_out.from)} → <span className="text-fg font-semibold">{inr(effect.carried_out.to)}</span></p>
          <p className="text-sm text-fg2 tnum">Tax to pay in cash for {monthLabel(effect.cash.month, { long: true })}: {inr(effect.cash.from)} → <span className="text-fg font-semibold">{inr(effect.cash.to)}</span></p>
          {effect.filed_differ.count ? <p className="text-sm text-fg">Filed months keep their figures as filed; {plural(effect.filed_differ.count, "filed month")} ({effect.filed_differ.from && monthLabel(effect.filed_differ.from)}{effect.filed_differ.count > 1 && effect.filed_differ.to ? ` to ${monthLabel(effect.filed_differ.to)}` : ""}) would have come out differently. Check the balance with your CA.</p> : <p className="text-sm text-muted">No filed month comes out differently.</p>}
        </div> : null}
        <p className="text-sm text-muted">The change goes in the Audit log with the old and new figures.</p>
        <FailNote error={p ? saveFailure(p) : null} />
      </div>
    </Dialog>
  );
}
