import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { FirmId } from '@/core/scope';
import { problemOf, type ApiProblem } from './errors';
import { captureFormData, type UploadCapture } from '@/core/captures/multipart';
export type { UploadCapture } from '@/core/captures/multipart';
import type { AiReads, Capture, CaptureList, CaptureSummaryList } from '@/core/captures/types';
import { invalidateDashboard } from '@/core/due/fresh';

export const captureKeys = {
  all: ['captures'] as const,
  list: (firm: number | 'all' | null, status: string) => ['captures', 'list', firm, status] as const,
  summary: (firm: number | 'all' | null, day: string | null, page: number, status: string) => ['captures', 'list', 'summary', firm, day, page, status] as const,
  one: (id: number | null) => ['captures', 'one', id] as const,
};
export function captureProblem(error: unknown): ApiProblem {
  return problemOf(error);
}
export function useCaptures(firm: number | 'all' | null, status: 'waiting' | 'filled' | 'discarded' | 'all' = 'waiting') {
  return useQuery({ queryKey: captureKeys.list(firm, status), enabled: firm !== null,
    refetchOnWindowFocus: false, retry: false,
    queryFn: async ({ signal }) => (await api.get<CaptureList>('captures/', {
      signal, params: { ...(typeof firm === 'number' ? { business_id: firm } : {}), status },
    })).data });
}
/** X-18: Easy's day list is paged independently and never enters the full Capture cache. */
export function useCaptureSummary(firm: number | 'all' | null, day: string | null, page = 1, status: 'waiting' | 'filled' | 'discarded' | 'all' = 'all') {
  return useQuery({ queryKey: captureKeys.summary(firm, day, page, status), enabled: firm !== null && day !== null,
    refetchOnWindowFocus: false, retry: false,
    queryFn: async ({ signal }) => (await api.get<CaptureSummaryList>('captures/', {
      signal, params: { ...(typeof firm === 'number' ? { business_id: firm } : {}), day, summary: 1, page, page_size: 50, status },
    })).data });
}
export async function getCapture(id: number, signal?: AbortSignal, expectedUserId?: number): Promise<Capture> {
  return (await api.get<Capture>(`captures/${id}/`, { signal, expectedUserId })).data;
}
export function useCapture(id: number | null) {
  return useQuery({ queryKey: captureKeys.one(id), enabled: id !== null, refetchOnWindowFocus: false, retry: false,
    queryFn: async ({ signal }) => (await api.get<Capture>(`captures/${id}/`, { signal })).data });
}
export async function uploadCapture(input: UploadCapture, signal?: AbortSignal, expectedUserId?: number): Promise<Capture> {
  return (await api.post<Capture>('captures/', captureFormData(input), { signal, expectedUserId })).data;
}
export async function readCapture(id: number, signal?: AbortSignal, expectedUserId?: number): Promise<Capture> {
  return (await api.post<Capture>(`captures/${id}/read/`, undefined, { signal, expectedUserId })).data;
}
export function useCaptureAction(action: 'read' | 'discard' | 'restore') {
  const client = useQueryClient();
  return useMutation({ retry: false, networkMode: 'always',
    mutationFn: async (id: number) => action === 'read' ? readCapture(id)
      : action === 'discard' ? (await api.delete<Capture>(`captures/${id}/`)).data
      : (await api.post<Capture>(`captures/${id}/restore/`)).data,
    onSuccess: (capture) => { client.setQueryData(captureKeys.one(capture.id), capture); invalidateDashboard(client); },
    onSettled: () => { void client.invalidateQueries({ queryKey: ['captures', 'list'] }); void client.invalidateQueries({ queryKey: ['ai-reads'] }); },
  });
}
export function useAiReads() {
  return useQuery({ queryKey: ['ai-reads'], refetchOnWindowFocus: false, retry: false,
    queryFn: async ({ signal }) => (await api.get<AiReads>('ai-reads/', { signal })).data });
}

/** Preserve 2B's existing preview export in this single capture API module. */
export type CaptureInboxPreview = { count: number; results: { id: number; label: string; hint: string; status: 'reading' | 'ready' | 'failed'; business_name: string | null }[] };
export function useCaptureInboxPreview(firmId: FirmId | null, enabled = true) {
  return useQuery({ queryKey: ['captures', 'list', firmId], enabled: enabled && firmId !== null,
    queryFn: firmId === null ? skipToken : async ({ signal }) => (await api.get('captures/', { params: { ...(firmId !== 'all' ? { business_id: firmId } : {}), status: 'waiting' }, signal })).data as CaptureInboxPreview });
}
