// What the print, batch print and bulk PDF pages share: a file made as soon as its choices are known, the bank-details
// switch, and several bills in words. Their lines in the audit log are core/print/log.ts's.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { plural } from "@/core/format";
import { pdfCodeMissing } from "@/core/print/make";
import { hasBank, type PrintBill } from "@/core/print/model";
import type { FirmOnBill } from "@/core/sales/types";
import { andList, billsAnd } from "@/core/sales/words";
import { Switch } from "@/core/ui";

/**
 * A batch takes up to this many bills (Ruling 1E-16): about 90 pages with all three copies. Its PDF is made here, on the
 * browser's main thread, at about a tenth of a second a page, when the page opens and again after every choice, and its
 * papers are drawn twice (on screen and for the browser's own print). Each bill is also a request (Neon's free plan).
 */
export const MAX_BILLS = 30;

/** Bills by number where it's known, the rest counted: "KGH/2026-27/32 and MO/2026-27/7", "KGH/2026-27/32 and 1 more bill", "4 bills". */
export function named(numbers: (string | null)[]): string {
  const known = numbers.filter((n): n is string => Boolean(n));
  if (known.length > 3) return plural(numbers.length, "bill");
  const rest = numbers.length - known.length;
  return andList([...known, rest ? plural(rest, known.length ? "more bill" : "bill") : ""]);
}

/**
 * The bills that didn't load, what happened and what to do. Offline they come by themselves once the internet is back;
 * a refusal's own words (a 429 already says when to try again) stand as they are. rest: other bills can print meanwhile.
 */
export function notLoadedWords(p: ApiProblem, one: boolean, rest: boolean): string {
  const them = one ? "it" : "them";
  const meanwhile = rest ? " to print the rest" : "";
  if (p.kind === "offline") return `You're offline, so the batch waits for ${them}. ${one ? "It loads by itself" : "They load by themselves"} when the internet is back, or leave ${them} out${meanwhile}.`;
  if (p.kind === "unreachable" || p.kind === "server") return `The app couldn't reach the shop's records just now, so the batch waits for ${them}. Try again, or leave ${them} out${meanwhile}.`;
  return rest ? `${p.message} You can leave ${them} out to print the rest.` : p.message;
}

/**
 * What `make` makes for `key` (null: nothing to make yet), made again when the key changes, on retry or on remake. Only
 * the file of the key now showing is handed out, so a choice just changed never prints the one before it. error: why the
 * last attempt failed. retry: the person's Try again, which clears the failure at once (retrying until that attempt
 * ends); remake: made again quietly, the one made still handed out meanwhile (a PDF that went without its signature),
 * and kept if that attempt fails.
 */
export function useMade<T>(key: string | null, make: () => Promise<T>): { value: T | null; failed: boolean; error: unknown; retrying: boolean; retry: () => void; remake: () => void } {
  const [tries, setTries] = useState(0);
  const [made, setMade] = useState<{ key: string; value: T | null; failed: boolean; error?: unknown } | null>(null);
  // the key a Try again is making again
  const [retrying, setRetrying] = useState<string | null>(null);
  // the key a quiet remake is making again: one that fails leaves the file made as it is
  const quiet = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    const remaking = quiet.current === key;
    quiet.current = null;
    const end = (m: { key: string; value: T | null; failed: boolean; error?: unknown }) => { if (!live) return; setMade(m); setRetrying(null); };
    make().then((value) => end({ key, value, failed: false }), (error: unknown) => { if (!remaking) end({ key, value: null, failed: true, error }); });
    return () => { live = false; };
  }, [key, tries]); // eslint-disable-line react-hooks/exhaustive-deps -- `make` changes with `key`
  const retry = useCallback(() => { quiet.current = null; setMade(null); setRetrying(key); setTries((n) => n + 1); }, [key]);
  const remake = useCallback(() => { quiet.current = key; setTries((n) => n + 1); }, [key]);
  const now = made && made.key === key ? made : null;
  return { value: now?.value ?? null, failed: now?.failed ?? false, error: now?.error ?? null, retrying: retrying !== null && retrying === key, retry, remake };
}

