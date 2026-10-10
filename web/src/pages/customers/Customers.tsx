// Customers: everyone the firms bill, with this year's sales in the firm picked (PROTO pages/records/Customers.jsx).
// Every figure names its period and firms, and the summary line follows the filters. No balances: the app doesn't
// record payments received. The duplicate-customers banner ("Review and merge") comes with Merge in part 4.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowUpDown, Download, MoreVertical, Search, SlidersHorizontal, Upload, UserPlus, Users, X } from "lucide-react";
import {
  customerListParams, fetchAllCustomers, LIST_PAGE, useCustomer, useCustomerCount, useCustomerList, type CustomerListFilters, type CustomerRow, type CustomerSort,
} from "@/core/api/customers";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, dateShort, mobileText, plural, todayIST } from "@/core/format";
import { stateOptions, stateTitle } from "@/core/ids";
import { cancelledNote, failText } from "@/core/sales/words";
import { useFirms, useScope } from "@/core/scope";
import {
  Badge, Button, ButtonLink, Card, EmptyState, Field, IconButton, ListRow, ListSkeleton, Menu, Money, Page, QueryView, SearchInput, Segmented, Select, Sheet, StaleNote,
  Table, Td, Th, Tr, useToast,
} from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { customersCsv } from "./exportCsv";
import { downloadFile, fyPeriod, homeState, scopeName, tableState, useJustSaved } from "./lib";
import { CustomerRowMenu, FirmChips, MoreButton } from "./listParts";
import { WhyNote } from "./parts";

const SORTS: { value: CustomerSort; label: string }[] = [{ value: "recent", label: "Recent bill" }, { value: "name", label: "Name" }, { value: "sales", label: "Most sales" }];
const GST_OPTS = [{ value: "any" as const, label: "All" }, { value: "yes" as const, label: "Has GSTIN" }, { value: "no" as const, label: "No GSTIN" }];
const OFFLINE: ApiProblem = { kind: "offline", message: "You're offline" };
/** Why Export is off when the list of firms didn't load: the file would have no firm to name its figures by. */
const NO_FIRMS = "The firms didn't load. Reload the page to export.";
/**
 * On a desktop the list's states sit in its card, under the toolbar, so a search that fails keeps the search box. There,
 * QueryView's skeleton and failure card drop their own frame, and its notes keep the card's margins.
 */
const IN_CARD = "[&>.card]:border-0 [&>.card]:rounded-none [&>.rounded-card]:mx-5 [&>.rounded-card]:mb-3 [&>p]:px-5 [&>p]:pb-4";

