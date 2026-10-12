import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FirmId } from '@/core/scope';
import type { SupplierInput } from '@/core/purchases/types';
import { toSupplierDetail, toSupplierMemory, toSupplierPage, toSupplierRecord } from '@/core/purchases/wire';
import { invalidatePurchases } from './purchases';
import { api } from './client';
export const supplierKeys = {
  all: ['suppliers'] as const,
  list: (firmId: FirmId | null, fy: string, q: string, ordering: '-total' | 'name') => ['suppliers', 'list', firmId, fy, q, ordering] as const,
  one: (id: number | null, firmId: FirmId | null, fy?: string) => ['suppliers', 'one', id, firmId, fy] as const,
  memory: (id: number | null, business?: number | null) => ['suppliers', 'memory', id, business] as const,
};
export function useSuppliers(firmId: FirmId | null, fy: string, q = '', ordering: '-total' | 'name' = 'name') {
  return useInfiniteQuery({ queryKey: supplierKeys.list(firmId, fy, q, ordering), initialPageParam: 1,
    queryFn: firmId === null ? skipToken : async ({ pageParam, signal }) => toSupplierPage((await api.get('suppliers/', { params: { ...(firmId === 'all' ? {} : { business_id: firmId }), fy, q, ordering, page: pageParam, page_size: 100 }, signal })).data),
    getNextPageParam: (last, pages) => last.next ? pages.length + 1 : undefined,
    placeholderData: (prev, previous) => previous?.queryKey[2] === firmId && previous.queryKey[3] === fy ? prev : undefined,
  });
}
export function useSupplier(id: number | null, firmId: FirmId | null = 'all', fy?: string) {
  return useQuery({ queryKey: supplierKeys.one(id, firmId, fy), queryFn: id === null || firmId === null ? skipToken : async ({ signal }) => toSupplierDetail((await api.get(`suppliers/${id}/`, { params: { ...(firmId === 'all' ? {} : { business_id: firmId }), ...(fy ? { fy } : {}) }, signal })).data) });
}
export function useSupplierMemory(id: number | null, business?: number | null) {
  return useQuery({ queryKey: supplierKeys.memory(id, business), queryFn: id === null || business === null ? skipToken : async ({ signal }) => toSupplierMemory((await api.get(`suppliers/${id}/memory/`, { params: business == null ? {} : { business_id: business }, signal })).data) });
}
export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, body }: { id?: number; body: SupplierInput }) => toSupplierRecord((id == null ? await api.post('suppliers/', body) : await api.put(`suppliers/${id}/`, body)).data),
    onSuccess: () => { invalidatePurchases(qc); void qc.invalidateQueries({ queryKey: ['sales'] }); } });
}
