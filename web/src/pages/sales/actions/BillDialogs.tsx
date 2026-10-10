// Cancel, delete, renumber, move to another firm and the e-way bill (PROTO sales/parts.jsx:413-641), with the WhatsApp
// number from Task 5. One host per page: useBillDialogs().open(kind, bill), and render its element once.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useBillDetail, useCancelBill, useCheckNumber, useDeleteBill, useMoveBill, useNextNumber, useRenumberBill, useRestoreBill, useSaveEway } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, inr, monthLabel } from "@/core/format";
import { markFresh } from "@/core/sales/fresh";
import { numberHint, numberShapeProblem, storedFor } from "@/core/sales/numbers";
import type { BillDetail, BillRow, Eway, TransportMode, VehicleType } from "@/core/sales/types";
import { ewayNumberText, failText, restoreFailure, type FailText } from "@/core/sales/words";
import { useFirms } from "@/core/scope";
import { Button, Chip, ConfirmDialog, Dialog, FailNote, Field, Input, ListSkeleton, QueryView, Select, Textarea, useToast } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { useHeldValue } from "./held";
import { recordRows } from "./recordRows";
import { useSendBill } from "./useSendBill";
import { WhatsAppDialog } from "./WhatsAppDialog";

export type DialogKind = "cancel" | "delete" | "renumber" | "move" | "eway" | "whatsapp";
export type DialogBill = BillRow | BillDetail;
export type OpenDialog = (kind: DialogKind, bill: DialogBill) => void;

/** { open(kind, bill), element } for one page; onDeleted runs after a delete (the bill page goes back to the list). */
export function useBillDialogs({ onDeleted }: { onDeleted?: (b: DialogBill) => void } = {}): { open: OpenDialog; element: ReactNode } {
  const [st, setSt] = useState<{ kind: DialogKind; bill: DialogBill } | null>(null);
  const open = useCallback<OpenDialog>((kind, bill) => setSt({ kind, bill }), []);
  const close = useCallback(() => setSt(null), []);
  const of = (k: DialogKind) => (st?.kind === k ? st.bill : null);
  const element = (
    <>
      <CancelDialog bill={of("cancel")} onClose={close} />
      <DeleteDialog bill={of("delete")} onClose={close} onDeleted={onDeleted} />
      <RenumberDialog bill={of("renumber")} onClose={close} onNeedNumber={(b) => setSt({ kind: "whatsapp", bill: b })} />
      <MoveDialog bill={of("move")} onClose={close} />
      <EwayDialog bill={of("eway")} onClose={close} />
      <WhatsAppDialog bill={of("whatsapp")} onClose={close} />
    </>
  );
  return { open, element };
}

const CANCEL_REASONS = ["Wrong weight or rate", "Customer returned it", "Wrong customer"];
function CancelDialog({ bill, onClose }: { bill: DialogBill | null; onClose: () => void }) {
  const b = useHeldValue(bill);
  const cancel = useCancelBill();
  const { show } = useToast();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [fail, setFail] = useState<FailText | null>(null);
  useEffect(() => { if (bill) { setReason(""); setErr(""); setFail(null); } }, [bill]);
  if (!b) return null;
  const month = monthLabel(b.invoice_date.slice(0, 7), { long: true });
  const confirm = () => {
    if (!reason.trim()) { setErr("Say why in a few words. It goes into the audit log."); document.getElementById("cancel-reason")?.focus(); return; }
    cancel.mutate({ id: b.id, reason: reason.trim() }, {
      onSuccess: () => {
        show({ title: `Cancelled ${b.invoice_number}`, body: `It stays in ${month}'s GSTR-1 as cancelled, with its number. Make it again from the bill if it was a mistake.` });
        onClose();
      },
      onError: (e) => {
        const p = problemOf(e);
        if (p.fields?.reason) { setErr(p.fields.reason); return; }
        setFail(failText(p, "cancelled"));
      },
    });
  };
  return (
    <ConfirmDialog tone="danger" open={Boolean(bill)} onClose={onClose} onConfirm={confirm} busy={cancel.isPending} title={`Cancel bill ${b.invoice_number}?`}
      confirmLabel={fail ? "Try again" : "Cancel bill"} busyLabel="Cancelling…" cancelLabel="Keep the bill" record={recordRows(b)}
      extra={(
        <>
          <Field label="Why is it cancelled?" htmlFor="cancel-reason" error={err} hint="For the audit log and the cancelled bill.">
            <Textarea id="cancel-reason" rows={2} className="min-h-[64px]" maxLength={255} value={reason} invalid={Boolean(err)}
              onChange={(e) => { setReason(e.target.value); if (err) setErr(""); }} />
          </Field>
          <div className="flex flex-wrap gap-2 -mt-1" role="group" aria-label="Common reasons">
            {CANCEL_REASONS.map((r) => <Chip key={r} selected={reason === r} onClick={() => { setReason(r); setErr(""); }}>{r}</Chip>)}
          </div>
          <FailNote error={fail} />
        </>
      )}>
      <p>It stays in {month}&apos;s GSTR-1 as a cancelled bill with its number, so the series has no gap. Its amount leaves Sales, the dashboard and the GST figures. Cancelling can&apos;t be undone; the bill can be made again with a new number.</p>
      <p className="text-sm text-muted">Cancel a bill the customer already has. A bill made by mistake can be deleted instead.</p>
    </ConfirmDialog>
  );
}