/**
 * Why a PDF wasn't made, in words, and whether Try again can help. react-pdf's code that didn't come (the app changed
 * since the page opened) comes only with a reload, so there's no Try again then, and offline the reload waits for the
 * internet. what: "PDF" or "batch".
 */
export function unmade(error: unknown, offline: boolean, what: string): { body: string; again: boolean } {
  if (pdfCodeMissing(error)) {
    return { again: false, body: offline ? "You're offline, and the part of the app that makes PDFs didn't load. Reload the page once the internet is back." : "The part of the app that makes PDFs didn't load. Reload the page, then try again." };
  }
  return { again: true, body: offline ? `You're offline, so the ${what} wasn't made. It needs the internet; try again when you're back.` : "Something stopped it part way. Try again." };
}

/**
 * What a paper prints, to key its PDF on: everything the PDF draws, with the firm's signature by its path, as its link is
 * signed afresh with each answer. So a refresh that changed what prints makes the PDF again, and one that changed nothing
 * on paper (a send's record, a link signed afresh) keeps the one made (Ruling 1E-8).
 */
export function whatPrints(p: PrintBill): string {
  return JSON.stringify({ ...p, firm: { ...p.firm, signature: p.firm.signature?.split("?")[0] ?? null } });
}

/**
 * The bank switch, or why there's nothing to switch (PROTO sales/BillPrint.jsx:192-206): a firm without an account
 * number prints no bank block. A bill keeps the firm as it was when it was made (frozen), so an account added later
 * doesn't reach it.
 */
export function BankSwitch({ firm, firmId, checked, onChange }: { firm: Pick<FirmOnBill, "name" | "bank_name" | "bank_account_number" | "frozen">; firmId: number; checked: boolean; onChange: (v: boolean) => void }) {
  const { can } = useAuth();
  if (!hasBank(firm)) {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-medium">Bank details on the bill</p>
        <p className="text-sm text-muted">
          {firm.frozen ? `${firm.name} had no bank account saved when the app made this bill, so it prints without a bank block.` : (
            <>{firm.name} has no bank account saved, so the bill prints without a bank block.{" "}
              {can("firm.edit") ? <Link to={`/firms/${firmId}/edit`} className="text-brand underline underline-offset-2">Add the account</Link> : "The owner can add it under Firms."}</>
          )}
        </p>
      </div>
    );
  }
  return <Switch label="Bank details on the bill" description={`${firm.bank_name || "Bank"} · A/c ${firm.bank_account_number}`} checked={checked} onChange={onChange} />;
}

type SpanBill = { invoice_number: string; business: number; business_name: string; status: string };
/** Bills grouped by firm, in the order they come. */
export function byFirm<T extends SpanBill>(bills: T[]): { business: number; name: string; list: T[] }[] {
  const out: { business: number; name: string; list: T[] }[] = [];
  for (const b of bills) {
    const g = out.find((x) => x.business === b.business);
    if (g) g.list.push(b);
    else out.push({ business: b.business, name: b.business_name, list: [b] });
  }
  return out;
}
/**
 * Several bills in words, never one number range across firms (PROTO sales/lib.js:655-670): "3 bills from 2 firms:
 * KIRAN GOLD HOUSE (2) and MEERA ORNAMENTS (1)". numbers: name a few bills; "all": name every one, however many (the
 * audit log's line, whose details hold any length).
 */
export function billsSpan(bills: SpanBill[], { numbers = false }: { numbers?: boolean | "all" } = {}): string {
  if (!bills.length) return "No bills";
  if (bills.length === 1) return bills[0].invoice_number;
  const groups = byFirm(bills);
  const shouldName = (n: number, few: number) => numbers === "all" || (numbers && n <= few);
  if (groups.length === 1) {
    const { name, list } = groups[0];
    return `${billsAnd(list)} from ${name}${shouldName(list.length, 4) ? `: ${andList(list.map((b) => b.invoice_number))}` : ""}`;
  }
  return `${billsAnd(bills)} from ${groups.length} firms: ${andList(groups.map(({ name, list }) => `${name} (${shouldName(list.length, 3) ? list.map((b) => b.invoice_number).join(", ") : list.length})`))}`;
}
