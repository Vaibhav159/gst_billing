// Prototype FirmForm: registration, account check, numbering and the actual signature. Signature files use their own endpoint.
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, Building2, Check, CheckCircle2, Info, Sparkles, Trash2, Upload } from "lucide-react";
import { useFirm, useSaveFirm, useSignature, type FirmBody, type FirmDetail } from "@/core/api/firms";
import { useRegistry } from "@/core/api/registry";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useShopSettings } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, fyOf, plural, todayIST } from "@/core/format";
import { checkGstin, cleanGstin, mobileDigits, stateLabel } from "@/core/ids";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { fullNumber } from "@/core/sales/numbers";
import { useFirms, useScope, type Firm } from "@/core/scope";
import { Banner, Button, ButtonLink, Card, cn, ConfirmDialog, Disclosure, Field, Input, ListSkeleton, LoadError, Page, QueryView, scrollIntoViewSafe, Switch, Textarea, useToast } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { keepFocus, markSaved, useBack, useCtrlS } from "@/pages/customers/lib";
import { ErrorSummary, MissingRecord, NoAccess, SaveError, useEcho } from "@/pages/customers/parts";
import { FIRM_IDS as IDS, firmBody, firmErrors, paperNumberWords } from "./form";
import { SignaturePreview } from "./parts";
export default function FirmForm() {
  const raw = useParams().id; const id = raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  const [query] = useSearchParams(); const { fy } = useScope(); const firms = useFirms(); const one = useFirm(id, fy); const { can, whyNot } = useAuth();
  const first = !raw && (query.get("first") === "1" || (!firms.loading && !firms.error && !firms.firms.length));
  const title = first ? "Add your first business" : raw ? `Edit ${one.data?.name ?? "firm"}` : "Add a firm";
  if (raw && (id === null || (one.isError && problemOf(one.error).kind === "notfound"))) return <MissingRecord icon={Building2} title="This firm isn't on file" to="/firms" label="All firms" />;
  if (!can("firm.edit")) return <Page narrow icon={Building2} title={title} back="/firms"><NoAccess title="Only the owner adds or changes firms" actions={<ButtonLink to={id ? `/firms/${id}` : "/firms"}>All firms</ButtonLink>}>{whyNot("firm.edit", "add or change firms")} The GSTIN, bank account and bill numbers print on every bill, so one person looks after them.</NoAccess></Page>;
  if (!raw && firms.loading) return <Page narrow title={title} back="/firms"><ListSkeleton rows={5} what="the form" /></Page>;
  if (!raw && firms.error) return <Page narrow title={title} back="/firms"><LoadError problem={firms.problem!} what="firms" /></Page>;
  if (raw) return <QueryView query={one} what="the firm's details">{(f) => <Form key={f.id} firm={f} firms={firms.firms} first={false} title={title} />}</QueryView>;
  return <Form key={first ? "first" : "new"} firm={null} firms={firms.firms} first={first} title={title} />;
}
function Form({ firm, firms, first, title }: { firm: FirmDetail | null; firms: Firm[]; first: boolean; title: string }) {
  const initial = useMemo(() => firmBody(firm), []); const [f, setF] = useState(initial); const [tried, setTried] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof FirmBody, boolean>>>({}); const [serverErrors, setServerErrors] = useState<Partial<Record<keyof FirmBody, string>>>({});
  const [saveError, setSaveError] = useState<ApiProblem | null>(null); const [signError, setSignError] = useState(""); const [picture, setPicture] = useState<File | null | undefined>();
  const [preview, setPreview] = useState<string | null>(firm?.signature_url ?? null); const [filled, setFilled] = useState<{ gstin: string; fields: string[] }>({ gstin: "", fields: [] });
  const [bankCheck, setBankCheck] = useState(false); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null); const [badDate, setBadDate] = useState(false); const [partial, setPartial] = useState<false | "sign" | "switch">(false);
  const sending = useRef(false); const savedId = useRef(firm?.id); const fileRef = useRef<HTMLInputElement>(null); const objectUrl = useRef<string | null>(null);
  const saveFirm = useSaveFirm(); const signature = useSignature(); const shop = useShopSettings(); const navigate = useNavigate(); const toast = useToast(); const { isPhone } = useView(); const { echo, say } = useEcho();
  const backTo = firm ? `/firms/${firm.id}` : first ? "/setup" : "/firms"; const back = useBack(backTo);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial) || picture !== undefined;
  const guard = useUnsavedGuard(dirty && !done);
  useEffect(() => { if (done) navigate(done, { replace: true }); }, [done, navigate]);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  const set = <K extends keyof FirmBody>(key: K, value: FirmBody[K]) => { setF((v) => ({ ...v, [key]: value })); setServerErrors((e) => ({ ...e, [key]: undefined })); setSaveError(null); };
  const gstin = useDebounced(f.gst_number); // the stored GSTIN is never looked up: opening the edit form must not change it
  const registry = useRegistry(firm && gstin === firm.gst_number ? "" : gstin);
  useEffect(() => {
    const answer = registry.data;
    if (!answer || answer.gstin !== f.gst_number || answer.status !== "found" || !answer.registry?.active || filled.gstin === answer.gstin) return;
    const r = answer.registry; const names: string[] = []; const patch: Partial<FirmBody> = {};
    for (const [key, value, label] of [["name", r.legal_name, "the name"], ["address", r.address, "the address"], ["city", r.city, "the city"], ["pin_code", r.pin_code, "the PIN code"]] as const) if (!f[key].trim() && value) { patch[key] = value; names.push(label); }
    setFilled({ gstin: answer.gstin, fields: names }); if (names.length) setF((v) => ({ ...v, ...patch }));
  }, [registry.data, f.gst_number, f.name, f.address, f.city, f.pin_code, filled.gstin]);
  const g = checkGstin(f.gst_number); const valid = g.status === "valid"; const errs = { ...serverErrors, ...firmErrors(f, firm, firms.filter((item) => item.id !== savedId.current)), ...(badDate ? { paper_full_number_from: "Type the date like 2027-04-01." } : {}) };
  const show = (k: keyof FirmBody) => (tried || touched[k] || serverErrors[k] ? errs[k] : undefined);
  const fullFy = firm?.numbers.fy ?? fyOf(todayIST()); const counter = firm?.numbers.next.counter ?? 1; const next = fullNumber(errs.invoice_prefix ? firm?.invoice_prefix ?? "" : f.invoice_prefix, fullFy, counter);
  const changedGstin = firm && f.gst_number !== firm.gst_number && valid; const changedPrefix = firm && f.invoice_prefix !== firm.invoice_prefix && !errs.invoice_prefix;
  const bankChanged = firm && (f.bank_account_number !== initial.bank_account_number || f.bank_ifsc_code !== initial.bank_ifsc_code) && Boolean(f.bank_account_number || initial.bank_account_number);
  const save = async (checked = false) => {
    if (sending.current) return; setTried(true);
    const errorKeys = (Object.keys(IDS) as (keyof FirmBody)[]).filter((k) => errs[k]);
    if (errorKeys.length || signError) { const key = errorKeys[0]; const el = document.getElementById(key ? IDS[key] : "fm-sign"); if (el === document.activeElement) say(key ? errs[key]! : signError); el?.focus({ preventScroll: true }); scrollIntoViewSafe(el, { block: "center" }); return; }
    if (bankChanged && !checked) { setBankCheck(true); return; }
    sending.current = true; setBusy(true); setSaveError(null);
    const body = { ...f, mobile_number: firm && f.mobile_number === initial.mobile_number ? f.mobile_number : mobileDigits(f.mobile_number) }; let stored = false; let stage: "sign" | "switch" = "sign";
    try {
      // While a new picture waits to upload, the first save keeps the stored switch: a refused upload must not turn the old signature on
      const opening = picture ? { ...body, signature_on_bills: firm?.signature_on_bills ?? false } : body;
      let result = await saveFirm.mutateAsync({ id: savedId.current, body: opening }); savedId.current = result.id; stored = true;
      if (picture !== undefined) {
        result = await signature.mutateAsync({ id: result.id, image: picture });
        setPicture(undefined); stage = "switch";
      }
      // Upload enables the picture. An explicit switch-off still wins.
      if (picture && !body.signature_on_bills) result = await saveFirm.mutateAsync({ id: result.id, body });
      setPartial(false); setBankCheck(false); markSaved("firm", result.id);
      if (firm) {
        const words = [f.bank_account_number !== initial.bank_account_number ? `Account number changed: ${initial.bank_account_number || "None"} → ${f.bank_account_number || "None"}.` : "", f.bank_ifsc_code !== initial.bank_ifsc_code ? `IFSC changed: ${initial.bank_ifsc_code || "None"} → ${f.bank_ifsc_code || "None"}.` : "", bankChanged ? "Every bill now prints the new account." : "", changedGstin ? `New bills print GSTIN ${f.gst_number}; bills already made keep theirs.` : "", changedPrefix ? `New bills are numbered ${next} onwards.` : ""].filter(Boolean);
        if (words.length) toast.show({ title: `${result.name} saved`, body: words.join(" ") });
      }
      setDone(first ? "/setup" : `/firms/${result.id}`);
    } catch (e) { const problem = problemOf(e); setSaveError(problem); setServerErrors(problem.fields ?? {}); if (stored) { setPartial(stage); if (problem.fields?.image) setSignError(problem.fields.image); } }
    finally { sending.current = false; setBusy(false); }
  };
  useCtrlS(() => { void save(); });
  const selectPicture = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setSignError(`${file.name} isn't a picture. Pick a PNG or JPG of the signature.`); return; }
    if (file.size > 1024 * 1024) { setSignError(`That picture is ${(file.size / 1048576).toFixed(1)} MB. Pick one under 1 MB; a phone photo cropped to the signature is fine.`); return; }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = URL.createObjectURL(file);
    setPicture(file); setPreview(objectUrl.current); set("signature_on_bills", true); setSignError("");
  };
  type TextKey = Exclude<keyof FirmBody, "signature_on_bills" | "paper_full_number_from">;
  const input = (key: TextKey, props: InputHTMLAttributes<HTMLInputElement> = {}, transform = (v: string) => v) => <Input id={IDS[key]} value={f[key]} onChange={(e) => set(key, transform(e.target.value))} onBlur={() => setTouched((v) => ({ ...v, [key]: true }))} autoComplete="off" invalid={Boolean(show(key))} {...props} />;
  const grid = isPhone ? "flex flex-col gap-4" : "grid grid-cols-2 gap-x-5 gap-y-4";
  const bankFields = <div className={grid}><Field label="Bank" htmlFor={IDS.bank_name} error={show("bank_name")} hint="As on the passbook, like State Bank of India">{input("bank_name")}</Field><Field label="Branch" htmlFor={IDS.bank_branch_name} error={show("bank_branch_name")}>{input("bank_branch_name")}</Field><Field label="Account number" htmlFor={IDS.bank_account_number} error={show("bank_account_number")}>{input("bank_account_number", { inputMode: "numeric" }, (s) => s.replace(/\D/g, ""))}</Field><Field label="IFSC" htmlFor={IDS.bank_ifsc_code} error={show("bank_ifsc_code")}>{input("bank_ifsc_code", { spellCheck: false }, (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))}</Field></div>;
  const numbering = <div className="flex flex-col gap-3"><div className={grid}><Field label="Number prefix" htmlFor={IDS.invoice_prefix} error={show("invoice_prefix")} hint={f.invoice_prefix ? `Bills look like ${next}` : "Optional, like KGH. Blank gives bare numbers: 1, 2, 3."}>{input("invoice_prefix", { spellCheck: false }, (s) => s.toUpperCase())}</Field><div className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg2">{firm ? "Next bill number" : "First bill number"}</span><span className="min-h-11 flex items-center px-3 rounded-ctl border border-line bg-raised tnum font-semibold text-brand">{next}</span><span className="text-sm text-muted">{firm ? "Follows the last bill this year, so numbers never skip or repeat." : "Each financial year starts again at 1."}</span></div></div>
    {changedPrefix ? <Banner tone="brand" icon={AlertTriangle} title={firm.numbers.last ? "Changing the prefix mid-year starts a second series" : "Bills of earlier years keep their numbers"}>New bills will be {next} onwards, and GSTR-1 lists both series under Documents issued. If you can, change it from 1 April instead, and tell your CA.</Banner> : null}
    <Field label="Paper bills carry the full number from" htmlFor={IDS.paper_full_number_from} error={show("paper_full_number_from")} hint="Numbers already stored never change."><Input id={IDS.paper_full_number_from} type="date" min="2000-01-01" max="2099-12-31" value={f.paper_full_number_from ?? ""} invalid={Boolean(show("paper_full_number_from"))} onBlur={() => setTouched((v) => ({ ...v, paper_full_number_from: true }))}
      // a half-typed date reads as empty: keep the saved date and say how to type it
      onChange={(e) => { const bad = !e.target.value && e.target.validity.badInput; setBadDate(bad); if (!bad) set("paper_full_number_from", e.target.value || null); }} /></Field>
    {f.paper_full_number_from && !errs.paper_full_number_from ? <p className="text-sm text-fg2">{paperNumberWords(f.paper_full_number_from, f.invoice_prefix)}</p> : null}
    {firm && firm.plain_after_full_date > 0 && f.paper_full_number_from === firm.paper_full_number_from ? <p className="text-sm text-muted">{plural(firm.plain_after_full_date, "bill")} from that date keep the numbers they were saved with</p> : null}
  </div>;
  const sign = <div className="flex flex-col gap-3"><Switch label="Print the signature on bills" description={f.signature_on_bills ? "It prints above “Authorised signatory”." : "Bills print a blank line to sign by hand."} checked={f.signature_on_bills} onChange={(v) => set("signature_on_bills", v)} /><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Signature picture" onChange={(e) => { selectPicture(e.target.files?.[0]); e.target.value = ""; }} /><div className={cn("flex gap-4", isPhone ? "flex-col" : "items-start")}><SignaturePreview name={f.name} image={preview} on={f.signature_on_bills} className={isPhone ? "" : "w-[280px] shrink-0"} /><div id="fm-sign" tabIndex={-1} className="flex flex-col gap-2 outline-none min-w-0"><p className="text-sm text-fg2">{preview ? "This picture prints on every bill." : "Upload a picture of the signature on white paper; it prints only while the switch is on."}</p><div className="flex flex-wrap gap-2"><Button icon={Upload} onClick={() => fileRef.current?.click()}>{preview ? "Change picture" : "Upload a picture"}</Button>{preview ? <Button variant="ghost" icon={Trash2} onClick={() => { setPicture(savedId.current ? null : undefined); setPreview(null); set("signature_on_bills", false); setSignError(""); }}>Remove signature</Button> : null}</div>{signError ? <p role="alert" className="text-sm text-neg">{signError}</p> : <p className="text-sm text-muted">PNG or JPG, under 1 MB.</p>}</div></div></div>;
  const smallPrint = <div className="flex flex-col gap-4"><Field label="Jurisdiction" htmlFor={IDS.jurisdiction} error={show("jurisdiction")} hint={`Optional · prints as “Subject to ${f.jurisdiction || f.city || "Udaipur"} jurisdiction”`}>{input("jurisdiction")}</Field><Field label="Declaration" htmlFor={IDS.declaration} error={show("declaration")} hint={f.declaration.trim() ? "Optional" : "Left empty, bills print the standard sentence."}><Textarea id={IDS.declaration} value={f.declaration} onChange={(e) => set("declaration", e.target.value)} onBlur={() => setTouched((v) => ({ ...v, declaration: true }))} invalid={Boolean(show("declaration"))} rows={3} /></Field></div>;
  const saveLabel = busy ? "Saving…" : firm ? "Save firm details" : first ? "Save and continue" : "Add firm";
  const saveButton = <Button variant="primary" icon={Check} loading={busy && !bankCheck} onClick={() => { void save(); }} title="Ctrl S" {...keepFocus}>{saveLabel}</Button>;
  const lookup = registry.data?.gstin === f.gst_number ? registry.data : null; const record = lookup?.registry;
  const partialMessage = <Banner tone="brand" title="Firm details were saved">{partial === "switch" ? "The signature was saved, but it still prints on bills: switching that off didn't go through. Save again to switch it off." : "The signature wasn't saved. What you chose is still here. Save again to finish."}{saveError ? <p>{saveError.message}</p> : null}</Banner>;
  const errors = (Object.keys(IDS) as (keyof FirmBody)[]).filter((k) => errs[k]).map((k) => ({ field: IDS[k], text: errs[k]! }));
  return <Page narrow icon={first ? Sparkles : Building2} title={title} back={backTo} breadcrumbs={first ? [{ label: "Set up", to: "/setup" }] : [{ label: "Firms", to: "/firms" }]} context={first ? "Your GST registration: its GSTIN, address and bill numbers print on every bill. Four things are required; the rest can wait." : firm ? `Prints on every ${firm.short} bill · bills already made keep their details` : "A new GST registration with its own bill numbers"} phoneSubtitle={first ? "Step 1 of 4 · your GST registration" : firm ? "Owner only · prints on every bill" : "A new GST registration"} actions={<><Button variant="ghost" onClick={back} disabled={busy}>Cancel</Button>{saveButton}</>} actionBar={saveButton}>
    {guard}{echo}<form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-5">{tried && errors.length ? <ErrorSummary items={errors} /> : null}
      {partial ? partialMessage : null}<SaveError problem={partial ? null : saveError} onRetry={() => { void save(); }} />
      <Card title="Registration" subtitle="As on the GST certificate"><div className={grid}><Field label="GSTIN" htmlFor={IDS.gst_number} required error={show("gst_number")}><Input id={IDS.gst_number} value={f.gst_number} onChange={(e) => set("gst_number", cleanGstin(e.target.value))} onBlur={() => setTouched((v) => ({ ...v, gst_number: true }))} autoFocus={!firm && !isPhone} autoComplete="off" spellCheck={false} maxLength={15} placeholder="15 characters" inputClassName="tnum tracking-wide uppercase placeholder:normal-case placeholder:tracking-normal" aria-describedby="fm-gstin-status" /><div id="fm-gstin-status" aria-live="polite" className="min-h-5 flex flex-col gap-1">{valid ? <p className="text-sm text-sale flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden="true" />Valid · {stateLabel(g.state)} · PAN {g.pan}</p> : <p className="text-sm text-muted">{f.gst_number ? `${f.gst_number.length} of 15 characters` : "The state and PAN fill in from it, and the GST registry fills in what's empty."}</p>}
      {valid && registry.isFetching && gstin === f.gst_number ? <p className="text-sm text-muted">Checking the GST registry…</p> : null}
      {valid && gstin === f.gst_number && (registry.isError || lookup?.lookup === "unreachable") ? <p className="text-sm text-muted" role="status">The GST registry didn't answer. The state and PAN come from the number itself.</p> : lookup?.status === "unknown" ? <p className="text-sm text-muted" role="status">The GST registry has no details for this GSTIN yet. The number itself checks out.</p> : record ? <p role="status" className={record.active ? "text-sm text-sale" : "text-sm text-neg"}>{record.active ? `Active since ${date(record.registered_on)} · ${record.trade_name || record.legal_name} · ${record.city}` : "Cancelled"}{filled.gstin === f.gst_number && filled.fields.length ? ` · Filled in ${filled.fields.join(" and ")} from the registry` : ""}</p> : null}</div></Field>
      <Field label="PAN" htmlFor="fm-pan" hint="From the GSTIN"><Input id="fm-pan" value={valid ? g.pan : firm?.pan_number ?? ""} disabled placeholder="Fills in from the GSTIN" /></Field><Field label="Legal name" htmlFor={IDS.name} required error={show("name")} className={isPhone ? "" : "col-span-2"}>{input("name", { placeholder: "As on the GST certificate" })}</Field><Field label="Short name" htmlFor={IDS.short_name} error={show("short_name")} hint="Optional · blank uses the first word of the name">{input("short_name")}</Field></div>
      {changedGstin ? <Banner tone="brand" icon={AlertTriangle} title="Bills already made keep the old GSTIN">The bills {firm.name} has made keep {firm.gst_number} printed on them, as GST law needs. New bills from now on use {f.gst_number}. If the firm has a new registration, check with your CA before saving.</Banner> : null}{firm && f.name.trim() !== firm.name && !errs.name ? <p className="mt-3 text-sm text-fg2 flex items-start gap-2"><Info size={16} aria-hidden="true" />Bills already made keep the name {firm.name}.</p> : null}</Card>
      <Card title="Address and contact" subtitle="Printed under the firm's name"><div className={grid}><Field label="Address" htmlFor={IDS.address} required error={show("address")} className={isPhone ? "" : "col-span-2"}>{input("address", { placeholder: "Shop number, street, area" })}</Field><Field label="City" htmlFor={IDS.city} hint="Optional" error={show("city")}>{input("city")}</Field><Field label="PIN code" htmlFor={IDS.pin_code} hint="Optional" error={show("pin_code")}>{input("pin_code", { inputMode: "numeric" }, (v) => v.replace(/\D/g, ""))}</Field><Field label="Phone" htmlFor={IDS.mobile_number} required error={show("mobile_number")}>{input("mobile_number", { type: "tel", inputMode: "numeric", placeholder: "10-digit mobile" })}</Field><Field label="Email" htmlFor={IDS.email} hint="Optional" error={show("email")}>{input("email", { type: "email", inputMode: "email" })}</Field></div></Card>
      {first ? <Card><div className="flex flex-col divide-y divide-rule -my-2"><Disclosure title="Bank details" summary="Optional · printed on bills so customers can pay by transfer">{bankFields}</Disclosure><Disclosure title="Bill numbers" summary={`Optional prefix · the first bill will be ${next}`}>{numbering}</Disclosure><Disclosure title="Signature and small print" summary="Optional · signature picture, jurisdiction, declaration">{sign}<div className="mt-4">{smallPrint}</div></Disclosure></div></Card> : <><Card title="Bank details" subtitle={shop.data?.show_bank === false ? "Optional · turned off for bills in Settings" : "Optional · printed on every bill, so customers can pay by bank transfer"}>{bankFields}</Card><Card title="Bill numbers" subtitle="Each firm numbers its own bills, from 1 every financial year">{numbering}</Card><Card title="Signature" subtitle="At the foot of every bill">{sign}</Card><Card title="Small print" subtitle="At the foot of every bill">{smallPrint}</Card></>}
      {!isPhone ? <div className="flex items-center justify-end gap-2"><span className={cn("text-sm mr-auto", dirty ? "text-fg2" : "text-muted")}>{!firm ? "Ctrl S saves" : dirty ? "Unsaved changes · Ctrl S saves" : "No changes yet"}</span><Button variant="ghost" onClick={back} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" icon={Check} loading={busy && !bankCheck} {...keepFocus}>{saveLabel}</Button></div> : null}
    </form><ConfirmDialog open={bankCheck} busy={busy} busyLabel="Saving…" onClose={() => setBankCheck(false)} onConfirm={() => { void save(true); }} title="Check the new bank account" confirmLabel="Save the new account" record={firm ? [["Account number", f.bank_account_number !== initial.bank_account_number ? `${initial.bank_account_number || "None"} → ${f.bank_account_number || "None"}` : f.bank_account_number || "None"], ["IFSC", f.bank_ifsc_code !== initial.bank_ifsc_code ? `${initial.bank_ifsc_code || "None"} → ${f.bank_ifsc_code || "None"}` : f.bank_ifsc_code || "None"], ["Bank", [f.bank_name, f.bank_branch_name].filter(Boolean).join(", ") || "Not given"]] : null} extra={partial ? partialMessage : <SaveError problem={saveError} onRetry={() => { void save(true); }} />}><p>Customers will pay into this account: it prints on every {firm?.short} bill from now on, old bills included when printed again. Check it digit by digit against the passbook or a cancelled cheque.</p></ConfirmDialog>
  </Page>;
}
