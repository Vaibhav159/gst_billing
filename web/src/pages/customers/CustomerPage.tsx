// One customer: their details, the income-tax checks on their saved bills, then their sales bills for a period that is
// always named (the FY picked in the top bar, or all time, both visible), with what was billed on udhaar explained.
// A register, not a ledger: no balance is ever shown (PROTO pages/records/CustomerDetail.jsx). The page asks for the
// customer's all-time statement in the firm picked once, and works out the year's figures from its bills, so switching
// the period asks nothing. The income-tax notes are the server's flags (sales/?itax=1), never worked out again here.
// Merge waits for part 4; sending a bill again happens on the bill (part 1B).
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  AlertTriangle, Ban, Banknote, ChevronDown, FileText, GitMerge, IdCard, Info, MapPin, MessageCircle, MoreHorizontal, MoreVertical, NotebookPen, Pencil, Plus, ReceiptText, RotateCw, Store,
  Trash2, UserPlus, UserRound, WifiOff,
} from "lucide-react";
import { deleteRefusal, useDeleteCustomer, useItaxBills, useStatement, type Customer, type ItaxBill, type ItaxKind, type LastBill, type StatementBill } from "@/core/api/customers";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { addMonths, date, dateShort, fyOf, inr, mobileText, monthLabel, monthOf, plural, todayIST } from "@/core/format";
import { checkGstin, stateLabel } from "@/core/ids";
import { dayOf, PAY, PAY_SHORT } from "@/core/sales/words";
import { useFirms, useScope, type Firm } from "@/core/scope";
import {
  Badge, Banner, Button, ButtonLink, Card, ConfirmDialog, DL, EmptyState, Figure, IconButton, ListRow, ListSkeleton, Menu, Money, Page, QueryView, Table, Td, Th, Tr, useToast, type MenuItem,
} from "@/core/ui";
import { useView } from "@/core/view";
import { billsWithCancelled, firstName, fyPeriod, homeState, notCounted, openOnEnter, scopeName, tableState, useJustSaved, useRouteCustomer } from "./lib";
import { MoreButton, useContact } from "./listParts";
import { Bump, CopyButton, InfoCell, PeriodSwitch, QuickActions, type PeriodOption } from "./pageParts";
import { MissingRecord, WhyNote } from "./parts";

const PAGE = 15;
type Period = "fy" | "all";
/** How their bills are taxed, from their state against the firm's: IGST, CGST + SGST, or not known (no state on either side). */
type TaxWay = "igst" | "local" | null;

export default function CustomerPage() {
  // an address that names no customer on file (/customers/c-anil, or the server's 404) gets the missing-record page
  const { one, missing } = useRouteCustomer();
  if (missing) return <MissingRecord icon={UserRound} title="This customer isn't on file" to="/customers" label="All customers" />;
  // loading, slow, offline and failed, as every page draws them (the kit's QueryView)
  if (!one.data) return <Page title="Customer" back="/customers"><QueryView query={one} what="this customer" skeleton={<ListSkeleton rows={5} what="the customer" />}>{() => null}</QueryView></Page>;
  // keyed by the customer: another one opened from here (search) starts with its own period, Show more and dialogs
  return <Detail key={one.data.id} c={one.data} />;
}

/** The figures of a period's active bills. */
function figures(bills: StatementBill[]) {
  const active = bills.filter((b) => b.status === "active");
  const sum = (list: StatementBill[], k: "total_amount" | "taxable" | "tax") => list.reduce((s, b) => s + b[k], 0);
  const credit = active.filter((b) => b.paid === "udhaar");
  return {
    active, count: active.length, total: sum(active, "total_amount"), taxable: sum(active, "taxable"), tax: sum(active, "tax"),
    credit: { count: credit.length, total: sum(credit, "total_amount") }, notRecorded: active.filter((b) => b.paid === "not_recorded").length, cancelled: bills.length - active.length,
  };
}
/** Bills newest first (the statement gives them oldest first). */
const newestFirst = (a: StatementBill, b: StatementBill) => (a.invoice_date === b.invoice_date ? b.id - a.id : a.invoice_date < b.invoice_date ? 1 : -1);
/** The earliest bill's date, or null with none. */
const firstDate = (list: StatementBill[]) => list.reduce<string | null>((m, b) => (m === null || b.invoice_date < m ? b.invoice_date : m), null);

