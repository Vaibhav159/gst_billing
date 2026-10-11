import { CircleCheck, ExternalLink, Info, XCircle } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { dateShort, inr, plural } from "@/core/format";
import type { Check, Month } from "@/core/gst/types";
import { Button, Card } from "@/core/ui";

export function Checks({ month, onFix }: { month: Month; onFix: (check: Check) => void }) {
  const { can } = useAuth();
  const { blockers, notes, passes } = month.checks;
  const subtitle = [blockers.length ? plural(blockers.length, "blocker") : null, blockers.length ? `${passes.length} pass` : `All ${passes.length} pass`, notes.length ? plural(notes.length, "note") : null].filter(Boolean).join(" · ");
  const fix = (check: Check) => {
    switch (check.kind) {
      case "duplicate": return can("bill.edit") ? "Fix" : null;
      case "gstin": return can("customer.edit") ? "Add the GSTIN" : null;
      case "badgstin": return can("customer.edit") ? "Correct the GSTIN" : null;
      case "hsn": return can("bill.edit") ? "Add the HSN code" : null;
      case "state": case "head": return can("bill.edit") ? "Fix the bill" : null;
      case "empty": case "to_confirm": return "Open the bill";
      case "gap": return "See Documents issued";
      default: return null;
    }
  };
  const first = blockers.find((check) => fix(check));
  return (
    <Card id="gst-checks" className="scroll-mt-6" title={month.stage === "open" ? "Checks so far" : month.record.gstr1 ? "Checks" : "Checks before filing"} subtitle={subtitle}>
      <ul className="flex flex-col gap-2">
        {[...blockers, ...notes].map((check, i) => {
          const action = fix(check);
          const bills = check.bills.filter((bill) => "invoice_number" in bill);
          const deleted = bills.length === 1 && bills[0].status === "deleted" ? bills[0] : null;
          const link = deleted ? can("bill.delete") && deleted.bin_id !== undefined ? { to: `/audit?restore=${deleted.bin_id}`, label: "Open the deleted bill" } : null
            : check.kind === "duplicate" ? { to: `/sales?firm=${month.business}&dups=1`, label: "Open the two bills" }
            : check.kind === "empty" ? { to: `/sales?firm=${month.business}&month=${month.month}&empty=1`, label: "Open bills with no items" }
            : check.kind === "hsn" ? { to: `/sales?firm=${month.business}&month=${month.month}&no_hsn=1`, label: "Open lines without HSN" }
            : bills.length === 1 && bills[0].id !== null ? { to: `/sales/${bills[0].id}`, label: "Open the bill" } : null;
          return <li key={`${check.kind}:${i}`} className={cn("rounded-ctl border px-3 py-3", check.blocks ? "border-neg-line bg-neg-tint" : "border-line bg-field")}>
            <div className="flex items-start gap-2.5">
              {check.blocks ? <XCircle size={18} className="text-neg shrink-0 mt-0.5" aria-hidden="true" /> : <Info size={18} className="text-fg2 shrink-0 mt-0.5" aria-hidden="true" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium">{check.text}</p>
                {check.detail ? <p className="text-sm text-muted mt-0.5">{check.detail}{check.kind === "deleted" ? can("bill.delete") ? " If it was a real sale, restore it from the Audit log." : " If it was a real sale, the owner can restore it from the Audit log." : ""}</p> : null}
                {bills.length ? <ul className="mt-1 text-sm text-fg2 flex flex-col gap-0.5">{bills.map((bill, index) => <li key={bill.id ?? `bin:${bill.bin_id}:${index}`} className="tnum">{bill.invoice_number}{bill.status === "deleted" ? <> · <span>Deleted</span></> : null} · {dateShort(bill.invoice_date)} · {bill.customer_name} · {inr(bill.total_amount)}{bill.typed ? <span className="text-neg"> · typed by hand</span> : null}</li>)}</ul> : null}
                {check.more_bills > 0 ? <p className="text-sm text-muted mt-1">{plural(check.more_bills, "more bill")}</p> : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                  {action ? <Button size="sm" data-fix={check === first ? "" : undefined} variant={check.blocks ? "primary" : "secondary"} onClick={() => onFix(check)}>{action}</Button> : null}
                  {link ? <Link className="link text-sm inline-flex items-center gap-1 min-h-11" to={link.to}>{link.label}<ExternalLink size={14} aria-hidden="true" /></Link> : null}
                </div>
              </div>
            </div>
          </li>;
        })}
        {passes.map((pass) => <li key={pass} className="flex items-start gap-2.5 rounded-md px-1 py-1.5"><CircleCheck size={18} className="text-sale shrink-0 mt-0.5" aria-hidden="true" /><span>{pass}</span></li>)}
      </ul>
    </Card>
  );
}
