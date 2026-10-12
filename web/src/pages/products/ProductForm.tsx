// Port of PROTO records/ProductForm.jsx, with paper-first rates and the Records contract's stored fields.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Package, Check, AlertTriangle, Info } from "lucide-react";
import { useCatalogSearch, useProduct, useSaveProduct, type ProductBody, type ProductDetail } from "@/core/api/catalog";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { plural, qty, UNITS } from "@/core/format";
import { MOD } from "@/core/modifierKeys";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { useScope } from "@/core/scope";
import { Page, Card, Button, ButtonLink, Field, Input, Select, Switch, Textarea, QueryView, scrollIntoViewSafe, optionClass } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { keepFocus, markSaved, safeReturn, useBack, useCtrlS } from "@/pages/customers/lib";
import { ErrorSummary, MissingRecord, NoAccess, SaveError, useEcho } from "@/pages/customers/parts";
import { RateInput } from "@/pages/sales/form/fields";
import { idParam, SLABS, slabOf } from "@/pages/sales/form/model";
import { HSN_SUGGESTIONS, inferredKind, KIND_LABEL, perUnit, PURITY_CHIPS, slabSplit, slabWarning } from "./lib";

const IDS: Record<keyof ProductBody, string> = { name: "pr-name", hsn_code: "pr-hsn", gst_percent: "pr-gst", unit: "pr-unit", kind: "pr-kind", purity: "pr-purity", usual_rate: "pr-rate", purchase_only: "pr-bought", description: "pr-desc" };
const ORDER = Object.keys(IDS) as (keyof ProductBody)[];
const HINT: Record<string, string> = { "0": "exempt", "0.25": "cut and polished diamonds (HSN 7102)", "3": "gold, silver and jewellery (HSN 71)", "5": "job work on jewellery", "18": "most services, packing" };
const SLAB_OPTIONS = [...SLABS].sort((a, b) => Number(a) - Number(b)).map((s) => ({ value: s, label: `${s}%${HINT[s] ? ` · ${HINT[s]}` : ""}` }));
const UNIT_OPTIONS = UNITS.map((u) => ({ value: u.value, label: `${u.label}${u.decimals ? ` · ${u.decimals} decimals` : " · whole numbers"}` }));
const normalized = (name: string) => name.trim().replace(/\s+/g, " ");
export default function ProductForm() {
  const { id } = useParams();
  const pid = idParam(id ?? null);
  const { firmId, fy } = useScope();
  const one = useProduct(pid, { firmId, fy });
  const { can, whyNot } = useAuth();
  if (!can("product.edit")) return <Page narrow icon={Package} title={id ? "Edit product" : "Add product"} back="/products"><NoAccess title="You can't add or change products" actions={<ButtonLink to="/products">All products</ButtonLink>}>{whyNot("product.edit")} The HSN and GST rate on every bill come from here, so changes are kept to one person.</NoAccess></Page>;
  if (id && (pid === null || (one.isError && problemOf(one.error).kind === "notfound"))) return <MissingRecord icon={Package} title="This product isn't on file" to="/products" label="All products" />;
  return id ? <QueryView query={one} what="the product">{(p) => <Form key={p.id} existing={p} />}</QueryView> : <Form existing={null} />;
}
function Form({ existing }: { existing: ProductDetail | null }) {
  const { isPhone } = useView();
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const back = useBack(existing ? `/products/${existing.id}` : "/products");
  const mutation = useSaveProduct();
  const [initial] = useState<ProductBody>(() => existing ? { name: existing.name, hsn_code: existing.hsn_code, gst_percent: existing.gst_percent, unit: existing.unit, purity: existing.purity, usual_rate: existing.usual_rate, purchase_only: existing.purchase_only, kind: existing.kind, description: existing.description } : { name: query.get("name") ?? "", hsn_code: "", gst_percent: "", unit: "gms", purity: "", usual_rate: null, purchase_only: false, kind: null, description: "" });
  const [f, setF] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof ProductBody, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [hsnOpen, setHsnOpen] = useState(false);
  const [picked, setPicked] = useState<typeof HSN_SUGGESTIONS[number] | null>(null);
  const [saveError, setSaveError] = useState<ApiProblem | null>(null);
  const [server, setServer] = useState<Record<string, string>>({});
  const [goTo, setGoTo] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const leave = useUnsavedGuard(dirty && !goTo);
  const { echo, say } = useEcho();
  useEffect(() => { if (goTo) navigate(goTo, { replace: true }); }, [goTo, navigate]);
  const set = <K extends keyof ProductBody>(key: K, value: ProductBody[K]) => { setF((old) => ({ ...old, [key]: value })); setSaveError(null); setServer((old) => ({ ...old, [key]: "" })); say(""); };
  const touch = (key: keyof ProductBody) => () => setTouched((t) => ({ ...t, [key]: true }));
  const term = useDebounced(normalized(f.name));
  const matches = useCatalogSearch(term, term.length >= 3);
  const twin = matches.data?.find((p) => p.id !== existing?.id && normalized(p.name).toLowerCase() === normalized(f.name).toLowerCase());
  const renamed = !existing || normalized(existing.name).toLowerCase() !== normalized(f.name).toLowerCase();
  const errs: Partial<Record<keyof ProductBody, string>> = { ...server };
  if (!f.name.trim()) errs.name = "Enter the product's name, as it should print on bills.";
  else if (normalized(f.name).length > 255) errs.name = "Keep the name to 255 characters.";
  else if (twin && renamed) errs.name = `There's already a product called ${twin.name}. Names that differ only in capital letters confuse the bill form; use a different name.`;
  if (!f.hsn_code) errs.hsn_code = "Enter the HSN code. Every bill line needs one for GSTR-1.";
  else if (!/^\d{4,8}$/.test(f.hsn_code)) errs.hsn_code = `HSN codes have 4 to 8 digits; this has ${f.hsn_code.length}.`;
  if (!f.gst_percent) errs.gst_percent = "Choose the GST rate. There's no default, so a wrong rate can't slip onto bills.";
  else if (!slabOf(f.gst_percent) && f.gst_percent !== existing?.gst_percent) errs.gst_percent = "Choose one of the GST rates: 0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28 or 40%.";
  if (f.purity.length > 20) errs.purity = "Keep the purity short, like 22K or 925 (20 characters at most).";
  if (f.description.length > 1000) errs.description = "Keep the description to 1,000 characters.";
  if (f.usual_rate && (!/^\d+(\.\d{1,3})?$/.test(f.usual_rate) || Number(f.usual_rate) <= 0 || Number(f.usual_rate) >= 100_000_000)) errs.usual_rate = `Type the rate ${perUnit(f.unit)}, like 6470.00, or leave it empty.`;
  const show = (key: keyof ProductBody) => (tried || touched[key] || server[key] || (key === "name" && twin && renamed)) ? errs[key] : undefined;
  // the kind the server goes by while none is stored
  const autoKind = existing && existing.kind === null && f.name === initial.name && f.hsn_code === initial.hsn_code ? existing.kind_effective : inferredKind(f.hsn_code, f.name);
  const kind = f.kind ?? autoKind;
  const warn = slabWarning(f.hsn_code, f.gst_percent);
  const known = HSN_SUGGESTIONS.find((h) => h.hsn === f.hsn_code);
  const candidates = HSN_SUGGESTIONS.filter((h) => !f.hsn_code || h.hsn.includes(f.hsn_code));
  const pick = (h: typeof HSN_SUGGESTIONS[number]) => {
    // a suggestion stores its kind only when the automatic one would differ: nobody chose a kind by picking an HSN
    const auto = inferredKind(h.hsn, f.name); const stored = h.kind && h.kind !== auto ? h.kind : null; const nextKind = stored ?? auto;
    setF((old) => ({ ...old, hsn_code: h.hsn, gst_percent: h.gst, kind: stored, purity: nextKind !== kind && old.purity && !PURITY_CHIPS[nextKind].includes(old.purity) ? "" : old.purity }));
    setPicked(h); setSaveError(null); setServer((old) => ({ ...old, hsn_code: "", gst_percent: "" }));
    document.getElementById(IDS.hsn_code)?.focus(); setHsnOpen(false);
  };
  const hsnKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hsnOpen) { e.preventDefault(); listRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus(); }
    if (e.key === "Escape") setHsnOpen(false);
    if (e.key === "Enter") { e.preventDefault(); const list = HSN_SUGGESTIONS.filter((h) => h.hsn.startsWith(f.hsn_code)); const h = known ?? (f.hsn_code && list.length === 1 ? list[0] : null); if (h) pick(h); else setHsnOpen(false); }
  };
  const focusError = (errors: Partial<Record<keyof ProductBody, string>>) => {
    const key = ORDER.find((k) => errors[k]);
    if (!key) return false;
    const el = document.getElementById(IDS[key]); el?.focus({ preventScroll: true }); scrollIntoViewSafe(el, { block: "center" }); say(errors[key] ?? ""); return true;
  };
  const save = async () => {
    if (inFlight.current) return;
    flushSync(() => setTried(true));
    if (focusError(errs)) return;
    inFlight.current = true;
    try {
      const p = await mutation.mutateAsync({ id: existing?.id, body: { ...f, name: normalized(f.name), purity: f.purity.trim(), description: f.description.trim(), usual_rate: f.usual_rate || null } });
      markSaved("product", p.id);
      const backTo = safeReturn(query.get("return"));
      setGoTo(backTo ? `${backTo}${backTo.includes("?") ? "&" : "?"}product=${p.id}` : existing ? `/products/${p.id}` : "/products");
    } catch (e) {
      const p = problemOf(e);
      flushSync(() => { setSaveError(p); setServer(p.fields ?? {}); });
      focusError(p.fields ?? {});
    } finally { inFlight.current = false; }
  };
  useCtrlS(() => void save());
  const busy = mutation.isPending;
  const saveLabel = busy ? "Saving…" : existing ? "Save changes" : "Save product";
  const grid = isPhone ? "flex flex-col gap-4" : "grid grid-cols-2 gap-x-5 gap-y-4";
  const usedOn = existing ? existing.uses.sales + existing.uses.cancelled : 0;
  const changedTax = existing && (f.gst_percent !== initial.gst_percent || f.hsn_code !== initial.hsn_code || f.usual_rate !== initial.usual_rate);
  const saveButton = <Button variant="primary" icon={Check} onClick={() => void save()} loading={busy} title={`${MOD} S`} {...keepFocus}>{saveLabel}</Button>;
  return <Page narrow icon={Package} title={existing ? `Edit ${existing.name}` : "Add product"} back={existing ? `/products/${existing.id}` : "/products"} breadcrumbs={[{ label: "Products", to: "/products" }, ...(existing ? [{ label: existing.name, to: `/products/${existing.id}` }] : [])]}
    context={existing ? usedOn ? `On ${plural(usedOn, "sales bill")} already · those keep their figures` : "Not on any sales bill yet" : "HSN and GST rate print on every bill line"} phoneSubtitle={existing ? "Bills already made keep their figures" : "HSN and GST rate are required"}
    actions={<><Button variant="ghost" onClick={back} disabled={busy}>Cancel</Button>{saveButton}</>} actionBar={saveButton}>
    {leave}{echo}
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="flex flex-col gap-5">
      {tried ? <ErrorSummary items={ORDER.filter((k) => errs[k]).map((k) => ({ field: IDS[k], text: errs[k]! }))} /> : null}
      <SaveError problem={saveError} onRetry={() => void save()} />
      {existing && twin && !renamed ? <p className="text-sm text-fg2 flex items-start gap-2 anim-rise"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-neg" aria-hidden="true" /><span><Link to={`/products/${twin.id}`} className="underline underline-offset-2">{twin.name}</Link> has the same name in different capitals (from older data). You can still save this one; renaming one of them stops the bill form mixing them up.</span></p> : null}
      {existing && normalized(f.name) !== normalized(existing.name) ? <p className="text-sm text-fg2">Bills already made keep the old name. This product's page still counts them under its earlier names.</p> : null}
      <fieldset disabled={busy} className="flex flex-col gap-5 min-w-0">
        <Card title="Product"><div className={grid}>
          <Field label="Name" htmlFor={IDS.name} required error={show("name")} hint="As it prints on bills, like Gold necklace 22K." className={isPhone ? "" : "col-span-2"}><Input id={IDS.name} value={f.name} onChange={(e) => set("name", e.target.value)} onBlur={touch("name")} autoComplete="off" autoFocus={!existing && !isPhone} invalid={Boolean(show("name"))} /></Field>
          <Field label="Kind" htmlFor={IDS.kind} hint="Groups products in lists and reports."><Select id={IDS.kind} value={f.kind ?? ""} onChange={(e) => set("kind", (e.target.value || null) as ProductBody["kind"])} options={[{ value: "", label: `Automatic: ${KIND_LABEL[autoKind]}` }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]} /></Field>
          <Field label="Purity" htmlFor={IDS.purity} error={show("purity")} hint={kind === "diamond" ? "Optional. A clarity grade like VVS or VS; prints next to the name." : "Optional. Prints next to the name."}><Input id={IDS.purity} value={f.purity} onChange={(e) => set("purity", e.target.value)} autoComplete="off" invalid={Boolean(show("purity"))} />{PURITY_CHIPS[kind].length ? <div className="flex flex-wrap gap-1.5" role="group" aria-label={kind === "diamond" ? "Common diamond grades" : "Common purities"}>{PURITY_CHIPS[kind].map((x) => <button key={x} type="button" onClick={() => set("purity", x)} aria-pressed={f.purity === x} className={cn("rounded-full border px-2.5 text-sm transition-colors", isPhone ? "min-h-11 min-w-11" : "h-7", f.purity === x ? "bg-brand-sel border-brand text-brand font-semibold" : "border-ctl-line text-fg2 hover:text-fg")}>{x}</button>)}</div> : null}</Field>
          <Field label="Description" htmlFor={IDS.description} error={show("description")} hint="Optional, like “plain and Rajkot designs, 916 hallmarked”. Shows on the product page and helps search; not printed on bills." className={isPhone ? "" : "col-span-2"}><Textarea id={IDS.description} value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className="min-h-[64px]" invalid={Boolean(show("description"))} /></Field>
        </div></Card>
        <Card title="Tax" subtitle="Both are required. The rate has no default on purpose."><div className={grid}>
          <Field label="HSN code" htmlFor={IDS.hsn_code} required error={show("hsn_code")} hint={known?.name ?? "4 to 8 digits, like 7113 for gold jewellery. Common codes open as you click here; picking one sets the rate."}>
            <Input id={IDS.hsn_code} value={f.hsn_code} inputMode="numeric" maxLength={8} autoComplete="off" role="combobox" aria-expanded={hsnOpen} aria-controls="pr-hsn-list" aria-autocomplete="list" onChange={(e) => { set("hsn_code", e.target.value.replace(/\D/g, "").slice(0, 8)); setHsnOpen(true); setPicked(null); }} onFocus={() => setHsnOpen(true)} onBlur={(e) => { touch("hsn_code")(); if (!listRef.current?.contains(e.relatedTarget)) setHsnOpen(false); }} onKeyDown={hsnKeys} inputClassName="tnum" invalid={Boolean(show("hsn_code"))} />
            {hsnOpen ? <div ref={listRef} id="pr-hsn-list" role="listbox" aria-label="Common HSN codes" className="rounded-ctl border border-line bg-card shadow-pop max-h-[260px] overflow-y-auto py-1 anim-rise" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && (e.relatedTarget as HTMLElement | null)?.id !== IDS.hsn_code) setHsnOpen(false); }} onKeyDown={(e) => {
              const els = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]; const at = els.indexOf(document.activeElement as HTMLElement);
              if (e.key === "ArrowDown") { e.preventDefault(); els[(at + 1) % els.length]?.focus(); }
              if (e.key === "ArrowUp") { e.preventDefault(); if (at <= 0) document.getElementById(IDS.hsn_code)?.focus(); else els[at - 1]?.focus(); }
              if (e.key === "Escape") { e.preventDefault(); document.getElementById(IDS.hsn_code)?.focus(); setHsnOpen(false); }
            }}>{candidates.length ? candidates.map((h) => <button key={h.hsn} type="button" role="option" aria-selected={h.hsn === f.hsn_code} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} className={cn("w-full flex items-center gap-3 px-3.5 text-left focus:bg-raised outline-none", optionClass(h.hsn === f.hsn_code), isPhone ? "min-h-12" : "min-h-10")}><span className="tnum font-medium w-20 shrink-0">{h.hsn}</span><span className="flex-1 min-w-0 truncate text-fg2">{h.name}</span><span className="text-sm text-brand font-semibold shrink-0">{h.gst}%</span></button>) : <p className="text-sm text-muted">No common code starts with {f.hsn_code}. Type the full code from your CA's list.</p>}</div> : null}
            {picked ? <p key={picked.hsn} className="text-sm text-sale anim-rise">Picked {picked.hsn} · {picked.name}: GST set to {picked.gst}%.</p> : null}
          </Field>
          <Field label="GST rate" htmlFor={IDS.gst_percent} required error={show("gst_percent")} hint={f.gst_percent ? slabSplit(f.gst_percent) : "Pick the slab for this HSN."}><Select id={IDS.gst_percent} value={f.gst_percent} placeholder="Choose the GST rate" onChange={(e) => { set("gst_percent", e.target.value); touch("gst_percent")(); setPicked(null); }} options={[...(existing && !existing.slab_ok ? [{ value: existing.gst_percent, label: `${existing.gst_percent}% · Not a GST rate` }] : []), ...SLAB_OPTIONS]} invalid={Boolean(show("gst_percent"))} />{known && f.gst_percent !== known.gst ? <p className="text-sm text-fg2 flex flex-wrap items-center gap-x-2 anim-rise"><span>{known.hsn} is {known.name.toLowerCase()}</span><Button size="sm" variant="link" onClick={() => pick(known)}>Use {known.gst}%</Button></p> : null}</Field>
        </div><div id="pr-gst-warn" role="status">{warn ? <p className="mt-4 text-sm text-neg flex items-start gap-2 anim-rise"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{warn}</p> : null}</div>{changedTax && usedOn ? <p className="mt-3 text-sm text-fg2 flex items-start gap-2 anim-rise"><Info size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />The {plural(usedOn, "sales bill")} already made keep the HSN, rate and GST they were made with. New bills use what you save here.</p> : null}</Card>
        <Card title="On bills"><div className={grid}>
          <Field label="Unit" htmlFor={IDS.unit} hint={`Quantities print like ${qty(UNITS.find((u) => u.value === f.unit)?.decimals ? 12.345 : 2, f.unit)}.`}><Select id={IDS.unit} value={f.unit} onChange={(e) => set("unit", e.target.value)} options={UNIT_OPTIONS} /></Field>
          <Field label={`Usual rate · ${perUnit(f.unit)}`} htmlFor={IDS.usual_rate} error={show("usual_rate")} hint="Shown on the product; bills take the rate written on the paper bill"><RateInput id={IDS.usual_rate} value={f.usual_rate ?? ""} onChange={(v) => set("usual_rate", v || null)} invalid={Boolean(show("usual_rate"))} /></Field>
          <div className={cn("border-t border-rule pt-3", isPhone ? "" : "col-span-2")}><Switch label="Bought only, never sold" description="It won't show when making a sales bill. Purchase bills still use it, so its input tax credit counts." checked={f.purchase_only} onChange={(v) => set("purchase_only", v)} /></div>
        </div></Card>
      </fieldset>
      {!isPhone ? <div className="flex items-center justify-end gap-2"><span className={cn("text-sm mr-auto", dirty ? "text-fg2" : "text-muted")}>{!existing ? `${MOD} S saves` : dirty ? `Unsaved changes · ${MOD} S saves` : "No changes yet"}</span><Button variant="ghost" onClick={back} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" icon={Check} loading={busy} {...keepFocus}>{saveLabel}</Button></div> : null}
      {existing ? <p className="text-sm text-muted">Bills with this product: <Link to={`/products/${existing.id}`} className="link">see them on its page</Link>.</p> : null}
    </form>
  </Page>;
}
