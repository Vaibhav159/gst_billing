import { useEffect, useState } from "react";
import { logger } from "@/utils/logger";

/**
 * The answer to the latest request only, and whether it failed.
 *
 * The customer page's totals and Bulk PDF's list kept whatever answer came
 * back last, so a slow answer for the previous customer (or FY) replaced the
 * current one, and a failed fetch left the old figures showing (review of
 * H18). `run` is called again whenever `deps` change; an answer to an earlier
 * call is dropped.
 */
export function useLatest<T>(run: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; failed: boolean; loading: boolean }>(
    { data: null, failed: false, loading: true },
  );
  useEffect(() => {
    let current = true;
    setState({ data: null, failed: false, loading: true });
    run().then(
      (data) => { if (current) setState({ data, failed: false, loading: false }); },
      (e) => {
        logger.warn("Fetch failed", e);
        if (current) setState({ data: null, failed: true, loading: false });
      },
    );
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller's dependency list
  }, deps);
  return state;
}