function useDetail(c: Customer) {
  const { firmId, setFirmId, fy } = useScope();
  const { firms, error: firmsFailed } = useFirms();
  const offline = useNetwork() === "offline";
  const fyP = fyPeriod(fy);
  const [period, setPeriod] = useState<Period>("fy");
  const [limit, setLimit] = useState(PAGE);
  // a new period, firm or year starts the bills from the top
  const view = `${period}|${firmId}|${fy}`;
  const [shownFor, setShownFor] = useState(view);
  if (shownFor !== view) { setShownFor(view); setLimit(PAGE); }
  // the firm's name is known (a firm picked on this device is known before the list of firms comes). The bills wait for
  // it, or for that list to fail, so their figures never show under another firm's name and nothing says "the firm picked's"
  const named = typeof firmId !== "number" || firms.some((f) => f.id === firmId);
  const worded = firmId !== null && (named || firmsFailed);
  const st = useStatement(c.id, !worded ? null : typeof firmId === "number" ? { business_id: firmId } : {});
  const itax = useItaxBills(c.id);
  const all = st.data?.bills ?? [];
  const inFy = all.filter((b) => b.invoice_date >= fyP.from && b.invoice_date <= fyP.to);
  const fyFig = figures(inFy);
  const allFig = figures(all);
  const fig = period === "fy" ? fyFig : allFig;
  const bills = [...(period === "fy" ? inFy : all)].sort(newestFirst);
  // "Customer since" is the record's own date (Call 20). All time runs from the first bill when that's older: a bill
  // copied in from Tally before the record was made here
  const since = dayOf(c.created_at);
  const first = firstDate(all);
  const allFrom = first && (!since || first < since) ? first : since;
  const last = [...allFig.active].sort(newestFirst)[0] ?? null;
  // loaded: figures to show, fresh or kept after asking again failed. ready: fresh, which is what Delete goes by
  const loaded = st.data !== undefined;
  const ready = st.isSuccess;
  const plabel = period === "fy" ? fyP.label : "All time";
  const allRange = allFrom ? `since ${date(allFrom)}` : "";
  const prange = period === "fy" ? fyP.range : allRange || "every year";
  const options: PeriodOption<Period>[] = [
    { value: "fy", title: fyP.label, sub: loaded ? `${fyP.range} · ${plural(fyFig.count, "bill")} · ${inr(fyFig.total)}` : fyP.range },
    { value: "all", title: "All time", sub: [allRange, loaded ? `${plural(allFig.count, "bill")} · ${inr(allFig.total)}` : ""].filter(Boolean).join(" · ") || "Every year" },
  ];
  // sales by month for the period, to one scale: the year's months so far, or from the first counted bill
  const from = period === "fy" ? fyP.from : firstDate(allFig.active) ?? fyP.from;
  const to = period === "fy" ? fyP.to : todayIST();
  const trend: { ym: string; total: number; count: number }[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) {
    const inMonth = fig.active.filter((b) => monthOf(b.invoice_date) === m);
    trend.push({ ym: m, total: inMonth.reduce((s, b) => s + b.total_amount, 0), count: inMonth.length });
  }
  // the firm in words, once it can be worded: its name or "All firms"; "the firm picked" when the list of firms failed
  const scope = worded ? scopeName(firms, firmId) : null;
  const home = homeState(firms, firmId);
  const taxWay: TaxWay = !c.state_name || !home ? null : tableState(c.state_name) !== home ? "igst" : "local";
  return {
    firms, firmId, setFirmId, fy, fyP, period, setPeriod, st, itax, loaded, ready, bills, shown: bills.slice(0, limit), more: () => setLimit((l) => l + PAGE),
    fig, allFig, since, last, plabel, prange, options, trend, scope, taxWay, key: `${period}|${firmId}`,
    // the firm picked's, by name ("KIRAN GOLD HOUSE's"); without its name, neutral words, never "the firm picked's"
    whose: typeof firmId === "number" && named ? `${scopeName(firms, firmId)}'s` : "one firm's",
    // after "It has no bills", "None" and "Has 3 bills": the statement is the firm picked's, so it says whose bills it looked at
    inScope: typeof firmId === "number" && scope ? ` in ${scope}` : "",
    usual: firms.filter((f) => c.businesses.includes(f.id)),
    // why what needs the bills (Delete) is off until they come: what happened, and what to do
    away: offline ? "Needs the internet" : st.isError ? "The bills didn't load. Use Try again." : "Waits for the bills to load",
  };
}
type D = ReturnType<typeof useDetail>;

/** A statement bill as WhatsApp's "Resend <last bill>" names it. */
const asLast = (b: StatementBill | null): LastBill | null => (b ? { id: b.id, invoice_number: b.invoice_number, invoice_date: b.invoice_date, total_amount: b.total_amount, business: b.business } : null);
/** The firm a bill is from, by its short name (the server's name until the list of firms comes). */
const firmShort = (firms: Firm[], b: StatementBill) => firms.find((f) => f.id === b.business)?.short ?? b.business_name;
/** "GST charged"'s caption. */
const gstCaption = (d: D) => (!d.fig.count ? "No bills" : d.taxWay === "igst" ? "IGST" : d.taxWay === "local" ? "CGST + SGST" : "CGST + SGST or IGST");

