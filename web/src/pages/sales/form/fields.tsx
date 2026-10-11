// The bill form's own fields (PROTO pages/sales/parts.jsx): a date typed day-first with a calendar, how it was paid with
// nothing picked for you, the checks beside the total, and a rate typed as written (up to 3 decimals, grouped the
// Indian way once you leave it). Plus the focus helpers that let a fast typist's next key land in the right box.
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/core/cn";
import { addMonths, date, lastDayOfMonth, monthLabel } from "@/core/format";
import type { PaymentMode } from "@/core/sales/types";
import { PAY, rateText } from "@/core/sales/words";
import { Button, Dialog, IconButton, Input, type InputProps } from "@/core/ui";
import { useView } from "@/core/view";
import { parseDateText, shiftDate } from "./rules";
import type { Check as CheckItem } from "./rules";

/** Focus an element by id now, inside the key handler, so the next key lands there (PROTO parts.jsx:1194-1200). */
export function focusNow(id: string, select = false): boolean {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return false;
  el.focus();
  if (select && typeof el.select === "function") el.select();
  return true;
}
/** Focus an element by id after the next paint (for something not drawn yet). */
export function focusSoon(id: string, select = false): void {
  setTimeout(() => focusNow(id, select), 30);
}
/** Keeps a label row as tall as its neighbours that carry link buttons, so the boxes line up. */
export function LabelSpacer() {
  return <span aria-hidden="true" className="invisible inline-flex items-center min-h-8 text-sm">.</span>;
}

/* ── Date: typed day-first, with a calendar ── */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The arrows move a day or a week; PageUp and PageDown a month. */
const DAY_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const MONTH_KEYS: Record<string, number> = { PageUp: -1, PageDown: 1 };
/**
 * A month grid: days after today, and days the form can't take (a filed month), are off with the reason (PROTO
 * parts.jsx:787-842). A grid of weeks: a row of the days' names, then a row of seven cells per week (blank before the
 * 1st and after the last day), each day's button in its cell, so a screen reader reads it as a table. inDialog: the
 * calendar sits in a dialog of its own (a phone's), which puts the cursor on the day itself.
 */
