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
    // Ruling 41: nothing queues. TanStack's default ("online") holds a save made offline and sends it later: the button
    // spins, and the save could land after the person was told it wasn't saved. "always" sends it at once, so it fails at once.
    mutations: { retry: false, networkMode: "always" },
  },
});
