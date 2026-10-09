import { createContext, useContext, type AriaAttributes, type ReactNode } from "react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";

/* ── Form controls ─────────────────────────────────────── */
const FieldCtx = createContext<{ id: string; describedBy: string | undefined; invalid: boolean } | null>(null);

type FieldAria = Pick<AriaAttributes, "aria-describedby" | "aria-invalid">;

/** The error (or hint) and invalid state a kit control gets from the Field whose htmlFor is its id, unless the control sets its own. Used inside the kit only. */
export function useFieldAria(id: string | undefined, rest: FieldAria): FieldAria {
  const f = useContext(FieldCtx);
  if (!f || !id || f.id !== id) return {};
  const out: FieldAria = {};
  if (rest["aria-describedby"] === undefined && f.describedBy) out["aria-describedby"] = f.describedBy;
  if (rest["aria-invalid"] === undefined && f.invalid) out["aria-invalid"] = true;
  return out;
}

export type FieldProps = { label?: ReactNode; htmlFor?: string; hint?: ReactNode; error?: ReactNode; required?: boolean; aside?: ReactNode; className?: string; children: ReactNode };

/** Label + control + hint/error. Pass htmlFor = the control's id: the kit's controls with that id are tied to the error (or hint) and marked invalid on their own. */
export function Field({ label, htmlFor, hint, error, required, children, className, aside }: FieldProps) {
  const { isPhone, isEasy } = useView();
  // Easy reads bigger: labels 16 px in the main text colour, hints and errors 15 px
  const small = isEasy ? "text-[15px] leading-[21px]" : "text-sm";
  return (
    <div className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      {label ? (
        <div className={cn("flex items-center justify-between gap-2", isPhone ? "min-h-5" : "h-5")}>
          <label htmlFor={htmlFor} className={cn("font-medium truncate", isEasy ? "text-[16px] leading-[22px] text-fg" : "text-sm text-fg2")}>{label}{required ? <span className="text-muted font-normal"> · required</span> : null}</label>
          {aside ? <span className={cn("flex items-center shrink-0", small)}>{aside}</span> : null}
        </div>
      ) : null}
      <FieldCtx.Provider value={htmlFor ? { id: htmlFor, describedBy: error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined, invalid: Boolean(error) } : null}>{children}</FieldCtx.Provider>
      {error ? <p id={htmlFor ? `${htmlFor}-error` : undefined} className={cn(small, "text-neg")}>{error}</p> : hint ? <p id={htmlFor ? `${htmlFor}-hint` : undefined} className={cn(small, "text-muted")}>{hint}</p> : null}
    </div>
  );
}
