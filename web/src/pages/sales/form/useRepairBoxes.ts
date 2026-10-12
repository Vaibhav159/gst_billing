import { useState } from "react";

/** Keep repair fields under the cursor until another item or editing session starts. */
export function useRepairBoxes(item: string, content: boolean, needs: boolean, session?: unknown): boolean {
  const [fixing, setFixing] = useState<{ item: string; session: unknown } | null>(needs ? { item, session } : null);
  const same = fixing?.item === item && fixing.session === session;
  if (needs && !same) setFixing({ item, session });
  return needs || (content && same);
}
