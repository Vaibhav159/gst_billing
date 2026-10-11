import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { invalidateRecords } from "./audit";
import { toCustomerPage, type CustomerType } from "./customers";
import type { BillRef, CustomerRef } from "@/core/sales/types";

export type DuplicateGroup = { what: "phone" | "gstin"; value: string; customers: CustomerRef[] };
export type MergeCustomer = CustomerRef & { state_name: string; type: CustomerType; since?: string };
export type MergeChange = { bill: BillRef; sent: boolean; paper: boolean; sent_at: string | null; sent_via: string;
  heads: { from: "igst" | "cgst_sgst"; to: "igst" | "cgst_sgst" } | null;
  segment: { from: string; to: string } | null; gstin_changes: boolean; words: string };
export type MergePreview = { source: MergeCustomer; target: MergeCustomer; can_merge: boolean;
  refusal: { code: "month_closed" | "sent_changes" | "walkin"; detail: string; months: string[]; bills: MergeChange[] } | null;
  bills: { count: number; cancelled: number; numbers: string[] }; purchases: number; bin: number; drafts: number;
  changes: MergeChange[]; firms_added: { id: number; name: string; short: string }[]; keeps: string };
export type MergeResult = { target: number; moved: { bills: number; purchases: number; bin: number; drafts: number }; refiled: number; firms_added: number };

export function useCustomerDuplicates(enabled = true) {
  return useQuery({ queryKey: ["customers", "duplicates"], queryFn: enabled ? async ({ signal }) =>
    (await api.get<{ groups: DuplicateGroup[] }>("customers/duplicates/", { signal })).data.groups : skipToken });
}
export function useMergeCandidates(term: string) {
  return useQuery({ queryKey: ["customers", "merge-candidates", term], queryFn: async ({ signal }) =>
    toCustomerPage((await api.get("customers/", { signal, params: { search: term, ordering: "name", page_size: 9 } })).data).rows });
}
export function useMergePreview(source: number, target: number | null) {
  return useQuery({ queryKey: ["customers", "merge-preview", source, target],
    queryFn: target === null ? skipToken : async ({ signal }) =>
      (await api.get<MergePreview>(`customers/${source}/merge-preview/`, { params: { into: target }, signal })).data });
}
export function useMergeCustomer() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ source, target }: { source: number; target: number }) =>
    (await api.post<MergeResult>(`customers/${source}/merge-into/`, { into: target })).data,
    onSuccess: () => { void invalidateRecords(qc); } });
}
