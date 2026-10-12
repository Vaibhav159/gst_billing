import { useState } from "react";
import type { PurchaseRead, ReadGroup } from "./types";

export const readGroups: ReadGroup[] = ["supplier", "gstin", "bill_no", "date", "amounts"];
export const checkWords: Record<ReadGroup, string> = {
  supplier: "supplier", gstin: "GSTIN", bill_no: "bill number", date: "date", amounts: "quantities and rates",
};
export type ReadConfirmations = Partial<Record<ReadGroup, true>>;

export function pendingReadGroups(read: PurchaseRead | null, confirmed: ReadConfirmations): ReadGroup[] {
  return readGroups.filter((group) => read?.confidence[group] === "medium" && !confirmed[group]);
}

/** Pass the reading accepted into the form, not a newer result awaiting "Use what was read". */
export function useReadConfidence(read: PurchaseRead | null) {
  const [checks, setChecks] = useState<{ read: PurchaseRead | null; confirmed: ReadConfirmations }>({ read, confirmed: {} });
  // A replacement read needs its own checks, even when its words happen to match.
  if (checks.read !== read) setChecks({ read, confirmed: {} });
  const confirmed = checks.read === read ? checks.confirmed : {};
  const pending = pendingReadGroups(read, confirmed);
  const confirm = (group: ReadGroup) => setChecks((previous) => ({
    read, confirmed: { ...(previous.read === read ? previous.confirmed : {}), [group]: true },
  }));
  return { confirmed, pending, needsReview: pending.length > 0, confirm, edited: confirm, reset: () => setChecks({ read, confirmed: {} }) };
}
