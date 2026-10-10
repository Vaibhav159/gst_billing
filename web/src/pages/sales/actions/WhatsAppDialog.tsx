import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Printer, Send } from "lucide-react";
import { useSaveCustomer } from "@/core/api/customers";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { mobileOf } from "@/core/sales/share";
import { Button, Checkbox, Dialog, Field, Input, useToast } from "@/core/ui";
import { useHeldValue } from "./held";
import { useSendBill, type SendableBill } from "./useSendBill";

/** Why the number didn't reach the customer's record, and what to do: the bill has gone already, so the dialog has closed. */
function notSaved(p: ApiProblem, name: string, mobile: string): string {
  if (p.kind === "offline") return `You're offline. Add +91 ${mobile} to ${name}'s record when the internet is back.`;
  if (p.kind === "unreachable" || p.kind === "server") return `The app couldn't get through. Add +91 ${mobile} to ${name}'s record in a minute.`;
  return p.message;
}

/** What the number box keeps, typed or pasted: digits, spaces and +, up to 12 digits (91 and the 10), so "+91 98290 41122" fits whole. */
function numberText(raw: string): string {
  let digits = 0;
  let out = "";
  for (const ch of raw.replace(/[^\d\s+]/g, "")) {
    if (/\d/.test(ch) && ++digits > 12) break;
    out += ch;
  }
  return out;
}

/**
 * "Send on WhatsApp" for a customer with no mobile on record (PROTO sales/parts.jsx:216-255): type the number for this
 * bill. The send carries it as `to`, kept on the bill only: a walk-in's is never kept. A customer's can be saved to their
 * record (customer.edit) once the send is recorded, through plan 1C's customer save, which refreshes the customers and
 * the bills (Ruling 1B-8); a landline already there is named, and replaced only when the person ticks Replace it. Once
 * WhatsApp has the bill the dialog closes, even if the record failed: its toast marks it again, never a second chat.
 */
export function WhatsAppDialog({ bill, onClose, onSent }: { bill: SendableBill | null; onClose: () => void; onSent?: () => void }) {
  const b = useHeldValue(bill);
  const { can } = useAuth();
  const navigate = useNavigate();
  const send = useSendBill();
  const saveCustomer = useSaveCustomer();
  const { show } = useToast();
  const [text, setText] = useState("");
  // null until the person ticks or unticks it: it starts ticked to save a number, unticked to replace one
  const [keep, setKeep] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // a fresh start each time it opens for a bill, not each time the list behind it redraws that bill
  const openFor = bill ? bill.id : null;
  useEffect(() => { if (openFor !== null) { setText(""); setErr(""); setKeep(null); setBusy(false); } }, [openFor]);
  if (!b) return null;
  const c = b.customer;
  const walkin = c.type === "walkin";
  // a number on record that isn't a mobile (a landline): WhatsApp can't take it
  const onRecord = c.mobile_number.trim();
  const canKeep = !walkin && can("customer.edit");
  const keepIt = keep ?? !onRecord;
  const go = () => {
    if (busy) return;
    const to = mobileOf(text);
    if (!to) { setErr("Type a 10-digit mobile number, like 98290 41122."); document.getElementById("wa-no")?.focus(); return; }
    const saveIt = canKeep && keepIt;
    let opened = false;
    setBusy(true);
    // the chat opens now, within this press; the number goes to the customer's record once the send is recorded, at once
    // or later by the toast's Mark as sent
    void send(b, {
      to,
      onOpened: () => { opened = true; },
      onRecorded: saveIt ? () => {
        saveCustomer.mutateAsync({ id: c.id, body: { mobile_number: to.replace(/\s/g, "") } }).catch((e: unknown) => {
          show({ tone: "neg", title: `Not saved to ${c.name}'s record`, body: notSaved(problemOf(e), c.name, to) });
        });
      } : undefined,
    }).then((ok) => {
      setBusy(false);
      // nothing opened (offline, the shop's message still loading): the number stays here to send again
      if (!ok && !opened) return;
      onClose();
      if (ok) onSent?.();
    });
  };
  return (
    <Dialog open={Boolean(bill)} onClose={busy ? () => {} : onClose} title={`Send ${b.invoice_number} on WhatsApp`} size="sm"
      description={walkin ? "A walk-in has no number on record. Type theirs to send the bill to their WhatsApp; it isn't kept as a customer."
        : onRecord ? `${c.name} has ${onRecord} on record, which isn't a mobile number.` : `${c.name} has no mobile number on record.`}
      footer={<>
        <Button onClick={() => { onClose(); navigate(`/sales/${b.id}/print`); }} disabled={busy} icon={Printer}>Print instead</Button>
        <Button variant="primary" icon={Send} loading={busy} onClick={go}>{busy ? "Sending…" : "Send"}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Field label="WhatsApp number" htmlFor="wa-no" error={err} hint="10 digits. The bill opens in this number's chat.">
          <Input id="wa-no" type="tel" inputMode="tel" autoComplete="off" prefix="+91" value={text} invalid={Boolean(err)} data-autofocus=""
            onChange={(e) => { setText(numberText(e.target.value)); setErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} />
        </Field>
        {canKeep ? <Checkbox label={onRecord ? `Replace it on ${c.name}'s record` : `Save it to ${c.name}'s record`} description="Next time, Send goes straight to this chat." checked={keepIt} onChange={setKeep} /> : null}
      </div>
    </Dialog>
  );
}