function Detail({ c }: { c: Customer }) {
  const { isPhone } = useView();
  const d = useDetail(c);
  const [del, setDel] = useState(false);
  return (
    <>
      {isPhone ? <PhoneDetail c={c} d={d} openDelete={() => setDel(true)} /> : <DesktopDetail c={c} d={d} openDelete={() => setDel(true)} />}
      <DeleteCustomer c={c} bills={`None${d.inScope}`} open={del} onClose={() => setDel(false)} />
    </>
  );
}

/** "KGH/2026-27/18, KGH/2026-27/22, MO/2026-27/7 and 2 more". */
const numbers = (list: ItaxBill[]) => list.slice(0, 3).map((b) => b.invoice_number).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");

/** The income-tax checks the bill form runs, for this customer's saved bills in every firm and year: the server's flags, by kind (Call 7). */
function ComplianceNotes({ c, bills }: { c: Customer; bills: ItaxBill[] }) {
  const { can } = useAuth();
  const by = (...kinds: ItaxKind[]) => bills.filter((b) => b.itax.some((f) => kinds.includes(f.kind)));
  // on the walk-in record a big bill's flag is walkin_limit: it needs the buyer's PAN all the same
  const pan = by("pan", "walkin_limit"), addr = by("b2b_address"), cash = by("cash_limit");
  if (!pan.length && !addr.length && !cash.length) return null;
  const walkin = c.type === "walkin";
  const edit = (field: string) => (can("customer.edit") && !walkin ? `/customers/${c.id}/edit?focus=${field}` : null);
  const panTo = edit("pan"), addrTo = edit("address");
  return (
    <div className="flex flex-col gap-2">
      {pan.length ? (
        <Banner tone="brand" icon={IdCard} title={`PAN needed: ${plural(pan.length, "bill")} over ₹2,00,000`}
          actions={walkin ? (can("customer.edit") ? <ButtonLink size="sm" to="/customers/new?from=list" icon={UserPlus}>Add the buyer</ButtonLink> : null) : panTo ? <ButtonLink size="sm" to={panTo}>Add PAN</ButtonLink> : null}>
          {numbers(pan)}. A bill over ₹2,00,000 needs the buyer's PAN (Income Tax Rule 114B).{walkin ? " Add the buyer as a customer with their PAN." : ""}
        </Banner>
      ) : null}
      {addr.length ? (
        <Banner tone="brand" icon={MapPin} title={`Address needed: ${plural(addr.length, "bill")} to a business`} actions={addrTo ? <ButtonLink size="sm" to={addrTo}>Add the address</ButtonLink> : null}>
          A bill to a GST-registered buyer carries their address. Add it once here; it prints on every bill from now on.
        </Banner>
      ) : null}
      {cash.length ? (
        <Banner tone="neg" icon={Banknote} title={`Cash at the limit: ${plural(cash.length, "bill")} of ₹2,00,000 or more taken in cash`}>
          {numbers(cash)}. Income Tax Sec 269ST doesn't allow ₹2,00,000 or more in cash for one bill. Check with your CA.
        </Banner>
      ) : null}
    </div>
  );
}

/**
 * The income-tax notes, or, when the checks couldn't load, a note that says so: a page with no notes never reads as
 * nothing to fix. Offline, a check that failed or waits says so, with no Try again (as StaleNote and QueryView): TanStack
 * asks again by itself once the device is back.
 */
function IncomeTaxNotes({ c, q }: { c: Customer; q: D["itax"] }) {
  const offline = useNetwork() === "offline";
  if (q.data) return <ComplianceNotes c={c} bills={q.data} />;
  if (!q.isError && !(offline && q.isPaused)) return null;
  return (
    <Banner tone="muted" icon={offline ? WifiOff : AlertTriangle} title="Couldn't check their bills for income tax"
      actions={offline ? undefined : <Button size="sm" icon={RotateCw} loading={q.isFetching} onClick={() => void q.refetch()}>Try again</Button>}>
      {offline ? "You're offline, so the check can't run. It runs when you're back online."
        : "Bills that need the buyer's PAN or address, or took ₹2,00,000 or more in cash, show here once the check loads."}
    </Banner>
  );
}

function ScopeBanner({ d }: { d: D }) {
  // one firm's bills, said once its name (or the list of firms' failure) is known
  if (typeof d.firmId !== "number" || !d.scope) return null;
  return (
    <Banner tone="muted" icon={Store} title={`Showing ${d.whose} bills only`} actions={<Button size="sm" onClick={() => d.setFirmId("all")}>Show all firms</Button>}>
      The firm picker decides which bills these figures count.
    </Banner>
  );
}

function WalkinBanner({ c }: { c: Customer }) {
  const { can } = useAuth();
  if (c.type !== "walkin") return null;
  return (
    <Banner tone="muted" icon={Info} title="This record collects cash sales made without a name"
      actions={can("customer.edit") ? <ButtonLink size="sm" to="/customers/new?from=list" icon={UserPlus}>Add a customer</ButtonLink> : null}>
      Quick counter sales where the buyer didn't give a name land here, and go to GSTR-1 as B2C sales. It can't be renamed, merged or deleted. To keep a buyer's bills together, add them as a customer.
    </Banner>
  );
}