/** " · 1 cancelled bill not counted" after the bills, or "" with none (Selling's words, @/core/sales/words). */
function notCounted(n: number): string {
  const note = cancelledNote(n, "not counted");
  return note ? ` · ${note}` : "";
}
/** Each customer once: one can come again on the next page when the order moved between the two asks. */
function once(rows: CustomerRow[]): CustomerRow[] {
  const seen = new Set<number>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
/** Enter on a row that has focus (Back puts it there) opens it; Enter on a link or button inside the row is that control's. */
function openOnEnter(open: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => { if (e.key === "Enter" && e.target === e.currentTarget) open(); };
}

function useCustomersPage() {
  const { firmId, setFirmId, fy } = useScope();
  const { firms, error: firmsFailed } = useFirms();
  const net = useNetwork();
  const period = fyPeriod(fy);
  const [q, setQ] = useState("");
  const [gst, setGst] = useState<"any" | "yes" | "no">("any");
  const [state, setState] = useState("");
  const [usual, setUsual] = useState<number | null>(null);
  const [sort, setSort] = useState<CustomerSort>("recent");
  const term = useDebounced(q.trim());
  // the firm's name is known: a firm picked on this device is known before the list of firms comes
  const scopeKnown = typeof firmId !== "number" || firms.some((f) => f.id === firmId);
  // so the figures wait for its name as well as its id (or for that list to fail), and never show under another name
  const filters: CustomerListFilters = { firmId: scopeKnown || firmsFailed ? firmId : null, from: period.from, to: period.to, q: term, gst, state, usualFirm: usual, sort };
  const list = useCustomerList(filters);
  const everyone = useCustomerCount();
  const pages = list.data?.pages ?? [];
  const rows = once(pages.flatMap((p) => p.rows));
  const count = pages[0]?.count ?? 0;
  const summary = pages[0]?.summary ?? null;
  const chips = [
    gst !== "any" ? { key: "gst", label: gst === "yes" ? "Has GSTIN" : "No GSTIN", clear: () => setGst("any") } : null,
    state ? { key: "state", label: stateTitle(state), clear: () => setState("") } : null,
    usual !== null ? { key: "usual", label: `Usually billed by ${firms.find((f) => f.id === usual)?.short ?? "a firm"}`, clear: () => setUsual(null) } : null,
  ].filter((c): c is { key: string; label: string; clear: () => void } => c !== null);
  const clearAll = () => { setQ(""); setGst("any"); setState(""); setUsual(null); };
  // what the rows on screen answer: the search as it was asked (once typing paused), and the filters
  const describe = [...chips.map((c) => c.label), term ? `matching “${term}”` : ""].filter(Boolean).join(", ");
  // rows are on screen: fresh, kept while a new search or filter asks, or kept after asking again failed
  const ready = list.data !== undefined;
  // the customer just added comes first and flashes, even when its place in the order is further down
  const justSaved = useJustSaved("customer");
  const waiting = justSaved !== null && ready && !rows.some((r) => r.id === justSaved) && !describe;
  const saved = useCustomer(waiting ? justSaved : null);
  const shown: CustomerRow[] = waiting && saved.data ? [{ ...saved.data, figures: null }, ...rows.slice(0, Math.max(0, rows.length - 1))] : rows;
  const total = everyone.data ?? count;
  return {
    firms, firmId, setFirmId, period, q, setQ, term, gst, setGst, state, setState, usual, setUsual, sort, setSort, list, shown, count, total, summary,
    chips, clearAll, describe, justSaved, ready, offline: net === "offline",
    // Export asks for the list's own filters, once it can ask, and names the firm its figures are for; without the
    // list of firms it waits even for all firms, as the file names each customer's usual firms
    exportable: ready && scopeKnown && !firmsFailed,
    params: filters.firmId === null ? null : customerListParams(filters), scope: scopeName(firms, firmId), home: homeState(firms, firmId),
  };
}
type D = ReturnType<typeof useCustomersPage>;

export default function Customers() {
  const { isPhone } = useView();
  const d = useCustomersPage();
  return isPhone ? <PhoneCustomers d={d} /> : <DesktopCustomers d={d} />;
}

/** Every customer the filters match, as a CSV file, and a message saying what it holds. */
function useExport(d: D) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!d.params || !d.exportable) return;
    setBusy(true);
    try {
      const all = await fetchAllCustomers(d.params);
      const name = `Customers_${todayIST()}.csv`;
      downloadFile(new Blob([customersCsv(all, d.firms, `${d.period.label} · ${d.scope}`)], { type: "text/csv;charset=utf-8" }), name);
      show({ title: `Downloaded ${name}`, body: `${plural(all.length, "customer")}${d.describe ? ` (${d.describe})` : ""} · name, phone, GSTIN, state, address, firms, and sales for ${d.period.label}, ${d.scope}.` });
    } catch (e) {
      const p = problemOf(e);
      const network = p.kind === "offline" || p.kind === "unreachable" || p.kind === "server";
      // failText's titles ("Not exported: you're offline"); an export changes nothing, so the body says what didn't happen
      show({ tone: "neg", title: failText(p, "exported").title, body: network ? `The file didn't download. ${p.kind === "offline" ? "Try again when the internet is back." : "Try again in a minute."}` : p.message });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * The list as QueryView sees it. A Show more that failed leaves the query in error with every row it had: MoreButton says
 * so and asks for that page again, so to QueryView it's the rows, loaded (its Try again would re-ask only the pages already
 * on screen, and call it a failed refresh).
 */
