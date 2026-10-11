import { skipToken, useQuery } from "@tanstack/react-query";
import type { FirmId } from "@/core/scope";
import { api } from "./client";

/** 2B's read adapter; 2C extends this single module with the complete capture wire and writes. */
export type CaptureInboxPreview = { count: number; results: { id: number; label: string; hint: string; status: "reading" | "ready" | "failed"; business_name: string | null }[] };
export function useCaptureInboxPreview(firmId: FirmId | null, enabled = true) {
  return useQuery({ queryKey: ["captures", "list", firmId], enabled: enabled && firmId !== null,
    queryFn: firmId === null ? skipToken : async ({ signal }) => (await api.get("captures/", { params: { ...(firmId !== "all" ? { business_id: firmId } : {}), status: "waiting" }, signal })).data as CaptureInboxPreview });
}
