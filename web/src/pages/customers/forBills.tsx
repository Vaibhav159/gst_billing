// What the bill form (part 1D), the bill pages (1B) and Easy (part 6) take from the customer screens: one import path.
// - Who a bill is for (PROTO pages/sales/BillForm.jsx customerOptions, CustomerField and CustomerSheet): the desktop's
//   customer box, and the phone's sheet, which opens on the list rather than the keyboard.
// - A new customer without leaving the bill (PROTO pages/sales/parts.jsx NewCustomerForm; BillForm.jsx's sheet). The GST
//   registry's fill-in comes with part 4's lookup.
// - A customer's PAN or address, added from a bill (PROTO pages/sales/parts.jsx CustomerFixSheet).
// The combobox and FailNote are the kit's (@/core/ui), and failText is Selling's (@/core/sales/words): one home each.
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { customerSaveErrors, useCustomerSearch, useRecentCustomers, useSaveCustomer, useWalkin, type Customer, type CustomerBody, type CustomerRow } from "@/core/api/customers";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { dateShort, inr, mobileText } from "@/core/format";
import { checkGstin, cleanGstin, cleanPan, mobileDigits, mobileProblem, PAN_PROBLEM, PAN_RE, panProblem, stateLabel, stateOptions } from "@/core/ids";
import { andList, failText, type FailText } from "@/core/sales/words";
import { useFirms, type Firm } from "@/core/scope";
import { Avatar, Button, Combobox, Dialog, FailNote, Field, Input, ListRow, SearchInput, Select, Sheet, useToast, type ComboItem, type ComboOption } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { customerLine, keepFocus, useOnFile } from "./lib";

export { customerLine, homeState } from "./lib";

/* ── Who the bill is for ───────────────────────────────── */

const NO_ROWS: CustomerRow[] = [];

/** A search that didn't work, in words. */
function searchFailed(p: ApiProblem): string {
  if (p.kind === "offline") return "Couldn't search: you're offline";
  if (p.kind === "unreachable" || p.kind === "server") return "Couldn't search: the app couldn't get through";
  return `Couldn't search. ${p.message}`;
}

/**
 * The search for what's typed, once typing pauses (from 2 characters). rows: its answer for exactly what's typed, null
 * until that has come; note: what to say meanwhile, or that it didn't work (rows are then empty).
 */
function useTypedSearch(typed: string, size?: number): { t: string; rows: CustomerRow[] | null; note: string } {
  const t = typed.trim();
  const term = useDebounced(t);
  const search = useCustomerSearch(term, { size });
  const offline = useNetwork() === "offline";
  if (!t) return { t, rows: null, note: "" };
  if (t.length < 2) return { t, rows: null, note: "Keep typing to search" };
  if (term !== t) return { t, rows: null, note: "Searching…" };
  if (search.data) return { t, rows: search.data, note: "" };
  if (search.isError) return { t, rows: NO_ROWS, note: searchFailed(problemOf(search.error)) };
  // offline, TanStack holds the search and sends it once the device is back
  return { t, rows: null, note: offline && search.isPaused ? "You're offline: the search runs when you're back online" : "Searching…" };
}

/** Whether a firm usually bills a customer: it's one of their ticked firms, or none is ticked (every firm). */
const usualFor = (c: Customer, firmId: number) => !c.businesses.length || c.businesses.includes(firmId);

/**
 * The rows a bill's customer box offers (PROTO BillForm.jsx customerOptions). `typed` is what's in the box. Empty: the
 * walk-in record, "+ New customer…" and the firm's recent customers. Typed: the matches, the firm's own customers first
 * and the others named by the firms that usually bill them, then "+ New customer “…”". `matches` is the typed term's
 * search, null until it has answered: the list then says `note` and has nothing to pick, so a name typed and Enter
 * pressed at once never opens the new-customer sheet (Ruling 1D-2).
 */
