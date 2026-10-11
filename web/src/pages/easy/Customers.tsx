import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ChevronRight, Plus, ReceiptText, Phone, UserPlus, SearchX, Users, Pencil } from "lucide-react";
import { customerKeys, type Customer, type CustomerRow, type useCustomerList } from "@/core/api/customers";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, fyOf, inr, todayIST } from "@/core/format";
import { formatMobile, looksLikePhone, mobileDigits } from "@/core/ids";
import { Button, ButtonLink, Dialog, DL, EmptyState, Field, ListSkeleton, QueryView, SearchInput, useNewIds } from "@/core/ui";
import { firstName, useJustSaved, useMoreFocus } from "@/pages/customers/lib";
import type { CustomerFrame, CustomerFirm } from "./CustomerParts";

type Props = { Frame: CustomerFrame; firm: CustomerFirm; query: ReturnType<typeof useCustomerList>; q: string; onSearch(q: string): void; onStart(id: number): void };
export function CustomersBody({ Frame, firm, query, q, onSearch, onStart }: Props) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<number | null>(null);
  const added = useJustSaved("easy-customer");
  const qc = useQueryClient();
  const t = q.trim();
  const cached = added === null ? undefined : qc.getQueryData<Customer>(customerKeys.one(added));
  const rows = useMemo(() => {
    const loaded = query.data?.pages.flatMap((p) => p.rows).filter((c) => c.type !== "walkin") ?? [];
    const saved = loaded.find((c) => c.id === added) ?? (cached ? { ...cached, figures: null } : null);
    const match = !t || saved && (saved.name.toLowerCase().includes(t.toLowerCase()) || looksLikePhone(t) && mobileDigits(saved.mobile_number).includes(mobileDigits(t)));
    return saved && match ? [saved, ...loaded.filter((c) => c.id !== saved.id)] : loaded;
  }, [query.data, added, cached, t]);
  const moreFocus = useMoreFocus(rows.map((c) => c.id));
  const flash = useNewIds(rows.map((c) => String(c.id)));
  const selected = rows.find((c) => c.id === openId);
  const fy = fyOf(todayIST());
  const from = `${fy.slice(0, 4)}-04-01`;
  const last = (c: CustomerRow) => c.figures?.last_bill && c.figures.last_bill.invoice_date >= from && c.figures.last_bill.invoice_date <= todayIST() ? c.figures.last_bill : null;
  const canEdit = can("customer.edit");
  return <Frame title="Customers" subtitle={`Last bill shown for ${firm.name}`} docTitle="Easy mode · Customers"
    bar={canEdit ? <Button variant="primary" size="xl" icon={UserPlus} full onClick={() => navigate("/e/customers/new")}>Add a customer</Button>
      : <p className="text-md text-muted text-center">{whyNot("customer.edit", "add customers")}</p>}>
    <Field label="Find a customer by name or phone" htmlFor="easy-cust-find"><SearchInput id="easy-cust-find" label={null} value={q} onChange={onSearch} placeholder="Like Meena or 9414" /></Field>
    <QueryView query={query} what="the customer list" skeleton={<ListSkeleton rows={7} what="customers" />}>{() => rows.length ?
      <section aria-label={t ? `Customers matching ${t}` : "All customers"} className="card">
        <p className="px-4 pt-3.5 pb-2 text-md text-muted">{t ? `${rows.length} of ${query.data?.pages[0].count ?? rows.length} customers` : `${rows.length} customers · latest buyers first`}</p>
        <ul>{rows.map((customer) => {
          const recent = last(customer);
          return <li key={customer.id} className={cn((flash.has(String(customer.id)) || added === customer.id) && "anim-flash")}>
            <button type="button" data-row={customer.id} onClick={() => setOpenId(customer.id)} className="w-full flex items-center gap-3 pl-4 pr-3 py-3 min-h-[68px] text-left border-t border-rule transition-colors hover:bg-raised/60">
              <span className="flex-1 min-w-0"><span className="block font-medium break-words">{customer.name}{added === customer.id ? <span className="ml-2 align-middle inline-flex items-center rounded-full bg-sale-tint border border-sale-line text-sale text-md font-semibold px-2">Just added</span> : null}</span>
                <span className="block text-md text-muted tnum">{formatMobile(customer.mobile_number) || "No phone"}{customer.gst_number ? " · shop" : ""}</span></span>
              <span className="text-right shrink-0">{recent ? <><span className="block tnum text-sale">{inr(recent.total_amount)}</span><span className="block text-md text-muted tnum">{date(recent.invoice_date)}</span></> : <span className="block text-md text-muted">No bills here this year</span>}</span>
              <ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" />
            </button>
          </li>;
        })}</ul>
        {query.hasNextPage ? <div className="p-4"><Button full size="lg" loading={query.isFetchingNextPage} onClick={() => { moreFocus(); void query.fetchNextPage(); }}>Show 40 more</Button></div> : null}
      </section>
      : t ? <div className="card"><EmptyState icon={SearchX} title={`No customer called “${t}”`} actions={canEdit ? <Button variant="outline" size="lg" icon={UserPlus} onClick={() => navigate(`/e/customers/new?${looksLikePhone(t) ? "phone" : "name"}=${encodeURIComponent(t)}`)}>Add “{t}”</Button> : null}>Check the spelling or try the phone number.</EmptyState></div>
        : <div className="card"><EmptyState icon={Users} title="No customers yet">Add the first one with the button below. Walk-in customers don't need adding.</EmptyState></div>
    }</QueryView>
    <Dialog open={Boolean(selected)} onClose={() => setOpenId(null)} title={selected?.name || ""} description={selected ? selected.gst_number ? "Shop or company" : "Customer" : ""}
      footer={selected ? <>
        {selected.mobile_number ? <ButtonLink size="lg" icon={Phone} to={`tel:+91${mobileDigits(selected.mobile_number)}`}>Call {formatMobile(selected.mobile_number)}</ButtonLink> : null}
        {canEdit ? <ButtonLink size="lg" icon={Pencil} to={`/e/customers/${selected.id}/edit`}>Change details</ButtonLink> : null}
        <ButtonLink size="lg" icon={ReceiptText} to={`/e/bills?q=${encodeURIComponent(selected.name)}`}>See {firstName(selected.name)}'s bills</ButtonLink>
        {can("bill.create") ? <Button variant="primary" size="xl" icon={Plus} onClick={() => { setOpenId(null); onStart(selected.id); }}>New bill for {firstName(selected.name)}</Button> : null}
      </> : null}>
      {selected ? <DL rows={[
        ["Phone", formatMobile(selected.mobile_number) || "Not saved"],
        selected.address || selected.city ? ["Address", [selected.address, selected.city].filter(Boolean).join(", ")] : null,
        selected.gst_number ? ["GST number", <span key="g" className="tnum">{selected.gst_number}</span>] : null,
        [`Bills at ${firm.short}, FY ${fy}`, selected.figures?.bills ? `${selected.figures.bills} · ${inr(selected.figures.total)}` : "None yet"],
        last(selected) ? ["Last bill", `${date(last(selected)!.invoice_date)} · ${inr(last(selected)!.total_amount)}`] : null,
      ]} /> : null}
    </Dialog>
  </Frame>;
}
