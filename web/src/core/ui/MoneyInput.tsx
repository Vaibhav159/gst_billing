import { useEffect, useRef, useState } from "react";
import { groupIN, paiseToInput, parseRupees } from "@/core/format";
import { Input, type InputProps } from "./Input";

/**
 * Money typed in rupees, held as paise. Keeps exactly what was typed while the field
 * has focus (the text never changes under the cursor); leaving it shows Indian grouping ("65,000.00"). A comma before the last
 * one or two digits is a decimal comma ("4150,50" is ₹4,150.50): Indian grouping never
 * ends in a group of one or two digits, so it can't be a thousands comma.
 */
export function readMoney(text: string): number | null {
  const t = String(text ?? "").trim();
  return parseRupees(!t.includes(".") && /,\d{1,2}$/.test(t) ? t.replace(/,(\d{1,2})$/, ".$1") : t);
}
function groupedMoney(p: number | null): string {
  if (p == null) return "";
  const s = paiseToInput(p);
  const [r, d] = s.split(".");
  return `${groupIN(Number(r))}.${d}`;
}

export type MoneyInputProps = { value: number | null; onChange?: (paise: number | null, text: string) => void } & Omit<InputProps, "value" | "onChange">;

export function MoneyInput({ value, onChange, onBlur, onFocus, ...rest }: MoneyInputProps) {
  const focused = useRef(false);
  const [raw, setRaw] = useState(value == null ? "" : groupedMoney(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setRaw(value == null ? "" : focused.current ? paiseToInput(value) : groupedMoney(value)); } }, [value]);
  return (
    <Input prefix="₹" inputMode="decimal" autoComplete="off" value={raw}
      onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ""); setRaw(t); const p = readMoney(t); last.current = p; onChange?.(p, t); }}
      onFocus={(e) => { focused.current = true; onFocus?.(e); }}
      onBlur={(e) => { focused.current = false; const p = readMoney(raw); if (p != null) setRaw(groupedMoney(p)); onBlur?.(e); }}
      {...rest} />
  );
}

export type QtyInputProps = { value: number | null; onChange?: (n: number | null, text: string) => void; unit?: string; decimals?: number } & Omit<InputProps, "value" | "onChange">;

/** Quantity with fixed decimals (weights: 3). A comma is read as the decimal point. */
export function QtyInput({ value, onChange, onBlur, unit = "g", decimals = 3, ...rest }: QtyInputProps) {
  const fmt = (v: number | null) => (v == null || Number.isNaN(v) ? "" : Number(v).toFixed(decimals));
  const [raw, setRaw] = useState(fmt(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setRaw(fmt(value)); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const re = new RegExp(`^\\d*\\.?\\d{0,${decimals}}$`);
  return (
    <Input suffix={unit} inputMode="decimal" autoComplete="off" value={raw}
      onChange={(e) => { const t = e.target.value.replace(",", ".").replace(/[^\d.]/g, ""); if (!re.test(t)) return; setRaw(t); const n = t === "" || t === "." ? null : Number(t); last.current = n; onChange?.(n, t); }}
      onBlur={(e) => { if (raw !== "" && raw !== ".") setRaw(fmt(Number(raw))); onBlur?.(e); }}
      {...rest} />
  );
}
