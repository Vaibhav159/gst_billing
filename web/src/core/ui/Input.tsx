import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, Search, X, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { useFieldAria } from "./Field";

// HTML's own `prefix` attribute (RDFa, a string) is dropped: here it is the text or icon shown before the value.
export type InputProps = { prefix?: ReactNode | LucideIcon; suffix?: ReactNode; invalid?: boolean; inputClassName?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "prefix">;

// An icon to draw, not a node to show. lucide's icons are forwardRef objects, so the prototype's
// `typeof P === "function"` missed them and React threw on the object.
function isIcon(p: InputProps["prefix"]): p is LucideIcon {
  return typeof p === "function" || (typeof p === "object" && p !== null && "render" in p);
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ prefix, suffix, className, inputClassName, invalid, ...rest }, ref) {
  const P = prefix;
  const aria = useFieldAria(rest.id, rest);
  return (
    <div className={cn("relative min-w-0", className)}>
      {P ? <span className="pointer-events-none absolute left-3 top-0 bottom-0 flex items-center text-muted">{isIcon(P) ? <P size={17} aria-hidden="true" /> : P}</span> : null}
      <input ref={ref} aria-invalid={invalid || undefined} className={cn("ctl", P && "pl-9", suffix && "pr-14", inputClassName)} {...rest} {...aria} />
      {suffix ? <span className="pointer-events-none absolute right-3 top-0 bottom-0 flex items-center text-muted text-sm">{suffix}</span> : null}
    </div>
  );
});

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = { options: readonly (string | SelectOption)[]; placeholder?: string; invalid?: boolean } & SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, className, placeholder, invalid, ...rest }, ref) {
  const aria = useFieldAria(rest.id, rest);
  return (
    <div className={cn("relative min-w-0", className)}>
      <select ref={ref} aria-invalid={invalid || undefined} className="ctl appearance-none pr-10 truncate" {...rest} {...aria}>
        {placeholder ? <option value="" disabled>{placeholder}</option> : null}
        {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
    </div>
  );
});

export type TextareaProps = { invalid?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, invalid, ...rest }, ref) {
  const aria = useFieldAria(rest.id, rest);
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn("ctl min-h-[88px] resize-y", className)} {...rest} {...aria} />;
});

export type SearchInputProps = { value: string; onChange: (v: string) => void; placeholder?: string; id?: string; label?: string | null; className?: string; inputRef?: Ref<HTMLInputElement> } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

/** Search box: the icon sits in its own padding, never over the text. */
export function SearchInput({ value, onChange, placeholder, id, label, className, inputRef, ...rest }: SearchInputProps) {
  const { isPhone } = useView();
  const auto = useId();
  const iid = id || auto;
  return (
    <div className={cn("relative min-w-0", className)} role="search">
      {label === null || rest["aria-labelledby"] || rest["aria-label"] ? null : <label htmlFor={iid} className="sr-only">{label || placeholder}</label>}
      <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input ref={inputRef} id={iid} type="search" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="ctl pl-11 pr-11 [&::-webkit-search-cancel-button]:appearance-none" {...rest} />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className={cn("absolute top-1/2 -translate-y-1/2 grid place-items-center text-muted hover:text-fg rounded-md", isPhone ? "right-0 w-11 h-11" : "right-1.5 w-9 h-9")}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