function UdhaarNote({ c, d }: { c: Customer; d: D }) {
  return (
    <p className="text-sm text-muted flex items-start gap-2">
      <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        Billed on udhaar counts bills marked udhaar when they were made: {plural(d.fig.credit.count, "bill")}, {inr(d.fig.credit.total)} ({d.plabel}). The app doesn't record payments received,
        so this isn't what {c.type === "walkin" ? "anyone" : c.name} still owes; your udhaar book has that.{d.fig.notRecorded ? ` ${plural(d.fig.notRecorded, "bill")} came from Tally without a payment mode.` : ""}
      </span>
    </p>
  );
}

/** Sales month by month, bars to one scale. */
function Trend({ d }: { d: D }) {
  const { isPhone } = useView();
  if (!d.trend.length) return null;
  const max = Math.max(...d.trend.map((m) => m.total), 1);
  const many = d.trend.length > 12;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="caps">Sales by month · {d.plabel}</p>
        <p className="text-xs text-muted tnum">Tallest: {inr(max)}</p>
      </div>
      <div className={cn("flex items-end gap-1", isPhone ? "h-16" : "h-20")} role="img" aria-label={`Sales by month: ${d.trend.map((m) => `${monthLabel(m.ym)} ${inr(m.total)}`).join("; ")}`}>
        {d.trend.map((m) => (
          <span key={m.ym} title={`${monthLabel(m.ym, { long: true })}: ${inr(m.total)} · ${plural(m.count, "bill")}`} className="flex-1 h-full flex items-end min-w-0">
            <span className={cn("w-full rounded-t-[3px]", m.total ? "bg-sale" : "bg-line")} style={{ height: m.total ? `${Math.max(4, (m.total / max) * 100)}%` : "2px" }} />
          </span>
        ))}
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {d.trend.map((m, i) => <span key={m.ym} className="flex-1 min-w-0 text-center text-2xs text-muted truncate">{!many || i % 3 === 0 ? monthLabel(m.ym, { year: false }) : ""}</span>)}
      </div>
    </div>
  );
}

/** Cancelled (with its reason on hover) or Udhaar, as the bills lists show them. */
function BillState({ b }: { b: StatementBill }) {
  if (b.status === "cancelled") return <Badge tone="neg" icon={Ban} title={b.cancel_reason ? `Cancelled: ${b.cancel_reason}` : undefined}>Cancelled</Badge>;
  if (b.paid === "udhaar") return <Badge tone="muted" icon={NotebookPen}>Udhaar</Badge>;
  return null;
}

/** All bills in Sales, Merge (part 4) and Delete (owner; a customer with no bills): one menu on desktop and phone. */
function useMoreItems(c: Customer, d: D, openDelete: () => void): MenuItem[] {
  const { can, whyNot } = useAuth();
  if (c.type === "walkin") return [{ label: "All walk-in bills in Sales", icon: ReceiptText, to: `/sales?customer=${c.id}` }];
  const owner = can("customer.merge");
  const has = d.allFig.count + d.allFig.cancelled > 0;
  // Delete waits for the bills (Ruling 1C-6): until they've loaded it can't say there are none. The server refuses a
  // customer with bills in another firm, and the dialog says so (Call 11)
  const hint = !owner ? whyNot("customer.merge", "delete customers")
    : !d.ready ? d.away
      : has ? `Has ${billsWithCancelled(d.allFig.count, d.allFig.cancelled)}${d.inScope}. Merge it into the right customer instead.` : `It has no bills${d.inScope}`;
  return [
    { label: "All bills in Sales", icon: ReceiptText, hint: "With every filter and export there", to: `/sales?customer=${c.id}` },
    { label: "Merge into another customer…", icon: GitMerge, disabled: true, hint: owner ? "Comes in part 4, with Records and admin" : whyNot("customer.merge", "merge customers") },
    { divider: true },
    { label: "Delete customer…", icon: Trash2, tone: "danger", disabled: !owner || !d.ready || has, onSelect: openDelete, hint },
  ];
}

/** bills: the Bills row ("None", or "None in KIRAN GOLD HOUSE" when one firm's bills were looked at). */
function DeleteCustomer({ c, bills, open, onClose }: { c: Customer; bills: string; open: boolean; onClose: () => void }) {
  const del = useDeleteCustomer();
  const navigate = useNavigate();
  const { show } = useToast();
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setError(null);
    del.mutate(c.id, {
      onSuccess: () => { show({ title: `${c.name} deleted`, body: "It's also in the Audit log, to restore later." }); onClose(); navigate("/customers", { replace: true }); },
      onError: (e) => setError(deleteRefusal(e)),
    });
  };
  return (
    <ConfirmDialog open={open} busy={del.isPending} busyLabel="Deleting…" onClose={() => { onClose(); setError(null); }} onConfirm={go} tone="danger" title={`Delete ${c.name}?`} confirmLabel="Delete customer"
      record={[["Customer", c.name], ["Phone", mobileText(c.mobile_number) || "No phone"], ["GSTIN", c.gst_number || "No GSTIN"], ["Bills", bills]]}
      extra={error ? <p role="alert" className="text-sm text-neg">{error}</p> : null}>
      <p>It goes off the customer list and the bill form. The Audit log can bring it back.</p>
    </ConfirmDialog>
  );
}

