import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { downloadBackupFile } from "./backup";
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
  count: number; next: string | null; previous: string | null; results: AuditEntry[]; total?: number;
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
      const { blob, name } = await downloadBackupFile("audit/export/", auditParams(filters), `Audit-log_${todayIST()}.csv`);
      saveFile(blob, name);
    },
    // The export adds one entry: refetch only the first loaded page, not every page of the log.
    onSuccess: () => {
      qc.setQueriesData<InfiniteData<AuditPage, number>>({ queryKey: ["audit", "list"] }, (data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) });
      return qc.invalidateQueries({ queryKey: ["audit", "list"] });
    },
  });
}


/** Shared by audit, merge and backup restore. Removed detail pages become stale without asking for a deleted row. */
export async function invalidateRecords(qc: QueryClient): Promise<void> {
  const roots = new Set(["audit", "sales", "customers", "catalog", "products", "firms", "businesses", "purchases", "bin", "gst", "reports", "search", "setup", "backup", "drafts", "suppliers", "captures", "shop-settings", "registry", "dashboard", "due-next"]);
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
    onError: (error, { id }) => {
      const problem = problemOf(error);
      if (problem.kind !== "conflict") return;
      qc.setQueriesData<InfiniteData<AuditPage>>({ queryKey: ["audit", "list"] }, (data) => data && {
        ...data, pages: data.pages.map(page => ({ ...page, results: page.results.map(entry => entry.id === id && entry.can
          ? { ...entry, can: { ...entry.can, disabled: problem.message } } : entry) })),
      });
    },
  });
}
export type AuditRecord = { number: string; date: string; party: string; total: number | null; deletedAt?: string; deletedBy?: Person };
type BillWire = { invoice_number: string; invoice_date: string; total_amount: string; customer?: { name: string }; supplier?: { name: string } };
type BinWire = BillWire & { id: number; original_id: number; type?: "sale" | "purchase"; deleted_at: string; deleted_by: Person };
const recordOf = (bill: BillWire): AuditRecord => ({ number: bill.invoice_number, date: bill.invoice_date, party: bill.supplier?.name ?? bill.customer?.name ?? "", total: toPaise(bill.total_amount) });
const binRecord = (bill: BinWire): AuditRecord => ({ ...recordOf(bill), deletedAt: bill.deleted_at, deletedBy: bill.deleted_by });
/** A stale link stops after this many pages instead of walking the whole bin or log. */
const SCAN_PAGES = 20;
async function findBin(match: (row: BinWire) => boolean, signal: AbortSignal, q?: string): Promise<BinWire | null> {
  for (let page = 1; page <= SCAN_PAGES; page += 1) {
    const answer = (await api.get<{ results: BinWire[]; next: string | null }>("bin/", { params: { page, page_size: 100, ...(q ? { q } : {}) }, signal })).data;
    const row = answer.results.find(match);
    if (row) return row;
    if (!answer.next) return null;
  }
  return null;
}
/** Sales-only bin links scan at most SCAN_PAGES pages. Purchases restore from their Audit action (P4-9). */
export function useAuditRestoreEntry(binId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["audit", "restore-entry", binId], enabled: enabled && Number.isSafeInteger(binId) && binId > 0,
    queryFn: async ({ signal }): Promise<{ entry: AuditEntry; record: AuditRecord } | null> => {
      const bin = await findBin((row) => row.id === binId && row.type !== "purchase", signal);
      if (!bin) return null;
      for (let page = 1; page <= SCAN_PAGES; page += 1) {
        const answer = (await api.get<AuditPage>("audit/", { params: { entity_id: bin.original_id, kind: "sales", group: "delete", page, page_size: 30 }, signal })).data;
        const entry = answer.results.find((row) => row.entity_id === bin.original_id && row.kind === "sales" && row.can?.kind === "restore");
        if (entry) return { entry, record: binRecord(bin) };
        if (!answer.next) return null;
      }
      return null;
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
