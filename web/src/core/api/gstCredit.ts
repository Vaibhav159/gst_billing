import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { paiseToDecimal, toPaise } from "@/core/format";
import type { CreditValue, Credit, OpeningCreditValue, OpeningCredit, OpeningEffectValue, OpeningEffect, OpeningInput } from "@/core/gst/creditTypes";
import { invalidateDashboard } from "@/core/due/fresh";

export function toOpeningCredit(o: OpeningCreditValue<string>): OpeningCredit {
  const h = o.carried_out_of_first_month.heads;
  return { ...o, igst: toPaise(o.igst)!, cgst: toPaise(o.cgst)!, sgst: toPaise(o.sgst)!, total: toPaise(o.total)!,
    carried_out_of_first_month: { ...o.carried_out_of_first_month, heads: { igst: toPaise(h.igst)!, cgst: toPaise(h.cgst)!, sgst: toPaise(h.sgst)! } } };
}
function toEffect(e: OpeningEffectValue<string>): OpeningEffect {
  return { ...e, carried_out: { from: toPaise(e.carried_out.from)!, to: toPaise(e.carried_out.to)! },
    cash: { ...e.cash, from: toPaise(e.cash.from)!, to: toPaise(e.cash.to)! } };
}
function toCredit(c: CreditValue<string>): Credit {
  return { ...c, at_risk: { ...c.at_risk, tax: toPaise(c.at_risk.tax)!, bills: c.at_risk.bills.map(b => ({ ...b, tax: toPaise(b.tax)! })) },
    buckets: { ...c.buckets, claimed: { ...c.buckets.claimed, tax: toPaise(c.buckets.claimed.tax)! },
      open: { ...c.buckets.open, tax: toPaise(c.buckets.open.tax)! }, lapsed: { ...c.buckets.lapsed, tax: toPaise(c.buckets.lapsed.tax)! },
      before_ledger: { ...c.buckets.before_ledger, tax: toPaise(c.buckets.before_ledger.tax)! } },
    opening: toOpeningCredit(c.opening) };
}
function openingBody(input: OpeningInput) {
  return { business: input.business, igst: paiseToDecimal(input.igst), cgst: paiseToDecimal(input.cgst), sgst: paiseToDecimal(input.sgst) };
}
// An opening change and a purchase move can cross FYs.
function invalidateCreditDependents(qc: QueryClient) {
  for (const queryKey of [["gst"], ["reports"], ["purchases"]]) void qc.invalidateQueries({ queryKey });
  invalidateDashboard(qc);
}
export function useGstCredit(businessId: number | null, fy: string) {
  return useQuery({ queryKey: ["gst", "credit", businessId, fy], queryFn: businessId === null ? skipToken : async ({ signal }) =>
    toCredit((await api.get<CreditValue<string>>("gst/credit/", { params: { business_id: businessId, fy }, signal })).data) });
}
export function useOpeningCredit(businessId: number | null) {
  return useQuery({ queryKey: ["gst", "opening-credit", businessId], queryFn: businessId === null ? skipToken : async ({ signal }) =>
    toOpeningCredit((await api.get<OpeningCreditValue<string>>("gst/opening-credit/", { params: { business_id: businessId }, signal })).data) });
}
export function useOpeningPreview() {
  return useMutation({ mutationFn: async (input: OpeningInput) => toEffect((await api.put<OpeningEffectValue<string>>("gst/opening-credit/", openingBody(input), { params: { preview: 1 } })).data) });
}
export function useSaveOpeningCredit() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: OpeningInput) => {
    const d = (await api.put<{ opening: OpeningCreditValue<string>; effect: OpeningEffectValue<string> }>("gst/opening-credit/", openingBody(input))).data;
    return { opening: toOpeningCredit(d.opening), effect: toEffect(d.effect) };
  }, onSuccess: () => invalidateCreditDependents(qc) });
}
export function useMoveCredit() {
  const qc = useQueryClient();
  // The purchase response is deliberately not a second copy of part 2's Credit decoder.
  return useMutation({ mutationFn: async ({ id, month }: { id: number; month: string }) => { await api.put(`purchases/${id}/credit-month/`, { itc_month: month }); },
    onSuccess: () => invalidateCreditDependents(qc) });
}
