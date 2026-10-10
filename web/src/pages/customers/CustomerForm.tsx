// Add or change a customer (PROTO pages/records/CustomerForm.jsx). While a name is typed, customers already on file
// with a name like it show up; the GSTIN is checked as it's typed and fills the state, type and PAN; a GSTIN or phone
// another customer has is named; every problem is said in plain words next to its field. A GSTIN that fails only its
// check character saves with a warning and stays B2B (part 1 design, decision 3). The GST registry lookup and Merge
// come in part 4.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, Check, CheckCircle2, Info, UserPlus, UserRound } from "lucide-react";
import { customerSaveErrors, useCustomerSearch, useSaveCustomer, useStatement, type Customer, type CustomerBody, type CustomerField } from "@/core/api/customers";
import type { ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, plural } from "@/core/format";
import { checkGstin, cleanGstin, cleanPan, emailProblem, formatMobile, gstinPan, mobileDigits, mobileProblem, panProblem, stateLabel, stateOptions, stateTitle } from "@/core/ids";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { useFirms, useScope, type Firm } from "@/core/scope";
import { Banner, Button, ButtonLink, Card, Field, Input, ListSkeleton, LoadError, Page, QueryView, Segmented, Select, scrollIntoViewSafe } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { firstName, homeState, keepFocus, markSaved, safeReturn, tableState, useBack, useCtrlS, useOnFile, useRouteCustomer } from "./lib";
import { ErrorSummary, FirmToggles, MissingRecord, NoAccess, SaveError } from "./parts";

type Values = { name: string; phone: string; email: string; type: "person" | "business"; gstin: string; pan: string; address: string; city: string; state: string; firms: number[] };
const IDS: Record<CustomerField, string> = {
  name: "cu-name", phone: "cu-phone", email: "cu-email", gstin: "cu-gstin", pan: "cu-pan", address: "cu-address", city: "cu-city", state: "cu-state", firms: "cu-firms", type: "cu-type",
};
const ORDER: CustomerField[] = ["name", "phone", "email", "type", "gstin", "pan", "address", "city", "state", "firms"];

function initialValues(existing: Customer | null, firms: Firm[], home: string, query: URLSearchParams): Values {
  const all = firms.map((f) => f.id);
  if (existing) {
    const ticked = all.filter((id) => existing.businesses.includes(id));
    return {
      name: existing.name, phone: formatMobile(existing.mobile_number), email: existing.email, type: existing.type === "business" ? "business" : "person",
      gstin: existing.gst_number, pan: existing.pan_number || gstinPan(existing.gst_number), address: existing.address, city: existing.city,
      // in the table's spelling, as the picker and a GSTIN name it: a stored "JAMMU & KASHMIR" is the GSTIN's own state
      state: tableState(existing.state_name) || home, firms: ticked.length ? ticked : all,
    };
  }
  // a GSTIN in the address (?gstin=) fills the state, type and PAN, as typing it would
  const gstin = cleanGstin(query.get("gstin") ?? "");
  const g = checkGstin(gstin);
  const fromGstin = g.status === "valid" || g.status === "check";
  return {
    name: query.get("name") ?? "", phone: formatMobile(query.get("phone")), email: "", type: fromGstin ? "business" : "person", gstin,
    pan: g.status === "valid" ? g.pan : "", address: "", city: "", state: fromGstin ? g.state : home, firms: all,
  };
}

/** Customers whose names look like the one typed, best first (PROTO records/data.js nameMatches), never the walk-in record. */
function nameMatches<T extends Customer>(list: T[], typed: string): T[] {
  const t = typed.trim().toLowerCase();
  if (t.length < 3) return [];
  const words = t.split(/\s+/).filter((w) => w.length >= 3);
  return list.filter((c) => c.type !== "walkin").map((c) => {
    const n = c.name.trim().toLowerCase();
    const score = n === t ? 3 : n.startsWith(t) || n.includes(t) ? 2 : words.some((w) => n.split(/\s+/).includes(w)) ? 1 : 0;
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name)).slice(0, 4).map((x) => x.c);
}