export function Calendar({ value, today, onPick, onClose, offReason, label = "Pick a date", inDialog = false }: { value: string; today: string; onPick: (iso: string) => void; onClose?: () => void; offReason: (iso: string) => string; label?: string; inDialog?: boolean }) {
  const { isPhone } = useView();
  const start = value || today;
  const [ym, setYm] = useState(start.slice(0, 7));
  const [focus, setFocus] = useState(start);
  const grid = useRef<HTMLDivElement>(null);
  const prevMonth = useRef<HTMLButtonElement>(null);
  // the cursor goes to the focused day as the calendar opens and on the arrow and Page keys, never on a month button:
  // there it stays on the button, so Enter again turns another month and never picks a day the person didn't move to.
  // In a dialog the dialog puts it there as it opens (the day is marked data-autofocus), once it has noted what opened
  // it, so closing gives the cursor back to that
  const pull = useRef(!inDialog);
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = Number(lastDayOfMonth(ym).slice(8));
  const iso = (d: number) => `${ym}-${String(d).padStart(2, "0")}`;
  // months and days are calendar sums (part 0's addMonths, Task 2's shiftDate), never a local Date's
  /** The focused day's date in month `to`, or that month's last day (31 Oct is 30 Sep), and never after today. */
  const sameDayIn = (to: string) => { const day = `${to}-${focus.slice(8)}`; const end = to >= today.slice(0, 7) ? today : lastDayOfMonth(to); return day > end ? end : day; };
  const moveFocus = (next: string, cursor: boolean) => {
    pull.current = cursor;
    setFocus(next);
    setYm(next.slice(0, 7));
  };
  // a month button takes Tab's stop to the month shown; Next month turns off on this month, so the cursor moves to
  // Previous month rather than drop to the page
  const shift = (n: number) => {
    const to = addMonths(ym, n);
    moveFocus(sameDayIn(to), false);
    if (to >= today.slice(0, 7)) prevMonth.current?.focus();
  };
  useEffect(() => {
    if (!pull.current) return;
    pull.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, ym]);
  const onKey = (e: KeyboardEvent) => {
    if (DAY_KEYS[e.key] != null) { e.preventDefault(); moveFocus(shiftDate(focus, DAY_KEYS[e.key]), true); }
    else if (MONTH_KEYS[e.key] != null) { e.preventDefault(); moveFocus(sameDayIn(addMonths(ym, MONTH_KEYS[e.key])), true); }
  };
  const cells = [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => Array.from({ length: 7 }, (__, d) => cells[w * 7 + d] ?? null));
  return (
    // Esc closes it from the month buttons as well as from the days
    <div className="flex flex-col gap-2" role="group" aria-label={label} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose?.(); } }}>
      <div className="flex items-center justify-between gap-2">
        <IconButton ref={prevMonth} size="sm" label="Previous month" icon={ChevronLeft} onClick={() => shift(-1)} />
        <p className="font-semibold" aria-live="polite">{monthLabel(ym, { long: true })}</p>
        <IconButton size="sm" label="Next month" icon={ChevronRight} onClick={() => shift(1)} disabled={ym >= today.slice(0, 7)} />
      </div>
      <div ref={grid} role="grid" aria-label={monthLabel(ym, { long: true })} onKeyDown={onKey} className="flex flex-col gap-1 text-center">
        <div role="row" className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => <span key={d} role="columnheader" className="caps py-1" aria-label={d}>{d.slice(0, 2)}</span>)}
        </div>
        {weeks.map((week, w) => (
          <div key={w} role="row" className="grid grid-cols-7 gap-1">
            {week.map((d, i) => {
              if (!d) return <div key={`e${i}`} role="gridcell" />;
              const day = iso(d);
              const off = offReason(day);
              const sel = day === value;
              return (
                <div key={day} role="gridcell">
                  {/* a day the cursor lands on any way (a click too) is where the arrows go on from */}
                  <button type="button" data-day={day} tabIndex={day === focus ? 0 : -1} data-autofocus={day === focus ? "" : undefined} aria-pressed={sel} aria-disabled={off ? true : undefined}
                    aria-label={`${date(day)}${off ? `, ${off}` : ""}`} title={off || undefined} onFocus={() => setFocus(day)} onClick={() => { if (!off) onPick(day); }}
                    className={cn(isPhone ? "min-h-11" : "h-9", "w-full min-w-9 rounded-md tnum text-sm transition-colors", sel ? "bg-brand text-onbrand font-semibold" : off ? "text-muted/60 cursor-not-allowed" : "hover:bg-raised", day === today && !sel && "border border-brand-line text-brand")}>
                    {d}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export type DateFieldProps = {
  id: string; value: string; today: string; onChange: (iso: string | null, text: string) => void; onCommit?: (iso: string | null) => void;
  invalid?: boolean; describedBy?: string; offReason: (iso: string) => string; label?: string;
};
/** A date typed as people say it ("8/10", "8 oct", "today"); Alt + Down opens the calendar (PROTO parts.jsx:844-881). */
export function DateField({ id, value, today, onChange, onCommit, invalid, describedBy, offReason, label = "Date" }: DateFieldProps) {
  const { isPhone } = useView();
  const [text, setText] = useState(value ? date(value) : "");
  const [cal, setCal] = useState(false);
  const last = useRef(value);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { if (value !== last.current) { last.current = value; setText(value ? date(value) : ""); } }, [value]);
  useEffect(() => {
    if (!cal || isPhone) return undefined;
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setCal(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [cal, isPhone]);
  const commit = () => { const iso = parseDateText(text, today); if (iso) setText(date(iso)); onCommit?.(iso); };
  const pick = (iso: string) => { setCal(false); last.current = iso; setText(date(iso)); onChange(iso, date(iso)); onCommit?.(iso); document.getElementById(id)?.focus(); };
  const calendar = <Calendar value={value} today={today} onPick={pick} onClose={() => { setCal(false); document.getElementById(id)?.focus(); }} offReason={offReason} label={`${label}: calendar`} inDialog={isPhone} />;
  // Tab out of the desktop calendar closes it, so it doesn't sit over the next field (a phone's is a dialog of its own)
  const leave = (e: FocusEvent) => { if (cal && !isPhone && e.relatedTarget && !wrap.current?.contains(e.relatedTarget)) setCal(false); };
  // Esc closes an open calendar from the date box and its button too (the calendar's own days and month buttons close it themselves)
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && cal) { e.preventDefault(); e.stopPropagation(); setCal(false); } };
  return (
    <div ref={wrap} className="relative min-w-0" onBlur={leave} onKeyDown={esc}>
      <Input id={id} value={text} invalid={invalid} aria-describedby={describedBy} autoComplete="off" spellCheck={false} inputClassName={isPhone ? "pl-14" : "pl-11"}
        onChange={(e) => { const t = e.target.value; setText(t); const iso = parseDateText(t, today); last.current = iso ?? ""; onChange(iso, t); }}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setCal(true); } }} />
      <button type="button" onClick={() => setCal((o) => !o)} aria-label={`${label}: open the calendar`} aria-expanded={cal} title="Calendar (Alt + Down)"
        className={cn("absolute top-1/2 -translate-y-1/2 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-raised transition-colors", isPhone ? "left-0.5 w-11 h-11" : "left-1 w-9 h-9")}>
        <CalendarDays size={17} aria-hidden="true" />
      </button>
      {cal && !isPhone ? <div className="absolute z-pop left-0 top-full mt-1.5 w-[300px] card shadow-pop p-3 anim-pop">{calendar}</div> : null}
      {isPhone ? <Dialog open={cal} onClose={() => setCal(false)} title={label}>{calendar}</Dialog> : null}
    </div>
  );
}

/* ── How it was paid: nothing chosen until the person picks (PROTO parts.jsx:754-783) ── */
/** The ways a bill can be paid, in the order they're offered (a link's ?paid= takes one of them too). */
export const PAY_KEYS: PaymentMode[] = ["cash", "bank", "credit", "mixed"];
/** autoFocus: its first choice takes focus as a dialog opens (the review's "How was it paid?"). */
export function PayPicker({ value, onChange, allowNotRecorded, labelledBy, invalid, describedBy, id, autoFocus }: {
  value: PaymentMode | null; onChange: (v: PaymentMode) => void; allowNotRecorded?: boolean; labelledBy: string; invalid?: boolean; describedBy?: string; id?: string; autoFocus?: boolean;
}) {
  const { isPhone } = useView();
  const box = useRef<HTMLDivElement>(null);
  const opts: PaymentMode[] = [...PAY_KEYS, ...(allowNotRecorded ? [""] as PaymentMode[] : [])];
  const at = value == null ? -1 : opts.indexOf(value);
  const move = (d: number) => {
    const i = at < 0 ? (d > 0 ? 0 : opts.length - 1) : (at + d + opts.length) % opts.length;
    onChange(opts[i]);
    box.current?.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
  };
  return (
    <div ref={box} id={id} role="radiogroup" aria-labelledby={labelledBy} aria-invalid={invalid || undefined} aria-describedby={describedBy}
      onKeyDown={(e) => { if (["ArrowRight", "ArrowDown"].includes(e.key)) { e.preventDefault(); move(1); } else if (["ArrowLeft", "ArrowUp"].includes(e.key)) { e.preventDefault(); move(-1); } }}
      className={cn("gap-2", isPhone ? "grid grid-cols-2" : "flex flex-wrap")}>
      {opts.map((v, i) => {
        const sel = value === v;
        return (
          <button key={v || "none"} type="button" role="radio" aria-checked={sel} tabIndex={(at < 0 ? i === 0 : sel) ? 0 : -1} onClick={() => onChange(v)}
            data-autofocus={autoFocus && (at < 0 ? i === 0 : sel) ? "" : undefined}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-ctl border px-3.5 transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98]",
              isPhone ? "min-h-12 py-2 text-md whitespace-normal" : "h-9 text-sm whitespace-nowrap",
              sel ? "bg-brand-sel border-brand text-brand font-semibold" : cn("bg-field text-fg2 hover:text-fg hover:border-muted/50", invalid ? "border-neg-line" : "border-ctl-line"))}>
            {sel ? <Check size={15} className="shrink-0" aria-hidden="true" /> : null}{PAY[v]}
          </button>
        );
      })}
    </div>
  );
}

