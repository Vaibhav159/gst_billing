import { useRef } from "react";

/** The last value that wasn't null, so a dialog's words stay while it animates out (PROTO sales/parts.jsx:25-29). */
export function useHeldValue<T>(v: T | null | undefined): T | null {
  const r = useRef<T | null>(v ?? null);
  if (v) r.current = v;
  return r.current;
}