function viewOf(list: D["list"]): D["list"] {
  if (!list.isFetchNextPageError) return list;
  return { ...list, status: "success", isSuccess: true, isError: false, error: null, isLoadingError: false, isRefetchError: false, isFetchNextPageError: false, isFetchPreviousPageError: false };
}

/**
 * The list's loading, slow, offline and failure states are the kit's QueryView's: rows to come, "Still loading" after
 * 1.4 s (not while the list waits for the firm), offline even before the firm is known, a failure with Try again, and
 * rows already showing kept, saying why, when asking again fails. A new search or filter keeps the rows on screen until
 * its answer comes; offline, that answer waits for the internet, so the rows say they're from before.
 */
function Loaded({ d, children }: { d: D; children: ReactNode }) {
  const held = d.list.isPlaceholderData && d.list.isPaused;
  return (
    <QueryView query={viewOf(d.list)} what="customers" skeleton={<ListSkeleton rows={8} what="customers" />}>
      {() => <>{held ? <StaleNote problem={OFFLINE} what="customers" /> : null}{children}</>}
    </QueryView>
  );
}

/** Show more, while the server has a next page; one that failed says why at the button, which asks for that page again. */
function More({ d }: { d: D }) {
  if (!d.list.hasNextPage) return null;
  return (
    <MoreButton shown={d.shown.length} total={d.count} what="customers" pageSize={LIST_PAGE} onMore={() => void d.list.fetchNextPage()} loading={d.list.isFetchingNextPage}
      problem={d.list.isFetchNextPageError ? problemOf(d.list.error) : null} />
  );
}

function NoMatch({ d }: { d: D }) {
  const { can } = useAuth();
  // the words are the answer's on screen: the search as it was asked, so a box just cleared doesn't read as a shop with
  // no customers while the list comes back
  const q = d.term;
  if (!q && !d.chips.length) {
    // rows kept from other filters while the list comes back: nothing to say about them
    if (d.list.isPlaceholderData) return null;
    return (
      <EmptyState icon={Users} title="No customers yet" actions={can("customer.edit") ? <ButtonLink variant="primary" icon={UserPlus} to="/customers/new?from=list">Add customer</ButtonLink> : null}>
        Everyone you bill lists here. A name and phone are enough to start.
      </EmptyState>
    );
  }
  const looksLikePhone = /\d{3}/.test(q);
  return (
    <EmptyState icon={Search} title={q ? `No customer matches “${q}”` : "No customers match these filters"}
      actions={<>
        <Button onClick={d.clearAll}>Clear search and filters</Button>
        {q && can("customer.edit") ? <ButtonLink variant="primary" icon={UserPlus} to={`/customers/new?from=list&${looksLikePhone ? "phone" : "name"}=${encodeURIComponent(q)}`}>{`Add “${q}” as a customer`}</ButtonLink> : null}
      </>}>
      Search looks at names, phone numbers and GSTINs{d.chips.length ? `, inside the filters: ${d.chips.map((c) => c.label).join(", ")}` : ""}.
    </EmptyState>
  );
}

