// The customer page's own pieces (PROTO pages/records/shared.jsx InfoCell, PeriodSwitch, CopyButton, Bump; CustomerDetail.jsx QuickActions).
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Copy, FileText, MessageCircle, Phone } from "lucide-react";
import type { Customer, LastBill } from "@/core/api/customers";
import { cn } from "@/core/cn";
import { IconButton, Menu, useToast } from "@/core/ui";
import { useView } from "@/core/view";
import { useContact } from "./listParts";

/** A labelled cell in the details strip. */
export function InfoCell({ label, children, sub, className }: { label: ReactNode; children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      <span className="caps">{label}</span>
      <span className="min-w-0">{children}</span>
      {sub ? <span className="text-sm text-muted">{sub}</span> : null}
    </div>
  );
}

export type PeriodOption<T extends string> = { value: T; title: string; sub: string };
/** Two periods, both named and both visible, each with its count and total. Arrow keys move between them. */
export function PeriodSwitch<T extends string>({ options, value, onChange, label, className }: { options: PeriodOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const { isPhone } = useView();
  const box = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    onChange(options[(i + 1) % options.length].value);
    setTimeout(() => box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0);
  };
  return (
    <div ref={box} role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("grid gap-1 p-1 rounded-card border border-ctl-line bg-field", isPhone ? "grid-cols-1" : "grid-cols-2", className)}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} onClick={() => onChange(o.value)}
            className={cn("text-left rounded-ctl border px-3.5 py-2 min-h-11 transition-colors duration-150 active:scale-[0.99]", sel ? "bg-brand-sel border-brand" : "border-transparent hover:bg-raised")}>
            <span className={cn("block font-semibold", sel ? "text-brand" : "text-fg")}>{o.title}</span>
            <span className="block text-sm text-muted tnum">{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Copies a GSTIN or PAN, and says so (or shows it, when the browser won't copy). */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { show } = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); show({ title: `Copied ${value}`, body: `${label} is on the clipboard.` }); }
    catch { show({ tone: "brand", title: `${label}: ${value}`, body: "This window can't use the clipboard; select the number to copy it." }); }
  };
  return <IconButton label={`Copy ${label} ${value}`} icon={Copy} size="sm" onClick={() => void copy()} />;
}

/** Bumps what it holds when `k` changes (never on first show): the figures after a period or firm switch. */
export function Bump({ k, children }: { k: string; children: ReactNode }) {
  const initial = useRef(k);
  const moved = useRef(false);
  if (k !== initial.current) moved.current = true;
  return <span key={k} className={moved.current ? "anim-bump" : undefined}>{children}</span>;
}

/** Under the name on a phone: Call · WhatsApp · Statement, a tap each (New bill is the bar at the bottom). */
export function QuickActions({ c, last }: { c: Customer; last: LastBill | null }) {
  const k = useContact(c, last);
  const tile = "flex flex-col items-center justify-center gap-1 min-h-16 rounded-card border border-line bg-card text-fg font-medium transition-colors hover:bg-raised active:scale-[0.98] disabled:opacity-50";
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Contact ${c.name}`}>
      {k.tel ? <a href={k.tel} className={cn(tile, "no-underline")}><Phone size={20} className="text-brand" aria-hidden="true" />Call</a>
        : <button type="button" disabled className={tile} title="No mobile number on file"><Phone size={20} aria-hidden="true" />Call</button>}
      {k.items.length ? <Menu title={`WhatsApp ${c.name}`} items={k.items} trigger={(p) => <button type="button" {...p} className={tile}><MessageCircle size={20} className="text-brand" aria-hidden="true" />WhatsApp</button>} />
        : <button type="button" disabled className={tile} title="No mobile number on file"><MessageCircle size={20} aria-hidden="true" />WhatsApp</button>}
      <Link to={`/customers/${c.id}/statement`} className={cn(tile, "no-underline")}><FileText size={20} className="text-brand" aria-hidden="true" />Statement</Link>
    </div>
  );
}
