// The list's own pieces: Show more, the phone's firm chips, and each customer's Call · WhatsApp · New bill · Statement
// (PROTO pages/records/shared.jsx MoreButton, core/common.jsx FirmChips, CustomerDetail.jsx useContact and CustomerRowMenu).
import { ChevronDown, FileText, MessageCircle, MoreHorizontal, Phone, Plus, Send } from "lucide-react";
import type { Customer, LastBill } from "@/core/api/customers";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { dateShort, inr } from "@/core/format";
import { formatMobile, mobileDigits } from "@/core/ids";
import type { Firm, FirmId } from "@/core/scope";
import { Button, IconButton, Menu, useToast, type MenuItem } from "@/core/ui";
import { useView } from "@/core/view";
import { firstName } from "./lib";

/** "Showing 20 of 31 customers · Show 11 more". */
export function MoreButton({ shown, total, what, pageSize, onMore, loading }: { shown: number; total: number; what: string; pageSize: number; onMore: () => void; loading?: boolean }) {
  const { isPhone } = useView();
  if (shown >= total) return null;
  return (
    <div className={cn("flex items-center gap-3 border-t border-rule", isPhone ? "flex-col px-4 py-3" : "justify-between px-5 py-3")}>
      <span className="text-sm text-muted tnum">Showing {shown} of {total} {what}</span>
      <Button icon={ChevronDown} onClick={onMore} loading={loading} full={isPhone}>{`Show ${Math.min(pageSize, total - shown)} more`}</Button>
    </div>
  );
}

/** The firm the lists follow, as chips on phones (the desktop has it in the top bar). */
export function FirmChips({ firms, value, onChange }: { firms: Firm[]; value: FirmId | null; onChange: (id: FirmId) => void }) {
  const opts: { id: FirmId; label: string }[] = [{ id: "all", label: "All firms" }, ...firms.map((f) => ({ id: f.id, label: f.short }))];
  return (
    <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="Firm">
      {opts.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cn("min-h-11 px-4 rounded-full border whitespace-nowrap transition-colors shrink-0", value === o.id ? "bg-brand-sel border-brand text-brand font-semibold" : "bg-card border-line text-fg2")}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * Call and WhatsApp for a customer: a tel: link, and WhatsApp's "Resend <last bill>" (it opens the bill, where Send is)
 * and "Message <first name>" (a chat). Nothing for a number that isn't a 10-digit mobile.
 */
export function useContact(c: Pick<Customer, "name" | "mobile_number">, last: LastBill | null): { tel: string | null; items: MenuItem[] } {
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const digits = mobileDigits(c.mobile_number);
  if (!/^[6-9]\d{9}$/.test(digits)) return { tel: null, items: [] };
  const chat = () => {
    const w = window.open(`https://wa.me/91${digits}`, "_blank");
    if (w) w.opener = null;
    else show({ tone: "brand", title: "WhatsApp didn't open", body: `The browser stopped the new tab. Allow pop-ups for this app, or message ${c.name} on +91 ${formatMobile(digits)}.` });
  };
  const items: MenuItem[] = [];
  if (last) {
    items.push({
      label: `Resend ${last.invoice_number}`, icon: Send, to: `/sales/${last.id}`, disabled: !can("bill.send"),
      hint: can("bill.send") ? `${dateShort(last.invoice_date)} · ${inr(last.total_amount)} · opens the bill to send it again` : whyNot("bill.send"),
    });
  }
  items.push({ label: `Message ${firstName(c.name)}`, icon: MessageCircle, hint: "Opens a WhatsApp chat", onSelect: chat });
  return { tel: `tel:+91${digits}`, items };
}

/** The row's ⋯: Call (phones) · WhatsApp · New bill · Statement, as on the customer page. */
export function CustomerRowMenu({ c, last }: { c: Customer; last: LastBill | null }) {
  const { can, whyNot } = useAuth();
  const { isPhone } = useView();
  const k = useContact(c, last);
  const items: MenuItem[] = [];
  if (k.tel && isPhone) items.push({ label: `Call ${formatMobile(c.mobile_number)}`, icon: Phone, onSelect: () => { window.location.href = k.tel!; } });
  items.push(...k.items);
  if (items.length) items.push({ divider: true });
  items.push(
    { label: c.type === "walkin" ? "New bill for a walk-in" : `New bill for ${firstName(c.name)}`, icon: Plus, disabled: !can("bill.create"), hint: can("bill.create") ? undefined : whyNot("bill.create"), to: `/sales/new?customer=${c.id}` },
    { label: "Statement", icon: FileText, hint: "Bills for a period, as a PDF", to: `/customers/${c.id}/statement` },
  );
  return <Menu title={c.name} width={300} items={items} trigger={(p) => <IconButton {...p} label={`Actions for ${c.name}`} icon={MoreHorizontal} />} />;
}
