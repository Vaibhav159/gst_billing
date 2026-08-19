import { CheckCircle2, AlertTriangle, Loader2, Info } from "lucide-react";
import type { GstinState } from "@/hooks/useGstinLookup";

/**
 * One-line verdict under a GSTIN input: instant checksum feedback, then what
 * the lookup found. Renders nothing until there's something worth saying.
 */
export default function GstinStatus({ state }: { state: GstinState }) {
  if (state.status === "idle") return null;
  if (state.status === "checking")
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Checking GSTIN…
      </p>
    );
  if (state.status === "invalid")
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-warning mt-1">
        <AlertTriangle className="w-3 h-3" /> {state.reason}
      </p>
    );
  const d = state.data;
  if (!d.valid)
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-warning mt-1">
        <AlertTriangle className="w-3 h-3" /> {d.reason}
      </p>
    );
  if (d.legal_name || d.trade_name)
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-success mt-1">
        <CheckCircle2 className="w-3 h-3" />
        {d.status ? `${d.status} · ` : ""}{d.trade_name || d.legal_name} (GSTN)
      </p>
    );
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
      <Info className="w-3 h-3" /> Valid GSTIN — state and PAN filled from the number
    </p>
  );
}
