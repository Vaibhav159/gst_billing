// Search (Ctrl K, and the phone header's Search): pages, actions, the records opened lately, and customers, sales
// bills, products and firms from the server. Ported from PROTO/core/shell.jsx (Palette).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { BarChart3, Building2, Camera, CornerDownLeft, FileText, Landmark, LayoutDashboard, Package, Plus, ReceiptText, Search, ShoppingBag, Truck, UserRound, Users, type LucideIcon } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, inr, pct, toPaise } from "@/core/format";
import { Button, Dialog, Kbd, optionClass } from "@/core/ui";
import { useView } from "@/core/view";
import { ALT, DESKTOP_NAV, MORE_NAV } from "./nav";
import { recentVisits } from "./recent";

/** A row: where it goes, under which heading. Actions show their hint as a key; other rows as a second line. */
type Result = { group: string; label: string; hint?: string; icon?: LucideIcon; to: string };

const PAGE_ICON: Record<string, LucideIcon> = { dashboard: LayoutDashboard, sales: ReceiptText, purchases: ShoppingBag, customers: Users, gst: Landmark, reports: BarChart3 };
/** An opened record's icon, by the first part of its address. */
const RECENT_ICON: Record<string, LucideIcon> = { sales: FileText, customers: UserRound, purchases: ShoppingBag, products: Package, suppliers: Truck };

type ApiCustomer = { id: number; name: string; mobile_number?: string | null; gst_number?: string | null };
type ApiBill = { id: number; invoice_number: string; customer_name: string; invoice_date: string; total_amount: string | number };
type ApiProduct = { id: number; name: string; hsn_code: string; gst_tax_rate: string | number };
type ApiFirm = { id: number; name: string; gst_number?: string | null };

/** A list's rows: `results` when the API pages it, else the array itself. */
function rowsOf<T>(data: unknown): T[] {
  const d = data as { results?: unknown } | null;
  return (Array.isArray(d) ? d : Array.isArray(d?.results) ? d.results : []) as T[];
}

/** A mobile number as it's read: "9829041122" gives "98290 41122" (a +91 or 0 in front dropped). Anything else as typed. */
function mobileText(m: string | null | undefined): string {
  const s = (m ?? "").trim();
  const d = s.replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : s;
}

/** The server's answer for one search: its rows, and why any part of it failed. */
type Found = { q: string; rows: Result[]; problem: ApiProblem | null };

/**
 * Customers, sales bills, products and firms matching q, asked for together: one signal cancels all four. A part that
 * fails leaves the rest. Not through TanStack Query: a search is the box's passing state, and its defaults (paused
 * offline, one retry, a cached answer) would hold back the "you're offline" or "couldn't reach" the box must say at once.
 */
// ponytail: the server matches anywhere and lists bills newest first, so "31" doesn't put KGH/2026-27/31 ahead of /131
// as the prototype did. Upgrade: rank an exact bill number first on the server (part 1's bill search).
async function searchServer(q: string, signal: AbortSignal): Promise<Omit<Found, "q">> {
  const [cs, bs, ps, fs] = await Promise.allSettled([
    api.get("customers/", { params: { search: q, page_size: 5 }, signal }),
    api.get("invoices/", { params: { search: q, type_of_invoice: "outward", page_size: 5 }, signal }),
    api.get("products/", { params: { search: q, page_size: 3 }, signal }),
    api.get("businesses/", { params: { search: q, page_size: 3 }, signal }),
  ]);
  const rows: Result[] = [];
  if (cs.status === "fulfilled") for (const c of rowsOf<ApiCustomer>(cs.value.data)) rows.push({ group: "Customers", label: c.name, icon: UserRound, hint: mobileText(c.mobile_number) || c.gst_number || "Customer", to: `/customers/${c.id}` });
  if (bs.status === "fulfilled") for (const b of rowsOf<ApiBill>(bs.value.data)) rows.push({ group: "Sales bills", label: b.invoice_number, icon: FileText, hint: `${b.customer_name} · ${date(b.invoice_date)} · ${inr(toPaise(b.total_amount))}`, to: `/sales/${b.id}` });
  if (ps.status === "fulfilled") for (const p of rowsOf<ApiProduct>(ps.value.data)) rows.push({ group: "Products", label: p.name, icon: Package, hint: `HSN ${p.hsn_code} · GST ${pct(Number(p.gst_tax_rate))}`, to: `/products/${p.id}` });
  if (fs.status === "fulfilled") for (const f of rowsOf<ApiFirm>(fs.value.data)) rows.push({ group: "Firms", label: f.name, icon: Building2, hint: f.gst_number || undefined, to: `/firms/${f.id}` });
  const failed = [cs, bs, ps, fs].find((s): s is PromiseRejectedResult => s.status === "rejected");
  return { rows, problem: failed ? problemOf(failed.reason) : null };
}

/** Why the records weren't searched, in the app's words (LoadError's). */
function troubleText(p: ApiProblem): string {
  if (p.kind === "offline") return "You're offline, so customers and bills can't be searched.";
  if (p.kind === "unreachable" || p.kind === "server") return "The app couldn't reach the shop's records just now, so customers and bills weren't searched.";
  return p.message;
}

export function Palette({ open, onClose }: { open: boolean; onClose(): void }) {
  const { me, can } = useAuth();
  const navigate = useNavigate();
  const { isPhone } = useView();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  const [tries, setTries] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // a fresh box each time, cleared as search closes: cleared as it opened instead, keys typed at once would land after
    // the last search's words
    if (!open) { setQ(""); setI(0); setFound(null); return; }
    // ready to type in as it opens, not after the dialog's 20 ms timer. The dialog has noted what had focus by now (its
    // effects run before this one), so closing still returns there. Again once React's development double run of the
    // new dialog's effects is over: its cleanup hands focus back to the opener (a production build never does)
    const box = () => { if (input.current && document.activeElement !== input.current) input.current.focus({ preventScroll: true }); };
    box();
    queueMicrotask(box);
  }, [open]);
  const text = q.trim();
  // records come from the server, and only from typing: two characters or more, 250 ms after the last key. A newer
  // search cancels the one before; nothing asks on a timer (the database is Neon's free plan)
  useEffect(() => {
    if (!open || text.length < 2) return undefined;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      void searchServer(text, ctl.signal)
        .catch((e: unknown) => ({ rows: [], problem: problemOf(e) }))
        .then((r) => { if (!ctl.signal.aborted) setFound({ q: text, ...r }); });
    }, 250);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [open, text, tries]);
  // the server's rows for what's in the box now (an older search's rows don't stand in for it)
  const records = found?.q === text ? found : null;
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
    return [...actions.filter((a) => match(a.label)), ...pages.filter((p) => match(p.label)), ...(records?.rows ?? [])].slice(0, 24);
  }, [open, q, can, meId, records]);
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
  const asked = text.length >= 2;
  const trouble = records?.problem ? troubleText(records.problem) : null;
  const status = trouble ?? (results.length ? null
    : !asked ? "Keep typing to search customers and bills."
      : !records ? "Searching…"
        : `Nothing matches “${q}”. Try a phone number, or a bill number like 31 or KGH/2026-27/31.`);
  const retry = () => { setFound(null); setTries((n) => n + 1); input.current?.focus(); };
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
