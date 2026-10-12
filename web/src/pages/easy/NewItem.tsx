// Easy's material/category recipe is presentation; the caller saves through the shared product mutation.
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Check, CloudOff, Plus, WifiOff } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { Button, Checkbox, Chip, Dialog, Field, Input, cn } from "@/core/ui";
import { blankLine, type FormLine } from "@/pages/sales/form/model";
import type { SaleProduct } from "@/pages/sales/form/products";

export type EasyNewItem = { line: FormLine; kind: "gold" | "silver" | "diamond" | "other"; purity: string; keep: boolean };
export type NewItemSheetProps = {
  open: boolean; onClose: () => void; products: SaleProduct[]; canKeep: boolean;
  onAdd: (item: EasyNewItem) => void | Promise<void>; onUseExisting: (product: SaleProduct) => void;
};
type Category = { id: string; label: string; hint: string; hsn: string; gst: string };
type Material = { id: string; label: string; kind: EasyNewItem["kind"]; purity: string; kinds: string[] };
const MATERIALS: Material[] = [
  { id: "g22", label: "Gold 22K", kind: "gold", purity: "22K", kinds: ["jewellery", "coins", "silverware"] },
  { id: "g18", label: "Gold 18K", kind: "gold", purity: "18K", kinds: ["jewellery", "coins", "silverware"] },
  { id: "g24", label: "Gold 24K", kind: "gold", purity: "24K", kinds: ["jewellery", "coins", "silverware"] },
  { id: "silver", label: "Silver", kind: "silver", purity: "925", kinds: ["jewellery", "coins", "silverware"] },
  { id: "diamond", label: "Diamond", kind: "diamond", purity: "VS-GH", kinds: ["jewellery", "stones"] },
  { id: "other", label: "Something else", kind: "other", purity: "", kinds: ["imitation", "jewellery"] },
];
const CATEGORIES: Category[] = [
  { id: "jewellery", label: "Jewellery", hint: "Rings, chains, bangles, earrings, sets", hsn: "7113", gst: "3" },
  { id: "coins", label: "Coins", hint: "Gold or silver coins", hsn: "7118", gst: "3" },
  { id: "silverware", label: "Utensils and gifts", hint: "Glasses, plates, idols, gift pieces", hsn: "7114", gst: "3" },
  { id: "stones", label: "Loose diamonds", hint: "Cut and polished, sold by the carat", hsn: "7102", gst: "0.25" },
  { id: "imitation", label: "Imitation jewellery", hint: "Not real gold or silver", hsn: "7117", gst: "3" },
];

