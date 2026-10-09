import { QueryClient } from "@tanstack/react-query";
import axios from "axios";

/** Data cache defaults. Never poll and never refetch on focus: the database is Neon's free plan. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => count < 1 && !(axios.isAxiosError(error) && error.response && error.response.status < 500),
    },
    mutations: { retry: false },
  },
});
