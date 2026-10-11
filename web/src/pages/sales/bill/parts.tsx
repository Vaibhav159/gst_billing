// The bill page's pieces (PROTO sales/BillDetail.jsx:72-387): the state banners, the total, the parties, what happened,
// the customer's other bills, the e-way bill, payment and sending, and the role note.
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRightLeft, Ban, ChevronRight, Download, FilePlus2, FileSpreadsheet, Hash, Info, Landmark, Lock, Pencil, Printer, RefreshCcw, RotateCcw,
  Scale, Send, Trash2, Truck, Users, Wrench, type LucideIcon,
} from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { salesKeys, useFixHeads, useSalesPage } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { ROLES } from "@/core/auth/permissions";
import { cn } from "@/core/cn";
import { date, dateShort, inr, mobileText, monthLabel, plural } from "@/core/format";
import { billPdfName } from "@/core/sales/files";
import { taxSlips } from "@/core/sales/maths";
import { gstinNote, SEGMENTS, stateNameOf } from "@/core/sales/pos";
import type { Activity as ActivityRow, AuditAction, BillDetail } from "@/core/sales/types";
import { LOCKED_REASON, PAY, cancelledMark, dayOf, ewayNumberText, failText, realReason, sentLine, taxLines, timeOf, type FailText } from "@/core/sales/words";
import { Banner, Button, ButtonLink, Card, DL, FailNote, ListRow, Money, Skeleton, useToast } from "@/core/ui";
import type { Detail } from "./useDetail";

/**
 * Each audit action in words, with its icon (PROTO sales/BillDetail.jsx:72-75; imported, moved, printed, exported and
 * merged are new: v2's Excel import is its own, Ruling 1B-13).
 */
export const VERB: Record<AuditAction, [string, LucideIcon]> = {
  created: ["Made the bill", FilePlus2], imported: ["Imported from Excel", FileSpreadsheet], sent: ["Sent", Send], updated: ["Edited", Pencil],
  cancelled: ["Cancelled", Ban], renumbered: ["Given a new number", Hash], restored: ["Restored from the Audit log", RotateCcw], deleted: ["Deleted", Trash2],
  moved: ["Moved to another firm", ArrowRightLeft], printed: ["Printed", Printer], exported: ["Put in an export", Download], merged: ["Its customer was merged", Users],
};

