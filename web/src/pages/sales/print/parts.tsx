// What the print, batch print and bulk PDF pages share: a file made as soon as its choices are known, the bank-details
// switch, and several bills in words. Their lines in the audit log are core/print/log.ts's.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasBank } from "@/core/print/model";
import type { FirmOnBill } from "@/core/sales/types";
import { andList, billsAnd } from "@/core/sales/words";
import { Switch } from "@/core/ui";

/**
 * What `make` makes for `key` (null: nothing to make yet), made again when the key changes, on retry or on remake. Only
 * the file of the key now showing is handed out, so a choice just changed never prints the one before it. retry: the
 * person's Try again, which clears the failure at once (retrying until that attempt ends); remake: made again quietly,
 * the one made still handed out meanwhile (a PDF that went without its signature), and kept if that attempt fails.
 */
export function useMade<T>(key: string | null, make: () => Promise<T>): { value: T | null; failed: boolean; retrying: boolean; retry: () => void; remake: () => void } {
  const [tries, setTries] = useState(0);
  const [made, setMade] = useState<{ key: string; value: T | null; failed: boolean } | null>(null);
  // the key a Try again is making again
  const [retrying, setRetrying] = useState<string | null>(null);
  // the key a quiet remake is making again: one that fails leaves the file made as it is
  const quiet = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    const remaking = quiet.current === key;
    quiet.current = null;
    const end = (m: { key: string; value: T | null; failed: boolean }) => { if (!live) return; setMade(m); setRetrying(null); };
    make().then((value) => end({ key, value, failed: false }), () => { if (!remaking) end({ key, value: null, failed: true }); });
    return () => { live = false; };
  }, [key, tries]); // eslint-disable-line react-hooks/exhaustive-deps -- `make` changes with `key`
  const retry = useCallback(() => { quiet.current = null; setMade(null); setRetrying(key); setTries((n) => n + 1); }, [key]);
  const remake = useCallback(() => { quiet.current = key; setTries((n) => n + 1); }, [key]);
  const now = made && made.key === key ? made : null;
  return { value: now?.value ?? null, failed: now?.failed ?? false, retrying: retrying !== null && retrying === key, retry, remake };
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
 * KIRAN GOLD HOUSE (2) and MEERA ORNAMENTS (1)". numbers: name a few bills (for the audit log).
 */
export function billsSpan(bills: SpanBill[], { numbers = false } = {}): string {
  if (!bills.length) return "No bills";
  if (bills.length === 1) return bills[0].invoice_number;
  const groups = byFirm(bills);
  if (groups.length === 1) {
    const { name, list } = groups[0];
    return `${billsAnd(list)} from ${name}${numbers && list.length <= 4 ? `: ${andList(list.map((b) => b.invoice_number))}` : ""}`;
  }
  return `${billsAnd(bills)} from ${groups.length} firms: ${andList(groups.map(({ name, list }) => `${name} (${numbers && list.length <= 3 ? list.map((b) => b.invoice_number).join(", ") : list.length})`))}`;
}