export function customerOptions({ typed, firmId, firms, walkin, recent, matches, note }: {
  typed: string; firmId: number | null; firms: Firm[]; walkin: Customer | null; recent: CustomerRow[];
  matches: CustomerRow[] | null;
  /** Said above the rows: why there are none yet ("Searching…"), or that the search didn't work. */
  note?: string;
}): ComboItem<Customer | null>[] {
  const row = (c: CustomerRow): ComboOption<Customer | null> => {
    // the firms are named once their list has come
    const by = firmId !== null && !usualFor(c, firmId) ? firms.filter((f) => c.businesses.includes(f.id)).map((f) => f.short) : [];
    const last = c.figures?.last_bill;
    return { key: String(c.id), value: c, title: c.name, sub: customerLine(c) + (by.length ? ` · usually billed by ${andList(by)}` : ""), right: last ? `${dateShort(last.invoice_date)} · ${inr(last.total_amount)}` : "" };
  };
  const t = typed.trim();
  if (!t) {
    return [
      ...(walkin ? [{ key: String(walkin.id), value: walkin, title: walkin.name, sub: "Counter sale: no name or GSTIN on the bill" }] : []),
      { key: "__new", value: null, title: "+ New customer…", sub: "Add someone without leaving the bill", tone: "brand" as const },
      ...(recent.length ? [{ heading: "Recent customers" }, ...recent.map(row)] : []),
    ];
  }
  if (!matches) return [{ heading: note || "Searching…" }];
  const mine = matches.filter((c) => firmId === null || usualFor(c, firmId));
  const others = matches.filter((c) => !mine.includes(c));
  const shown = [...mine, ...others].slice(0, 8);
  return [
    ...(note ? [{ heading: note }] : []),
    ...shown.map(row),
    {
      key: "__new", value: null, title: `+ New customer “${t}”…`, tone: "brand" as const,
      sub: shown.length ? "Not one of these? Add them without leaving the bill" : note ? "Add them without leaving the bill" : "No customer matches. Add them without leaving the bill",
    },
  ];
}

export type CustomerPickerProps = {
  /** The bill's firm: its usual customers come first, and its recent ones show when the box is empty. */
  firmId: number | null;
  /** The customer picked, or null. */
  value: Customer | null;
  onPick: (c: Customer) => void;
  /** "+ New customer…" or the New customer link, with what's typed (open NewCustomerSheet with it). */
  onNew: (typed: string) => void;
  /** The field's problem ("Choose who this bill is for. Pick Walk-in customer for a counter sale."). */
  error?: string;
  /** The box's id; its error and hint are `${id}-error` and `${id}-hint`. */
  id?: string;
  autoFocus?: boolean;
};

/** The bill form's Customer field, on a desktop (PROTO BillForm.jsx CustomerField). */
export function CustomerPicker({ firmId, value, onPick, onNew, error, id = "bf-customer", autoFocus }: CustomerPickerProps) {
  const { firms } = useFirms();
  const [q, setQ] = useState(value ? value.name : "");
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setQ(value ? value.name : ""); }, [value, editing]);
  const typed = editing && q !== (value?.name ?? "") ? q : "";
  const search = useTypedSearch(typed);
  const walkin = useWalkin();
  const recent = useRecentCustomers(firmId);
  const options = useMemo(() => customerOptions({ typed, firmId, firms, walkin: walkin.data ?? null, recent: recent.data ?? NO_ROWS, matches: search.rows, note: search.note }),
    [typed, firmId, firms, walkin.data, recent.data, search.rows, search.note]);
  // picked by Enter: onPick runs inside the key press, so the bill form can move focus before the next key
  const pick = (o: ComboOption<Customer | null>) => {
    setEditing(false);
    if (!o.value) { onNew(typed.trim()); return; }
    setQ(o.value.name);
    onPick(o.value);
  };
  return (
    <Field label="Customer" htmlFor={id} error={error} hint={value ? customerLine(value) : "Type a name, phone or GSTIN. Recent customers show first."}
      // a press keeps the cursor in the box, so the name typed there goes with it
      aside={<Button size="sm" variant="link" icon={UserPlus} onClick={() => onNew(typed.trim())} {...keepFocus}>New customer</Button>}>
      <Combobox id={id} query={q} onQuery={(t) => { setQ(t); setEditing(true); }} options={options} onPick={pick} listLabel="Customers"
        invalid={Boolean(error)} describedBy={error ? `${id}-error` : `${id}-hint`} autoFocus={autoFocus} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} />
    </Field>
  );
}

