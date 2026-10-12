import { useState } from 'react';
import { useCaptureSummary } from '@/core/api/captures';

/** Local paging only; 2C owns the types, endpoint, cache keys and transport. */
export function useTodayCaptures(firm: number | null, day: string) {
  const [selected, setSelected] = useState({ firm, day, page: 1 });
  const page = selected.firm === firm && selected.day === day ? selected.page : 1;
  if (selected.firm !== firm || selected.day !== day) setSelected({ firm, day, page: 1 });
  const query = useCaptureSummary(firm, day, page, 'waiting');
  return { ...query, page,
    nextPage: () => setSelected({ firm, day, page: page + 1 }),
    previousPage: () => setSelected({ firm, day, page: Math.max(1, page - 1) }),
  };
}
