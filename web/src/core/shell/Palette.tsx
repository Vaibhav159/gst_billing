// Search (Ctrl K, and Today's Search on a phone): pages, actions, the records opened lately, and customers, sales
// bills, products and firms. Ported from PROTO/core/shell.jsx (Palette).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, Camera, CornerDownLeft, FileText, Landmark, LayoutDashboard, Package, Plus, ReceiptText, Search, ShoppingBag, Truck, UserRound, Users, type LucideIcon } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, inr, mobileText, pct, toPaise } from "@/core/format";
import { useFirms, type Firm } from "@/core/scope";
import { Button, Dialog, Kbd, optionClass } from "@/core/ui";
import { useView } from "@/core/view";
import { ALT, DESKTOP_NAV, MORE_NAV } from "./nav";
import { recentVisits } from "./recent";

/** A row: where it goes, under which heading. Actions show their hint as a key; other rows as a second line. */
type Result = { group: string; label: string; hint?: string; icon?: LucideIcon; to: string };

const PAGE_ICON: Record<string, LucideIcon> = { dashboard: LayoutDashboard, sales: ReceiptText, purchases: ShoppingBag, customers: Users, gst: Landmark, reports: BarChart3 };
/** An opened record's icon, by the first part of its address. */
const RECENT_ICON: Record<string, LucideIcon> = { sales: FileText, customers: UserRound, purchases: ShoppingBag, products: Package, suppliers: Truck };

/** search/quick/'s answer (billing/api/search.py, v2's search too): customers with their latest bills, bills by number, products. */
type QuickBill = { id: number; invoice_number: string; invoice_date: string; total_amount: string; type_of_invoice: string };
type Quick = {
  customers: { id: number; name: string; gst_number: string; mobile_number: string; recent_invoices: QuickBill[] }[];
  invoices: (QuickBill & { customer_name: string })[];
  // gst_tax_rate: a fraction as a string ("0.0300"); a server from before v3 doesn't send it
  products: { id: number; name: string; hsn_code: string; gst_tax_rate?: string }[];
};

// ponytail: bills come newest first from what the server found by number, so "31" doesn't put KGH/2026-27/31 ahead of
// /131 as the prototype did. Upgrade: rank an exact bill number first on the server (part 1's bill search).
/** The server's records as rows: customers; sales bills by number or by a customer found, newest first; products. */
function recordRows(d: Quick): Result[] {
  const rows: Result[] = d.customers.map((c) => ({ group: "Customers", label: c.name, icon: UserRound, hint: mobileText(c.mobile_number) || c.gst_number || "Customer", to: `/customers/${c.id}` }));
  // the prototype's "bills by number or customer": sales only, each once
  const bills = new Map<number, QuickBill & { customer_name: string }>();
  for (const b of d.invoices) if (b.type_of_invoice === "outward") bills.set(b.id, b);
  for (const c of d.customers) for (const b of c.recent_invoices) if (b.type_of_invoice === "outward" && !bills.has(b.id)) bills.set(b.id, { ...b, customer_name: c.name });
  const newest = [...bills.values()].sort((a, b) => (a.invoice_date === b.invoice_date ? b.id - a.id : a.invoice_date < b.invoice_date ? 1 : -1));
  for (const b of newest.slice(0, 5)) rows.push({ group: "Sales bills", label: b.invoice_number, icon: FileText, hint: `${b.customer_name} · ${date(b.invoice_date)} · ${inr(toPaise(b.total_amount))}`, to: `/sales/${b.id}` });
  for (const p of d.products.slice(0, 3)) rows.push({ group: "Products", label: p.name, icon: Package, hint: `HSN ${p.hsn_code}${p.gst_tax_rate == null ? "" : ` · GST ${pct(Number(p.gst_tax_rate))}`}`, to: `/products/${p.id}` });
  return rows;
}

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
  // the server is asked about what's typed once it has rested 250 ms, from two characters: one request per term, kept
  // 30 s, and a newer term cancels the one still out. Nothing asks on a timer (the database is Neon's free plan)
  useEffect(() => { const t = setTimeout(() => setTerm(text), 250); return () => clearTimeout(t); }, [text]);
  const search = useQuery({
    queryKey: ["search", term],
    queryFn: async ({ signal }) => (await api.get("search/quick/", { params: { q: term }, signal })).data as Quick,
    enabled: open && term.length >= 2,
    // a search that fails says so at once: no retry, and offline it still asks (and fails) instead of waiting
    retry: false, networkMode: "always", staleTime: 30_000,
  });
  // the answer for what's in the box now (an older term's rows never stand in for it); a failure is all of it, and the
  // reason shows again only once Try again has had its answer
  const current = open && text.length >= 2 && term === text;
  const records = current && search.data && !search.isError ? search.data : null;
  const problem = current && search.isError && search.fetchStatus !== "fetching" ? problemOf(search.error) : null;
  const settled = Boolean(records || problem);
  const meId = me?.id;
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
      ...DESKTOP_NAV.filter((n) => !n.need || can(n.need)).map((n) => ({ group: "Pages", label: n.label, icon: PAGE_ICON[n.section], to: n.to })),
      ...MORE_NAV.filter((n) => !n.need || can(n.need)).map((n) => ({ group: "Pages", label: n.label, icon: n.icon, to: n.to })),
    ];
    const match = (s: string) => !t || s.toLowerCase().includes(t);
    if (!t) {
      // what people come back for first: what they opened last
      const out: Result[] = [];
      const recent = meId == null ? [] : recentVisits(meId).filter((v) => typeof v?.to === "string" && typeof v.label === "string");
      for (const v of recent.slice(0, 5)) out.push({ group: "Opened recently", label: v.label || v.to, icon: RECENT_ICON[v.to.split("/")[1] ?? ""], to: v.to });
      out.push(...actions);
      out.push(...pages);
      return out.slice(0, 24);
    }
    const out = [...actions.filter((a) => match(a.label)), ...pages.filter((p) => match(p.label))];
    // the records come in together, once the server has answered for this text (or couldn't: the firms are this app's own)
    if (settled) out.push(...(records ? recordRows(records) : []), ...firmRows(firms, t));
    return out.slice(0, 24);
  }, [open, q, can, meId, records, settled, firms]);
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
  const retry = () => { input.current?.focus(); void search.refetch(); };
  let lastGroup: string | null = null;
  return (
    <Dialog open={open} onClose={onClose} title="Search" size="md" initialFocus={input}
      footer={isPhone ? null : <p className="text-xs text-muted flex items-center gap-3 w-full"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span><span className="ml-auto">Type a name, phone, bill number or page</span></p>}>
      <div className="flex flex-col gap-3 -mt-1">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={results[i] ? `pal-${i}` : undefined} aria-label="Search customers, bills and pages"
            value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} onKeyDown={onKey}
            placeholder="Customer, phone, bill number or a page" className="ctl pl-11" />
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
                  {r.icon ? <r.icon size={18} className="shrink-0 text-fg2" aria-hidden="true" /> : null}
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
