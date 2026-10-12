// Records contract §2. Every list picker uses the slim query; numbers and FY figures are opt-in.
import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { toPaise } from "@/core/format";
import type { BillRef, BillStatus, PaymentMode } from "@/core/sales/types";
import type { Change } from "./catalog";
import { figures, firmKeys, firmListQuery, type WireFigures } from "./firmList";
export { firmKeys, firmListQuery, toFirmRow } from "./firmList";
export type ReturnState = "future" | "open" | "blocked" | "ready" | "gstr1" | "filed" | "unlocked";
export type FirmNumbers = { fy: string; last: BillRef | null; next: { counter: number; invoice_number: string }; full_number: boolean };
export type FirmFigures = {
  fy: string; from: string; to: string;
  sales: { bills: number; total: number; tax: number; cancelled: number }; purchases: { bills: number; total: number; tax: number };
  customers: number; first_bill: BillRef | null; last_bill: BillRef | null;
  last_filed: { month: string; gstr1_filed_on: string | null; gstr3b_filed_on: string | null } | null;
  previous_month: { month: string; state: ReturnState; blocker: string };
};
export type FirmRow = { id: number; name: string; short: string; short_name: string; gst_number: string; state_code: string; state_name: string; invoice_prefix: string; city: string; paper_full_number_from: string | null; numbers?: FirmNumbers; figures?: FirmFigures };
export type FirmBody = { name: string; short_name: string; gst_number: string; address: string; city: string; pin_code: string; mobile_number: string; email: string; bank_name: string; bank_account_number: string; bank_ifsc_code: string; bank_branch_name: string; invoice_prefix: string; paper_full_number_from: string | null; signature_on_bills: boolean; jurisdiction: string; declaration: string };
export type FirmDetail = FirmRow & FirmBody & {
  gstin_valid: boolean; pan_number: string; has_bank: boolean; signature_url: string | null; jurisdiction_printed: string; declaration_printed: string;
  numbers: FirmNumbers; figures: FirmFigures;
  recent: { id: number; invoice_number: string; invoice_date: string; customer_name: string; payment_mode: PaymentMode; total_amount: number; status: BillStatus }[];
  months: { month: string; state: ReturnState; gstr1_filed_on: string | null; gstr3b_filed_on: string | null }[];
  uses: { sales: number; cancelled: number; purchases: number; bin: number; drafts: number; captures: number; filing_records: number; filing_months: number; filed_periods: number; opening_credits: number };
  plain_after_full_date: number; updated_at: string; changes?: Change[]; frozen_bills?: number;
};
export type FirmSaved = Omit<FirmDetail, "numbers" | "figures" | "recent" | "months" | "uses" | "plain_after_full_date">;
export function toFirmDetail(raw: unknown): FirmDetail {
  const f = raw as Omit<FirmDetail, "figures" | "recent"> & { figures: WireFigures; recent: (Omit<FirmDetail["recent"][number], "total_amount"> & { total_amount: string })[] };
  return { ...f, figures: figures(f.figures), recent: f.recent.map((b) => ({ ...b, total_amount: toPaise(b.total_amount) ?? 0 })) };
}
export type FirmParams = { numbers?: 1; figures?: 1; fy?: string };
export function useFirmNumbers() { return useQuery(firmListQuery({ numbers: 1 })); }
export function useFirmList(fy: string) { return useQuery(firmListQuery({ numbers: 1, figures: 1, fy })); }
export function useFirm(id: number | null, fy: string) {
  return useQuery({ queryKey: firmKeys.one(id, fy), queryFn: id === null ? skipToken : async ({ signal }) => toFirmDetail((await api.get(`firms/${id}/`, { params: { fy }, signal })).data) });
}
export function invalidateFirms(qc: QueryClient) {
  for (const key of ["firms", "sales", "customers", "setup", "search", "registry", "audit", "shop-settings"]) void qc.invalidateQueries({ queryKey: [key] });
}
export function useSaveFirm() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, body }: { id?: number; body: FirmBody }) => (await (id ? api.put<FirmSaved>(`firms/${id}/`, body) : api.post<FirmSaved>("firms/", body))).data, onSuccess: () => invalidateFirms(qc) });
}
export function useSignature() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, image }: { id: number; image: File | null }) => {
    if (!image) return (await api.delete<FirmSaved>(`firms/${id}/signature/`)).data;
    const data = new FormData(); data.append("image", image);
    return (await api.put<FirmSaved>(`firms/${id}/signature/`, data)).data;
  }, onSuccess: () => invalidateFirms(qc) });
}
export function useDeleteFirm() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (id: number) => (await api.delete<{ audit_id: number }>(`firms/${id}/`)).data, onSuccess: () => invalidateFirms(qc) });
}
/** The firm's toast can undo its deletion before the Audit page lands. */
export function useRestoreFirm() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (auditId: number) => (await api.post<{ link: string }>(`audit/${auditId}/restore/`)).data, onSuccess: () => invalidateFirms(qc) });
}
