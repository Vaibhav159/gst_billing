import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { paiseToDecimal } from '@/core/format';
import { boardOf, type Quoted, type Rates, type WireBoard, type WireRates } from './model';
export const ratesKeys = { all: ['rates'] as const, board: (date?: string | null) => ['rates', date ?? 'latest'] as const };
/** undefined: current board; ISO date: board in force; null/blank: wait for a valid date. */
export function useRates(date?: string | null, enabled = true) {
  return useQuery({ queryKey: ratesKeys.board(date), enabled: enabled && date !== null && date !== '', staleTime: 60_000,
    refetchOnMount: true, refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<Rates> => {
      const d = (await api.get<WireRates>('rates/', { params: date ? { date } : {}, signal })).data;
      return { ...d, latest: boardOf(d.latest), previous: boardOf(d.previous),
        ...(date ? { in_force: boardOf(d.in_force ?? null) } : {}) };
    },
  });
}
export function useSetRates() {
  const qc = useQueryClient();
  return useMutation({ retry: false, networkMode: 'always',
    mutationFn: async (quoted: Quoted) => boardOf((await api.post<WireBoard>('rates/', {
      quoted: Object.fromEntries(Object.entries(quoted).map(([key, value]) => [key, paiseToDecimal(value)])),
    })).data)!,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ratesKeys.all }); },
  });
}