/* ── Desktop ───────────────────────────────────────────── */
function DesktopCustomers({ d }: { d: D }) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const exp = useExport(d);
  const failed = d.list.isError && !d.list.data;
  const away = d.offline ? "Needs the internet" : "Waits for the list to load";
  const firmCol = typeof d.firmId === "number" ? ` · ${scopeName(d.firms, d.firmId, true)}` : "";
  return (
    <Page icon={Users} title="Customers"
      context={d.ready ? `${plural(d.total, "customer")} · sales figures for ${d.period.label} (${d.period.range}), ${d.scope}` : d.offline ? "Waiting for the internet" : failed ? "The list didn't load" : "Loading the list…"}
      actions={<>
        {can("customer.edit") ? (d.ready ? <ButtonLink to="/import?type=customers" icon={Upload}>Import</ButtonLink> : <Button icon={Upload} disabled title={away}>Import</Button>) : null}
        <Button icon={Download} onClick={() => void exp.run()} loading={exp.busy} disabled={!d.exportable} title={d.exportable ? "A spreadsheet of the customers shown below" : d.ready ? NO_FIRMS : away}>{d.ready ? `Export ${plural(d.count, "customer")}` : "Export"}</Button>
        {can("customer.edit") && !failed
          ? <ButtonLink to="/customers/new?from=list" variant="primary" icon={UserPlus}>Add customer</ButtonLink>
          : <Button variant="primary" icon={UserPlus} disabled title={failed ? away : whyNot("customer.edit", "add customers")}>Add customer</Button>}
      </>}>
      {!can("customer.edit") ? <WhyNote className="-mt-3">{whyNot("customer.edit", "add or change customers")}</WhyNote> : null}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
          <SearchInput value={d.q} onChange={d.setQ} placeholder="Name, phone or GSTIN" label="Search customers (press /)" className="w-[300px]" data-page-search="" />
          <Segmented label="GSTIN" options={GST_OPTS} value={d.gst} onChange={d.setGst} />
          <Select aria-label="State" value={d.state} onChange={(e) => d.setState(e.target.value)} className="w-[190px]" options={[{ value: "", label: "All states" }, ...stateOptions(d.home)]} />
          <Select aria-label="Usually billed by" value={d.usual === null ? "" : String(d.usual)} onChange={(e) => d.setUsual(e.target.value ? Number(e.target.value) : null)} className="w-[230px]"
            options={[{ value: "", label: "Usually billed by any firm" }, ...d.firms.map((f) => ({ value: String(f.id), label: `Usually billed by ${f.short}` }))]} />
          <div className="flex-1" />
          <Select aria-label="Sort" value={d.sort} onChange={(e) => d.setSort(e.target.value as CustomerSort)} className="w-[200px]" options={SORTS.map((s) => ({ value: s.value, label: `Sort: ${s.label}` }))} />
        </div>
        <div className={IN_CARD}>
          <Loaded d={d}>
            <div className="px-5 pb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm border-b border-rule">
              <p className="text-fg2">
                <span className="font-semibold text-fg">{d.count === d.total ? plural(d.count, "customer") : `${d.count} of ${plural(d.total, "customer")} match`}</span>
                {d.describe ? <span> · {d.describe}</span> : null}
                {d.describe ? <button type="button" onClick={d.clearAll} className="link ml-2">Clear</button> : null}
              </p>
              {d.summary ? (
                <p className="text-muted">
                  Their sales · {d.period.label} · {d.scope}: <Money value={d.summary.total} strong className="text-fg" /> in {plural(d.summary.bills, "bill")}{notCounted(d.summary.cancelled)}
                  {" · "}billed on udhaar: {plural(d.summary.udhaar_bills, "bill")}, <Money value={d.summary.udhaar_total} className="text-fg2" />
                </p>
              ) : null}
            </div>
            {d.shown.length ? (
              <Table label="Customers">
                <thead>
                  <tr>
                    <Th>Customer</Th><Th className="hidden xl:table-cell">GSTIN · state</Th>
                    <Th align="right">Sales · {d.period.label}{firmCol}</Th>
                    <Th align="right">Bills</Th><Th>Last bill</Th><Th align="right">Billed on udhaar</Th>
                    <Th className="w-12"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {d.shown.map((c) => {
                    const f = c.figures;
                    // compared in the GST table's spelling, so a "Rajasthan" stored by hand isn't another state
                    const igst = Boolean(d.home) && Boolean(c.state_name) && tableState(c.state_name) !== d.home;
                    const open = () => navigate(`/customers/${c.id}`);
                    return (
                      <Tr key={c.id} data-row={c.id} tabIndex={-1} onClick={open} onKeyDown={openOnEnter(open)} className={cn("row-focus outline-none", c.id === d.justSaved && "anim-flash")}>
                        <Td>
                          <span className="flex items-center gap-2">
                            <Link to={`/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand">{c.name}</Link>
                            {c.type === "walkin" ? <Badge>Cash sales without a name</Badge> : null}
                          </span>
                          <span className="block text-xs text-muted tnum mt-0.5">{mobileText(c.mobile_number) || (c.type === "walkin" ? "No name or phone kept" : "No phone")}<span className="xl:hidden">{c.gst_number ? ` · ${c.gst_number}` : ""}{igst ? ` · ${stateTitle(c.state_name)}, IGST` : ""}</span></span>
                        </Td>
                        <Td className="hidden xl:table-cell">
                          {c.gst_number ? <span className="tnum">{c.gst_number}</span> : <span className="text-muted">No GSTIN</span>}
                          <span className="block text-xs text-muted mt-0.5">{stateTitle(c.state_name) || "No state"}{igst ? " · IGST on bills" : ""}</span>
                        </Td>
                        <Td align="right">{f?.bills ? <Money value={f.total} /> : <span className="text-muted">No bills</span>}</Td>
                        <Td align="right">{f?.bills || <span className="text-muted">0</span>}</Td>
                        <Td>{f?.last_bill ? <><span className="block tnum">{date(f.last_bill.invoice_date)}</span><span className="block text-xs text-muted tnum mt-0.5">{f.last_bill.invoice_number}</span></> : <span className="text-muted">No bills yet</span>}</Td>
                        <Td align="right">{f?.udhaar_bills ? <><Money value={f.udhaar_total} /><span className="block text-xs text-muted mt-0.5">{plural(f.udhaar_bills, "bill")}</span></> : <span className="text-muted">None</span>}</Td>
                        <Td onClick={(e) => e.stopPropagation()}><CustomerRowMenu c={c} last={f?.last_bill ?? null} /></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : <NoMatch d={d} />}
            <More d={d} />
          </Loaded>
        </div>
      </Card>
      <p className="text-sm text-muted">“Billed on udhaar” counts bills marked udhaar when they were made. The app doesn't record payments received, so it never shows what a customer still owes.</p>
    </Page>
  );
}

/* ── Phone ─────────────────────────────────────────────── */
function PhoneCustomers({ d }: { d: D }) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const exp = useExport(d);
  const [sheet, setSheet] = useState(false);
  const failed = d.list.isError && !d.list.data;
  const sortLabel = SORTS.find((s) => s.value === d.sort)!.label;
  const chip = "inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full border whitespace-nowrap shrink-0 transition-[background-color,border-color,transform] duration-150 active:scale-[0.97]";
  return (
    <Page title="Customers" phoneSubtitle={d.ready ? `${plural(d.total, "customer")} · ${d.period.label} sales · ${scopeName(d.firms, d.firmId, true)}` : d.offline ? "Waiting for the internet" : failed ? "The list didn't load" : "Loading…"}
      phoneActions={<Menu title="Customers" items={[
        { label: "Import customers", icon: Upload, disabled: !can("customer.edit"), hint: can("customer.edit") ? "From a spreadsheet, with a check before anything is added" : whyNot("customer.edit", "import customers"), onSelect: () => navigate("/import?type=customers") },
        { label: d.ready ? `Export ${plural(d.count, "customer")}` : "Export", icon: Download, disabled: !d.exportable || exp.busy, hint: d.exportable ? d.describe || "Everyone in the list" : d.ready ? NO_FIRMS : "Waits for the list to load", onSelect: () => void exp.run() },
      ]} trigger={(p) => <IconButton {...p} label="Import or export customers" icon={MoreVertical} />} />}
      actionBar={can("customer.edit") ? (failed ? <Button variant="primary" size="lg" icon={UserPlus} disabled title="Needs the internet">Add customer</Button> : <ButtonLink to="/customers/new?from=list" variant="primary" size="lg" icon={UserPlus}>Add customer</ButtonLink>) : null}>
      <SearchInput value={d.q} onChange={d.setQ} placeholder="Name, phone or GSTIN" label="Search customers" data-page-search="" />
      <FirmChips firms={d.firms} value={d.firmId} onChange={d.setFirmId} />
      <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar">
        <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog" className={cn(chip, d.chips.length ? "bg-brand-sel border-brand text-brand font-semibold" : "bg-card border-line text-fg2")}>
          <SlidersHorizontal size={16} aria-hidden="true" />Filters{d.chips.length ? ` · ${d.chips.length}` : ""}
        </button>
        <Menu title="Sort customers" items={SORTS.map((s) => ({ label: s.label, checked: s.value === d.sort, onSelect: () => d.setSort(s.value) }))}
          trigger={(p) => <button {...p} type="button" className={cn(chip, "bg-card border-line text-fg2")}><ArrowUpDown size={16} aria-hidden="true" />{sortLabel}</button>} />
        {d.chips.map((f) => (
          <button key={f.key} type="button" onClick={f.clear} aria-label={`Remove filter: ${f.label}`} className={cn(chip, "bg-brand-sel border-brand text-brand font-semibold")}>
            {f.label}<X size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
      {!can("customer.edit") ? <WhyNote>{whyNot("customer.edit", "add or change customers")}</WhyNote> : null}
      <Loaded d={d}>
        <div className="flex flex-col gap-0.5 text-sm">
          <p className="text-fg2"><span className="font-semibold text-fg">{d.count === d.total ? plural(d.count, "customer") : `${d.count} of ${d.total} match`}</span>{d.describe ? ` · ${d.describe}` : ""}</p>
          {d.summary ? <p className="text-muted">Their sales · {d.period.label}: <Money value={d.summary.total} className="text-fg" /> in {plural(d.summary.bills, "bill")}{notCounted(d.summary.cancelled)}</p> : null}
        </div>
        <Card pad={false}>
          {d.shown.length ? d.shown.map((c) => {
            const f = c.figures;
            return (
              <div key={c.id} data-row={c.id} tabIndex={-1} onKeyDown={openOnEnter(() => navigate(`/customers/${c.id}`))}
                className={cn("flex items-center border-t border-rule first:border-t-0 outline-none row-focus", c.id === d.justSaved && "anim-flash")}>
                <ListRow to={`/customers/${c.id}`} className="!border-t-0 flex-1 min-w-0 !pr-1" chevron={false} title={c.name}
                  subtitle={c.type === "walkin" ? "Cash sales without a name" : `${mobileText(c.mobile_number) || "No phone"} · ${f?.last_bill ? `last ${dateShort(f.last_bill.invoice_date)}` : "no bills yet"}`}
                  right={f?.bills ? <Money value={f.total} /> : <span className="text-muted">No bills</span>}
                  rightSub={f?.bills ? `${plural(f.bills, "bill")}${f.udhaar_bills ? ` · ${f.udhaar_bills} udhaar` : ""}` : d.period.label} />
                <span className="pr-1 shrink-0"><CustomerRowMenu c={c} last={f?.last_bill ?? null} /></span>
              </div>
            );
          }) : <NoMatch d={d} />}
          <More d={d} />
        </Card>
      </Loaded>
      <p className="text-sm text-muted">Udhaar counts bills marked udhaar when made. Payments received aren't recorded, so no balance is shown.</p>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filter customers"
        footer={<><Button onClick={d.clearAll}>Clear all</Button><Button variant="primary" onClick={() => setSheet(false)}>{`Show ${plural(d.count, "customer")}`}</Button></>}>
        <div className="flex flex-col gap-4">
          <Field label="GSTIN"><Segmented full label="GSTIN" options={GST_OPTS} value={d.gst} onChange={d.setGst} /></Field>
          <Field label="State" htmlFor="cf-state">
            <Select id="cf-state" value={d.state} onChange={(e) => d.setState(e.target.value)} options={[{ value: "", label: "All states" }, ...stateOptions(d.home)]} />
          </Field>
          <Field label="Usually billed by" htmlFor="cf-by" hint="Customers whose usual firms include it">
            <Select id="cf-by" value={d.usual === null ? "" : String(d.usual)} onChange={(e) => d.setUsual(e.target.value ? Number(e.target.value) : null)} options={[{ value: "", label: "Any firm" }, ...d.firms.map((f) => ({ value: String(f.id), label: f.name }))]} />
          </Field>
        </div>
      </Sheet>
    </Page>
  );
}
