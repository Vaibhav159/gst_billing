import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import type { LineInput, PaymentMode } from '@/core/sales/types';
import type { PurchaseRead } from '@/core/captures/types';
import { assertMultipartSize } from '@/core/captures/multipart';
export type ImportKind = 'purchases' | 'sales';
export type ImportLine = LineInput | { product_name: string; hsn_code: string; gst_percent: string; unit: string; taxable: string; note: string; amount_only: true; quantity?: string };
export type ImportBill = { ref: string; business: number; invoice_number: string; invoice_date: string; payment_mode: PaymentMode; lines: ImportLine[]; supplier?: number | string; customer?: number | string; itc_eligible?: boolean; itc_month?: string | null; buyer_gstin?: string; buyer_ack?: boolean; pair?: { seller: number; invoice_number: string } | null; paper?: true; place_of_supply?: string | null; notes?: string };
export type ImportParty = { ref: string; name: string; gst_number: string; state_name: string; city: string; address: string };
export type ImportBody = { file_name: string; dry_run: boolean; suppliers?: ImportParty[]; customers?: ImportParty[]; bills: ImportBill[] };
export type Credit = { month: string | null; chosen: string | null; late: boolean; eligible: boolean; lapsed: boolean; claimed: string; state: 'outside' | 'open' | 'filed'; filed_on: string | null; deadline: string };
export type ImportResult = { dry_run: boolean; ok: boolean; bills: { ref: string; ok: boolean; id: number | null; problems: { field: string; detail: string }[]; duplicate: { id: number; invoice_number: string } | null; credit: Credit | null }[]; suppliers?: { ref: string; id: number | null }[]; customers?: { ref: string; id: number | null }[]; totals: { bills: number; total_amount: string; credit: string } };
export type Read = PurchaseRead;
export async function batchRequest(kind: ImportKind, body: ImportBody): Promise<ImportResult> {
  if (!body.bills.length) throw new Error('There are no bills to import.');
  if (body.bills.length > 300) throw new Error('An import can hold at most 300 bills. Split the file.');
  if (Math.max(body.suppliers?.length ?? 0, body.customers?.length ?? 0) > 100) throw new Error('An import can add at most 100 new parties. Split the file.');
  return (await api.post<ImportResult>(`${kind}/import/`, body)).data;
}
export function useBatchImport(kind: ImportKind) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: ImportBody) => batchRequest(kind, body), onSuccess: async (result, body) => {
    if (!body.dry_run && result.ok && !result.dry_run) await Promise.all(['purchases', 'sales', 'suppliers', 'customers', 'search', 'gst'].map(key => qc.invalidateQueries({ queryKey: [key] })));
  } });
}
export function useReadBill() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (body: FormData) => {
    assertMultipartSize(body);
    return (await api.post<Read>('purchases/read/', body)).data;
  },
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai-reads'] }) });
}
