import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useRegistry } from "@/core/api/registry";
import { date } from "@/core/format";
import { checkGstin } from "@/core/ids";
import { useDebounced } from "@/core/useDebounced";
import { Banner, Button } from "@/core/ui";

type Values = { name: string; address: string; city: string };
/** X-67: the registry is asked only for a GSTIN the person types, or the stored one when they tap "Check this GSTIN". */
export function CustomerRegistry({ gstin, stored = "", values, onFill, onName }: {
  gstin: string; stored?: string; values: Values; onFill: (patch: Partial<Values>) => void; onName: (name: string) => void;
}) {
  const [checked, setChecked] = useState<string | null>(null);
  const wanted = gstin !== stored || checked === gstin;
  const asked = useDebounced(gstin);
  const lookup = useRegistry(asked, wanted);
  const data = asked === gstin && lookup.data?.gstin === gstin ? lookup.data : undefined;
  const reg = data?.registry;
  const applied = useRef<string | null>(null);
  const filled = useRef<string[]>([]);
  useEffect(() => { applied.current = null; filled.current = []; }, [gstin]);
  useEffect(() => {
    if (data?.status !== "found" || !reg?.active || applied.current === gstin) return;
    applied.current = gstin;
    const patch: Partial<Values> = {};
    if (!values.name.trim()) patch.name = reg.trade_name || reg.legal_name;
    if (!values.address.trim()) patch.address = reg.address;
    if (!values.city.trim()) patch.city = reg.city;
    filled.current = Object.keys(patch).map(key => `the ${key}`);
    if (Object.keys(patch).length) onFill(patch);
  }, [data, reg, gstin, values, onFill]);
  if (checkGstin(gstin).status !== "valid") return null;
  if (!wanted) return <div><Button size="sm" onClick={() => setChecked(gstin)}>Check this GSTIN</Button></div>;
  if (asked !== gstin || lookup.isPending) return <p role="status" className="text-sm text-muted">Checking the GST registry…</p>;
  if (lookup.isError || data?.lookup === "unreachable") return <p role="status" className="text-sm text-muted">The GST registry didn't answer. The state and PAN come from the number itself.</p>;
  if (!reg) return <p role="status" className="text-sm text-muted flex items-start gap-1.5 anim-rise"><Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />The GST registry has no details for this GSTIN yet. The number itself checks out.</p>;
  const name = reg.trade_name || reg.legal_name;
  if (!reg.active) return <p role="status" className="text-sm text-neg flex items-start gap-1.5 anim-rise"><XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{reg.status_text} in the GST registry: {name}. A business with a cancelled GSTIN can't claim GST on your bills; bill it as unregistered (no GSTIN) or ask for its new number.</span></p>;
  const different = values.name.trim() && ![reg.trade_name, reg.legal_name].some(n => n.trim().toLowerCase() === values.name.trim().toLowerCase());
  return <div className="flex flex-col gap-2">
    <p role="status" className="text-sm text-sale flex items-start gap-1.5 anim-rise"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Active{reg.registered_on ? ` since ${date(reg.registered_on)}` : ""} · {name}{reg.legal_name !== name ? ` (${reg.legal_name})` : ""}{reg.city ? ` · ${reg.city}` : ""}{filled.current.length ? <span className="text-fg2"> · Filled in {filled.current.length > 1 ? `${filled.current.slice(0, -1).join(", ")} and ${filled.current.at(-1)}` : filled.current[0]} from the registry</span> : null}</span></p>
    {different ? <Banner tone="brand" icon={AlertTriangle} title={`This GSTIN is registered to ${name}${reg.city ? ` (${reg.city})` : ""}`}
      actions={<Button size="sm" onClick={() => onName(name)}>Use {name}</Button>}>
      Bills will print {values.name.trim()}. A bill to a business must carry the name the GSTIN is registered to{reg.legal_name !== name ? ` (${reg.legal_name})` : ""}. If {values.name.trim()} is a person buying for themselves, leave the GSTIN out.
    </Banner> : null}
  </div>;
}
