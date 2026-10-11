import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import axios from "axios";
import { saveFile } from "@/core/print/files";
import { todayIST } from "@/core/format";
import type { Person } from "@/core/sales/types";

export type AuditChange = { key: string; field: string; from: string; to: string };
export type AuditAction = "undo" | "revert" | "restore";
export type AuditEntry = {
  id: number; at: string; by: Person; action: string; entity: string; entity_id: number;
  kind: string; group: string; words: { text: string; target: string; after: string }; link: string | null;
  note: string; details: string; changes: AuditChange[]; result: "undone" | "reverted" | "restored" | null;
  can: { kind: AuditAction; label: string; disabled: string; hint: string; effect: string } | null;
};
export type AuditPage = {
  count: number; next: string | null; previous: string | null; results: AuditEntry[]; total: number;
  counts?: Record<string, number>; people?: { id: number | null; name: string }[];
};
export type AuditFilters = { by?: string; kind?: string; group?: string; q?: string; entity?: string; entity_id?: number; start_date?: string; end_date?: string };
export function auditParams(filters: AuditFilters): Record<string, string | number> {
  return Object.fromEntries(Object.entries({ ...filters, q: filters.q?.trim().slice(0, 100) }).filter((pair): pair is [string, string | number] => pair[1] !== undefined && pair[1] !== "" && pair[1] !== "all"));
}
export function useAuditLog(filters: AuditFilters) {
  const params = auditParams(filters);
  return useInfiniteQuery({
    queryKey: ["audit", "list", params], initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => (await api.get<AuditPage>("audit/", { params: { ...params, page: pageParam, page_size: 30, ...(pageParam === 1 ? { counts: 1 } : {}) }, signal })).data,
    getNextPageParam: (last, _pages, page) => last.next ? page + 1 : undefined,
  });
}
export function useAuditExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (filters: AuditFilters) => {
      try {
        const res = await api.get<Blob>("audit/export/", { params: auditParams(filters), responseType: "blob", timeout: 600_000 });
        const name = /filename="?([^";]+)"?/i.exec(String(res.headers["content-disposition"] ?? ""))?.[1];
        saveFile(res.data, name?.split(/[\\/]/).pop() || `Audit-log_${todayIST()}.csv`);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
          try { error.response.data = JSON.parse(await error.response.data.text()); } catch { /* Shared problemOf handles a non-JSON failure. */ }
        }
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit"] }),
  });
}