/** A GSTIN on file that doesn't check out, said, with the way to fix it (Call 1); nothing for one that does. Both views use it. */
function GstinProblem({ c, className }: { c: Customer; className?: string }) {
  const { can } = useAuth();
  const g = checkGstin(c.gst_number);
  if (!c.gst_number || g.status === "valid") return null;
  return (
    <span className={cn("text-neg", className)}>
      {g.status === "check" ? "Its last character doesn't match, so you may have mistyped one character." : "It doesn't look like a GSTIN."}
      {can("customer.edit") && c.type !== "walkin" ? <> <Link to={`/customers/${c.id}/edit?focus=gstin`} className="link">Check the GSTIN</Link></> : null}
    </span>
  );
}

/**
 * The GSTIN or PAN cell. The PAN shown is the one that counts (the server's `pan`: typed, else the GSTIN's), under a GSTIN
 * that doesn't check out too: there it's the one typed, as the app never reads a PAN from such a GSTIN.
 */
function IdCell({ c, className }: { c: Customer; className?: string }) {
  const g = checkGstin(c.gst_number);
  const pan = c.pan || (g.status === "valid" ? g.pan : "");
  const panLine = pan ? <span className="flex items-center gap-1">PAN <span className="tnum">{pan}</span><CopyButton value={pan} label="PAN" /></span> : null;
  const sub = !c.gst_number ? (c.pan ? "No GSTIN" : "Needed for a bill over ₹2,00,000")
    : g.status === "valid" ? panLine
      : <>{panLine}<GstinProblem c={c} /></>;
  return (
    <InfoCell className={className} label={c.gst_number ? "GSTIN · B2B bills" : "PAN · B2C bills"} sub={sub}>
      {c.gst_number ? <span className="flex items-center gap-1"><span className="tnum">{c.gst_number}</span><CopyButton value={c.gst_number} label="GSTIN" /></span>
        : c.pan ? <span className="flex items-center gap-1"><span className="tnum">{c.pan}</span><CopyButton value={c.pan} label="PAN" /></span> : <span className="text-muted">No GSTIN or PAN</span>}
    </InfoCell>
  );
}

