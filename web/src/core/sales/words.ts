// Selling's words, said one way everywhere: how a bill was paid, cancelled bills named apart, and a change that didn't
// happen in the app's words. Plan 1C made this file with PAY, PAY_SHORT, cancelledNote, FailText and failText; plan 1B
// adds Selling's other words beside them.
import type { ApiProblem } from "@/core/api/errors";
import { plural } from "@/core/format";
import type { PaymentMode } from "./types";

/** How a bill was paid (PROTO core/common.jsx:33-34). "" is not recorded (bills from Tally and old imports). */
export const PAY: Record<PaymentMode, string> = { cash: "Cash", bank: "UPI / bank", credit: "Udhaar", mixed: "Part cash, part UPI", "": "Not recorded" };
export const PAY_SHORT: Record<PaymentMode, string> = { cash: "Cash", bank: "UPI", credit: "Udhaar", mixed: "Part cash", "": "Not recorded" };

/** "1 cancelled bill also listed" (how: "not counted"…), or "" when there are none (PROTO sales/lib.js:608-611). */
export function cancelledNote(n: number, how = "also listed"): string {
  return n ? `${plural(n, "cancelled bill")} ${how}` : "";
}

/** A save (or another change) that didn't happen, in words: what happened, and what to do. */
export type FailText = { title: string; body: string };
/** (PROTO sales/parts.jsx:43-50) verb: "saved", "cancelled", "deleted", "restored"… Only a save says that what was typed is still there. */
export function failText(p: ApiProblem, verb = "saved"): FailText {
  const typed = verb === "saved" ? " What you typed is still here." : "";
  if (p.kind === "offline") return { title: `Not ${verb}: you're offline`, body: `Nothing was changed.${typed} Try again when the internet is back.` };
  if (p.kind === "unreachable" || p.kind === "server") return { title: `Not ${verb}: the app couldn't get through`, body: `Nothing was changed.${typed} Try again in a minute.` };
  return { title: `Not ${verb}`, body: p.message };
}