export type CustomerSheetProps = { open: boolean; onClose: () => void; firmId: number | null; homeState: string; value: Customer | null; onPick: (c: Customer) => void };

/** The phone's customer sheet: the list first (walk-in and recent), a search, and a new customer without leaving the bill. */
export function CustomerSheet({ open, onClose, firmId, homeState, value, onPick }: CustomerSheetProps) {
  const [mode, setMode] = useState<"list" | "new">("list");
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState(false);
  useEffect(() => { if (open) { setMode("list"); setQ(""); setTyped(false); } }, [open]);
  const search = useTypedSearch(q, 12);
  const walkin = useWalkin();
  const recent = useRecentCustomers(firmId);
  const pick = (c: Customer) => { onPick(c); onClose(); };
  const t = search.t;
  const row = (c: Customer, last?: string) => (
    <ListRow key={c.id} onClick={() => pick(c)} leading={<Avatar name={c.name} size={36} tone="muted" />} title={c.name} chevron={false}
      subtitle={c.type === "walkin" ? "Counter sale, no name on the bill" : [mobileText(c.mobile_number) || "No phone", c.gst_number ? "GSTIN" : "No GSTIN", c.city].filter(Boolean).join(" · ")}
      right={last ? <span className="text-sm text-muted">{dateShort(last)}</span> : null} className={cn(value?.id === c.id && "bg-brand-sel/40")} />
  );
  return (
    <Dialog open={open} onClose={onClose} title={mode === "new" ? "New customer" : "Customer"} description={mode === "new" ? "Saved to Customers and picked for this bill." : undefined}
      confirmClose={mode === "new" && typed ? "Discard this customer?" : undefined}>
      {mode === "list" ? (
        // the sheet opens on the list, not the search box, so the keyboard doesn't cover the recent customers
        <div className="flex flex-col gap-3 outline-none" tabIndex={-1} data-autofocus="">
          <SearchInput value={q} onChange={setQ} placeholder="Name, phone or GSTIN" label="Search customers" enterKeyHint="search" />
          <div className="-mx-5 flex flex-col">
            {t ? (
              search.rows?.length ? search.rows.map((c) => row(c, c.figures?.last_bill?.invoice_date))
                // searching, offline or failed, it says so: never "no customer matches" before the search has answered
                : <p role="status" className="px-5 py-4 text-fg2">{search.note || `No customer matches “${t}”. Add them below.`}</p>
            ) : (
              <>
                {walkin.data ? row(walkin.data) : null}
                {recent.data?.length ? <p className="caps px-5 pt-4 pb-1">Recent</p> : null}
                {(recent.data ?? NO_ROWS).map((c) => row(c, c.figures?.last_bill?.invoice_date))}
              </>
            )}
          </div>
          <Button variant="outline" size="lg" full icon={UserPlus} onClick={() => setMode("new")}>{t ? `Add “${t}” as a new customer` : "New customer"}</Button>
        </div>
      ) : <NewCustomerForm initialName={t} idBase="ncp" homeState={homeState} onSaved={pick} onCancel={() => setMode("list")} onTyped={setTyped} />}
    </Dialog>
  );
}

/* ── A new customer, without leaving the bill ──────────── */

export type NewCustomerFormProps = {
  /** What was typed in the customer box, to start the name with. */
  initialName?: string;
  /** Prefix for the fields' ids ("nc": nc-name, nc-phone…), so two forms on one page don't clash. */
  idBase?: string;
  /** The bill's firm's state (a server state name, "RAJASTHAN"): a customer without a GSTIN starts there. */
  homeState: string;
  /** The customer saved, or the one already on file whose number or GSTIN was typed ("Use … instead"). */
  onSaved: (c: Customer) => void;
  onCancel?: () => void;
  /** Whether anything has been typed, for the sheet around it to ask before throwing it away. */
  onTyped?: (typed: boolean) => void;
};

type FormField = "name" | "phone" | "gstin" | "pan";