/* ── Desktop ───────────────────────────────────────────── */
function DesktopDetail({ c, d, openDelete }: { c: Customer; d: D; openDelete: () => void }) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const flash = useJustSaved("customer") === c.id;
  const items = useMoreItems(c, d, openDelete);
  const k = useContact(c, asLast(d.last));
  const walkin = c.type === "walkin";
  return (
    <Page icon={UserRound} breadcrumbs={[{ label: "Customers", to: "/customers" }]} title={c.name}
      context={[walkin ? "Walk-in record" : d.since ? `Customer since ${date(d.since)}` : null, walkin ? null : c.city, d.last ? `last bill ${date(d.last.invoice_date)}` : null].filter(Boolean).join(" · ")}
      actions={<>
        {k.items.length ? <Menu title={`WhatsApp ${c.name}`} width={320} items={k.items} trigger={(p) => <Button {...p} icon={MessageCircle} iconRight={ChevronDown}>WhatsApp</Button>} /> : null}
        {walkin ? null : can("customer.edit") ? <ButtonLink to={`/customers/${c.id}/edit`} icon={Pencil}>Edit</ButtonLink> : <Button icon={Pencil} disabled title={whyNot("customer.edit", "change customers")}>Edit</Button>}
        <Menu title={c.name} width={300} items={items} trigger={(p) => <Button {...p} icon={MoreHorizontal}>More</Button>} />
        {/* a bill needs the customer, not their past bills: it stays on when those didn't load */}
        {can("bill.create")
          ? <ButtonLink variant="primary" icon={Plus} to={`/sales/new?customer=${c.id}`}>{`New bill for ${c.name}`}</ButtonLink>
          : <Button variant="primary" icon={Plus} disabled title={whyNot("bill.create", "make bills")}>{`New bill for ${c.name}`}</Button>}
      </>}
      banner={<ScopeBanner d={d} />}>
      <WalkinBanner c={c} />
      {!can("customer.edit") && !walkin ? <WhyNote className="-mt-3">{whyNot("customer.edit", "change customers")}</WhyNote> : null}
      <Card pad={false}>
        <div className={cn("grid grid-cols-[1.1fr_1.35fr_1.15fr_1.3fr_1.9fr] divide-x divide-rule rounded-card", flash && "anim-flash")}>
          {/* (a number WhatsApp can't use, such as a landline, is like none: Send opens WhatsApp to pick the contact) */}
          <InfoCell className="px-5 py-4" label="Phone" sub={c.email || (k.tel ? "Bills are sent here on WhatsApp" : "Send opens WhatsApp to pick the contact")}>
            {k.tel ? <a href={k.tel} className="tnum text-fg hover:text-brand hover:underline" title={`Call ${c.name}`}>{mobileText(c.mobile_number)}</a> : <span className="tnum">{mobileText(c.mobile_number) || "No phone"}</span>}
          </InfoCell>
          <IdCell c={c} className="px-5 py-4" />
          <InfoCell className="px-5 py-4" label="State" sub={d.taxWay === "igst" ? "Inter-state: IGST on every bill" : d.taxWay === "local" ? "Local sales: CGST + SGST" : undefined}>{stateLabel(c.state_name)}</InfoCell>
          <InfoCell className="px-5 py-4" label="Address" sub={c.city}>{c.address || <span className="text-muted">No address</span>}</InfoCell>
          <InfoCell className="px-5 py-4" label="Firms that usually bill them">
            <span className="flex flex-wrap gap-1.5 mt-0.5">
              {/* by name once the list of firms has come; until then (or if it can't) by count, never "Any firm" for one they have */}
              {d.usual.length ? d.usual.map((f) => <Badge key={f.id}>{f.name}</Badge>) : c.businesses.length ? <span className="text-muted">{plural(c.businesses.length, "firm")}</span> : <Badge>Any firm</Badge>}
            </span>
          </InfoCell>
        </div>
      </Card>
      <IncomeTaxNotes c={c} q={d.itax} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Sales to {c.name}</h2>
          <p className="text-sm text-muted">{["Sales bills only", d.scope, "pick the period"].filter(Boolean).join(" · ")}</p>
        </div>
        <PeriodSwitch label={`Period for ${c.name}'s figures`} options={d.options} value={d.period} onChange={d.setPeriod} className="w-[680px] max-w-full" />
      </div>

      <QueryView query={d.st} what={`${c.name}'s bills`} skeleton={<ListSkeleton rows={5} what={`${c.name}'s bills`} />}>{() => (
        <>
          <Card>
            <div className="grid grid-cols-4 divide-x divide-rule -mx-5">
              <Figure className="px-5" label={`Sales · ${d.plabel}`} value={<Bump k={d.key}><Money value={d.fig.total} size="2xl" tone="sale" /></Bump>} caption={`${plural(d.fig.count, "sales bill")} · incl. GST`} />
              <Figure className="px-5" label={`Taxable value · ${d.plabel}`} value={<Bump k={d.key}><Money value={d.fig.taxable} size="2xl" /></Bump>} caption="Before GST" />
              <Figure className="px-5" label={`GST charged · ${d.plabel}`} value={<Bump k={d.key}><Money value={d.fig.tax} size="2xl" /></Bump>} caption={gstCaption(d)} />
              <Figure className="px-5" label={<span className="inline-flex items-center gap-1.5"><NotebookPen size={14} aria-hidden="true" />Billed on udhaar · {d.plabel}</span>} value={<Bump k={d.key}><Money value={d.fig.credit.total} size="2xl" /></Bump>} caption={`${plural(d.fig.credit.count, "bill")} · not a balance`} />
            </div>
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-8 border-t border-rule mt-5 pt-4">
              <UdhaarNote c={c} d={d} />
              <Trend d={d} />
            </div>
          </Card>

          <Card title={`Sales bills · ${d.plabel}`} subtitle={[d.prange, `${plural(d.fig.count, "bill")}${notCounted(d.fig.cancelled)}`, d.scope].filter(Boolean).join(" · ")} pad={false}
            actions={<ButtonLink to={`/customers/${c.id}/statement`} icon={FileText}>Statement</ButtonLink>}>
            <p className="px-5 pt-1 pb-3 text-sm text-muted">A register of bills, not a ledger: payments received aren't recorded here, so no balance is shown.</p>
            {d.bills.length ? (
              <Table label={`Sales bills to ${c.name}`}>
                <thead>
                  <tr>
                    <Th>Date</Th><Th>Bill no.</Th><Th className="hidden xl:table-cell">Firm</Th><Th align="right" className="hidden xl:table-cell">Taxable</Th><Th align="right">GST</Th>
                    <Th align="right">Total</Th><Th className="hidden xl:table-cell">Paid by</Th><Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.shown.map((b) => {
                    const off = b.status === "cancelled";
                    const open = () => navigate(`/sales/${b.id}`);
                    return (
                      <Tr key={b.id} data-row={b.id} tabIndex={-1} onClick={open} onKeyDown={openOnEnter(open)} className="row-focus outline-none">
                        <Td className="tnum whitespace-nowrap">{date(b.invoice_date)}</Td>
                        <Td><Link to={`/sales/${b.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand hover:underline tnum whitespace-nowrap">{b.invoice_number}</Link></Td>
                        <Td className="text-fg2 hidden xl:table-cell">{b.business_name}</Td>
                        <Td align="right" className={cn("hidden xl:table-cell", off && "line-through text-muted")}><Money value={b.taxable} /></Td>
                        <Td align="right" className={cn(off && "line-through text-muted")}><Money value={b.tax} /></Td>
                        <Td align="right" className={cn(off && "line-through text-muted")}><Money value={b.total_amount} strong={!off} /></Td>
                        <Td className={cn("whitespace-nowrap hidden xl:table-cell", b.payment_mode === "" ? "text-muted" : "text-fg2")}>{PAY[b.payment_mode] ?? PAY[""]}</Td>
                        <Td><BillState b={b} /></Td>
                      </Tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <Td className="font-semibold whitespace-nowrap" colSpan={2}>{d.plabel} total · {plural(d.fig.count, "bill")}</Td>
                    <Td className="hidden xl:table-cell" />
                    <Td align="right" className="hidden xl:table-cell"><Money value={d.fig.taxable} strong /></Td>
                    <Td align="right"><Money value={d.fig.tax} strong /></Td>
                    <Td align="right"><Money value={d.fig.total} strong tone="sale" /></Td>
                    <Td className="hidden xl:table-cell" />
                    <Td />
                  </tr>
                </tfoot>
              </Table>
            ) : (
              <EmptyState icon={FileText} title={`No sales bills to ${c.name} ${d.period === "fy" ? `in ${d.fyP.label}` : "yet"}`}
                actions={can("bill.create") ? <ButtonLink variant="primary" icon={Plus} to={`/sales/new?customer=${c.id}`}>{`New bill for ${c.name}`}</ButtonLink> : null}>
                {typeof d.firmId === "number" ? `Only ${d.whose} bills are counted. Pick All firms in the firm picker to see the rest.` : d.period === "fy" ? "Pick All time to see other years." : "Bills made for this customer will list here, newest first."}
              </EmptyState>
            )}
            <MoreButton shown={d.shown.length} total={d.bills.length} what="bills" pageSize={PAGE} onMore={d.more} />
          </Card>
        </>
      )}</QueryView>
    </Page>
  );
}

/* ── Phone ─────────────────────────────────────────────── */
function PhoneDetail({ c, d, openDelete }: { c: Customer; d: D; openDelete: () => void }) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const flash = useJustSaved("customer") === c.id;
  const items = useMoreItems(c, d, openDelete);
  const k = useContact(c, asLast(d.last));
  const walkin = c.type === "walkin";
  return (
    <Page title={c.name} back="/customers" phoneSubtitle={walkin ? "Cash sales without a name" : [mobileText(c.mobile_number) || "No phone", c.city].filter(Boolean).join(" · ")}
      phoneActions={<>
        {!walkin && can("customer.edit") ? <IconButton label={`Edit ${c.name}`} icon={Pencil} onClick={() => navigate(`/customers/${c.id}/edit`)} /> : null}
        <Menu title={c.name} items={walkin ? [...items, { divider: true }, { label: "Statement", icon: FileText, hint: "Bills for a period, as a PDF", to: `/customers/${c.id}/statement` }] : items}
          trigger={(p) => <IconButton {...p} label={`More for ${c.name}`} icon={MoreVertical} />} />
      </>}
      actionBar={can("bill.create") ? <ButtonLink to={`/sales/new?customer=${c.id}`} variant="primary" size="lg" icon={Plus}>{`New bill for ${walkin ? "walk-in" : firstName(c.name)}`}</ButtonLink> : null}>
      {walkin ? null : <QuickActions c={c} last={asLast(d.last)} />}
      <ScopeBanner d={d} />
      <WalkinBanner c={c} />
      {!can("bill.create") ? <WhyNote>{whyNot("bill.create", "make bills")}</WhyNote> : null}
      <IncomeTaxNotes c={c} q={d.itax} />
      <Card pad={false}>
        <div className={cn("px-4 py-1 rounded-card", flash && "anim-flash")}>
          <DL rows={[
            ["Phone", k.tel ? <a key="p" href={k.tel} className="tnum text-brand underline-offset-2 hover:underline inline-flex items-center min-h-11">{mobileText(c.mobile_number)}</a> : <span key="p" className="tnum">{mobileText(c.mobile_number) || "No phone"}</span>],
            c.email ? ["Email", <span key="e" className="break-all">{c.email}</span>] : null,
            ["GSTIN", c.gst_number ? (
              <span key="g">
                <span className="inline-flex items-center gap-0.5 tnum">{c.gst_number}<CopyButton value={c.gst_number} label="GSTIN" /></span>
                <GstinProblem c={c} className="block text-xs" />
              </span>
            ) : "No GSTIN · B2C bills"],
            ["PAN", c.pan ? <span key="pn" className="inline-flex items-center gap-0.5 tnum">{c.pan}<CopyButton value={c.pan} label="PAN" /></span> : <span key="pn" className="text-muted">None · needed over ₹2,00,000</span>],
            ["State", <span key="s">{stateLabel(c.state_name)}{d.taxWay ? <span className="block text-xs text-muted">{d.taxWay === "igst" ? "IGST on every bill" : "CGST + SGST"}</span> : null}</span>],
            ["Address", c.address ? [c.address, c.city].filter(Boolean).join(", ") : c.city || "No address"],
            ["Usually billed by", d.usual.length ? d.usual.map((f) => f.short).join(", ") : c.businesses.length ? plural(c.businesses.length, "firm") : "Any firm"],
          ]} />
        </div>
      </Card>

      <PeriodSwitch label={`Period for ${c.name}'s figures`} options={d.options} value={d.period} onChange={d.setPeriod} />

      <QueryView query={d.st} what={`${c.name}'s bills`} skeleton={<ListSkeleton rows={4} what={`${c.name}'s bills`} />}>{() => (
        <>
          <Card title={d.plabel} subtitle={[d.prange, d.scope].filter(Boolean).join(" · ")}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              <Figure label="Sales" value={<Bump k={d.key}><Money value={d.fig.total} size="xl" tone="sale" /></Bump>} caption={plural(d.fig.count, "bill")} />
              <Figure label="Taxable value" value={<Bump k={d.key}><Money value={d.fig.taxable} size="xl" /></Bump>} caption="Before GST" />
              <Figure label="GST charged" value={<Bump k={d.key}><Money value={d.fig.tax} size="lg" /></Bump>} caption={gstCaption(d)} />
              <Figure label={<span className="inline-flex items-center gap-1.5"><NotebookPen size={14} aria-hidden="true" />Billed on udhaar</span>} value={<Bump k={d.key}><Money value={d.fig.credit.total} size="lg" /></Bump>} caption={`${plural(d.fig.credit.count, "bill")} · not a balance`} />
            </div>
            <div className="border-t border-rule mt-4 pt-3 flex flex-col gap-4"><Trend d={d} /><UdhaarNote c={c} d={d} /></div>
          </Card>

          <Card title={`Sales bills · ${d.plabel}`} subtitle={[`${plural(d.fig.count, "bill")}${notCounted(d.fig.cancelled)}`, d.scope].filter(Boolean).join(" · ")} pad={false}>
            <ul className="mt-2">
              {d.shown.map((b) => {
                const off = b.status === "cancelled";
                return (
                  <li key={b.id} data-row={b.id} tabIndex={-1} onKeyDown={openOnEnter(() => navigate(`/sales/${b.id}`))} className="border-t border-rule outline-none row-focus">
                    {/* the number and the money on one line, never cut; the date, firm and payment on the next */}
                    <Link to={`/sales/${b.id}`} className="flex items-center justify-between gap-3 px-4 pt-2 min-h-11 hover:bg-raised/60">
                      <span className="font-medium tnum whitespace-nowrap">{b.invoice_number}</span>
                      <Money value={b.total_amount} className={cn("font-medium whitespace-nowrap", off && "line-through text-muted")} />
                    </Link>
                    <div className="flex items-center gap-2 pl-4 pr-2 pb-1">
                      <span className="flex-1 min-w-0 text-sm text-muted break-words">{dateShort(b.invoice_date)}{fyOf(b.invoice_date) !== d.fy ? ` ${b.invoice_date.slice(0, 4)}` : ""} · {firmShort(d.firms, b)} · {PAY_SHORT[b.payment_mode] ?? PAY_SHORT[""]}</span>
                      <BillState b={b} />
                    </div>
                  </li>
                );
              })}
            </ul>
            {d.bills.length ? (
              <>
                <MoreButton shown={d.shown.length} total={d.bills.length} what="bills" pageSize={PAGE} onMore={d.more} />
                <div className="border-t border-rule px-4 py-3 flex items-baseline justify-between gap-3">
                  <span className="text-sm text-fg2">{d.plabel} total</span>
                  <Money value={d.fig.total} strong tone="sale" />
                </div>
              </>
            ) : <EmptyState icon={FileText} title={`No sales bills ${d.period === "fy" ? `in ${d.fyP.label}` : "yet"}`}>{d.period === "fy" ? "Pick All time to see other years." : `Bills made for ${c.name} list here, newest first.`}</EmptyState>}
          </Card>
        </>
      )}</QueryView>
      {walkin ? (
        <Card pad={false}>
          <ListRow to={`/customers/${c.id}/statement`} leading={<span className="w-9 h-9 rounded-ctl bg-raised grid place-items-center text-fg2"><FileText size={18} aria-hidden="true" /></span>}
            title="Statement" subtitle="Bills for a period, as a PDF to share" />
        </Card>
      ) : null}
    </Page>
  );
}
