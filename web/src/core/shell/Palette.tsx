// Search (Ctrl K, and Today's Search on a phone): pages, actions, the records opened lately, today's bills, and
// customers, sales bills, deleted bills, products and firms. Ported from PROTO/core/shell.jsx (Palette).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Camera, CornerDownLeft, FileText, FileX, Package, Plus, Search, ShoppingBag, Truck, UserRound, type LucideIcon } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useBin, useTodaysBills } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, dateShort, inr, mobileText, pct, toPaise, todayIST } from "@/core/format";
import { sameNumber } from "@/core/sales/numbers";
import type { BinRow } from "@/core/sales/types";
import { cancelledMark, dayOf, timeOf } from "@/core/sales/words";
import { useFirms, type Firm } from "@/core/scope";
import { Button, Dialog, Kbd, optionClass } from "@/core/ui";
import { useView } from "@/core/view";
import { ALT, DESKTOP_NAV, MORE_NAV, NAV_ICON } from "./nav";
import { recentVisits } from "./recent";
import { newBillFor, rankBills, suggestions } from "./suggest";

/** A row: where it goes, under which heading. Actions show their hint as a key; other rows as a second line. */
type Result = { group: string; label: string; hint?: string; icon?: LucideIcon; to: string };

/** An opened record's icon, by the first part of its address. */
const RECENT_ICON: Record<string, LucideIcon> = { sales: FileText, customers: UserRound, purchases: ShoppingBag, products: Package, suppliers: Truck };

/** search/quick/'s answer (billing/api/search.py, v2's search too): customers with their latest bills, bills by number (status, paper and firm with part 1), products. */
type QuickBill = { id: number; invoice_number: string; invoice_date: string; total_amount: string; type_of_invoice: string; status?: string };
type Quick = {
  customers: { id: number; name: string; gst_number: string; mobile_number: string; recent_invoices: QuickBill[] }[];
  invoices: (QuickBill & { customer_name: string })[];
  // gst_tax_rate: a fraction as a string ("0.0300"); a server from before v3 doesn't send it
  products: { id: number; name: string; hsn_code: string; gst_tax_rate?: string }[];
};

/**
 * The server's records as rows: customers; sales bills by number or by a customer found, each once, the exact number
 * first then the newest (rankBills); deleted bills (the owner's), each opening its page to restore; products. A bill
 * whose number is exactly what's typed puts the bills ahead of the customers: a plain number ("34", a paper bill's) is
 * also in customers' phone numbers, and Enter opens the first row.
 */
function recordRows(d: Quick, term: string, deleted: BinRow[]): Result[] {
  const customers: Result[] = d.customers.map((c) => ({ group: "Customers", label: c.name, icon: UserRound, hint: mobileText(c.mobile_number) || c.gst_number || "Customer", to: `/customers/${c.id}` }));
  // the prototype's "bills by number or customer": sales only, each once
  const bills = new Map<number, QuickBill & { customer_name: string }>();
  for (const b of d.invoices) if (b.type_of_invoice === "outward") bills.set(b.id, b);
  for (const c of d.customers) for (const b of c.recent_invoices) if (b.type_of_invoice === "outward" && !bills.has(b.id)) bills.set(b.id, { ...b, customer_name: c.name });
  const ranked = rankBills([...bills.values()], term).slice(0, 5);
  const sales: Result[] = ranked.map((b) => ({ group: "Sales bills", label: b.invoice_number, icon: FileText, hint: `${b.customer_name} · ${date(b.invoice_date)} · ${inr(toPaise(b.total_amount))}${cancelledMark(b.status)}`, to: `/sales/${b.id}` }));
  const rows = ranked.some((b) => sameNumber(b.invoice_number, term)) ? [...sales, ...customers] : [...customers, ...sales];
  // deleted bills can still be found: their page offers Restore (PROTO core/shell.jsx:493-496)
  for (const s of deleted) rows.push({ group: "Deleted bills", label: s.invoice_number, icon: FileX, hint: `deleted ${dateShort(dayOf(s.deleted_at))} · ${s.customer.name} · open it to restore`, to: `/sales/${s.original_id}` });
  for (const p of d.products.slice(0, 3)) rows.push({ group: "Products", label: p.name, icon: Package, hint: `HSN ${p.hsn_code}${p.gst_tax_rate == null ? "" : ` · GST ${pct(Number(p.gst_tax_rate))}`}`, to: `/products/${p.id}` });
  return rows;
}

const NO_BINS: BinRow[] = [];

/** The firms matching t, by name or GSTIN: the app's own list (useFirms), so nothing is asked for them. */
function firmRows(firms: Firm[], t: string): Result[] {
  return firms.filter((f) => f.name.toLowerCase().includes(t) || f.gstin.toLowerCase().includes(t)).slice(0, 3)
    .map((f) => ({ group: "Firms", label: f.name, icon: Building2, hint: f.gstin || undefined, to: `/firms/${f.id}` }));
}