const DELETE_REASONS = ["Entered twice", "Wrong firm", "Test bill"];
function DeleteDialog({ bill, onClose, onDeleted }: { bill: DialogBill | null; onClose: () => void; onDeleted?: (b: DialogBill) => void }) {
  const b = useHeldValue(bill);
  const remove = useDeleteBill();
  const restore = useRestoreBill();
  const { show } = useToast();
  const [reason, setReason] = useState("");
  const [fail, setFail] = useState<FailText | null>(null);
  useEffect(() => { if (bill) { setReason(""); setFail(null); } }, [bill]);
  if (!b) return null;
  const month = monthLabel(b.invoice_date.slice(0, 7), { long: true, year: false });
  const confirm = () => remove.mutate({ id: b.id, reason: reason.trim() }, {
    onSuccess: (bin) => {
      show({
        title: `Deleted ${b.invoice_number}`, body: "It's in the Audit log, where it can be restored.",
        // Undo (or Ctrl Z) restores it from the bin (contract §3.2). The toast outlives this dialog (the bill page goes
        // back to the list): mutateAsync's answer still comes
        action: { label: "Undo", onClick: () => {
          restore.mutateAsync(bin.id).then(
            () => { markFresh(b.id); show({ title: `Restored ${b.invoice_number}`, body: "Back in Sales and in the month's GST figures." }); },
            (e: unknown) => show(restoreFailure(problemOf(e), b.invoice_number)),
          );
        } },
      });
      onClose();
      onDeleted?.(b);
    },
    onError: (e) => setFail(failText(problemOf(e), "deleted")),
  });
  return (
    <ConfirmDialog tone="danger" open={Boolean(bill)} onClose={onClose} onConfirm={confirm} busy={remove.isPending} title={`Delete bill ${b.invoice_number}?`}
      confirmLabel={fail ? "Try again" : "Delete bill"} busyLabel="Deleting…" cancelLabel="Keep the bill" record={recordRows(b)}
      extra={(
        <>
          <Field label="Why delete it?" htmlFor="delete-reason" hint="Optional. Shown in the Audit log and on the deleted bill.">
            <Input id="delete-reason" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2 -mt-1" role="group" aria-label="Common reasons">
            {DELETE_REASONS.map((r) => <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}
          </div>
          <FailNote error={fail} />
        </>
      )}>
      <p className="caps">What deleting does</p>
      <ul className="list-disc pl-5 flex flex-col gap-1.5">
        <li>Removes it from Sales, the dashboard and {month}&apos;s GST figures.</li>
        <li>The number {b.invoice_number} stays used, so no other bill gets it.</li>
        <li>You can restore it from More, then Audit log.</li>
      </ul>
    </ConfirmDialog>
  );
}

/**
 * The number field Renumber and Move share (Ruling 1B-9: one helper). It starts on the firm's next free number until the
 * person types. Once typing pauses (300 ms) the server checks what's typed (check-number); the field says what the number
 * is stored as: the check's answer, else storedFor's reading of the firm's format. business null: it asks nothing.
 */
function useNumberField(business: number | null, invoiceDate: string, excludeId: number | undefined) {
  const next = useNextNumber(business, invoiceDate);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState(false);
  const [err, setErr] = useState("");
  // restart() moves this on, so the next free number fills the field again even when its answer is the one already here
  const [round, setRound] = useState(0);
  useEffect(() => { if (!typed && next.data) setText(next.data.invoice_number); }, [round, typed, next.data]);
  const t = text.trim();
  const typedNow = useDebounced(t, 300);
  const check = useCheckNumber(business !== null && typedNow ? { business, invoice_date: invoiceDate, invoice_number: typedNow, exclude_id: excludeId } : null);
  const nx = next.data;
  // the check's answer counts only for what's in the field now
  const known = typedNow === t ? check.data ?? null : null;
  const stored = known?.invoice_number || storedFor(nx, text);
  return {
    text, err, setErr, next: nx, known, stored,
    /** "Saved as KGH/2026-27/34. " when what's typed is stored otherwise; else "". */
    savedAs: t && stored !== t ? `Saved as ${stored}. ` : "",
    /** The person typed. */
    type(v: string) { setText(v); setTyped(true); setErr(""); },
    /** A fresh start (the dialog opened, another firm picked): the next free number, no error. */
    restart() { setText(""); setTyped(false); setErr(""); setRound((r) => r + 1); },
    /** True, with the words at the field (focused), when the number can't be used: its shape, or the check found it in use. */
    blocked(fieldId: string): boolean {
      const problem = numberShapeProblem(text, { next: nx?.invoice_number ?? "", stored }) || (known?.code ? known.problem : "");
      if (!problem) return false;
      setErr(problem);
      document.getElementById(fieldId)?.focus();
      return true;
    },
    /** True, with the server's words at the field, for a refusal about the number; anything else is the dialog's to say. */
    refused(p: ApiProblem): boolean {
      if (!p.fields?.invoice_number && p.code !== "number_taken" && p.code !== "number_deleted") return false;
      setErr(p.fields?.invoice_number ?? p.message);
      return true;
    },
  };
}

function RenumberDialog({ bill, onClose, onNeedNumber }: { bill: DialogBill | null; onClose: () => void; onNeedNumber: (b: DialogBill) => void }) {
  const b = useHeldValue(bill);
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const send = useSendBill();
  const renumber = useRenumberBill();
  const detail = useBillDetail(bill ? bill.id : null);
  const no = useNumberField(bill ? bill.business : null, bill?.invoice_date ?? "", bill?.id);
  const [fail, setFail] = useState<FailText | null>(null);
  useEffect(() => { if (bill) { no.restart(); setFail(null); } }, [bill]);
  if (!b) return null;
  const nx = no.next;
  const other = detail.data?.duplicates[0];
  const who = b.customer.type === "walkin" ? "the customer" : b.customer.name;
  const month = monthLabel(b.invoice_date.slice(0, 7), { long: true, year: false });
  const hint = `${no.savedAs}${no.known?.note || (nx ? numberHint({ next: nx.invoice_number, firm: b.business_name, fy: b.fy, full: nx.full_number }) : "")}`;
  const confirm = () => {
    if (!can("bill.edit")) { no.setErr(whyNot("bill.edit")); return; }
    if (no.blocked("renumber-no")) return;
    renumber.mutate({ id: b.id, invoice_number: no.text.trim() }, {
      onSuccess: (r) => {
        const renamed = { ...b, invoice_number: r.invoice_number };
        show({
          title: `${r.previous} is now ${r.invoice_number}`,
          body: other ? `${month}'s GSTR-1 for ${b.business_name} no longer has a duplicate. Send ${who} the corrected bill.` : `Written to the audit log. Send ${who} the corrected bill.`,
          action: { label: "Send", onClick: () => { void send(renamed, { onNeedNumber: () => onNeedNumber(renamed) }); } },
        });
        onClose();
      },
      onError: (e) => { const p = problemOf(e); if (!no.refused(p)) setFail(failText(p, "renumbered")); },
    });
  };
  return (
    <Dialog open={Boolean(bill)} onClose={renumber.isPending ? () => {} : onClose} title={`Give ${b.invoice_number} a new number`} size="sm"
      description={other ? `This bill (${b.customer.name}, ${date(b.invoice_date)}) shares its number with ${other.customer_name}'s bill of ${date(other.invoice_date)}.` : `${b.customer.name} · ${date(b.invoice_date)} · ${inr(b.total_amount)}`}
      footer={<>
        <Button onClick={onClose} disabled={renumber.isPending}>Keep it for now</Button>
        <Button variant="primary" loading={renumber.isPending} onClick={confirm}>{renumber.isPending ? "Renumbering…" : fail ? "Try again" : "Renumber bill"}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Field label="New number" htmlFor="renumber-no" error={no.err} hint={hint}>
          <Input id="renumber-no" maxLength={16} value={no.text} invalid={Boolean(no.err)} inputClassName="tnum" autoComplete="off" spellCheck={false}
            onChange={(e) => no.type(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }} />
        </Field>
        <p className="text-sm text-fg2">The bill keeps its date, customer and amounts. The change is written to the audit log.</p>
        <FailNote error={fail} />
      </div>
    </Dialog>
  );
}

function MoveDialog({ bill, onClose }: { bill: DialogBill | null; onClose: () => void }) {
  const b = useHeldValue(bill);
  const { can, whyNot } = useAuth();
  const { firms, loading, error } = useFirms();
  const { show } = useToast();
  const move = useMoveBill();
  const others = firms.filter((f) => f.id !== b?.business);
  const [firmId, setFirmId] = useState<number | null>(null);
  const target = firmId ?? others[0]?.id ?? null;
  const no = useNumberField(bill ? target : null, bill?.invoice_date ?? "", bill?.id);
  const [fail, setFail] = useState<FailText | null>(null);
  useEffect(() => { if (bill) { setFirmId(null); no.restart(); setFail(null); } }, [bill]);
  if (!b) return null;
  const firm = firms.find((f) => f.id === target);
  const t = no.text.trim();
  const confirm = () => {
    if (!can("bill.edit")) { no.setErr(whyNot("bill.edit")); return; }
    if (target === null || !firm) return;
    if (no.blocked("move-no")) return;
    move.mutate({ id: b.id, business: target, invoice_number: t }, {
      onSuccess: (r) => {
        show({ title: `${r.previous.invoice_number} is now ${r.invoice_number}`, body: `Moved to ${firm.name}. ${r.previous.invoice_number} is left unused; the tax follows ${firm.name}'s state and the total stays the same.` });
        onClose();
      },
      onError: (e) => { const p = problemOf(e); if (!no.refused(p)) setFail(failText(p, "moved")); },
    });
  };
  // the edit form's words for a move (PROTO sales/BillForm.jsx:197), and the check's note
  const hint = firm && t ? `Moves the bill to ${firm.name} as ${no.stored}. ${b.invoice_number} is left unused.${no.known?.note ? ` ${no.known.note}` : ""}` : "";
  return (
    <Dialog open={Boolean(bill)} onClose={move.isPending ? () => {} : onClose} title={`Move ${b.invoice_number} to another firm`} size="sm"
      description={`${b.customer.name} · ${date(b.invoice_date)} · ${inr(b.total_amount)}`}
      footer={<>
        <Button onClick={onClose} disabled={move.isPending}>Keep it here</Button>
        <Button variant="primary" loading={move.isPending} disabled={!firm} onClick={confirm}>{move.isPending ? "Moving…" : fail ? "Try again" : "Move bill"}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        {others.length ? (
          <Field label="Firm" htmlFor="move-firm">
            <Select id="move-firm" value={String(target ?? "")} onChange={(e) => { setFirmId(Number(e.target.value)); no.restart(); setFail(null); }}
              options={others.map((f) => ({ value: String(f.id), label: f.name }))} />
          </Field>
        ) : loading ? null : <p className="text-fg2">{error ? "The list of firms didn't load. Close this and try again in a minute." : "There's no other firm to move it to."}</p>}
        <Field label="Number in that firm's series" htmlFor="move-no" error={no.err} hint={hint}>
          <Input id="move-no" maxLength={16} value={no.text} invalid={Boolean(no.err)} inputClassName="tnum" autoComplete="off" spellCheck={false}
            onChange={(e) => no.type(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }} />
        </Field>
        <p className="text-sm text-fg2">The bill keeps its date, customer and items; its tax heads follow the new firm&apos;s state. The audit log records the change.</p>
        <FailNote error={fail} />
      </div>
    </Dialog>
  );
}

const MODES: TransportMode[] = ["Road", "Rail", "Air", "Ship"];
type EwayForm = { number: string; mode: TransportMode; transporter: string; transporterGstin: string; vehicle: string; vehicleType: VehicleType; distance: string };
type EwayErrors = Partial<Record<"number" | "transporterGstin" | "vehicle" | "distance", string>>;
const EMPTY_EWAY: EwayForm = { number: "", mode: "Road", transporter: "", transporterGstin: "", vehicle: "", vehicleType: "Regular", distance: "" };
/** What's stored, as the form shows it: the e-way bill's number in fours, as it's read out. */
function ewayForm(e: Eway): EwayForm {
  return {
    number: ewayNumberText(e.eway_bill_number), mode: e.transport_mode, transporter: e.transporter_name, transporterGstin: e.transporter_gstin,
    vehicle: e.vehicle_number, vehicleType: e.vehicle_type, distance: e.distance_km ? String(e.distance_km) : "",
  };
}

function EwayDialog({ bill, onClose }: { bill: DialogBill | null; onClose: () => void }) {
  const b = useHeldValue(bill);
  const { isPhone } = useView();
  const { show } = useToast();
  const save = useSaveEway();
  const detail = useBillDetail(bill ? bill.id : null);
  const [v, setV] = useState<EwayForm | null>(null);
  const [err, setErr] = useState<EwayErrors>({});
  const [fail, setFail] = useState<FailText | null>(null);
  useEffect(() => { if (bill) { setV(null); setErr({}); setFail(null); } }, [bill]);
  if (!b) return null;
  // what's stored fills the form. The bill page's bill carries it; a list's row doesn't, so the form waits for the bill:
  // a save sends every field, and blanks typed before the stored details showed would replace them
  const stored = detail.data?.eway ?? ("eway" in b ? b.eway : undefined);
  const f = v ?? (stored ? ewayForm(stored) : EMPTY_EWAY);
  const set = <K extends keyof EwayForm>(k: K) => (x: EwayForm[K]) => { setV({ ...f, [k]: x }); setErr((e) => ({ ...e, [k]: "" })); };
  const submit = () => {
    if (!stored) return;
    const e: EwayErrors = {};
    const digits = f.number.replace(/\D/g, "");
    if (digits && digits.length !== 12) e.number = `An e-way bill number has 12 digits; this has ${digits.length}.`;
    const g = f.transporterGstin.trim().toUpperCase();
    if (g && g.length !== 15) e.transporterGstin = "A transporter's GSTIN or transporter ID has 15 characters.";
    const veh = f.vehicle.replace(/[\s-]/g, "").toUpperCase();
    if (veh && !/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(veh)) e.vehicle = "Type it like RJ14AB1234 (state, district, letters, 4 digits).";
    if (f.mode === "Road" && digits && !veh) e.vehicle = "By road, the e-way bill needs the vehicle number. Add it here, or later on the portal (Part B).";
    const km = f.distance ? Number(f.distance) : null;
    if (km !== null && (!Number.isInteger(km) || km < 1 || km > 4000)) e.distance = "Type the distance in whole kilometres, 1 to 4,000.";
    setErr(e);
    const first = (["number", "transporterGstin", "vehicle", "distance"] as const).find((k) => e[k]);
    if (first) { document.getElementById(`ew-${first}`)?.focus(); return; }
    save.mutate({ id: b.id, eway: { eway_bill_number: digits, transport_mode: f.mode, transporter_name: f.transporter.trim(), transporter_gstin: g, vehicle_number: veh, vehicle_type: f.vehicleType, distance_km: km } }, {
      onSuccess: () => {
        show({ title: digits ? `E-way bill saved on ${b.invoice_number}` : `Transport details saved on ${b.invoice_number}`, body: "They print in the bill's dispatch boxes." });
        onClose();
      },
      onError: (x) => {
        const p = problemOf(x);
        const fe = p.fields ?? {};
        const mapped: EwayErrors = { number: fe.eway_bill_number, transporterGstin: fe.transporter_gstin, vehicle: fe.vehicle_number, distance: fe.distance_km };
        if (Object.values(mapped).some(Boolean)) { setErr(mapped); return; }
        setFail(failText(p, "saved"));
      },
    });
  };
  return (
    <Dialog open={Boolean(bill)} onClose={save.isPending ? () => {} : onClose} title={`E-way bill for ${b.invoice_number}`} size="md"
      description={`Made on the GST e-way bill portal; record it here so it prints on the bill. ${b.customer.name} · ${inr(b.total_amount)}`}
      footer={<>
        <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!stored} onClick={submit}>{save.isPending ? "Saving…" : fail ? "Try again" : "Save"}</Button>
      </>}>
      {stored ? (
        <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2")}>
          <Field label="E-way bill number" htmlFor="ew-number" error={err.number} hint="12 digits, from the portal">
            <Input id="ew-number" inputMode="numeric" value={f.number} invalid={Boolean(err.number)} inputClassName="tnum" onChange={(e) => set("number")(e.target.value.replace(/[^\d ]/g, "").slice(0, 14))} />
          </Field>
          <Field label="Mode" htmlFor="ew-mode">
            <Select id="ew-mode" value={f.mode} options={MODES} onChange={(e) => set("mode")(e.target.value as TransportMode)} />
          </Field>
          <Field label="Transporter" htmlFor="ew-transporter" hint="The transport company's name">
            <Input id="ew-transporter" value={f.transporter} onChange={(e) => set("transporter")(e.target.value)} />
          </Field>
          <Field label="Transporter GSTIN or ID" htmlFor="ew-transporterGstin" error={err.transporterGstin}>
            <Input id="ew-transporterGstin" value={f.transporterGstin} maxLength={15} invalid={Boolean(err.transporterGstin)} inputClassName="uppercase tnum"
              onChange={(e) => set("transporterGstin")(e.target.value.toUpperCase().replace(/\s/g, ""))} />
          </Field>
          <Field label="Vehicle number" htmlFor="ew-vehicle" error={err.vehicle} hint="Like RJ14AB1234">
            <Input id="ew-vehicle" value={f.vehicle} maxLength={13} invalid={Boolean(err.vehicle)} inputClassName="uppercase tnum" onChange={(e) => set("vehicle")(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Vehicle type" htmlFor="ew-vehicleType">
            <Select id="ew-vehicleType" value={f.vehicleType} options={[{ value: "Regular", label: "Regular" }, { value: "ODC", label: "Over dimensional cargo (ODC)" }]}
              onChange={(e) => set("vehicleType")(e.target.value as VehicleType)} />
          </Field>
          <Field label="Distance" htmlFor="ew-distance" error={err.distance} hint="Kilometres, as on the portal">
            <Input id="ew-distance" inputMode="numeric" value={f.distance} suffix="km" invalid={Boolean(err.distance)} inputClassName="tnum" onChange={(e) => set("distance")(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Field>
        </div>
      ) : (
        <QueryView query={detail} what="the bill's e-way details" skeleton={<ListSkeleton rows={3} what="the bill's e-way details" />}>{() => null}</QueryView>
      )}
      <p className="text-sm text-muted mt-4">Jewellery and precious metals (HSN 71) don&apos;t need an e-way bill. Other goods over ₹50,000 that travel do.</p>
      <FailNote error={fail} className="mt-3" />
    </Dialog>
  );
}
