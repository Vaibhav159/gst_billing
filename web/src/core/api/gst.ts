import axios from 'axios';
import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client';
import { readGst } from '@/core/gst/wire';
import type { Gstr1, Gstr3b, Month, MonthEnd, Year } from '@/core/gst/types';
export const gstKeys = {
  all: ['gst'] as const,
  year: (business: number | null, fy: string) => ['gst','year',business,fy] as const,
  month: (business: number | null, month: string | null) => ['gst','month',business,month] as const,
  end: (month: string | null) => ['gst','month-end',month] as const,
  sections: (business: number | null, month: string | null, asFiled: boolean) => ['gst','gstr1',business,month,asFiled] as const,
  ledger: (business: number | null, month: string | null) => ['gst','gstr3b',business,month] as const,
};
export function invalidateGst(qc: QueryClient) {
  for (const root of ['gst','sales','bin','purchases','reports','audit']) void qc.invalidateQueries({ queryKey: [root] });
}
export function useGstYear(business: number | null, fy: string) {
  return useQuery({ queryKey: gstKeys.year(business, fy), queryFn: business === null ? skipToken : async ({signal}) => readGst<Year>((await api.get('gst/year/', { params: {business_id: business, fy}, signal })).data) });
}
export function useGstMonth(business: number | null, month: string | null) {
  return useQuery({ queryKey: gstKeys.month(business, month), queryFn: business === null || month === null ? skipToken : async ({signal}) => readGst<Month>((await api.get('gst/month/', { params: {business_id: business, month}, signal })).data) });
}
export function useGstMonthEnd(month: string | null) {
  return useQuery({ queryKey: gstKeys.end(month), queryFn: month === null ? skipToken : async ({signal}) => readGst<MonthEnd>((await api.get('gst/month-end/', { params: {month}, signal })).data) });
}
export function useGstSections(business: number | null, month: string | null, asFiled = false) {
  return useQuery({ queryKey: gstKeys.sections(business, month, asFiled), queryFn: business === null || month === null ? skipToken : async ({signal}) => readGst<Gstr1>((await api.get('gst/month/gstr1/', { params: {business_id: business, month, ...(asFiled ? {as_filed: 1} : {})}, signal })).data) });
}
export function useGstLedger(business: number | null, month: string | null) {
  return useQuery({ queryKey: gstKeys.ledger(business, month), queryFn: business === null || month === null ? skipToken : async ({signal}) => readGst<Gstr3b>((await api.get('gst/month/gstr3b/', { params: {business_id: business, month}, signal })).data) });
}
export type GstWrite = { method: 'post' | 'patch' | 'delete'; path: string; body: unknown };
export function useGstWrite() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({method,path,body}: GstWrite) => (await api.request({ method, url: `gst/${path}`, data: body })).data, onSuccess: () => invalidateGst(qc) });
}
/** Files stay server-owned. Blob errors still carry the contract's 400/409 words. */
export async function getGstFile(business: number, month: string, kind: 'gstr1' | 'gstr1a' | 'gstr3b' | 'amendments', asFiled = false, via: 'download' | 'share' = 'download'): Promise<Blob> {
  try { return (await api.get<Blob>(`gst/files/${kind}/`, { responseType: 'blob', params: { business_id: business, month, ...(asFiled ? {as_filed: 1} : {}), via } })).data; }
  catch (e) {
    if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
      try { e.response.data = JSON.parse(await e.response.data.text()); } catch { /* An HTML failure keeps the client's generic words. */ }
    }
    throw e;
  }
}
