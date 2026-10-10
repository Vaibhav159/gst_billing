import { useState } from "react";
import { useCustomerSearch, type CustomerRow } from "@/core/api/customers";
import { plural } from "@/core/format";
import { Combobox, type ComboOption } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { customerLine } from "@/pages/customers/forBills";
import type { ListModel } from "./model";

/** One customer's bills: type a name, phone or GSTIN (PROTO SalesList.jsx:705-722), found by 1C's customer search. */
export function CustomerFilter({ m }: { m: ListModel }) {
  const [q, setQ] = useState("");
  const found = useCustomerSearch(useDebounced(q.trim(), 250));
  const options: ComboOption<CustomerRow>[] = q.trim().length >= 2 ? (found.data ?? []).map((c) => ({
    key: String(c.id), title: c.name, sub: customerLine(c), right: c.figures ? plural(c.figures.bills, "bill") : undefined, value: c,
  })) : [];
  return (
    <div className="w-[200px]">
      <Combobox id="sl-customer" query={q} onQuery={setQ} options={options} onPick={(o) => { m.set({ customer: o.value.id }); setQ(""); }}
        placeholder={m.state.customer != null ? m.customerName ?? "One customer" : "Customer: any"} ariaLabel="Show one customer's bills" listLabel="Customers" />
    </div>
  );
}
