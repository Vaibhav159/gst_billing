// An item that isn't in Products, without leaving the bill (PROTO pages/sales/parts.jsx:1047-1111): its name, HSN, GST
// rate, unit, a rate if you have it, and a description that prints under it. The owner can keep it in Products for the
// next bill; everyone else uses it on this bill only (the HSN and GST rate on every bill come from Products, so one
// person keeps them).
import { useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Lock } from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { UNITS } from "@/core/format";
import { failText, type FailText } from "@/core/sales/words";
import { Button, Checkbox, FailNote, Field, Input, Select, useToast } from "@/core/ui";
import { useView } from "@/core/view";
import { RateInput } from "./fields";
import { SLAB_OPTIONS } from "./model";
import { useCreateProduct } from "./products";
import { isHsn } from "./rules";

/** What the line takes: the item, and the product's id when it was kept in Products. */
export type NewItem = { productId: number | null; line: { name: string; hsn: string; gst: string; unit: string; rate: string; description: string } };
export type NewItemFormProps = { initialName?: string; idBase?: string; onDone: (item: NewItem) => void; onCancel?: () => void; onTyped?: (typed: boolean) => void };

const UNIT_OPTIONS = UNITS.map((u) => ({ value: u.value, label: u.label }));
type Problems = Partial<Record<"name" | "hsn" | "gst", string>>;

export function NewItemForm({ initialName = "", idBase = "np", onDone, onCancel, onTyped }: NewItemFormProps) {
  const { can } = useAuth();
  const { isPhone } = useView();
  const { show } = useToast();
  const create = useCreateProduct();
  const canAdd = can("product.edit");
  const [v, setV] = useState({ name: initialName, hsn: "", gst: "", unit: "gms", rate: "", description: "", keep: canAdd });
  const [err, setErr] = useState<Problems>({});
  const [fail, setFail] = useState<FailText | null>(null);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => { setV((o) => ({ ...o, [k]: x })); setErr((e) => ({ ...e, [k]: "" })); setFail(null); };
  const typed = Boolean(v.hsn || v.gst !== "" || v.rate.trim() || v.description.trim() || v.unit !== "gms" || v.name.trim() !== initialName.trim());
  // a layout effect, so the sheet knows before the next key (an Esc right after typing still asks)
  useLayoutEffect(() => { onTyped?.(typed); }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onTyped?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Shows the problems, then puts the cursor on the first: drawn first, so a screen reader reads its words as it lands. */
  const showProblems = (e: Problems): boolean => {
    flushSync(() => setErr(e));
    const first = (["name", "hsn", "gst"] as const).find((k) => e[k]);
    if (first) document.getElementById(`${idBase}-${first}`)?.focus();
    return Boolean(first);
  };
  const done = () => {
    const e: Problems = {};
    if (!v.name.trim()) e.name = "Type the item's name as it should print on the bill.";
    if (!isHsn(v.hsn)) e.hsn = "Type the HSN code, 4 to 8 digits.";
    if (v.gst === "") e.gst = "Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%.";
    if (showProblems(e)) return;
    const line = { name: v.name.trim(), hsn: v.hsn, gst: v.gst, unit: v.unit, rate: v.rate, description: v.description.trim() };
    if (!(canAdd && v.keep)) { onDone({ productId: null, line }); return; }
    setFail(null);
    create.mutate({ name: line.name, hsn_code: line.hsn, gst_percent: line.gst, unit: line.unit, description: line.description }, {
      onSuccess: (p) => {
        show({ title: `${line.name} added to Products`, body: `HSN ${line.hsn} · GST ${line.gst}% · per ${line.unit}. It's on this bill now.` });
        onDone({ productId: p.id, line });
      },
      onError: (x) => {
        const p = problemOf(x);
        const said = p.fields?.name;
        if (said) showProblems({ name: /already exists/i.test(said) ? `Products already has ${line.name}. Pick it from the list, or name this one differently.` : said });
        else setFail(failText(p));
      },
    });
  };
  const busy = create.isPending;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" htmlFor={`${idBase}-name`} required error={err.name}>
        {/* data-autofocus, not autoFocus: a sheet around the form puts the cursor here once it has noted what opened it,
            so closing gives the cursor back (autoFocus would take it first, and closing would drop it to the page) */}
        <Input id={`${idBase}-name`} value={v.name} invalid={Boolean(err.name)} maxLength={255} data-autofocus={!isPhone ? "" : undefined} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2")}>
        <Field label="HSN code" htmlFor={`${idBase}-hsn`} required error={err.hsn} hint="Like 7113 for gold jewellery, 7114 for silverware">
          <Input id={`${idBase}-hsn`} value={v.hsn} inputMode="numeric" maxLength={8} invalid={Boolean(err.hsn)} inputClassName="tnum" onChange={(e) => set("hsn", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="GST rate" htmlFor={`${idBase}-gst`} required error={err.gst}>
          <Select id={`${idBase}-gst`} value={v.gst} placeholder="Choose the rate" options={SLAB_OPTIONS} invalid={Boolean(err.gst)} onChange={(e) => set("gst", e.target.value)} />
        </Field>
        <Field label="Unit" htmlFor={`${idBase}-unit`}>
          <Select id={`${idBase}-unit`} value={v.unit} options={UNIT_OPTIONS} onChange={(e) => set("unit", e.target.value)} />
        </Field>
        <Field label={`Rate per ${v.unit}`} htmlFor={`${idBase}-rate`} hint="Optional">
          <RateInput id={`${idBase}-rate`} value={v.rate} inputClassName="tnum" onChange={(r) => set("rate", r)} />
        </Field>
      </div>
      <Field label="Description" htmlFor={`${idBase}-description`} hint="Optional: purity, size or design, printed under the name">
        <Input id={`${idBase}-description`} value={v.description} maxLength={60} onChange={(e) => set("description", e.target.value)} />
      </Field>
      {canAdd
        ? <Checkbox label="Also save to Products" description={v.keep ? "It shows in Products and on future bills." : "Used on this bill only."} checked={v.keep} onChange={(on) => set("keep", on)} />
        : <p className="text-sm text-fg2 flex items-start gap-1.5 rounded-ctl border border-line bg-field px-3.5 py-2.5"><Lock size={15} className="shrink-0 mt-0.5 text-muted" aria-hidden="true" />Used on this bill only. The owner adds products to the list.</p>}
      <FailNote error={fail} />
      <div className={cn("flex gap-2 pt-1", isPhone ? "flex-col-reverse" : "justify-end")}>
        {onCancel ? <Button onClick={onCancel} full={isPhone} disabled={busy}>Back</Button> : null}
        <Button variant="primary" onClick={done} full={isPhone} loading={busy}>{busy ? "Saving…" : fail ? "Try again" : canAdd && v.keep ? "Save and use on this bill" : "Use on this bill"}</Button>
      </div>
    </div>
  );
}
