import { useEffect, useRef, useState } from "react";
import { cn } from "@/core/cn";
import { counterOf } from "@/core/sales/numbers";
import { Button, Dialog, Switch } from "@/core/ui";
import { focusSoon } from "@/pages/sales/form/fields";
import { DateBlock, NumberField } from "@/pages/sales/form/parts";
import type { BillFormApi } from "@/pages/sales/form/useBillForm";

/** Easy keeps the chosen paper day on the shared form; the brain owns its number and checks. */
export function BillNumber({ F, focus }: { F: BillFormApi; focus?: { field: "number" | "date"; key: number } }) {
  const [open, setOpen] = useState(false);
  const [earlier, setEarlier] = useState(Boolean(F.f.date && F.f.date < F.today));
  const numberRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    if (focus.field === "date") setEarlier(true);
    focusSoon(focus.field === "date" ? "easy-bill-date" : "easy-number-input", true);
  }, [focus]);
  const set: BillFormApi["set"] = (patch) => {
    const next = typeof patch === "function" ? patch(F.f) : patch;
    if (!("date" in next)) { F.set(next); return; }
    const changed = next.date !== F.f.date;
    // An object date patch also cancels the brain's pending paper-book date suggestion.
    F.set({ ...next, paper: Boolean(next.date && next.date < F.today), ...(changed ? { number: "", numberTyped: false } : {}) });
  };
  const dateForm = { ...F, set, paper: earlier };
  const errorId = F.numberError ? "easy-bill-number-error" : undefined;
  const number = counterOf(F.stored) ?? (F.numberText || "not typed yet");
  return <>
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={() => setOpen(true)} aria-describedby={errorId}
        className={cn("card w-full text-left px-4 py-3 flex items-center gap-3 min-h-16 active:scale-[0.99] transition-transform", F.numberError && "border-neg-line")}>
        <span className="flex-1 min-w-0"><span className="block font-semibold">Bill number</span><span className="block text-sm text-muted tnum">No. {number} · the number on the paper bill</span></span>
        <span className="text-brand font-semibold">Change</span>
      </button>
      {F.numberError ? <p id={errorId} className="text-sm text-neg px-1">{F.numberError}</p> : null}
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title="Bill number" initialFocus={focus?.field === "date" ? dateRef : numberRef} footer={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}>
      <div className="flex flex-col gap-5">
        <NumberField F={F} id="easy-number-input" inputRef={numberRef} />
        <Switch label="A bill from an earlier day" checked={earlier} onChange={(on) => { setEarlier(on); if (!on) set({ date: F.today }); }} />
        {earlier ? <DateBlock F={dateForm} id="easy-bill-date" inputRef={dateRef} /> : null}
      </div>
    </Dialog>
  </>;
}
