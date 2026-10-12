import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { rowsOf, usePurchasesList, type PurchaseQuery } from "@/core/api/purchases";
import { fyOf, monthLabel } from "@/core/format";
import { useFirms, useScope } from "@/core/scope";
import { useDebounced } from "@/core/useDebounced";

const positive = (s: string | null) => s && /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : undefined;
export function usePurchaseList() {
  const scope = useScope();
  const { firms } = useFirms();
  const [params, setParams] = useSearchParams();
  const linkFirm = positive(params.get("firm"));
  const linkMonth = params.get("month") || "";
  const linkCredit = params.get("credit") || "";
  const linkedYear = /^\d{4}-\d{2}$/.test(linkCredit || linkMonth) ? fyOf(`${linkCredit || linkMonth}-01`) : undefined;
  const seen = useRef<string | null>(null);
  const link = `${linkFirm ?? ""}/${linkMonth}/${linkCredit}`;
  const pendingLink = seen.current !== link;
  useEffect(() => {
    if (seen.current === link || linkFirm && !firms.length) return;
    seen.current = link;
    if (linkFirm && firms.some((f) => f.id === linkFirm)) scope.setFirmId(linkFirm);
    if (linkedYear) scope.setFy(linkedYear);
    if (linkFirm) setParams((before) => { const next = new URLSearchParams(before); next.delete("firm"); return next; }, { replace: true });
  }, [link, linkFirm, linkedYear, firms, scope, setParams]);
  const lastFy = useRef(scope.fy);
  useEffect(() => {
    if (lastFy.current === scope.fy) return;
    lastFy.current = scope.fy;
    if (params.get("fy") || linkedYear && linkedYear !== scope.fy && !pendingLink) setParams((before) => { const next = new URLSearchParams(before); for (const key of ["fy", "month", "credit", "from", "to"]) next.delete(key); return next; }, { replace: true });
  }, [scope.fy, linkedYear, pendingLink, params, setParams]);
  const firmId = pendingLink ? linkFirm ?? scope.firmId : scope.firmId;
  const fy = params.get("fy") || (pendingLink ? linkedYear ?? scope.fy : scope.fy);
  const search = useDebounced(params.get("q") || "");
  const query: PurchaseQuery = useMemo(() => ({
    fy, facets: true, ...(linkCredit ? { credit_month: linkCredit } : { ...(linkMonth ? { month: linkMonth } : {}), ...(params.get("from") ? { start_date: params.get("from")! } : {}), ...(params.get("to") ? { end_date: params.get("to")! } : {}) }),
    ...(positive(params.get("supplier")) ? { supplier_id: positive(params.get("supplier")) } : {}),
    ...(params.get("status") === "check" ? { check: true } : {}), ...(params.get("status") === "photo" ? { photo: true } : {}),
    ...(params.get("check") === "1" ? { check: true } : {}), ...(params.get("photo") === "1" ? { photo: true } : {}),
    ...(params.get("dups") === "1" ? { dups: true } : {}), ...(params.get("empty") === "1" ? { empty: true } : {}), ...(params.get("no_hsn") === "1" ? { no_hsn: true } : {}),
    ...(params.get("eligible") === "0" ? { eligible: 0 as const } : {}), ...(search ? { q: search } : {}),
  }), [fy, params, linkCredit, linkMonth, search]);
  const list = usePurchasesList(firmId, query, fy);
  const rows = rowsOf(list.data);
  const first = list.data?.pages[0];
  const set = (patch: Record<string, string | undefined>) => setParams((old) => { const p = new URLSearchParams(old); for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); } return p; }, { replace: true });
  const clear = () => setParams(linkFirm ? { firm: String(linkFirm) } : {}, { replace: true });
  const firm = firmId === "all" ? "All firms" : firms.find((f) => f.id === firmId)?.name || "Purchases";
  const period = linkCredit ? `credit claimed in ${monthLabel(linkCredit, { long: true })}'s GSTR-3B` : linkMonth ? monthLabel(linkMonth, { long: true }) : params.get("from") || params.get("to") ? `${params.get("from") || "start"} to ${params.get("to") || "today"}` : `FY ${fy}`;
  return { scope, firmId, fy, firm, period, query, params, set, clear, list, rows, first, filtered: [...params.keys()].some((k) => k !== "firm"), credit: linkCredit };
}