export default function CustomerForm() {
  // an address like /customers/c-anil/edit names no customer: it gets the missing-record page without asking the server
  const { id: editId, one, missing } = useRouteCustomer();
  const [query] = useSearchParams();
  const { can, whyNot } = useAuth();
  const { firms, loading: firmsLoading, error: firmsError } = useFirms();
  const { firmId } = useScope();
  const existing = editId !== null && one.data && !one.isPlaceholderData ? one.data : null;
  const back = useBack(editId !== null ? `/customers/${editId}` : "/customers");
  const crumbs = [{ label: "Customers", to: "/customers" }];
  if (missing) return <MissingRecord icon={UserRound} title="This customer isn't on file" to="/customers" label="All customers" />;
  if (existing?.type === "walkin") {
    return (
      <Page icon={UserRound} breadcrumbs={crumbs} title="Walk-in customer" back={`/customers/${existing.id}`} narrow>
        <NoAccess icon={Info} title="The walk-in record can't be edited"
          actions={<><ButtonLink to={`/customers/${existing.id}`}>Back to walk-in sales</ButtonLink>{can("customer.edit") ? <ButtonLink variant="primary" icon={UserPlus} to="/customers/new?from=list">Add a customer</ButtonLink> : null}</>}>
          It collects cash sales made without a name, so there's no name, phone or GSTIN to change. To keep a buyer's bills together, add them as a customer.
        </NoAccess>
      </Page>
    );
  }
  const title = editId !== null ? `Edit ${one.data?.name ?? "customer"}` : "Add customer";
  if (!can("customer.edit")) {
    return (
      <Page icon={UserRound} breadcrumbs={crumbs} title={title} back={editId !== null ? `/customers/${editId}` : "/customers"} narrow>
        <NoAccess title="You can't add or change customers" actions={<ButtonLink to={editId !== null ? `/customers/${editId}` : "/customers"}>{one.data ? `Back to ${one.data.name}` : "All customers"}</ButtonLink>}>
          {whyNot("customer.edit", "add or change customers")}
        </NoAccess>
      </Page>
    );
  }
  const backTo = editId !== null ? `/customers/${editId}` : "/customers";
  // the customer's loading, slow, offline and failed states, as every page draws them (the kit's QueryView)
  if (editId !== null && !existing) {
    const skeleton = <ListSkeleton rows={5} what={`${one.data?.name ?? "the customer"}'s details`} />;
    return <Page narrow icon={UserRound} breadcrumbs={crumbs} title={title} back={backTo}><QueryView query={one} what="this customer" skeleton={skeleton}>{() => skeleton}</QueryView></Page>;
  }
  // the firms (for the firm cards) come with the app; a list that couldn't load is said, as the firm picker says it
  if (firmsError) return <Page narrow icon={UserRound} breadcrumbs={crumbs} title={title} back={backTo}><LoadError problem={{ kind: "unreachable", message: "The app couldn't get through" }} what="the firms" /></Page>;
  if (firmsLoading) return <Page narrow icon={UserRound} breadcrumbs={crumbs} title={title} back={backTo}><ListSkeleton rows={5} what="the form" /></Page>;
  return <Form key={editId ?? `new?${query.get("name") ?? ""}&${query.get("phone") ?? ""}&${query.get("gstin") ?? ""}`} existing={existing} firms={firms} home={homeState(firms, firmId)} query={query} back={back} />;
}