/* ── The checks beside the total (PROTO parts.jsx:678-696) ── */
export type CheckRow = CheckItem & { action?: { label: string; onClick: () => void } };
export function CheckList({ checks, label = "Checks" }: { checks: CheckRow[]; label?: string }) {
  const { isPhone } = useView();
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-sm">
          {c.ok === true ? <CheckCircle2 size={16} className="text-sale shrink-0 mt-0.5" aria-hidden="true" />
            : c.ok === false ? <AlertTriangle size={16} className="text-neg shrink-0 mt-0.5" aria-hidden="true" />
              : c.ok === "warn" ? <AlertTriangle size={16} className="text-brand shrink-0 mt-0.5" aria-hidden="true" />
                : <Circle size={16} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />}
          <span className={c.ok === false ? "text-neg" : c.ok === true ? "text-fg2" : c.ok === "warn" ? "text-fg" : "text-muted"}>
            {c.text}{c.action && !isPhone ? <> <button type="button" onClick={c.action.onClick} className="link">{c.action.label}</button></> : null}
            {c.action && isPhone ? <span className="block mt-1.5"><Button size="sm" onClick={c.action.onClick}>{c.action.label}</Button></span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── A rate typed as written: rupees, up to 3 decimals ── */
/**
 * What was typed as the API takes it ("6,512.50" -> "6512.50", "4150,50" -> "4150.50", ".5" -> "0.5", "6512." -> "6512",
 * "" or "." -> ""), or null when it isn't a rate (a fourth decimal, a letter). The box keeps what was typed meanwhile.
 */
export function readRate(text: string): string | null {
  let t = String(text ?? "").replace(/[₹\s]/g, "");
  if (!t.includes(".") && /,\d{1,2}$/.test(t)) t = t.replace(/,(\d{1,2})$/, ".$1");
  t = t.replace(/,/g, "");
  if (!/^\d*\.?\d{0,3}$/.test(t)) return null;
  if (t === "" || t === ".") return "";
  return t.replace(/^\./, "0.").replace(/\.$/, "");
}
/** A rate as it reads once you leave it: 1B's rateText without its "₹" ("6512.5" -> "6,512.50", "999.995" -> "999.995"); a blank stays blank. */
export function rateShown(rate: string): string {
  return rate.trim() ? rateText(rate).replace(/^₹/, "") : "";
}
export type RateInputProps = { value: string; onChange: (rate: string) => void } & Omit<InputProps, "value" | "onChange">;
/** Keeps exactly what's typed while it has focus; leaving shows Indian grouping. A fourth decimal isn't taken. */
export function RateInput({ value, onChange, onBlur, onFocus, ...rest }: RateInputProps) {
  const focused = useRef(false);
  const [raw, setRaw] = useState(rateShown(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setRaw(focused.current ? value : rateShown(value)); } }, [value]);
  return (
    <Input prefix="₹" inputMode="decimal" autoComplete="off" value={raw}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, "");
        const r = readRate(t);
        if (r === null) return;
        setRaw(t);
        last.current = r;
        onChange(r);
      }}
      onFocus={(e) => { focused.current = true; onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; setRaw(rateShown(value)); onBlur?.(e); }}
      {...rest} />
  );
}
