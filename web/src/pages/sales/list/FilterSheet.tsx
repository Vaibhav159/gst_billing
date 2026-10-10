// The phone's filters in one sheet (PROTO sales/SalesList.jsx:1129-1179): quick views, the firm (it moves the app's
// firm too), a customer, how it was paid, the status and the order. The list follows each pick as it's made.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { plural } from "@/core/format";
import { PAY_FILTER, STATUS, type PayFilter, type StatusFilter } from "@/core/sales/words";
import { useCustomerSearch } from "@/core/api/customers";
import { Avatar, Button, Chip, Dialog, Field, IconButton, ListRow, SearchInput, Select } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { customerLine } from "@/pages/customers/forBills";
// the firms as chips (PROTO core/common.jsx:130-140): 1C's, one home for them (Ruling 1C-3)
import { FirmChips } from "@/pages/customers/listParts";
import type { ListModel } from "./model";
import { SavedViews } from "./parts";

export function FilterSheet({ m, open, onClose }: { m: ListModel; open: boolean; onClose: () => void }) {
  const [cq, setCq] = useState("");
  useEffect(() => { if (open) setCq(""); }, [open]);
  const t = cq.trim();
  const dt = useDebounced(t, 250);
  const found = useCustomerSearch(dt, { size: 6 });
  const custs = t.length >= 2 ? found.data ?? [] : [];
  const s = m.summary;
  const x = m.state.status === "cancelled";
  const showing = !s ? "Show the bills" : x ? `Show ${plural(s.bills, "cancelled bill")}` : !s.bills && s.cancelled ? `Show ${plural(s.cancelled, "cancelled bill")}` : `Show ${plural(s.bills, "bill")}`;
  return (
    <Dialog open={open} onClose={onClose} title="Filter bills"
      footer={<><Button onClick={m.clearFilters} disabled={!m.anyFilter}>Clear filters</Button><Button variant="primary" onClick={onClose}>{showing}</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg2">Quick views</p>
          <SavedViews m={m} phone />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg2">Firm <span className="text-muted font-normal">· also changes Home</span></p>
          <FirmChips firms={m.firms} value={m.firmId} onChange={m.setFirmId} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg2">Customer</p>
          {m.state.customer != null ? (
            <div className="flex items-center gap-3 rounded-ctl border border-brand bg-brand-sel/40 pl-3 pr-1">
              <Avatar name={m.customerName ?? ""} size={32} tone="muted" />
              <span className="flex-1 min-w-0 font-medium truncate">{m.customerName ?? "One customer"}</span>
              <IconButton label={`Remove ${m.customerName ?? "this customer"}`} icon={X} onClick={() => m.set({ customer: null })} />
            </div>
          ) : (
            <>
              <SearchInput value={cq} onChange={setCq} placeholder="Any customer: a name or phone" label="Show one customer's bills" />
              {custs.length ? <div className="-mx-5 flex flex-col">{custs.map((c) => <ListRow key={c.id} onClick={() => { m.set({ customer: c.id }); setCq(""); }} title={c.name} subtitle={customerLine(c)} chevron={false} />)}</div>
                // no match is said only of what was searched for: the answer on hand may be for what was typed before the pause
                : t.length >= 2 && dt === t && found.data ? <p className="text-sm text-muted">No customer matches “{t}”.</p> : null}
            </>
          )}
        </div>
        <Field label="Paid by" htmlFor="flt-pay">
          <Select id="flt-pay" value={m.state.paid} onChange={(e) => m.set({ paid: e.target.value as PayFilter })} options={PAY_FILTER.map((p) => (p.value === "any" ? { ...p, label: "Any payment" } : p))} />
        </Field>
        <Field label="Status" htmlFor="flt-status">
          <Select id="flt-status" value={m.state.status} onChange={(e) => m.set({ status: e.target.value as StatusFilter })} options={Object.entries(STATUS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg2">Sort</p>
          <div className="grid grid-cols-3 gap-2">
            <Chip selected={m.state.sort.key === "date"} onClick={() => m.set({ sort: { key: "date", dir: "desc" } })}>Newest</Chip>
            <Chip selected={m.state.sort.key === "number"} onClick={() => m.set({ sort: { key: "number", dir: "asc" } })}>By number</Chip>
            <Chip selected={m.state.sort.key === "total"} onClick={() => m.set({ sort: { key: "total", dir: "desc" } })}>Biggest</Chip>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
