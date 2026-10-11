import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { checkGstin, cleanGstin } from "@/core/ids";
import { useDebounced } from "@/core/useDebounced";
import type { CustomerRef } from "@/core/sales/types";
import type { FirmRef } from "./catalog";

export type GstinRegistry = { gstin: string; valid: boolean; source?: 'checksum' | 'cache' | 'provider'; reason?: string; trade_name?: string; legal_name?: string; address?: string; state_name?: string; pan?: string; status?: string; hint?: string };
/** One on-demand registry read, keyed by GSTIN. A stale response can never fill a different number's fields. */
export function useGstinRegistry(raw: string) {
  const g = cleanGstin(raw);
  const debounced = useDebounced(g);
  const ready = g === debounced && checkGstin(g).status === 'valid';
  return useQuery({ queryKey: ['gstin-registry', g], staleTime: 30 * 60_000, retry: false,
    queryFn: ready ? async ({ signal }) => (await api.get<GstinRegistry>(`gstin/${g}/`, { signal })).data : skipToken });
}

export type RegistryResult = {
  gstin: string; status: "invalid" | "found" | "unknown"; reason: string; state_code: string | null; state_name: string | null; pan: string | null;
  registry: { legal_name: string; trade_name: string; address: string; city: string; pin_code: string; registered_on: string; active: boolean; status_text: string; taxpayer_type: string; constitution: string } | null;
  lookup: "cache" | "provider" | "unreachable" | null; on_file: { customers: CustomerRef[]; firms: FirmRef[] } | null;
};
/** No request for partial or invalid input; a changed number never displays the previous number's answer. */
export function useRegistry(gstin: string | null, enabled = true) {
  const g = gstin?.trim().toUpperCase() ?? "";
  return useQuery({ queryKey: ["registry", g], staleTime: 5 * 60_000,
    queryFn: !enabled || checkGstin(g).status !== "valid" ? skipToken : async ({ signal }) => (await api.get<RegistryResult>(`registry/${encodeURIComponent(g)}/`, { signal })).data,
  });
}