/** Why the server's records weren't searched, in the app's words (LoadError's). */
function troubleText(p: ApiProblem): string {
  if (p.kind === "offline") return "You're offline, so customers, bills and products can't be searched.";
  if (p.kind === "unreachable" || p.kind === "server") return "The app couldn't reach the shop's records just now, so customers, bills and products weren't searched.";
  return p.message;
}

export function Palette({ open, onClose }: { open: boolean; onClose(): void }) {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isPhone } = useView();
  const { firms } = useFirms();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [term, setTerm] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // a fresh box each time, cleared as search closes: cleared as it opened instead, keys typed at once would land after
  // the last search's words (the dialog puts the cursor in the box as it opens)
  useEffect(() => { if (!open) { setQ(""); setI(0); setTerm(""); } }, [open]);
  const text = q.trim();
  // what the server is asked for: the name in "new anil"; a phone number typed in groups ("98290 41122") as the digits
  // it keeps; a hyphen stays ("2026-27")
  const named = newBillFor(text) ?? text;
  const asked = /^\d[\d ]*\d$/.test(named) ? named.replace(/ /g, "") : named;
  // the server is asked about what's typed once it has rested 250 ms, from two characters: one request per term, kept
  // 30 s, and a newer term cancels the one still out. Nothing asks on a timer (the database is Neon's free plan)
  useEffect(() => { const t = setTimeout(() => setTerm(asked), 250); return () => clearTimeout(t); }, [asked]);
  const search = useQuery({
    queryKey: ["search", term],
    queryFn: async ({ signal }) => (await api.get("search/quick/", { params: { q: term }, signal })).data as Quick,
    enabled: open && term.length >= 2,
    // a search that fails says so at once: no retry, and offline it still asks (and fails) instead of waiting
    retry: false, networkMode: "always", staleTime: 30_000,
  });
  // deleted bills, for whoever may restore them (design §6: bill.delete): search/quick/ doesn't hold the bin, so it's a
  // second request per term, once typing has paused, through the app's one bin reader (Ruling 1B-9), kept 30 s
  const canBin = can("bill.delete");
  const bin = useBin({ q: term, page_size: 3 }, open && canBin && term.length >= 2);
  // today's newest bills, for the empty box: asked once as search opens and kept 30 s, never on a timer (Neon's free
  // plan), nor again as the box is emptied
  const today = useTodaysBills(open);
  // the answer for what's in the box now (an older term's rows never stand in for it); a failure is all of it, and the
  // reason shows again only once Try again has had its answer
  const current = open && asked.length >= 2 && term === asked;
  const records = current && search.data && !search.isError ? search.data : null;
  const problem = current && search.isError && search.fetchStatus !== "fetching" ? problemOf(search.error) : null;
  // the deleted bills come with the records, never after them (a failure there leaves them out; asked for again, a
  // failure with nothing loaded is pending once more, so the records wait for that answer too)
  const binDone = !canBin || bin.isError || bin.data !== undefined;
  const deleted = current && canBin && bin.data ? bin.data.results : NO_BINS;
  const settled = Boolean(records || problem) && (Boolean(problem) || binDone);
  const meId = me?.id;
  const todays = today.data;
  const results = useMemo(() => {
    if (!open) return [];
    const t = q.trim().toLowerCase();
    const actions = ([
      can("bill.create") && { group: "Actions", label: "New sales bill", hint: `${ALT} N`, icon: Plus, to: "/sales/new" },
      can("bill.create") && { group: "Actions", label: "Enter bills from the paper book", icon: FileText, to: "/sales/paper" },
      can("capture") && { group: "Actions", label: "Capture a supplier's bill", icon: Camera, to: "/purchases/capture" },
      can("purchase.create") && { group: "Actions", label: "Add a purchase by hand", hint: `${ALT} P`, icon: ShoppingBag, to: "/purchases/new" },
      can("customer.edit") && { group: "Actions", label: "Add a customer", icon: UserRound, to: "/customers/new" },
      can("product.edit") && { group: "Actions", label: "Add a product", icon: Package, to: "/products/new" },
    ] as (Result | false)[]).filter((a): a is Result => Boolean(a));
    const pages: Result[] = [
      ...DESKTOP_NAV.filter((n) => !n.need || can(n.need)).map((n) => ({ group: "Pages", label: n.label, icon: NAV_ICON[n.section], to: n.to })),
      ...MORE_NAV.filter((n) => !n.need || can(n.need)).map((n) => ({ group: "Pages", label: n.label, icon: n.icon, to: n.to })),
    ];
    const match = (s: string) => !t || s.toLowerCase().includes(t);
    if (!t) {
      // what people come back for first: what they opened last, then today's bills after the actions
      const out: Result[] = [];
      const recent = meId == null ? [] : recentVisits(meId).filter((v) => typeof v?.to === "string" && typeof v.label === "string");
      for (const v of recent.slice(0, 5)) out.push({ group: "Opened recently", label: v.label || v.to, icon: RECENT_ICON[v.to.split("/")[1] ?? ""], to: v.to });
      out.push(...actions);
      for (const b of (todays ?? []).slice(0, 3)) {
        out.push({ group: "Today's bills", label: b.invoice_number, icon: FileText, hint: `${b.customer.name} · ${b.paper ? "paper bill" : timeOf(b.created_at)} · ${inr(b.total_amount)}${cancelledMark(b.status)}`, to: `/sales/${b.id}` });
      }
      out.push(...pages);
      return out.slice(0, 24);
    }
    // words that go straight to a list come first ("udhaar sep", "kiran gstr1", "new anil")
    const out: Result[] = [...suggestions(q, { firms, today: todayIST(), canCreate: can("bill.create"), customers: records?.customers ?? [] }), ...actions.filter((a) => match(a.label)), ...pages.filter((p) => match(p.label))];
    // the records come in together, once the server has answered for this text (or couldn't: the firms are this app's own)
    if (settled) out.push(...(records ? recordRows(records, asked, deleted) : []), ...firmRows(firms, t));
    return out.slice(0, 24);
  }, [open, q, can, meId, records, settled, firms, todays, asked, deleted]);
  const go = (r: Result) => { onClose(); navigate(r.to); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.max(0, Math.min(results.length - 1, x + 1))); }
    if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    if (e.key === "Home") { e.preventDefault(); setI(0); }
    if (e.key === "End") { e.preventDefault(); setI(Math.max(0, results.length - 1)); }
    if (e.key === "Enter" && results[i]) { e.preventDefault(); go(results[i]); }
  };
  useEffect(() => { document.getElementById(`pal-${i}`)?.scrollIntoView({ block: "nearest" }); }, [i]);
  if (!open) return null;
  // what the box says above the rows: why records weren't searched, else (with no rows) what to do next
  const trouble = problem ? troubleText(problem) : null;
  const status = trouble ?? (results.length ? null
    : text.length < 2 ? "Keep typing to search customers and bills."
      : !settled ? "Searching…"
        : `Nothing matches “${q}”. Try a phone number, or a bill number like 31 or KGH/2026-27/31.`);
  // Try again asks through the client (Ruling 1B-11): this term's search, and its deleted bills when asking for them failed too
  const retry = () => {
    input.current?.focus();
    void qc.refetchQueries({ queryKey: ["search", term] });
    if (bin.isError) void qc.refetchQueries({ queryKey: ["bin"], type: "active", predicate: (x) => x.state.status === "error" });
  };
  let lastGroup: string | null = null;
  return (
    <Dialog open={open} onClose={onClose} title="Search" size="md" initialFocus={input}
      footer={isPhone ? null : <p className="text-xs text-muted flex items-center gap-3 w-full"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span><span className="ml-auto">Try “udhaar sep”, “kiran gstr1” or “new anil”</span></p>}>
      <div className="flex flex-col gap-3 -mt-1">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={results[i] ? `pal-${i}` : undefined} aria-label="Search customers, bills and pages"
            value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={onKey}
            placeholder="Customer, phone, bill number, a page, or “udhaar sep”" className="ctl pl-11" />
        </div>
        {status ? <p role="status" className={cn("px-3 text-center text-muted", trouble ? "pt-6 pb-1" : "py-6")}>{status}</p> : null}
        {trouble ? <div className="flex justify-center pb-3"><Button size="sm" onClick={retry}>Try again</Button></div> : null}
        <ul id="palette-list" role="listbox" aria-label="Results" className={cn("flex flex-col max-h-[52vh] overflow-y-auto -mx-2", !results.length && "hidden")}>
          {results.map((r, k) => {
            const head = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <li key={k} role="presentation">
                {head ? <p className="caps px-3 pt-3 pb-1" aria-hidden="true">{head}</p> : null}
                <div id={`pal-${k}`} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => go(r)}
                  className={cn("flex items-center gap-3 px-3 rounded-ctl cursor-pointer", isPhone ? "min-h-14" : "min-h-11", optionClass(k === i))}>
                  {r.icon ? <r.icon size={18} className={cn("shrink-0", r.group === "Deleted bills" ? "text-neg" : "text-fg2")} aria-hidden="true" /> : null}
                  <span className="flex-1 min-w-0"><span className="block truncate">{r.label}</span>{r.hint && r.group !== "Actions" ? <span className="block text-sm text-muted truncate">{r.hint}</span> : null}</span>
                  {r.group === "Actions" && r.hint && !isPhone ? <Kbd>{r.hint}</Kbd> : null}
                  {k === i && !isPhone ? <CornerDownLeft size={16} className="text-muted" aria-hidden="true" /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
