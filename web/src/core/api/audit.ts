import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import axios from "axios";
import { problemOf } from "./errors";
import { saveFile } from "@/core/print/files";
import { todayIST, toPaise } from "@/core/format";
import { billQuery } from "./sales";
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


/** Shared by audit, merge and backup restore. Removed detail pages become stale without asking for a deleted row. */
export async function invalidateRecords(qc: QueryClient): Promise<void> {
  const roots = new Set(["audit", "sales", "customers", "catalog", "products", "firms", "businesses", "purchases", "bin", "gst", "reports", "search", "setup", "backup", "drafts"]);
  const affected = (q: { queryKey: readonly unknown[] }) => roots.has(String(q.queryKey[0]));
  await qc.invalidateQueries({ predicate: affected, refetchType: "none" });
  await qc.invalidateQueries({ predicate: (q) => affected(q) && !["one", "detail", "bill", "record", "restore-entry", "statement", "itax"].includes(String(q.queryKey[1])) });
}
export type AuditActionResult = { entry: AuditEntry; new_entry: AuditEntry; link?: string };
export function useAuditAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, kind }: { id: number; kind: AuditAction }) => (await api.post<AuditActionResult>(`audit/${id}/${kind}/`)).data,
    onSuccess: () => invalidateRecords(qc),
  });
}
export type AuditRecord = { number: string; date: string; party: string; total: number | null; deletedAt?: string; deletedBy?: Person };
type BillWire = { invoice_number: string; invoice_date: string; total_amount: string; customer?: { name: string }; supplier?: { name: string } };
type BinWire = BillWire & { id: number; original_id: number; type?: "sale" | "purchase"; deleted_at: string; deleted_by: Person };
const recordOf = (bill: BillWire): AuditRecord => ({ number: bill.invoice_number, date: bill.invoice_date, party: bill.supplier?.name ?? bill.customer?.name ?? "", total: toPaise(bill.total_amount) });
const binRecord = (bill: BinWire): AuditRecord => ({ ...recordOf(bill), deletedAt: bill.deleted_at, deletedBy: bill.deleted_by });
async function findBin(match: (row: BinWire) => boolean, signal: AbortSignal, q?: string): Promise<BinWire | null> {
  let page = 1;
  while (true) {
    const answer = (await api.get<{ results: BinWire[]; next: string | null }>("bin/", { params: { page, page_size: 100, ...(q ? { q } : {}) }, signal })).data;
    const row = answer.results.find(match);
    if (row) return row;
    if (!answer.next) return null;
    page += 1;
  }
}
/** A restore link carries a bin row id. The list contract has no get-by-id: scan bounded pages on this explicit visit. */
export function useAuditRestoreEntry(binId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["audit", "restore-entry", binId], enabled: enabled && Number.isSafeInteger(binId) && binId > 0,
    queryFn: async ({ signal }): Promise<{ entry: AuditEntry; record: AuditRecord } | null> => {
      const bin = await findBin((row) => row.id === binId, signal);
      if (!bin) return null;
      let page = 1;
      while (true) {
        const answer = (await api.get<AuditPage>("audit/", { params: { entity_id: bin.original_id, kind: "sales", group: "delete", page, page_size: 30 }, signal })).data;
        const entry = answer.results.find((row) => row.entity_id === bin.original_id && row.can?.kind === "restore");
        if (entry) return { entry, record: binRecord(bin) };
        if (!answer.next) return null;
        page += 1;
      }
    },
  });
}
/** Load a bill's confirmation only when its action opens; sales share the existing detail cache. */
export function useAuditRecord(entry: AuditEntry, record?: AuditRecord) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["audit", "record", entry.id], initialData: record,
    enabled: !record && ["sales", "purchases"].includes(entry.kind),
    queryFn: async ({ signal }): Promise<AuditRecord | null> => {
      if (entry.can?.kind === "restore" && entry.kind === "purchases") {
        try { await api.get(`purchases/${entry.entity_id}/`, { signal }); return null; }
        catch (error) {
          const problem = problemOf(error);
          const binned = problem.kind === "notfound" && problem.code === "deleted" ? (problem.body as { binned?: BinWire }).binned : undefined;
          if (binned) return binRecord(binned);
          throw error;
        }
      }
      if (entry.can?.kind === "restore") {
        const bin = await findBin((row) => row.original_id === entry.entity_id && (row.type === "purchase") === (entry.kind === "purchases"), signal, entry.words.target);
        return bin ? binRecord(bin) : null;
      }
      if (entry.kind === "sales") {
        const answer = await qc.fetchQuery(billQuery(entry.entity_id));
        if (answer.kind !== "bill") return null;
        const bill = answer.bill;
        return { number: bill.invoice_number, date: bill.invoice_date, party: bill.customer.name, total: bill.total_amount };
      }
      return recordOf((await api.get<BillWire>(`purchases/${entry.entity_id}/`, { signal })).data);
    },
  });
}