/**
 * GSTIN, name on the bill, mobile, address, city, state and PAN (PROTO pages/sales/parts.jsx NewCustomerForm), saved to
 * Customers and handed back to the bill. A number or GSTIN another customer has is named once it's found, with "Use …
 * instead". A GSTIN that fails only its check character warns, saves as typed and stays B2B (part 1 design, decision 3).
 */
export function NewCustomerForm({ initialName = "", idBase = "nc", homeState, onSaved, onCancel, onTyped }: NewCustomerFormProps) {
  const { can, whyNot } = useAuth();
  const { isPhone } = useView();
  const { show } = useToast();
  const save$ = useSaveCustomer();
  // no city to start with (Call 13): the firm's state, not its town
  const [v, setV] = useState({ name: initialName, phone: "", gstin: "", address: "", city: "", state: homeState, pan: "" });
  const [err, setErr] = useState<Partial<Record<FormField, string>>>({});
  const [tried, setTried] = useState(false);
  const [fail, setFail] = useState<FailText | null>(null);
  const set = (k: keyof typeof v, x: string) => { setV((o) => ({ ...o, [k]: x })); if (tried) setErr((e) => ({ ...e, [k]: "" })); setFail(null); };
  const typed = Boolean(v.phone.trim() || v.gstin.trim() || v.address.trim() || v.city.trim() || v.pan.trim() || v.state !== homeState || v.name.trim() !== initialName.trim());
  // a layout effect, so the sheet knows before the next key (an Esc right after typing still asks)
  useLayoutEffect(() => { onTyped?.(typed); }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onTyped?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const g = checkGstin(v.gstin);
  // a GSTIN failing only its check character still gives its state, and the customer is a business
  const fromGstin = g.status === "valid" || g.status === "check";
  const digits = mobileDigits(v.phone);
  // customers already on file with this number or GSTIN: one search each, once typing pauses (Task 3's hook)
  const { samePhone, sameGstin } = useOnFile(v.phone, v.gstin);

  const validate = () => {
    const e: Partial<Record<FormField, string>> = {};
    if (!v.name.trim()) e.name = "Type the customer's name as it should appear on the bill.";
    const phoneProblem = mobileProblem(v.phone);
    if (phoneProblem) e.phone = phoneProblem;
    else if (samePhone) e.phone = `This number belongs to ${samePhone.name}.`;
    if (g.status === "short" || g.status === "invalid") e.gstin = `${g.problem} Leave it empty for a person without a GSTIN.`;
    else if (sameGstin) e.gstin = `${sameGstin.name} already has this GSTIN.`;
    if (g.status !== "valid" && panProblem(v.pan)) e.pan = panProblem(v.pan);
    return e;
  };
  const save = () => {
    if (save$.isPending) return;
    setTried(true);
    setFail(null);
    if (!can("customer.edit")) { setErr({ name: whyNot("customer.edit") }); return; }
    const e = validate();
    setErr(e);
    const first = (["name", "phone", "gstin", "pan"] as const).find((k) => e[k]);
    if (first) { document.getElementById(`${idBase}-${first}`)?.focus(); return; }
    const name = v.name.trim().replace(/\s+/g, " ");
    const address = v.address.trim();
    // no `businesses`: none ticked means every firm, and the server refuses an empty list (Ruling 1C-2)
    const body: Partial<CustomerBody> = {
      name, mobile_number: digits, email: "", gst_number: v.gstin, pan_number: g.status === "valid" ? g.pan : v.pan, address, city: v.city.trim(),
      state_name: fromGstin ? g.state : v.state, customer_type: v.gstin ? "business" : "person",
    };
    save$.mutate({ body }, {
      onSuccess: (c) => {
        show({ title: `Added ${c.name}`, body: `Saved to Customers and picked for this bill.${v.gstin && !address ? " Add their address: a B2B bill needs it." : ""}` });
        onSaved(c);
      },
      onError: (x) => {
        // the server's words under the field it names; anything else above the buttons, with Try again
        const { problem, fields } = customerSaveErrors(x, name);
        const shown = { name: fields.name, phone: fields.phone, gstin: fields.gstin, pan: fields.pan };
        if (Object.values(shown).some(Boolean)) setErr(shown);
        else setFail(failText(problem));
      },
    });
  };
  const busy = save$.isPending;
  const gHint = sameGstin ? `${sameGstin.name} already has this GSTIN.` : g.status === "valid" ? `Valid GSTIN · ${stateLabel(g.state)} · PAN ${g.pan}`
    : g.status === "check" ? g.warning : g.status === "short" ? `${g.length} of 15 characters` : g.status === "invalid" ? g.problem
      : "Only for a registered business. The state and PAN come from it.";
  // a name typed in the customer box lands in the name, to finish it; with none, the GSTIN, which fills the most.
  // data-autofocus too: the sheet around the form puts the cursor there once it has opened
  const focusName = !isPhone && Boolean(initialName);
  const focusGstin = !isPhone && !initialName;
  return (
    <div className="flex flex-col gap-4">
      <Field label="GSTIN" htmlFor={`${idBase}-gstin`} error={err.gstin} hint={gHint}>
        <Input id={`${idBase}-gstin`} value={v.gstin} maxLength={15} inputClassName="uppercase tnum" autoComplete="off" spellCheck={false}
          autoFocus={focusGstin} data-autofocus={focusGstin ? "" : undefined} onChange={(e) => set("gstin", cleanGstin(e.target.value))} />
      </Field>
      {sameGstin ? <Button size="sm" variant="outline" className="self-start -mt-2" onClick={() => onSaved(sameGstin)}>{`Use ${sameGstin.name} instead`}</Button> : null}
      <Field label="Name on the bill" htmlFor={`${idBase}-name`} required error={err.name}>
        <Input id={`${idBase}-name`} value={v.name} autoComplete="off" autoFocus={focusName} data-autofocus={focusName ? "" : undefined} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Mobile number" htmlFor={`${idBase}-phone`} error={err.phone} hint={samePhone ? `This number belongs to ${samePhone.name}.` : "10 digits, for sending bills on WhatsApp. Optional."}>
        <Input id={`${idBase}-phone`} type="tel" inputMode="tel" value={v.phone} autoComplete="off" onChange={(e) => set("phone", e.target.value)} />
      </Field>
      {samePhone ? <Button size="sm" variant="outline" className="self-start -mt-2" onClick={() => onSaved(samePhone)}>{`Use ${samePhone.name} instead`}</Button> : null}
      <Field label="Address" htmlFor={`${idBase}-address`} hint={v.gstin ? "Shop or house, street and area. Needed on a B2B bill (CGST Rule 46)." : "Shop or house, street and area. Optional for a person."}>
        <Input id={`${idBase}-address`} value={v.address} autoComplete="off" onChange={(e) => set("address", e.target.value)} />
      </Field>
      <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2")}>
        <Field label="City" htmlFor={`${idBase}-city`}>
          <Input id={`${idBase}-city`} value={v.city} maxLength={100} autoComplete="off" onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="State" htmlFor={`${idBase}-state`} hint={fromGstin ? "From the GSTIN" : "Where they live; the bill's tax follows where the goods are handed over"}>
          <Select id={`${idBase}-state`} options={stateOptions(homeState)} placeholder="Choose the state" value={fromGstin ? g.state : v.state} disabled={fromGstin} onChange={(e) => set("state", e.target.value)} />
        </Field>
      </div>
      {g.status !== "valid" ? (
        <Field label="PAN" htmlFor={`${idBase}-pan`} error={err.pan}
          hint={g.status === "check" ? "Type the PAN: the app reads it only from a GSTIN that checks out." : "5 letters, 4 digits, a letter. Needed when one bill is more than ₹2,00,000 (Income Tax Rule 114B). Optional."}>
          <Input id={`${idBase}-pan`} value={v.pan} maxLength={10} inputClassName="uppercase tnum" autoComplete="off" spellCheck={false} onChange={(e) => set("pan", cleanPan(e.target.value))} />
        </Field>
      ) : null}
      <FailNote error={fail} />
      <div className={cn("flex gap-2 pt-1", isPhone ? "flex-col-reverse" : "justify-end")}>
        {onCancel ? <Button onClick={onCancel} full={isPhone} disabled={busy}>Back</Button> : null}
        <Button variant="primary" onClick={save} full={isPhone} loading={busy}>{busy ? "Saving…" : fail ? "Try again" : "Save and use on this bill"}</Button>
      </div>
    </div>
  );
}

export type NewCustomerSheetProps = { open: boolean; initialName: string; homeState: string; onClose: () => void; onSaved: (c: Customer) => void };

/** The new-customer form in a side sheet (a dialog on phones), for the desktop bill form's "+ New customer…". */
export function NewCustomerSheet({ open, initialName, homeState, onClose, onSaved }: NewCustomerSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="New customer" description="Saved to Customers and picked for this bill. You stay on the bill.">
      <NewCustomerForm key={initialName} initialName={initialName} idBase="nc" homeState={homeState} onCancel={onClose} onSaved={onSaved} />
    </Sheet>
  );
}

