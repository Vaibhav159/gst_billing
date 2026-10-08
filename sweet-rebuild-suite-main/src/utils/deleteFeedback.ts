/**
 * Deletes that report what the server actually did.
 *
 * List and detail pages used to fire the DELETE without awaiting it and toast
 * "Deleted" straight away, so a refusal (403 for an editor, 400 in a filed
 * month, 409 for a party that still has invoices) still read as a success,
 * and bulk delete announced "3 invoices deleted" while duplicates stayed and
 * flowed into GSTR-1.
 */
import { errorTag, formatApiError } from "@/utils/apiError";
import { formatDate } from "@/utils/mockData";
import { formatMoney } from "@/utils/money";

/**
 * An invoice named so a delete can't hit the wrong one (UX5): "KIRAN GOLD
 * HOUSE · 30 · 01 Apr 2026 · Kavita Joshi · ₹61,800.00". A bare "30" exists
 * in all three firms and in every year.
 */
export function invoiceDeleteName(inv: {
  businessName?: string; invoiceNumber: string; invoice_date?: string; customerName?: string; total: number;
}): string {
  return [inv.businessName, inv.invoiceNumber, inv.invoice_date ? formatDate(inv.invoice_date) : "", inv.customerName, formatMoney(inv.total)]
    .filter(Boolean)
    .join(" · ");
}

/** useToast's toast(), as far as these helpers need it. */
type Toast = (t: { title: string; description?: string; variant?: "default" | "destructive" }) => unknown;

const REFUSED = "The server refused the delete.";

/** Delete one thing; toast "Deleted" only once the server has, else its reason. */
export async function deleteWithFeedback(
  remove: () => Promise<unknown>,
  toast: Toast,
  { label, name }: { label: string; name?: string },
): Promise<boolean> {
  try {
    await remove();
    toast({ title: `${label} Deleted`, description: name, variant: "destructive" });
    return true;
  } catch (err) {
    toast({
      title: `Couldn't delete ${label.toLowerCase()} ${errorTag(err)}`,
      description: formatApiError(err, REFUSED),
      variant: "destructive",
    });
    return false;
  }
}

export interface BulkDeleteResult {
  deleted: string[];
  refused: { id: string; reason: string }[];
}

/** Delete every id, wait for every answer, and keep the reason for each refusal. */
export async function deleteEach(ids: string[], remove: (id: string) => Promise<unknown>): Promise<BulkDeleteResult> {
  const settled = await Promise.allSettled(ids.map((id) => remove(id)));
  const result: BulkDeleteResult = { deleted: [], refused: [] };
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") result.deleted.push(ids[i]);
    else result.refused.push({ id: ids[i], reason: formatApiError(s.reason, REFUSED) });
  });
  return result;
}

/** One toast for a bulk delete: "2 invoices deleted, 1 refused", and why. */
export function bulkDeleteToast({ deleted, refused }: BulkDeleteResult, noun: string) {
  const count = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const reasons = [...new Set(refused.map((r) => r.reason))];
  return {
    title: refused.length ? `${count(deleted.length)} deleted, ${refused.length} refused` : `${count(deleted.length)} deleted`,
    description: reasons.join(" · ") || undefined,
    variant: "destructive" as const,
  };
}
