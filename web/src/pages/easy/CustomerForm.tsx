import { useEffect, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { customerSaveErrors, useSaveCustomer, type Customer, type CustomerBody } from "@/core/api/customers";
import { saveFailure } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { checkGstin, cleanGstin, formatMobile, mobileDigits, mobileProblem, stateCodeOf, stateTitle } from "@/core/ids";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { isInterState } from "@/core/sales/pos";
import { Banner, Button, Field, Input, Textarea } from "@/core/ui";
import { firstName, markSaved, useOnFile } from "@/pages/customers/lib";
import type { CustomerFirm, CustomerFrame } from "./CustomerParts";

type Values = { name: string; phone: string; gstin: string; city: string; address: string };
const fields = ["name", "phone", "city", "gstin", "address"] as const;
type FieldName = typeof fields[number];
const ids: Record<FieldName, string> = { name: "easy-c-name", phone: "easy-c-phone", city: "easy-c-city", gstin: "easy-c-gst", address: "easy-c-address" };
function Guard({ dirty, existing }: { dirty: boolean; existing: boolean }) {
  return useUnsavedGuard(dirty, existing ? "Your changes to this customer aren't saved. Leave and lose them?" : "This customer isn't saved yet. Leave and lose what you typed?");
}

export type CustomerFormProps = {
  Frame: CustomerFrame; firm: CustomerFirm; firms: readonly CustomerFirm[]; existing?: Customer | null;
  initialName?: string; initialPhone?: string; subtitle?: string; forBill?: boolean;
  onSaved(customer: Customer): void;
  /** 6C sets guard=false and includes onDirty in its one layout blocker. Standalone pages keep their own. */
  guard?: boolean; onDirty?(dirty: boolean): void;
};
/** Shared by /e/customers/new, /e/customers/:id/edit and 6C's /e/new/customer. */
export function CustomerForm({ Frame, firm, firms, existing = null, initialName = "", initialPhone = "", subtitle, forBill = false, onSaved, guard = true, onDirty }: CustomerFormProps) {
  const { can, whyNot } = useAuth();
  const save = useSaveCustomer();
  const [initial] = useState<Values>(() => existing ? { name: existing.name, phone: existing.mobile_number, gstin: existing.gst_number, city: existing.city, address: existing.address }
    : { name: initialName, phone: initialPhone, gstin: "", city: firm.city, address: "" });
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [gstChecked, setGstChecked] = useState(Boolean(existing));
  const [failure, setFailure] = useState<ReturnType<typeof saveFailure> | null>(null);
  const [retry, setRetry] = useState(false);
  const [done, setDone] = useState<Customer | null>(null);
  const dirty = !done && fields.some((key) => value[key] !== initial[key]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  // The guard sees clean state before the caller navigates. No force navigation bypasses an unsaved form.
  useEffect(() => { if (done) onSaved(done); }, [done, onSaved]);
  const changed = (key: FieldName) => !existing || value[key] !== initial[key];
  const { samePhone, sameGstin } = useOnFile(changed("phone") ? value.phone : "", changed("gstin") ? value.gstin : "", existing?.id);
  const gst = checkGstin(value.gstin);
  const gstState = gst.status === "valid" || gst.status === "check" ? gst.state : "";
  const gstProblem = gst.status === "short" || gst.status === "invalid" ? gst.problem : "";
  const set = (key: FieldName, text: string) => {
    setValue((v) => ({ ...v, [key]: text }));
    setErrors((e) => ({ ...e, [key]: "" })); setFailure(null);
  };
  const showErrors = (next: Partial<Record<FieldName, string>>) => {
    flushSync(() => setErrors(next));
    const first = fields.find((key) => next[key]);
    if (first) document.getElementById(ids[first])?.focus();
    return Boolean(first);
  };
  const finish = (customer: Customer) => { markSaved("easy-customer", customer.id); setDone(customer); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending || done || !can("customer.edit")) return;
    setGstChecked(true); setFailure(null);
    const next: Partial<Record<FieldName, string>> = {};
    if (!value.name.trim()) next.name = "Type the customer's name, as it should appear on the bill.";
    if (changed("phone")) {
      const problem = mobileDigits(value.phone) ? mobileProblem(value.phone) : "Type the customer's mobile number. It's how the bill reaches them on WhatsApp.";
      if (problem) next.phone = problem;
      else if (samePhone) next.phone = `This number is already saved for ${samePhone.name}.`;
    }
    if (changed("gstin")) {
      if (gstProblem) next.gstin = gstProblem;
      else if (sameGstin) next.gstin = `${sameGstin.name} already has this GSTIN.`;
    }
    if (showErrors(next)) return;
    const values = { name: value.name.trim(), mobile_number: mobileDigits(value.phone), city: value.city.trim(), gst_number: value.gstin.trim().toUpperCase(), address: value.address.trim() };
    const body: Partial<CustomerBody> = {};
    // Never rewrite PAN, email, usual firms or legacy fields a person did not edit. Empty strings clear these
    // non-unique nullable text fields in the existing serializer; the shared mutation accepts string values.
    const wire = { name: "name", phone: "mobile_number", city: "city", gstin: "gst_number", address: "address" } as const;
    for (const key of fields) if (changed(key)) body[wire[key]] = values[wire[key]];
    if (!existing || changed("gstin")) {
      if (!existing) body.state_name = firm.state;
      if (gstState) body.state_name = gstState;
      body.customer_type = "";
    }
    if (!existing) body.businesses = [firm.id];
    if (existing && !Object.keys(body).length) { setDone(existing); return; }
    save.mutate({ id: existing?.id, body }, {
      onSuccess: finish,
      onError: (error) => {
        const { problem, fields: refused } = customerSaveErrors(error, value.name);
        const shown: Partial<Record<FieldName, string>> = {};
        for (const key of fields) if (refused[key]) shown[key] = refused[key];
        const other = Object.entries(refused).filter(([key]) => !fields.includes(key as FieldName)).map(([, words]) => words);
        const unknown = Object.entries(problem.fields ?? {}).filter(([key]) => !["name", "mobile_number", "city", "gst_number", "address", "state_name", "email", "pan_number", "businesses", "customer_type"].includes(key)).map(([, words]) => words);
        if (other.length || unknown.length) setFailure({ title: "Not saved", body: [...other, ...unknown].join(" ") });
        else if (!Object.keys(shown).length) setFailure(problem.kind === "forbidden" ? { title: "Not saved", body: whyNot("customer.edit", "add or change customers") || problem.message } : problem.kind === "offline" ? { ...saveFailure(problem), title: "Not saved yet: you're offline." } : saveFailure(problem));
        setRetry(true); showErrors(shown);
      },
    });
  };
  const all = firms.length === 1 ? `For ${firm.name}` : `For all ${["", "", "two", "three", "four", "five"][firms.length] || firms.length} firms`;
  const busy = save.isPending;
  return <Frame back title={existing ? "Change details" : "New customer"} subtitle={subtitle ?? existing?.name ?? all} docTitle={existing ? `Change ${existing.name}'s details` : "New customer"}
    bar={<Button type="submit" form="easy-customer-form" variant="primary" size="xl" full icon={CheckCircle2} disabled={!can("customer.edit")} loading={busy}>
      {busy ? "Saving…" : retry ? "Save again" : existing ? "Save changes" : forBill ? "Save and continue the bill" : "Save customer"}
    </Button>}>
    {guard ? <Guard dirty={dirty} existing={Boolean(existing)} /> : null}
    {!can("customer.edit") ? <p className="text-md text-muted">{whyNot("customer.edit", "add or change customers")}</p> : null}
    {failure ? <div role="alert"><Banner role="presentation" tone="neg" title={failure.title}>{failure.body}</Banner></div> : null}
    <form id="easy-customer-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field label="Name" htmlFor={ids.name} error={errors.name}><Input id={ids.name} value={value.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" autoCapitalize="words" placeholder="As it should print on the bill" /></Field>
      <div className="flex flex-col gap-2">
        <Field label="Mobile number" htmlFor={ids.phone} error={errors.phone} hint="10 digits. The bill goes to this number on WhatsApp.">
          <Input id={ids.phone} type="tel" inputMode="tel" value={value.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="off" prefix="+91" className="[&>span]:!text-lg" inputClassName="tnum !pl-14" />
        </Field>
        {samePhone ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl border border-brand-line bg-brand-tint px-4 py-3 anim-rise" role="status">
          <p className="flex-1 min-w-[180px]">{formatMobile(value.phone)} is {samePhone.name}'s number{samePhone.city ? `, ${samePhone.city}` : ""}.</p>
          {forBill ? <Button variant="outline" onClick={() => setDone(samePhone)}>Use {firstName(samePhone.name)}</Button> : null}
        </div> : null}
      </div>
      <Field label="Town or city" htmlFor={ids.city} error={errors.city} hint="Printed on the bill after the name."><Input id={ids.city} value={value.city} onChange={(e) => set("city", e.target.value)} autoComplete="off" autoCapitalize="words" /></Field>
      <Field label="GST number · only for shops and companies" htmlFor={ids.gstin} error={errors.gstin || (gstChecked && changed("gstin") ? gstProblem : "")}
        hint={gstState ? "" : "Leave it empty for people buying for themselves. With it, the shop can claim back the GST on its bill."}>
        <Input id={ids.gstin} value={value.gstin} onChange={(e) => set("gstin", cleanGstin(e.target.value))} onBlur={() => setGstChecked(true)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="15 letters and digits" inputClassName="tnum" />
      </Field>
      {gst.status === "check" ? <p className="text-md text-brand" role="status">{gst.warning}</p> : null}
      {sameGstin ? <div role="status"><p>{sameGstin.name} already has this GSTIN.</p>{forBill ? <Button variant="outline" onClick={() => setDone(sameGstin)}>Use {firstName(sameGstin.name)}</Button> : null}</div> : null}
      {gstState ? <p id="easy-c-gst-ok" className="-mt-3 flex items-start gap-2 text-md text-sale anim-rise"><CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>Looks right: a shop in {stateTitle(gstState)}.{isInterState(stateCodeOf(firm.state), stateCodeOf(gstState)) ? " Bills to it charge IGST, the GST for sales to another state." : ""}</span>
      </p> : null}
      <Field label="Address · optional" htmlFor={ids.address} error={errors.address}><Textarea id={ids.address} value={value.address} onChange={(e) => set("address", e.target.value)} placeholder="House, street, area" /></Field>
    </form>
  </Frame>;
}
