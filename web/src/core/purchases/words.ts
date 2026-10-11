import { date, dateShort, fyOf, monthLabel } from '@/core/format';
import type { CreditMonthOption } from './types';
export function claimLabel(option: CreditMonthOption, today: string): string {
  const month = monthLabel(option.month, { long: true });
  return option.running ? `${month} (this month)` : `${month} (not filed yet, 3B ${option.due < today ? 'was due' : 'due'} ${dateShort(option.due)})`;
}
export function lateNote(billMonth: string, chosen: CreditMonthOption, today: string): string {
  return `${monthLabel(billMonth, { long: true })} is filed, so its credit goes in a later return: ${claimLabel(chosen, today)}.`;
}
export function deadlineNote(invoiceDate: string, deadline: string): string {
  return `The last day is ${date(deadline)}, or the day FY ${fyOf(invoiceDate)}'s annual return (GSTR-9) is filed, if that's earlier.`;
}
export const earliestCreditWords = 'The earliest return not filed yet: the safer choice.';
export const beforeLedgerWords = 'This bill is before April 2025. Its credit is in the opening balance or lapsed.';
export function creditWords({ eligible = true, supplier, noGstin, lapsed, month, firm, option }: { eligible?: boolean; supplier?: string; noGstin?: boolean; lapsed?: boolean; month?: string; firm?: string; option?: CreditMonthOption }): string {
  if (noGstin) return `${supplier} has no GSTIN, so this bill carries no GST to claim.`;
  if (lapsed) return "Too late to claim: no return open now can carry this bill's credit.";
  if (!eligible) return "Off: for purchases the business can't claim, like things for personal use. The bill still counts in purchases.";
  if (option) return `Goes in ${monthLabel(option.month, { long: true })}'s GSTR-3B${option.running ? '' : ` (not filed yet, due ${dateShort(option.due)})`}.`;
  if (!firm || !month) return "Comes off the firm's GST for the bill's month.";
  return `Comes off what ${firm} pays for ${monthLabel(month, { long: true })}.`;
}
