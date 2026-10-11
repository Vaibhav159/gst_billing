import { skipToken, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { checkGstin, cleanGstin } from '@/core/ids';
import { useDebounced } from '@/core/useDebounced';

export type GstinRegistry = { gstin: string; valid: boolean; source?: 'checksum' | 'cache' | 'provider'; reason?: string; trade_name?: string; legal_name?: string; address?: string; state_name?: string; pan?: string; status?: string; hint?: string };
/** One on-demand registry read, keyed by GSTIN. A stale response can never fill a different number's fields. */
export function useGstinRegistry(raw: string) {
  const g = cleanGstin(raw);
  const debounced = useDebounced(g);
  const ready = g === debounced && checkGstin(g).status === 'valid';
  return useQuery({ queryKey: ['gstin-registry', g], staleTime: 30 * 60_000, retry: false,
    queryFn: ready ? async ({ signal }) => (await api.get<GstinRegistry>(`gstin/${g}/`, { signal })).data : skipToken });
}
