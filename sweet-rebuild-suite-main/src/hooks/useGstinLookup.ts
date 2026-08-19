import { useEffect, useRef, useState } from "react";
import api from "@/utils/api";
import { validateGstin, type GstinLookup } from "@/utils/gstin";

export type GstinState =
  | { status: "idle" }
  | { status: "invalid"; reason: string }
  | { status: "checking" }
  | { status: "done"; data: GstinLookup };

/**
 * Watches a GSTIN field: local checksum verdict instantly, then the server
 * lookup (state/PAN always; name/address/status when a provider key is
 * configured). Debounced; stale responses are dropped.
 */
export function useGstinLookup(gstin: string): GstinState {
  const [state, setState] = useState<GstinState>({ status: "idle" });
  const seq = useRef(0);

  useEffect(() => {
    const g = (gstin || "").trim().toUpperCase();
    const mySeq = ++seq.current;
    if (g.length === 0) { setState({ status: "idle" }); return; }
    if (g.length < 15) { setState({ status: "idle" }); return; }
    const local = validateGstin(g);
    if (!local.ok) { setState({ status: "invalid", reason: local.reason }); return; }
    setState({ status: "checking" });
    const t = setTimeout(async () => {
      try {
        const res = await api.get<GstinLookup>(`gstin/${g}/`);
        if (seq.current === mySeq) setState({ status: "done", data: res.data });
      } catch {
        // Endpoint unreachable — the local verdict still stands as "valid".
        if (seq.current === mySeq)
          setState({ status: "done", data: { gstin: g, valid: true, source: "checksum" } });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [gstin]);

  return state;
}