function Form({ existing, firms, home, query, back }: { existing: Customer | null; firms: Firm[]; home: string; query: URLSearchParams; back: () => void }) {
  const { isPhone } = useView();
  const navigate = useNavigate();
  const save$ = useSaveCustomer();
  const initial = useMemo(() => initialValues(existing, firms, home, query), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<CustomerField, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [serverErrs, setServerErrs] = useState<Partial<Record<CustomerField, string>>>({});
  const [saveError, setSaveError] = useState<ApiProblem | null>(null);
  const [stateNote, setStateNote] = useState<{ n: number; text: string } | null>(null);
  // what a typed GSTIN filled in (state, type, PAN), to put back if it changes again
  const [auto, setAuto] = useState<{ state: string; type: Values["type"]; pan: string; to: string } | null>(null);
  const [done, setDone] = useState<{ to: string; back: boolean } | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const guard = useUnsavedGuard(dirty && !done);
  useEffect(() => {
    if (!done) return;
    if (done.back && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
    else navigate(done.to, { replace: true });
  }, [done, navigate]);
  // a link like ?focus=pan (the customer page's "PAN needed · Add PAN") lands on that field
  useEffect(() => {
    const target = ({ pan: IDS.pan, address: IDS.address, gstin: IDS.gstin, phone: IDS.phone } as Record<string, string>)[query.get("focus") ?? ""];
    if (!target) return undefined;
    const t = setTimeout(() => document.getElementById(target)?.focus(), 80);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Values>(k: K) => (x: Values[K]) => {
    setV((o) => ({ ...o, [k]: x }));
    setSaveError(null);
    setServerErrs((e) => { if (!(k in e)) return e; const n = { ...e }; delete n[k as CustomerField]; return n; });
  };
  const touch = (k: CustomerField) => () => setTouched((t) => ({ ...t, [k]: true }));

  const g = checkGstin(v.gstin);
  const gValid = g.status === "valid";
  // customers already on file: a name like this one (a search once typing pauses), the same phone, the same GSTIN
  const nameTerm = useDebounced(v.name.trim().length >= 3 ? v.name.trim() : "");
  const nameHits = useCustomerSearch(nameTerm);
  const named = nameTerm === v.name.trim() ? (nameHits.data ?? []).filter((c) => c.id !== existing?.id) : [];
  const dupName = named.find((c) => c.name.trim().toLowerCase() === v.name.trim().toLowerCase()) ?? null;
  const suggestions = !existing && !dupName ? nameMatches(named, v.name) : [];
  const digits = mobileDigits(v.phone);
  const { samePhone: dupPhone, sameGstin: dupGstin } = useOnFile(v.phone, v.gstin, existing?.id);
  // the firms that have billed them (any year, cancelled bills too), under each firm card
  const billedQ = useStatement(existing?.id ?? null, existing ? {} : null);
  const billed = new Set((billedQ.data?.bills ?? []).map((b) => b.business));

  const errs: Partial<Record<CustomerField, string>> = {};
  if (!v.name.trim()) errs.name = "Enter the customer's name, as it should print on bills.";
  else if (dupName) errs.name = `There's already a customer called ${dupName.name}. Add the area or the father's name to tell them apart${dupName.city ? ` (like ${v.name.trim()}, ${dupName.city})` : ""}, or open ${dupName.name}.`;
  if (mobileProblem(v.phone)) errs.phone = mobileProblem(v.phone);
  if (emailProblem(v.email)) errs.email = emailProblem(v.email);
  if (g.status === "short" || g.status === "invalid") errs.gstin = g.problem;
  else if (v.type === "business" && g.status === "empty") errs.gstin = "A business customer needs its GSTIN: without one, its bills block GSTR-1. Add the GSTIN, or choose Person.";
  if (gValid && g.state !== v.state) errs.state = `This GSTIN is registered in ${stateLabel(g.state)}. Pick that state, or check the GSTIN.`;
  if (!gValid && panProblem(v.pan)) errs.pan = panProblem(v.pan);
  if (!v.firms.length) errs.firms = "Tick at least one firm so they show first somewhere.";
  for (const [k, msg] of Object.entries(serverErrs) as [CustomerField, string][]) if (!errs[k]) errs[k] = msg;
  // empty required fields wait for a save attempt; typed (or cleared) values are checked on leaving the field
  const show = (k: CustomerField): string => {
    const has = (x: Values) => { const val = x[k as keyof Values]; return Array.isArray(val) ? true : Boolean(String(val ?? "").trim()); };
    return tried || (k === "name" && dupName) || serverErrs[k] || (touched[k] && (k === "firms" || has(v) || has(initial))) ? errs[k] ?? "" : "";
  };
  const gstinErr = errs.gstin && (tried || touched.gstin || v.gstin.length === 15 || serverErrs.gstin) ? errs.gstin : "";

  const onGstin = (raw: string) => {
    const gstin = cleanGstin(raw);
    const c = checkGstin(gstin);
    const next = { ...v, gstin };
    setSaveError(null);
    setServerErrs((e) => { const n = { ...e }; delete n.gstin; return n; });
    if (c.status === "valid" || c.status === "check") {
      const undo = auto ?? { state: v.state, type: v.type, pan: v.pan, to: c.state };
      if (v.state !== c.state) { next.state = c.state; setStateNote({ n: (stateNote?.n ?? 0) + 1, text: `Set to ${stateLabel(c.state)} from the GSTIN` }); }
      next.type = "business";
      // a GSTIN that fails its check isn't read for a PAN: what was typed before stays
      next.pan = c.status === "valid" ? c.pan : undo.pan;
      setAuto({ ...undo, to: c.state });
    } else if (auto) {
      // the GSTIN that filled the state, type and PAN changed: put back what was there before
      if (v.state === auto.to) next.state = auto.state;
      next.type = auto.type;
      next.pan = auto.pan;
      setAuto(null);
      setStateNote(null);
    }
    setV(next);
  };

  const ret = safeReturn(query.get("return"));
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    if (save$.isPending) return;
    setTried(true);
    const first = ORDER.find((k) => errs[k]);
    if (first) { const el = document.getElementById(IDS[first]); el?.focus({ preventScroll: true }); scrollIntoViewSafe(el, { block: "center" }); return; }
    setSaveError(null);
    const body: CustomerBody = {
      name: v.name.trim().replace(/\s+/g, " "), mobile_number: digits, email: v.email.trim(), customer_type: v.type, gst_number: v.gstin,
      pan_number: gValid ? gstinPan(v.gstin) : v.pan, address: v.address.trim(), city: v.city.trim(), state_name: v.state, businesses: v.firms,
    };
    // mutate's callbacks run only while this form is still on screen: an answer after the person left takes no one anywhere
    save$.mutate({ id: existing?.id, body }, {
      onSuccess: (c) => {
        // the record flashes where it lands (first in the list, or its own page): that's the confirmation
        markSaved("customer", c.id);
        if (ret) setDone({ back: false, to: `${ret}${ret.includes("?") ? "&" : "?"}customer=${c.id}` });
        else if (existing) setDone({ back: true, to: `/customers/${c.id}` });
        else setDone({ back: query.get("from") === "list", to: "/customers" });
      },
      onError: (err) => {
        const { problem, fields } = customerSaveErrors(err, v.name);
        setServerErrs(fields);
        const firstField = ORDER.find((k) => fields[k]);
        if (firstField) document.getElementById(IDS[firstField])?.focus({ preventScroll: true });
        else setSaveError(problem);
      },
    });
  };
  useCtrlS(save);

  const busy = save$.isPending;
  const errorItems = ORDER.filter((k) => errs[k]).map((k) => ({ field: IDS[k], text: errs[k]! }));
  const allTicked = v.firms.length === firms.length;
  const title = existing ? `Edit ${existing.name}` : "Add customer";
  const saveLabel = busy ? "Saving…" : existing ? "Save changes" : "Save customer";
  const grid = isPhone ? "flex flex-col gap-4" : "grid grid-cols-2 gap-x-5 gap-y-4";
  const desc = (k: CustomerField, extra?: string | null) => [show(k) ? `${IDS[k]}-error` : null, extra].filter(Boolean).join(" ") || undefined;
  const homeTitle = stateTitle(home) || "the firm's state";
  const states = stateOptions(home);
  if (v.state && !states.some((o) => o.value === v.state)) states.push({ value: v.state, label: stateLabel(v.state) });
  const stateErr = show("state") || (gValid ? errs.state ?? "" : "");

  return (
    <Page narrow icon={existing ? UserRound : UserPlus} title={title} back={existing ? `/customers/${existing.id}` : "/customers"}
      breadcrumbs={[{ label: "Customers", to: "/customers" }, ...(existing ? [{ label: existing.name, to: `/customers/${existing.id}` }] : [])]}
      context={existing ? "Changes show on new bills from now on" : "A name and phone are enough to start. Add the GSTIN for businesses."}
      phoneSubtitle={existing ? "Changes show on new bills" : "Name and phone are enough to start"}
      actions={<><Button variant="ghost" onClick={back} disabled={busy}>Cancel</Button><Button variant="primary" icon={Check} onClick={() => save()} loading={busy} title="Ctrl S" {...keepFocus}>{saveLabel}</Button></>}
      actionBar={<Button variant="primary" size="lg" icon={Check} onClick={() => save()} loading={busy} {...keepFocus}>{saveLabel}</Button>}>
      {guard}
      <form id="customer-form" onSubmit={save} noValidate className="flex flex-col gap-5">
        {tried && errorItems.length ? <ErrorSummary items={errorItems} /> : null}
        <SaveError problem={saveError} onRetry={() => save()} />

        <Card title="Customer">
          <div className={grid}>
            <Field label="Name" htmlFor={IDS.name} required error={show("name")} className={isPhone ? "" : "col-span-2"}>
              <Input id={IDS.name} value={v.name} onChange={(e) => set("name")(e.target.value)} onBlur={touch("name")} autoComplete="off" autoFocus={!existing && !isPhone && !query.get("focus")}
                aria-describedby={desc("name", suggestions.length ? "cu-name-found" : null)} placeholder="As it should print on bills" />
              {suggestions.length ? (
                <div id="cu-name-found" className="rounded-ctl border border-brand-line bg-brand-tint/50 anim-rise" role="status">
                  <p className="px-3.5 pt-2.5 text-sm font-medium text-brand">Already on file? {plural(suggestions.length, "customer")} with a name like this</p>
                  <ul className="py-1">
                    {suggestions.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 px-3.5 py-1.5">
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{c.name}</span>
                          <span className="block text-sm text-muted truncate">{[formatMobile(c.mobile_number) || "No phone", c.city, c.figures?.last_bill ? `last bill ${date(c.figures.last_bill.invoice_date)}` : "no bills yet"].filter(Boolean).join(" · ")}</span>
                        </span>
                        <ButtonLink size="sm" to={`/customers/${c.id}`}>Open</ButtonLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {dupName ? <p className="text-sm text-fg2 anim-rise"><Link to={`/customers/${dupName.id}`} className="link">Open {dupName.name}</Link></p> : null}
            </Field>
            <Field label="Type" hint={v.type === "business" ? "Bills go to GSTR-1 as B2B; the buyer can claim the GST." : "Bills go to GSTR-1 as B2C sales."}>
              <Segmented label="Customer type" full options={[{ value: "person", label: "Person" }, { value: "business", label: "Business" }]} value={v.type} onChange={set("type")} />
            </Field>
            <Field label="Mobile number" htmlFor={IDS.phone} error={show("phone")} hint={dupPhone && !show("phone") ? null : "10 digits. Bills are sent here on WhatsApp."}>
              <Input id={IDS.phone} type="tel" inputMode="numeric" autoComplete="off" value={v.phone} prefix="+91" placeholder="10-digit mobile" inputClassName="!pl-12 tnum"
                onChange={(e) => set("phone")(formatMobile(e.target.value))} onBlur={touch("phone")} aria-describedby={desc("phone", dupPhone ? "cu-phone-dup" : null)} />
              {dupPhone && !show("phone") ? (
                <p id="cu-phone-dup" className="text-sm text-fg2 anim-rise"><AlertTriangle size={14} className="inline -mt-0.5 mr-1 text-neg" aria-hidden="true" />
                  <Link to={`/customers/${dupPhone.id}`} className="underline underline-offset-2">{dupPhone.name}</Link> has this number too. Fine for family members; if it's the same person, use {dupPhone.name} instead.
                </p>
              ) : null}
            </Field>
            <Field label="Email" htmlFor={IDS.email} error={show("email")} hint="Optional. For statements and bills by email." className={isPhone ? "" : "col-span-2"}>
              <Input id={IDS.email} type="email" inputMode="email" value={v.email} onChange={(e) => set("email")(e.target.value.trim())} onBlur={touch("email")} autoComplete="off" aria-describedby={desc("email")} />
            </Field>
          </div>
        </Card>

        <Card title="GST" subtitle="Optional for people. Businesses need it for B2B bills.">
          <div className={grid}>
            <Field label="GSTIN" htmlFor={IDS.gstin}>
              <Input id={IDS.gstin} value={v.gstin} onChange={(e) => onGstin(e.target.value)} onBlur={touch("gstin")} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                placeholder="15 characters" inputClassName="tnum tracking-wide uppercase placeholder:normal-case placeholder:tracking-normal" invalid={Boolean(gstinErr)} aria-describedby={`${IDS.gstin}-status`} maxLength={15} />
              <div id={`${IDS.gstin}-status`} aria-live="polite" className="min-h-5 flex flex-col gap-1">
                {gstinErr ? <p key={`e-${gstinErr}`} className="text-sm text-neg anim-rise">{gstinErr}</p>
                  : g.status === "valid" ? <p key="ok" className="text-sm text-sale flex items-center gap-1.5 anim-rise"><CheckCircle2 size={15} aria-hidden="true" />Valid GSTIN · {stateLabel(g.state)} · PAN {g.pan}</p>
                    : g.status === "check" ? <p key="check" className="text-sm text-brand flex items-start gap-1.5 anim-rise"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{g.warning}</p>
                      : v.gstin ? <p key="typing" className="text-sm text-muted tnum">{v.gstin.length} of 15 characters</p>
                        : <p key="empty" className="text-sm text-muted">The state and PAN fill in from it.</p>}
              </div>
            </Field>
            <Field label="PAN" htmlFor={IDS.pan} error={show("pan")}
              hint={gValid ? "From the GSTIN (characters 3 to 12)." : g.status === "check" ? "Type the PAN: the app reads it only from a GSTIN that checks out." : "Needed when one bill is more than ₹2,00,000. 10 characters, like ABCDE1234F."}>
              <Input id={IDS.pan} value={gValid ? g.pan : v.pan} disabled={gValid} maxLength={10} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                onChange={(e) => set("pan")(cleanPan(e.target.value))} onBlur={touch("pan")} inputClassName="tnum tracking-wide uppercase" aria-describedby={desc("pan")} />
            </Field>
          </div>
          {dupGstin ? (
            <div className="mt-4 anim-rise">
              <Banner tone="brand" icon={AlertTriangle} title={`${dupGstin.name} already has this GSTIN`} actions={<ButtonLink size="sm" to={`/customers/${dupGstin.id}`}>Open {dupGstin.name}</ButtonLink>}>
                One GSTIN on two customers splits one buyer's bills in two. If it's the same business, bill {dupGstin.name} instead.
              </Banner>
            </div>
          ) : null}
        </Card>

        <Card title="Address" subtitle="Printed on bills. The state decides IGST or CGST + SGST.">
          <div className={grid}>
            <Field label="Address" htmlFor={IDS.address} className={isPhone ? "" : "col-span-2"}>
              <Input id={IDS.address} value={v.address} onChange={(e) => set("address")(e.target.value)} autoComplete="off" placeholder="House, street, area" />
            </Field>
            <Field label="City" htmlFor={IDS.city} error={show("city")}>
              <Input id={IDS.city} value={v.city} maxLength={100} onChange={(e) => set("city")(e.target.value)} autoComplete="off" aria-describedby={desc("city")} />
            </Field>
            <Field label="State" htmlFor={IDS.state} error={stateErr}
              hint={stateNote && !errs.state ? null : v.state && v.state !== home ? `Outside ${homeTitle}: every firm's bills to this customer use IGST.` : `${homeTitle}: bills use CGST + SGST.`}>
              <Select id={IDS.state} value={v.state} placeholder="Choose the state" onChange={(e) => { set("state")(e.target.value); setStateNote(null); }} options={states} />
              {stateNote && !errs.state ? <p key={stateNote.n} className="text-sm text-sale flex items-center gap-1.5 anim-rise"><CheckCircle2 size={15} aria-hidden="true" />{stateNote.text}</p> : null}
            </Field>
          </div>
        </Card>

        <Card title={<span id="cu-firms-label">Firms that usually bill this customer</span>} subtitle="They show first when that firm makes a bill; any firm can still pick them."
          actions={<Button size="sm" variant="ghost" onClick={() => { set("firms")(allTicked ? [] : firms.map((x) => x.id)); touch("firms")(); }}>{allTicked ? "Untick all" : `Tick all ${firms.length}`}</Button>}>
          <div id={IDS.firms} tabIndex={-1} className="outline-none flex flex-col gap-2">
            <FirmToggles firms={firms} value={v.firms} onChange={(ids) => { set("firms")(ids); touch("firms")(); }} labelledBy="cu-firms-label" describedBy={show("firms") ? `${IDS.firms}-error` : undefined}
              note={existing && billedQ.isSuccess ? (f) => (billed.has(f.id) ? `Has billed ${firstName(existing.name)}` : "No bills yet") : undefined} />
            {show("firms") ? <p id={`${IDS.firms}-error`} className="text-sm text-neg anim-rise">{show("firms")}</p>
              : <p className="text-sm text-muted">{allTicked ? `All ${firms.length} firms ticked.` : `${plural(v.firms.length, "firm")} ticked: ${firms.filter((f) => v.firms.includes(f.id)).map((f) => f.name).join(", ")}.`}</p>}
          </div>
        </Card>

        {!isPhone ? (
          <div className="flex items-center justify-end gap-2">
            <span className={cn("text-sm mr-auto", dirty ? "text-fg2" : "text-muted")}>{!existing ? "Ctrl S saves" : dirty ? "Unsaved changes · Ctrl S saves" : "No changes yet"}</span>
            <Button variant="ghost" onClick={back} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" icon={Check} loading={busy} {...keepFocus}>{saveLabel}</Button>
          </div>
        ) : null}
      </form>
    </Page>
  );
}
