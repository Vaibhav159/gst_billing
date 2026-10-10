// A text box with a list of matches under it (PROTO pages/sales/parts.jsx Combobox). Enter or Tab picks the highlighted
// match after typing; the arrows move; Esc closes the list. onPick runs inside the key press, so it can move focus
// before the next key arrives (a weight typed straight after picking never lands in the wrong box).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/core/cn";
import { Input } from "./Input";
import { optionClass } from "./Menu";

/** A match: a row of the list. */
export type ComboOption<T> = { key: string; title: string; sub?: string; right?: string; tone?: "brand"; value: T };
/** A label over the matches that follow it; never picked. */
export type ComboHeading = { heading: string };
export type ComboItem<T> = ComboOption<T> | ComboHeading;
export type ComboboxProps<T> = {
  id: string; query: string; onQuery: (q: string) => void; options: ComboItem<T>[]; onPick: (o: ComboOption<T>) => void;
  placeholder?: string; ariaLabel?: string; listLabel?: string; invalid?: boolean; describedBy?: string; inputClassName?: string;
  autoFocus?: boolean; onFocus?: () => void; onBlur?: () => void;
};

export function Combobox<T>({ id, query, onQuery, options, onPick, placeholder, ariaLabel, listLabel, invalid, describedBy, inputClassName, autoFocus, onFocus, onBlur }: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // focused by autoFocus as the page opens: the list waits for the person, as the prototype's does
  const quietFocus = useRef(Boolean(autoFocus));
  const listId = `${id}-list`;
  const items = options.filter((o): o is ComboOption<T> => !("heading" in o));
  useEffect(() => { setActive(0); }, [query, open]);
  const pick = (o: ComboOption<T>) => { setOpen(false); onPick(o); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { if (open && items[active]) { e.preventDefault(); pick(items[active]); } }
    else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey) { if (open && query.trim() && items[active]) { e.preventDefault(); pick(items[active]); } else setOpen(false); }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }
  };
  let k = -1;
  return (
    <div className="relative min-w-0">
      <Input id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={ariaLabel}
        aria-activedescendant={open && items[active] ? `${id}-o${active}` : undefined} aria-describedby={describedBy} invalid={invalid}
        value={query} placeholder={placeholder} autoComplete="off" spellCheck={false} autoFocus={autoFocus} inputClassName={inputClassName}
        onChange={(e) => { onQuery(e.target.value); setOpen(true); }}
        onFocus={(e) => { if (quietFocus.current) quietFocus.current = false; else setOpen(true); e.target.select(); onFocus?.(); }}
        onMouseDown={() => setOpen(true)}
        onBlur={() => { setOpen(false); onBlur?.(); }}
        onKeyDown={onKeyDown} />
      {open && options.length ? (
        <ul id={listId} role="listbox" aria-label={listLabel || ariaLabel} className="absolute z-pop left-0 top-full mt-1.5 w-full min-w-[min(340px,80vw)] card shadow-pop py-1.5 max-h-[340px] overflow-y-auto anim-pop">
          {options.map((o) => {
            if ("heading" in o) return <li key={`h-${o.heading}`} role="presentation" className="caps px-3.5 pt-2 pb-1">{o.heading}</li>;
            k += 1;
            const i = k;
            return (
              <li key={o.key} id={`${id}-o${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}
                className={cn("flex items-start gap-3 px-3.5 py-2 cursor-pointer rounded-md mx-1", optionClass(i === active), o.tone === "brand" && "text-brand")}>
                <span className="flex-1 min-w-0">
                  <span className={cn("block", o.tone === "brand" ? "font-semibold" : "font-medium")}>{o.title}</span>
                  {o.sub ? <span className="block text-xs text-muted mt-0.5">{o.sub}</span> : null}
                </span>
                {o.right ? <span className="text-xs text-muted text-right shrink-0 tnum mt-0.5">{o.right}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
