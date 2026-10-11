// What the print, batch print and bulk PDF pages share: a file made as soon as its choices are known, the bank-details
// switch, the audit log's line for printing, and several bills in words.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { hasBank } from "@/core/print/model";
import type { FirmOnBill } from "@/core/sales/types";
import { andList, billsAnd } from "@/core/sales/words";
import { Switch } from "@/core/ui";

/**
 * What `make` makes for `key` (null: nothing to make yet), made again when the key changes or on retry. Only the file of
 * the key now showing is handed out, so a choice just changed never prints the one before it.
 */
export function useMade<T>(key: string | null, make: () => Promise<T>): { value: T | null; failed: boolean; retry: () => void } {
  const [tries, setTries] = useState(0);
  const [made, setMade] = useState<{ key: string; value: T | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    make().then((value) => { if (live) setMade({ key, value, failed: false }); }, () => { if (live) setMade({ key, value: null, failed: true }); });
    return () => { live = false; };
  }, [key, tries]); // eslint-disable-line react-hooks/exhaustive-deps -- `make` changes with `key`
  const retry = useCallback(() => setTries((n) => n + 1), []);
  const now = made && made.key === key ? made : null;
  return { value: now?.value ?? null, failed: now?.failed ?? false, retry };
}

export type PrintLog = { action: "printed" | "exported"; entity_id: number; entity_name: string; details: string };
/** A print or a PDF goes into the audit log as v2's bulk PDFs wrote it (contract §2.2). A log that fails stops nothing. */
export function useLogPrint(): (entry: PrintLog) => void {
  const { mutate } = useMutation({ mutationFn: (e: PrintLog) => api.post("audit-logs/log/", { ...e, entity: "invoice" }) });
  return useCallback((e) => mutate(e), [mutate]);
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
