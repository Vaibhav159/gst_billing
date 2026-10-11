import type { FirmBody, FirmDetail } from "@/core/api/firms";
import type { Firm } from "@/core/scope";
import { shortName } from "@/core/scope";
import { checkGstin, mobileDigits, mobileProblem } from "@/core/ids";
import { date, fyOf } from "@/core/format";
import { fullNumber } from "@/core/sales/numbers";
export const FIRM_IDS: Record<keyof FirmBody, string> = { name: "fm-name", short_name: "fm-short", gst_number: "fm-gstin", address: "fm-address", city: "fm-city", pin_code: "fm-pin", mobile_number: "fm-phone", email: "fm-email", bank_name: "fm-bank", bank_account_number: "fm-account", bank_ifsc_code: "fm-ifsc", bank_branch_name: "fm-branch", invoice_prefix: "fm-prefix", paper_full_number_from: "fm-full-date", signature_on_bills: "fm-sign", jurisdiction: "fm-jur", declaration: "fm-decl" };
export function firmBody(f: FirmDetail | null): FirmBody {
  const body: FirmBody = { name: "", short_name: "", gst_number: "", address: "", city: "", pin_code: "", mobile_number: "", email: "", bank_name: "", bank_account_number: "", bank_ifsc_code: "", bank_branch_name: "", invoice_prefix: "", paper_full_number_from: null, signature_on_bills: true, jurisdiction: "", declaration: "" };
  if (f) for (const k of Object.keys(body) as (keyof FirmBody)[]) Object.assign(body, { [k]: f[k] ?? body[k] });
  return body;
}
export function paperNumberWords(day: string, prefix: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const when = date(day).replace(/^0/, "");
  return `Before ${when}: 108 stays 108. From ${when}: 108 is saved as ${fullNumber(prefix, fyOf(day), 108)}`;
}
/** The server remains authoritative; unchanged historical values are never refused locally. */
export function firmErrors(f: FirmBody, old: FirmDetail | null, firms: Firm[]): Partial<Record<keyof FirmBody, string>> {
  const e: Partial<Record<keyof FirmBody, string>> = {}; const changed = (k: keyof FirmBody) => !old || f[k] !== old[k];
  const other = firms.filter((x) => x.id !== old?.id); const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (changed("name")) {
    if (!f.name.trim()) e.name = "Enter the firm's legal name, as on its GST certificate.";
    else if (f.name.trim().length > 255) e.name = "Keep the name to 255 characters.";
    else { const taken = other.find((x) => same(x.name, f.name)); if (taken) e.name = `There's already a firm called ${taken.name}. Firm names have to be different.`; }
  }
  if (changed("short_name") || changed("name")) {
    const effective = f.short_name.trim() || shortName(f.name); const taken = other.find((x) => same(x.short, effective));
    if (f.short_name.length > 20) e.short_name = "Keep the short name to 20 characters.";
    else if (taken) e.short_name = `${taken.name} already goes by ${taken.short}. Pick another short name.`;
  }
  if (changed("gst_number")) {
    const g = checkGstin(f.gst_number);
    if (g.status === "empty") e.gst_number = "Enter the firm's GSTIN. It prints at the top of every bill.";
    else if (g.status === "check") e.gst_number = "Check digit doesn't match — likely a typo.";
    else if (g.status !== "valid") e.gst_number = g.problem;
    else { const taken = other.find((x) => same(x.gstin, f.gst_number)); if (taken) e.gst_number = `${taken.name} has this GSTIN. Each firm has its own registration.`; }
  }
  if (changed("address") && !f.address.trim()) e.address = "Enter the address printed on bills.";
  if (changed("pin_code") && f.pin_code && !/^\d{6}$/.test(f.pin_code)) e.pin_code = `A PIN code has 6 digits; this has ${f.pin_code.length}.`;
  if (changed("mobile_number")) e.mobile_number = !mobileDigits(f.mobile_number) ? "Enter a phone number for bills." : mobileProblem(f.mobile_number) || undefined;
  if (changed("email") && f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = "That email looks incomplete. It should look like accounts@example.in.";
  if (changed("bank_account_number") && f.bank_account_number && !/^\d{9,18}$/.test(f.bank_account_number)) e.bank_account_number = `Account numbers have 9 to 18 digits; this has ${f.bank_account_number.length}.`;
  if (changed("bank_ifsc_code") && f.bank_ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bank_ifsc_code)) e.bank_ifsc_code = "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits (like SBIN0UDR014).";
  if (changed("invoice_prefix") && f.invoice_prefix) {
    const taken = other.find((x) => x.prefix === f.invoice_prefix);
    if (!/^[A-Z]{1,4}$/.test(f.invoice_prefix)) e.invoice_prefix = "Use 1 to 4 capital letters, like KGH. A GST bill number can have at most 16 characters.";
    else if (taken) e.invoice_prefix = `${taken.name} already uses ${f.invoice_prefix}. Each firm needs its own prefix, or bill numbers would clash.`;
  }
  if (changed("paper_full_number_from") && f.paper_full_number_from) {
    const d = f.paper_full_number_from; const parsed = new Date(`${d}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== Number(d.slice(0, 4)) || parsed.getUTCMonth() + 1 !== Number(d.slice(5, 7)) || parsed.getUTCDate() !== Number(d.slice(8))) e.paper_full_number_from = "Type the date like 2027-04-01.";
    else if (d < "2000-01-01" || d > "2099-12-31") e.paper_full_number_from = "Pick a date from 2000 to 2099.";
  }
  for (const [key, limit] of [["address", 255], ["city", 100], ["bank_name", 255], ["bank_branch_name", 255], ["jurisdiction", 100], ["declaration", 500]] as const) if (changed(key) && f[key].length > limit) e[key] = `Keep the ${key === "bank_name" ? "bank name" : key === "bank_branch_name" ? "branch name" : key} to ${limit} characters.`;
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v));
}
