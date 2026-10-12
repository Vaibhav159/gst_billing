import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import type { DashboardData } from "@/core/dashboard/types";
import { inr, monthLabel, plural, rangeLabel } from "@/core/format";
import { Card, Figure, Segmented } from "@/core/ui";

export function MonthCard({ data, scope, phone = false }: { data: DashboardData; scope: string; phone?: boolean }) {
  const [win, setWin] = useState<"month" | "30">(() => data.today.date.endsWith("-01") ? "30" : "month");
  const past = !data.current;
  const thirty = !past && win === "30" && data.last30 !== null;
  const figures = thirty ? data.last30! : data.month;
  const m = data.month.month;
  const caption = `${past ? `The last month of FY ${data.fy} · ` : ""}${rangeLabel(figures.from, figures.to)}`;
  const dated = thirty ? `Dated ${rangeLabel(figures.from, figures.to)}` : `Dated in ${monthLabel(m, { long: true, year: past })}`;
  const title = past ? monthLabel(m, { long: true }) : thirty ? "Last 30 days" : `${monthLabel(m, { long: true, year: false })} so far`;
  const period = past ? null : <Segmented full={phone} label="Period" value={win} onChange={setWin} options={[{ value: "month", label: phone ? "This month" : "This month so far" }, { value: "30", label: "Last 30 days" }]} />;
  if (phone) return <Card title={title} subtitle={caption}>
    <div className="flex flex-col gap-4">
      {period}
      <div className="dashboard-figures grid grid-cols-2 gap-x-4 gap-y-5">
        <Figure label={`Sales · ${plural(figures.sales.count, "bill")}`} value={figures.sales.total} size="xl" tone="sale" />
        <Figure label={`Purchases · ${plural(figures.purchases.count, "bill")}`} value={figures.purchases.total} size="xl" tone="amber" />
        <Figure label="GST on sales" value={figures.sales.tax} size="lg" />
        <Figure label="GST on purchase bills" value={figures.purchases.tax} size="lg" caption={dated} />
      </div>
      {thirty ? null : <div className="flex flex-wrap gap-x-4 -mt-1">
        <Link to={`/sales?month=${m}`} className="link inline-flex items-center gap-1 min-h-11">Sales bills <ChevronRight size={16} aria-hidden="true" /></Link>
        <Link to={`/purchases?month=${m}`} className="link inline-flex items-center gap-1 min-h-11">Purchase bills <ChevronRight size={16} aria-hidden="true" /></Link>
      </div>}
    </div>
  </Card>;
  return <Card title={title} subtitle={`${caption} · ${scope}`} actions={period}>
    <div className="grid grid-cols-2 gap-y-5 -mx-5 [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-rule">
      <Figure className="px-5" label={`Sales · ${plural(figures.sales.count, "bill")}`} value={figures.sales.total} tone="sale" caption={`Taxable ${inr(figures.sales.taxable)}`} to={thirty ? undefined : `/sales?month=${m}`} />
      <Figure className="px-5" label={`Purchases · ${plural(figures.purchases.count, "bill")}`} value={figures.purchases.total} tone="amber" caption={`Taxable ${inr(figures.purchases.taxable)}`} to={thirty ? undefined : `/purchases?month=${m}`} />
      <Figure className="px-5" label="GST on sales" value={figures.sales.tax} caption={thirty ? "CGST, SGST and IGST collected" : "CGST, SGST and IGST · opens the bills"} to={thirty ? undefined : `/sales?month=${m}`} />
      <Figure className="px-5" label="GST on purchase bills" value={figures.purchases.tax} caption={`${dated}${thirty ? "" : " · opens the bills"}`} to={thirty ? undefined : `/purchases?month=${m}`} />
    </div>
  </Card>;
}
