import { useState } from "react";
import type { CustomerRow } from "@/core/api/customers";
import { plural } from "@/core/format";
import { Combobox, type ComboItem } from "@/core/ui";
import { customerLine, useTypedSearch } from "@/pages/customers/forBills";
import type { ListModel } from "./model";

/**
 * One customer's bills: type a name, phone or GSTIN (PROTO SalesList.jsx:705-722), found by 1C's typed search (Ruling
 * 1B-18). Searching, offline or failed, the list says so, as the bill form's customer box does: that no customer
 * matches is said only once the search for what's typed has answered.
 */
export function CustomerFilter({ m }: { m: ListModel }) {
  const [q, setQ] = useState("");
  const search = useTypedSearch(q);
  const rows = search.rows ?? [];
  const options: ComboItem<CustomerRow>[] = !search.t ? [] : [
    ...(search.note ? [{ heading: search.note }] : search.rows?.length === 0 ? [{ heading: `No customer matches “${search.t}”` }] : []),
    ...rows.map((c) => ({ key: String(c.id), title: c.name, sub: customerLine(c), right: c.figures ? plural(c.figures.bills, "bill") : undefined, value: c })),
  ];
  return (
    <div className="w-[200px]">
      <Combobox id="sl-customer" query={q} onQuery={setQ} options={options} onPick={(o) => { m.set({ customer: o.value.id }); setQ(""); }}
        placeholder={m.state.customer != null ? m.customerName ?? "One customer" : "Customer: any"} ariaLabel="Show one customer's bills" listLabel="Customers" />
    </div>
  );
}