/** What happened to the bill, newest first, from the audit log; a bill from before the log still says who made it. */
export function Activity({ b }: { b: BillDetail }) {
  const rows: ActivityRow[] = [...b.history.activity];
  // (an imported bill's first row is its import: nothing is made up under it)
  if (!rows.some((a) => a.action === "created" || a.action === "imported")) {
    rows.push({ at: b.created_at, by: b.history.created_by?.name ?? null, action: "created", details: `${b.customer.name} · ${inr(b.total_amount)}` });
  }
  return (
    <ol className="flex flex-col" aria-label="What happened to this bill">
      {rows.map((a, i) => {
        const [verb, Icon] = VERB[a.action];
        return (
          <li key={`${a.at}-${i}`} className="flex items-start gap-3 py-2.5 border-t border-rule first:border-t-0">
            <span className="w-8 h-8 rounded-full bg-raised border border-line grid place-items-center text-fg2 shrink-0" aria-hidden="true"><Icon size={15} /></span>
            <span className="flex-1 min-w-0">
              <span className="block">{verb} <span className="text-muted">by {a.by ?? "someone"}</span></span>
              {a.details ? <span className="block text-sm text-muted">{a.details}</span> : null}
            </span>
            <span className="text-sm text-muted tnum whitespace-nowrap">{dateShort(dayOf(a.at))} · {timeOf(a.at)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** From and To, the place of supply and GSTR-1's table (PROTO sales/BillDetail.jsx:109-135). A GSTIN failing its check stays B2B, with the problem said. */
export function Parties({ b, stacked = false }: { b: BillDetail; stacked?: boolean }) {
  const f = b.firm;
  const c = b.customer;
  const firmState = f.state_code || b.place_of_supply;
  const note = c.gstin_valid === false ? gstinNote(c.gst_number) : "";
  return (
    <div className={cn("grid gap-4", stacked ? "grid-cols-1" : "grid-cols-2")}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="caps">From</p>
        <p className="font-semibold mt-1">{f.name || b.business_name}</p>
        <p className="text-sm text-fg2 tnum">GSTIN {f.gst_number}</p>
        <p className="text-sm text-muted">{f.address} · {stateNameOf(f.state_code)} ({f.state_code})</p>
      </div>
      <div className={cn("flex flex-col gap-0.5 min-w-0", stacked && "border-t border-rule pt-4")}>
        <p className="caps">To</p>
        {c.type !== "walkin" ? <Link to={`/customers/${c.id}`} className={cn("font-semibold mt-1 self-start hover:text-brand", stacked && "min-h-11 inline-flex items-center -my-2")}>{c.name}</Link> : <p className="font-semibold mt-1">{c.name}</p>}
        <p className="text-sm text-fg2 tnum">{c.gst_number ? `GSTIN ${c.gst_number}` : c.type === "walkin" ? "Counter sale, no GSTIN" : "No GSTIN: a sale to a person (B2C)"}</p>
        {note ? <p className="text-sm text-neg">{note}</p> : null}
        <p className="text-sm text-muted">{[c.address, c.city].filter(Boolean).join(", ")}{c.mobile_number ? ` · ${mobileText(c.mobile_number)}` : ""} · {stateNameOf(c.state_code)} ({c.state_code})</p>
      </div>
      <p className={cn("text-sm text-fg2 min-w-0", stacked ? "" : "col-span-2 border-t border-rule pt-3")}>
        Place of supply <span className="font-medium text-fg">{stateNameOf(b.place_of_supply)} ({b.place_of_supply})</span> · {b.interstate ? `inter-state, so IGST: delivered to ${stateNameOf(b.place_of_supply)}` : `local, so CGST + SGST: handed over in ${stateNameOf(firmState)}`} · Reverse charge: No · GSTR-1: {SEGMENTS[b.segment].label}
      </p>
    </div>
  );
}

/** The total the customer pays, exact to the paisa, with the heads and its words (PROTO sales/BillDetail.jsx:290-305): nothing is rounded to the rupee (Ruling 1B-12). */
export function TotalBlock({ b, d, big = "3xl" }: { b: BillDetail; d: Detail; big?: "3xl" | "4xl" }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="caps">{d.cancelled ? "Total when issued" : "Total incl. GST"}</p>
        <Money value={b.total_amount} size={big} tone={d.cancelled ? "muted" : "sale"} className="block mt-1" />
      </div>
      <DL rows={[
        ["Taxable value", <Money key="tx" value={b.taxable} />],
        ...taxLines(b).map((t) => [t.label, <Money key={t.key} value={t.value} />] as const),
        ["Total", <Money key="g" value={b.total_amount} strong />, { strong: true }],
      ]} />
      <p className="text-sm text-muted">{b.total_in_words}</p>
    </div>
  );
}

/** Paid by, sent, who made it and the PDF's name (PROTO sales/BillDetail.jsx:432-440). */
export function PaymentCard({ b, d }: { b: BillDetail; d: Detail }) {
  const maker = b.history.created_by?.name ?? "Someone";
  return (
    <Card title="Payment and sending">
      <DL rows={[
        ["Paid by", b.payment_mode ? PAY[b.payment_mode] : <span key="p" className="text-muted">Not recorded</span>],
        b.payment_mode === "credit" ? ["Udhaar", <span key="u" className="text-fg2">Billed on udhaar; payments aren&apos;t tracked</span>] : null,
        ["Sent", b.paper && !b.sent ? "No need: the customer has the paper bill" : b.sent ? `${sentLine(b.sent)}${d.cancelled ? ", before it was cancelled" : ""}` : "Not yet"],
        b.paper ? ["Typed in by", `${maker} on ${date(dayOf(b.created_at))}`] : ["Made by", `${maker} · ${timeOf(b.created_at)}`],
        ["PDF name", <span key="f" className="tnum break-all">{billPdfName(b)}</span>],
      ]} />
    </Card>
  );
}

/**
 * A button that opens the e-way dialog. In a filed month the server refuses the change (contract §2.8), so there the
 * button is locked with the reason, as the menu's E-way item is.
 */
function EwayButton({ b, d, icon, children }: { b: BillDetail; d: Detail; icon?: LucideIcon; children: string }) {
  return b.locked
    ? <Button size="sm" icon={Lock} disabled title={LOCKED_REASON}>{children}</Button>
    : <Button size="sm" icon={icon} onClick={() => d.dialogs.open("eway", b)}>{children}</Button>;
}

/** Recorded from the e-way bill portal; shown once something is (the menu adds one). The number reads in fours. */
export function EwayCard({ b, d }: { b: BillDetail; d: Detail }) {
  const e = b.eway;
  if (!e.eway_bill_number && !e.transporter_name && !e.vehicle_number && e.distance_km == null) return null;
  return (
    <Card title="E-way bill" subtitle="Prints in the bill's dispatch boxes" actions={d.can("bill.edit") && !d.cancelled ? <EwayButton b={b} d={d} icon={Pencil}>Edit</EwayButton> : null}>
      <DL rows={[
        ["Number", e.eway_bill_number ? <span key="n" className="tnum">{ewayNumberText(e.eway_bill_number)}</span> : <span key="n" className="text-muted">Not yet</span>],
        ["Mode", e.transport_mode],
        ["Transporter", e.transporter_name ? `${e.transporter_name}${e.transporter_gstin ? ` · ${e.transporter_gstin}` : ""}` : "—"],
        ["Vehicle", e.vehicle_number ? `${e.vehicle_number} · ${e.vehicle_type === "ODC" ? "over dimensional cargo" : "regular"}` : "—"],
        ["Distance", e.distance_km ? `${e.distance_km} km` : "—"],
      ]} />
    </Card>
  );
}

/**
 * The customer's other bills, all years (PROTO sales/BillDetail.jsx:324-344): five of them, and how many in all. When
 * they don't load, Try again asks again through the client (Ruling 1B-11).
 */
export function OtherBills({ b, phone = false }: { b: BillDetail; phone?: boolean }) {
  const c = b.customer;
  const qc = useQueryClient();
  const query = { customer_id: c.id, ordering: "-date" } as const;
  const page = useSalesPage("all", query, 6, c.type !== "walkin");
  if (c.type === "walkin") return null;
  const title = `Other bills for ${c.name}`;
  if (!page.data) {
    return (
      <Card title={title}>
        {page.isError
          ? <p className="text-sm text-muted">Couldn&apos;t load them just now. <Button size="sm" variant="link" loading={page.isFetching} onClick={() => { void qc.refetchQueries({ queryKey: salesKeys.page("all", query, 6) }); }}>Try again</Button></p>
          : <div className="flex flex-col gap-2"><Skeleton h={16} /><Skeleton w="70%" h={16} /></div>}
      </Card>
    );
  }
  const others = page.data.results.filter((s) => s.id !== b.id).slice(0, 5);
  if (!others.length) return <Card title={title}><p className="text-sm text-muted">This is their only bill.</p></Card>;
  const s = page.data.summary;
  const mine = b.status !== "cancelled";
  const bills = s.bills - (mine ? 1 : 0);
  const total = s.total_amount - (mine ? b.total_amount : 0);
  const x = s.cancelled - (mine ? 0 : 1);
  return (
    <Card title={title} subtitle={`${plural(bills, "bill")} in all years · ${inr(total)}${x ? ` · ${x} cancelled` : ""}`} pad={false}>
      <div className="mt-1">
        {others.map((o) => (
          <ListRow key={o.id} to={`/sales/${o.id}`} title={<span className="tnum">{o.invoice_number}</span>} subtitle={`${date(o.invoice_date)} · ${o.payment_mode ? PAY[o.payment_mode] : "Not recorded"}${cancelledMark(o.status)}`}
            right={<Money value={o.total_amount} className={o.status === "cancelled" ? "line-through text-muted" : ""} />} className={phone ? "" : "min-h-12 py-2"} />
        ))}
      </div>
      <div className="px-4 py-2 border-t border-rule"><Link to={`/sales?customer=${c.id}&all=1`} className="link inline-flex items-center gap-1 min-h-11">All of {c.name}&apos;s bills <ChevronRight size={15} aria-hidden="true" /></Link></div>
    </Card>
  );
}

/** Roles that can't change bills see why, in words. */
export function RoleNote() {
  const { me, can } = useAuth();
  if (!me || can("bill.delete")) return null;
  return <p className="text-sm text-muted flex items-start gap-1.5"><Info size={15} className="shrink-0 mt-0.5" aria-hidden="true" />Signed in as {ROLES[me.role].label.toLowerCase()}: {can("bill.send") ? "you can send and print this bill. " : "you can look at and print this bill. "}Editing, cancelling and deleting are for the owner.</p>;
}

const ITAX_TITLE: Record<string, string> = {
  cash_limit: "Cash at or over the ₹2,00,000 limit", pan: "The buyer's PAN is missing", walkin_limit: "A walk-in bill over ₹2,00,000", b2b_address: "The buyer's address is missing",
};

/**
 * What's wrong with the bill, or what's true of it, each with the way to fix it, in the prototype's order (PROTO
 * sales/BillDetail.jsx:203-288). A cancelled bill carries no flags. A fix the bill can't take (who's signed in, a
 * cancelled bill, a filed month) is greyed with the reason, as the menu has it.
 */
export function StateBanners({ b, d }: { b: BillDetail; d: Detail }) {
  const { show } = useToast();
  const fixHeads = useFixHeads();
  const [fail, setFail] = useState<FailText | null>(null);
  const out: ReactNode[] = [];
  const month = monthLabel(b.invoice_date.slice(0, 7), { long: true, year: false });
  if (b.replaces) {
    out.push(<p key="rp" className="text-sm text-fg2 flex items-center gap-1.5"><RefreshCcw size={15} className="text-muted" aria-hidden="true" />Replaces <Link to={`/sales/${b.replaces.id}`} className="link tnum">{b.replaces.invoice_number}</Link>, cancelled.</p>);
  }
  if (d.cancelled) {
    const repl = b.replaced_by;
    const reason = realReason(b.cancel_reason);
    out.push(<Banner key="x" tone="neg" icon={Ban} title="This bill is cancelled"
      actions={repl ? <ButtonLink size="sm" to={`/sales/${repl.id}`}>{`Open ${repl.invoice_number}`}</ButtonLink>
        : <Button size="sm" variant="primary" icon={RefreshCcw} disabled={!d.can("bill.create")} title={d.whyNot("bill.create") || "A new bill with the same customer, items and payment"} onClick={() => d.navigate(`/sales/new?remake=${b.id}`)}>Make it again</Button>}>
      {reason ? `“${reason}”. ` : ""}It stays in {d.month}&apos;s GSTR-1 as cancelled, with its number. Its amount isn&apos;t in sales or the GST figures.{repl ? ` It was made again as ${repl.invoice_number}.` : " Make it again opens a new bill with the same customer, items and payment."}
    </Banner>);
  }
  if (b.duplicates.length) {
    const o = b.duplicates[0];
    // renumbering is refused for a cancelled bill and in a filed month (contract §2.6), as the menu's Renumber is
    out.push(<Banner key="d" tone="neg" icon={AlertTriangle} title={`Bill number ${b.invoice_number} is used twice in ${d.firmName}`}
      actions={<>
        <ButtonLink size="sm" variant="primary" to={`/sales/${o.id}`}>Open the other bill</ButtonLink>
        <Button size="sm" disabled={Boolean(d.editBlock)} title={d.editBlock || undefined} onClick={() => d.dialogs.open("renumber", b)}>Renumber this one</Button>
      </>}>
      It shares the number with {o.customer_name}&apos;s bill of {date(o.invoice_date)}. {month}&apos;s GSTR-1 can&apos;t be filed until one of them gets a new number.
    </Banner>);
  }
  if (!d.cancelled && b.checks.includes("heads_mismatch")) {
    const fix = () => fixHeads.mutate(b.id, {
      onSuccess: () => { setFail(null); show({ title: `Tax heads fixed on ${b.invoice_number}`, body: `Now ${b.interstate ? "IGST" : "CGST + SGST"}, worked out again from the place of supply.` }); },
      onError: (e) => setFail(failText(problemOf(e), "fixed")),
    });
    out.push(<Banner key="h" tone="neg" icon={AlertTriangle} title={`Tax is under ${b.igst > 0 ? "IGST" : "CGST + SGST"}, but this is ${b.interstate ? "an inter-state" : "a local"} sale`}
      actions={<Button size="sm" variant="primary" icon={Wrench} loading={fixHeads.isPending} disabled={Boolean(d.editBlock)} title={d.editBlock || undefined} onClick={fix}>{fixHeads.isPending ? "Fixing…" : "Fix the tax heads"}</Button>}>
      Place of supply is {stateNameOf(b.place_of_supply)}, so the tax should be {b.interstate ? "IGST" : "CGST + SGST"}. {b.locked ? `${d.month}'s GSTR-1 is filed: unlock it first, then fix; your CA may need to amend the return.` : "Fix works the heads out again from the place of supply; the total stays the same."}
      <FailNote error={fail} onRetry={fix} busy={fixHeads.isPending} className="mt-2" />
    </Banner>);
  }
  const slips = d.cancelled ? [] : taxSlips(b.lines);
  if (slips.length) {
    const s0 = slips[0];
    const line = b.lines[s0.index];
    out.push(<Banner key="t" tone="neg" icon={AlertTriangle} title={`${plural(slips.length, "line")} ${slips.length === 1 ? "has" : "have"} tax that doesn't match ${slips.length === 1 ? "its" : "their"} GST rate`}
      actions={!d.editBlock ? <ButtonLink size="sm" to={`/sales/${b.id}/edit`} icon={Pencil}>Edit the bill</ButtonLink> : null}>
      {line.product_name}: {inr(s0.got)} of tax on {inr(line.taxable)} at {line.gst_percent}% should be {inr(s0.want)}. Saving the bill again works it out from the rate.
    </Banner>);
  }
  if (!d.cancelled && (b.checks.includes("no_lines") || b.checks.includes("no_hsn"))) {
    const none = !b.lines.length;
    out.push(<Banner key="q" tone="neg" icon={AlertTriangle} title={none ? "This bill has no items" : "A line has no HSN code"}
      actions={!d.editBlock ? <ButtonLink size="sm" variant="primary" to={`/sales/${b.id}/edit`} icon={Pencil}>{none ? "Add the items" : "Add the HSN code"}</ButtonLink> : null}>
      {month}&apos;s GSTR-1 can&apos;t be filed until it&apos;s fixed.
    </Banner>);
  }
  // the server's income-tax checks for a saved bill; the fixes are on the customer (plan 1C's form)
  if (!d.cancelled && b.itax.length) {
    const c = b.customer;
    const canFix = d.can("customer.edit") && c.type !== "walkin";
    const acts: ReactNode[] = [];
    if (canFix && b.itax.some((x) => x.kind === "pan")) acts.push(<ButtonLink key="pan" size="sm" to={`/customers/${c.id}/edit?focus=pan`}>Add PAN</ButtonLink>);
    if (canFix && b.itax.some((x) => x.kind === "b2b_address")) acts.push(<ButtonLink key="addr" size="sm" to={`/customers/${c.id}/edit?focus=address`}>Add the address</ButtonLink>);
    out.push(<Banner key="it" tone={b.itax.some((x) => x.kind === "cash_limit") ? "neg" : "brand"} icon={Scale}
      title={b.itax.length === 1 ? ITAX_TITLE[b.itax[0].kind] : `${b.itax.length} things to check on this bill`} actions={acts.length ? <>{acts}</> : null}>
      {b.itax.length === 1 ? b.itax[0].text : <ul className="list-disc pl-5 flex flex-col gap-1">{b.itax.map((x) => <li key={x.kind}>{x.text}</li>)}</ul>}
    </Banner>);
  }
  if (!d.cancelled && b.eway.may_be_needed) {
    out.push(<Banner key="e" tone="brand" icon={Truck} title="An e-way bill may be needed"
      actions={d.can("bill.edit") ? <EwayButton b={b} d={d}>Add the e-way bill</EwayButton> : null}>
      Over ₹50,000 with goods outside chapter 71: if they travel, make the e-way bill on the portal and record it here.
    </Banner>);
  }
  if (b.locked && !d.cancelled) {
    out.push(<Banner key="l" tone="file" icon={Lock} title={`${d.month} is filed and locked`}
      actions={<ButtonLink size="sm" to={`/gst?firm=${b.business}&month=${b.invoice_date.slice(0, 7)}`} icon={Landmark}>GST returns</ButtonLink>}>
      This bill can be printed and sent, not edited, cancelled or deleted. Unlock the month in GST returns first (owner only).
    </Banner>);
  }
  return <>{out}</>;
}
