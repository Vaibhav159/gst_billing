import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { ratesKeys } from '@/core/api/dashboard';
import { toBoard } from '@/core/dashboard/wire';
import { invalidateDashboard } from '@/core/due/fresh';
import { paiseToDecimal } from '@/core/format';
import type { Quoted } from './model';
export function useSetRates() {
  const qc = useQueryClient();
  return useMutation({ retry: false, networkMode: 'always',
    mutationFn: async (quoted: Quoted) => toBoard((await api.post('rates/', {
      quoted: Object.fromEntries(Object.entries(quoted).map(([key, value]) => [key, paiseToDecimal(value)])),
    })).data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ratesKeys.all }); invalidateDashboard(qc); },
  });
}
