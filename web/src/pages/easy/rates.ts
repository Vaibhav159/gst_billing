import { inr, toPaise } from "@/core/format";
import { rateSlip } from "@/core/rates/slip";
import { perWord } from "@/pages/sales/form/rules";

export { rateSlip, rateNote } from "@/core/rates/slip";

/** One shared slip decision and correction; Easy adds only its confirmation words. */
export function easyRateSlip(input: Parameters<typeof rateSlip>[0] & { name: string }): {
  text: string; fix: string; label: string; tick: string;
} | null {
  const slip = rateSlip({ ...input, easy: true });
  return slip ? {
    ...slip,
    tick: `Yes, ${inr(toPaise(input.rate))} a ${perWord(input.unit)} is right for ${input.name}`,
  } : null;
}