/* ── A PAN or address, added from a bill ───────────────── */

export type FixField = "pan" | "address";
export type CustomerFixSheetProps = {
  customer: Customer | null;
  /** What to add; null keeps the sheet shut. */
  field: FixField | null;
  open: boolean;
  onClose: () => void;
  /** The customer as saved (the caller refreshes its own bill if it needs to). */
  onSaved?: (c: Customer) => void;
};

/**
 * Income Tax Rule 114B asks for the buyer's PAN on a bill over ₹2,00,000, and CGST Rule 46 for a business buyer's
 * address. This saves it to the customer, so every bill shows it from then on. Only for someone who may change
 * customers: a bill page may open it for anyone (Ruling 1C-6).
 */
export function CustomerFixSheet({ customer, field, open, onClose, onSaved }: CustomerFixSheetProps) {
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const save$ = useSaveCustomer();
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [fail, setFail] = useState<FailText | null>(null);
  const cid = customer?.id;
  // filled from the record each time it opens (or for another customer or field): the same customer asked for again
  // meanwhile, as after the connection comes back, keeps what's typed
  useEffect(() => { if (open && customer) { setVal(field === "pan" ? customer.pan_number : customer.address); setErr(""); setFail(null); } }, [open, cid, field]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!customer || !field) return null;
  const busy = save$.isPending;
  const save = () => {
    if (busy) return;
    if (!can("customer.edit")) { setErr(whyNot("customer.edit")); return; }
    const t = field === "pan" ? val.trim().toUpperCase() : val.trim();
    if (field === "pan" && !PAN_RE.test(t)) { setErr(PAN_PROBLEM); return; }
    if (field === "address" && t.length < 6) { setErr("Type the shop or house, street and area."); return; }
    setFail(null);
    save$.mutate({ id: customer.id, body: field === "pan" ? { pan_number: t } : { address: t } }, {
      onSuccess: (c) => {
        show({ title: field === "pan" ? `Added ${customer.name}'s PAN` : `Added ${customer.name}'s address`, body: "It's in Customers now; this bill shows it." });
        onSaved?.(c);
        onClose();
      },
      onError: (x) => {
        const { problem, fields } = customerSaveErrors(x, customer.name);
        const mine = fields[field];
        if (mine) setErr(mine);
        else setFail(failText(problem));
      },
    });
  };
  const id = `fix-${field}`;
  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} title={field === "pan" ? `${customer.name}'s PAN` : `${customer.name}'s address`} width={420}
      description={field === "pan" ? "Income Tax Rule 114B: a bill over ₹2,00,000 needs the buyer's PAN (or Form 60)." : "CGST Rule 46: a B2B tax invoice shows the buyer's address."}
      footer={<><Button onClick={onClose} disabled={busy}>Not now</Button><Button variant="primary" loading={busy} onClick={save}>{busy ? "Saving…" : fail ? "Try again" : "Save"}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={field === "pan" ? "PAN" : "Address"} htmlFor={id} error={err}>
          <Input id={id} value={val} maxLength={field === "pan" ? 10 : 120} inputClassName={field === "pan" ? "uppercase tnum" : ""} autoComplete="off"
            onChange={(e) => { setVal(field === "pan" ? cleanPan(e.target.value) : e.target.value); setErr(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        </Field>
        <FailNote error={fail} />
      </div>
    </Sheet>
  );
}