export function NewItemSheet({ open, onClose, products, canKeep, onAdd, onUseExisting }: NewItemSheetProps) {
  const [name, setName] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [keep, setKeep] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<ApiProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => { if (open) { setName(""); setMaterialId(""); setCategoryId(""); setKeep(false); setTried(false); setError(null); } }, [open]);
  const material = MATERIALS.find((m) => m.id === materialId);
  const categories = material ? CATEGORIES.filter((c) => material.kinds.includes(c.id)) : [];
  const category = categories.find((c) => c.id === categoryId);
  const normalized = name.trim().replace(/\s+/g, " ");
  const full = normalized && material?.kind === "gold" && !normalized.toUpperCase().includes(material.purity) ? `${normalized} ${material.purity}` : normalized;
  const same = full ? products.find((p) => p.name.toLowerCase() === full.toLowerCase()) : undefined;
  const unit = category?.id === "stones" ? "ct" : "gms";
  const errors = {
    name: !normalized ? "Type what it's called, as it should print on the bill." : same ? `${same.name} is already in your items.` : "",
    mat: !material ? "Pick what it's made of." : "",
    kind: material && !category ? "Pick what kind of item it is. It sets the GST code and rate on the bill." : "",
  };
  const show = (key: keyof typeof errors) => tried ? errors[key] : "";
  const pickMaterial = (m: Material) => {
    setMaterialId(m.id);
    if (!m.kinds.includes(categoryId)) setCategoryId("");
  };
  const add = async () => {
    if (sending.current) return;
    flushSync(() => setTried(true));
    const first = (["name", "mat", "kind"] as const).find((key) => errors[key]);
    if (first) { document.getElementById(`ni-${first}`)?.focus(); return; }
    if (!material || !category) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      await onAdd({ line: { ...blankLine(), name: full, hsn: category.hsn, gst: category.gst, unit, custom: true }, kind: material.kind, purity: material.purity, keep: canKeep && keep });
    } catch (failure) { setError(problemOf(failure)); }
    finally { sending.current = false; setBusy(false); }
  };
  const failedConnection = error?.kind === "offline" || error?.kind === "unreachable" || error?.kind === "server";
  const offline = error?.kind === "offline";
  const ErrorIcon = offline ? WifiOff : CloudOff;

  return (
    <Dialog open={open} onClose={() => { if (!sending.current) onClose(); }} title="Add an item that isn't in the list"
      confirmClose={!busy && (normalized || materialId || categoryId) ? "Discard this item?" : undefined}
      footer={(close) => <>
        <Button size="lg" disabled={busy} onClick={close}>Go back</Button>
        <Button variant="primary" size="xl" icon={Plus} loading={busy} onClick={() => { void add(); }}>{busy ? "Adding…" : error ? "Try adding again" : "Add to the bill"}</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <p className="text-md text-fg2 -mt-2">It goes on this bill straight away.</p>
        <Field label="What is it called?" htmlFor="ni-name" error={show("name")}>
          <Input id="ni-name" value={name} disabled={busy} maxLength={255} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="words" placeholder="Like Gold mangalsutra"
            invalid={Boolean(show("name"))} aria-describedby={show("name") ? "ni-name-error" : undefined} />
        </Field>
        {tried && same ? <Button variant="outline" disabled={busy} onClick={() => onUseExisting(same)} className="self-start -mt-3">Use it instead</Button> : null}
        <fieldset className="flex flex-col gap-2 min-w-0">
          <legend id="ni-mat-l" className="text-[16px] font-medium mb-2">What is it made of?</legend>
          <div id="ni-mat" tabIndex={-1} role="group" aria-labelledby="ni-mat-l" aria-describedby={show("mat") ? "ni-mat-error" : undefined} className="flex flex-wrap gap-2 outline-none">
            {MATERIALS.map((m) => <Chip key={m.id} selected={materialId === m.id} disabled={busy} onClick={() => pickMaterial(m)} className="!min-h-12 !px-4">{m.label}</Chip>)}
          </div>
          {show("mat") ? <p id="ni-mat-error" className="text-md text-neg">{show("mat")}</p> : null}
        </fieldset>
        {material ? (
          <fieldset className="flex flex-col gap-2 min-w-0 anim-rise">
            <legend id="ni-kind-l" className="text-[16px] font-medium mb-2">What kind of item is it?</legend>
            <div id="ni-kind" tabIndex={-1} role="radiogroup" aria-labelledby="ni-kind-l" aria-describedby={show("kind") ? "ni-kind-error" : undefined} className="flex flex-col gap-2 outline-none"
              onKeyDown={(e) => {
                if (busy || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
                e.preventDefault();
                const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
                const at = categories.findIndex((c) => c.id === categoryId);
                const next = at < 0 ? (forward ? 0 : categories.length - 1) : (at + (forward ? 1 : categories.length - 1)) % categories.length;
                setCategoryId(categories[next].id);
                e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}>
              {categories.map((c, index) => {
                const selected = categoryId === c.id;
                return (
                  <button key={c.id} type="button" role="radio" aria-checked={selected} disabled={busy} tabIndex={selected || (!category && index === 0) ? 0 : -1} onClick={() => setCategoryId(c.id)}
                    className={cn("w-full flex items-center gap-3 rounded-ctl border px-4 py-2.5 min-h-14 text-left transition-[background-color,border-color] duration-150", selected ? "border-brand bg-brand-sel" : "border-ctl-line bg-field hover:border-muted/50")}>
                    <span className="flex-1 min-w-0"><span className={cn("block font-medium", selected && "text-brand")}>{c.label}</span><span className="block text-md text-muted">{c.hint}</span></span>
                    <span className="text-right shrink-0 text-md"><span className="block font-semibold tnum">GST {c.gst}%</span><span className="block text-muted tnum">HSN {c.hsn}</span></span>
                    {selected ? <Check size={18} className="text-brand shrink-0" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            {show("kind") ? <p id="ni-kind-error" className="text-md text-neg">{show("kind")}</p> : null}
          </fieldset>
        ) : null}
        {full && material && category ? <p className="rounded-ctl border border-line bg-field px-4 py-3 text-md anim-rise">On the bill: <span className="font-semibold">{full}</span> · HSN {category.hsn} · GST {category.gst}% · weighed in {unit === "ct" ? "carats" : "grams"}</p> : null}
        {canKeep
          ? <Checkbox label={<span className="text-[16px]">Also keep it in the item list</span>} description={<span className="text-md">Off: it's on this bill only. On: it shows under Something else next time; check it later in Products.</span>} checked={keep} disabled={busy} onChange={setKeep} />
          : <p className="text-md text-muted">Used on this bill only. The owner adds products to the list.</p>}
        {error ? (
          <div role="alert" className="flex flex-col gap-3 rounded-card border border-neg-line bg-neg-tint px-4 py-3.5 anim-rise">
            <div className="flex items-start gap-3"><ErrorIcon size={20} className="text-neg shrink-0 mt-0.5" aria-hidden="true" /><div className="min-w-0">
              <p className="font-semibold">{failedConnection ? `Not added yet: ${offline ? "you're offline" : "the app couldn't get through"}.` : "Not added yet"}</p>
              <p className="text-md text-fg2 mt-0.5">{failedConnection ? `The item and your bill are safe on this phone; tap Try adding again ${offline ? "when the internet is back" : "in a minute"}.` : error.message}</p>
            </div></div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
