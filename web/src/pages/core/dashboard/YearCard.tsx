import { useEffect, useState } from "react";
import { ChevronRight, History } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import type { DashboardData } from "@/core/dashboard/types";
import { dateShort, inr, monthLabel, monthOf, plural } from "@/core/format";
import { Card, Figure, Money, Segmented } from "@/core/ui";

export function YearCard({ data, scope, phone = false }: { data: DashboardData; scope: string; phone?: boolean }) {
  const { can } = useAuth();
  const [mode, setMode] = useState("value");
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), 30); return () => clearTimeout(t); }, []);
  const { year } = data;
  const currentMonth = monthOf(data.today.date);
  if (phone) return (
    <Card title={`FY ${data.fy}${data.current ? " so far" : ""}`} subtitle={`${data.current ? `1 Apr to ${dateShort(data.today.date)}` : "1 Apr to 31 Mar"} · ${scope}`}>
      <div className="dashboard-figures grid grid-cols-2 gap-4">
        <Figure label={`Sales · ${plural(year.sales.count, "bill")}`} value={year.sales.total} whole size="lg" tone="sale" />
        <Figure label={`Purchases · ${plural(year.purchases.count, "bill")}`} value={year.purchases.total} whole size="lg" tone="amber" />
      </div>
      <div className="flex flex-wrap gap-x-4 mt-1">
        <Link to="/reports/months" className="link inline-flex items-center gap-1 min-h-11">Month by month <ChevronRight size={16} aria-hidden="true" /></Link>
        {can("audit.view") ? <Link to="/audit" className="link inline-flex items-center gap-1 min-h-11"><History size={16} aria-hidden="true" />Latest changes</Link> : null}
      </div>
    </Card>
  );
  const count = mode === "count";
  type Month = DashboardData["year"]["months"][number];
  const val = (m: Month, key: "sales" | "purchases") => count ? m[key].count : m[key].total;
  const max = Math.max(...year.months.flatMap(m => [val(m, "sales"), val(m, "purchases")]), count ? 4 : 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const H = 180;
  const lakh = (p: number) => { const r = p / 100; return r >= 1e7 ? `₹${(r / 1e7).toFixed(r % 1e7 ? 1 : 0)} Cr` : r === 0 ? "₹0" : `₹${Math.round(r / 1e5)} L`; };
  const tick = (t: number) => count ? String(t) : lakh(t);
  const h = (v: number) => grown ? `${Math.max((v / top) * 100, v > 0 ? 1 : 0)}%` : "2px";
  const spoken = (m: Month) => `${monthLabel(m.month, { long: true })}${m.month === currentMonth ? " so far" : ""}: sales ${inr(m.sales.total)} in ${plural(m.sales.count, "bill")}, purchases ${inr(m.purchases.total)} in ${plural(m.purchases.count, "bill")}`;
  return (
    <Card title={`FY ${data.fy} by month`} subtitle={`${scope} · ${data.current ? `April to ${monthLabel(currentMonth, { long: true, year: false })} so far` : "April to March"} · ${count ? "bill counts" : "values incl. GST"} · click a month for its bills`}
      actions={<div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex flex-wrap items-center gap-1.5"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-sale" />Sales <Money value={year.sales.total} whole strong /> <span className="text-muted">· {plural(year.sales.count, "bill")}</span></span>
        <span className="flex flex-wrap items-center gap-1.5"><span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm bg-amber" />Purchases <Money value={year.purchases.total} whole strong /> <span className="text-muted">· {plural(year.purchases.count, "bill")}</span></span>
        <Segmented label="Chart shows" value={mode} onChange={setMode} options={[{ value: "value", label: "Value" }, { value: "count", label: "Bills" }]} />
      </div>}>
      <div className="flex gap-3">
        <div className="relative w-14 shrink-0" style={{ height: H }} aria-hidden="true">
          {ticks.map(t => <span key={t} className="absolute right-0 text-2xs text-muted tnum -translate-y-1/2" style={{ top: H - (t / top) * H }}>{tick(t)}</span>)}
        </div>
        <div className="relative flex-1" style={{ height: H }}>
          {ticks.map(t => <span key={t} aria-hidden="true" className="absolute left-0 right-0 border-t border-rule" style={{ top: H - (t / top) * H }} />)}
          <ul className="absolute inset-0 flex items-end gap-3 px-2" aria-label="Months: open a month's sales bills">
            {year.months.map(m => <li key={m.month} className="flex-1 h-full flex">
              <Link to={`/sales?month=${m.month}`} aria-label={`${spoken(m)}. Open ${monthLabel(m.month, { long: true })}'s sales bills`} title={spoken(m)}
                className="flex-1 flex items-end justify-center gap-1 h-full rounded-md hover:bg-raised/60 transition-colors">
                <span className="w-[38%] max-w-[22px] rounded-t-[3px] bg-sale transition-[height] duration-300 ease-out" style={{ height: h(val(m, "sales")) }} />
                <span className="w-[38%] max-w-[22px] rounded-t-[3px] bg-amber transition-[height] duration-300 ease-out" style={{ height: h(val(m, "purchases")) }} />
              </Link>
            </li>)}
          </ul>
        </div>
      </div>
      <div className="flex gap-3 mt-2" aria-hidden="true">
        <div className="w-14 shrink-0" />
        <div className="flex-1 flex gap-3 px-2">{year.months.map(m => <span key={m.month} className="flex-1 text-center text-xs text-muted">{monthLabel(m.month, { year: false })}{m.month === currentMonth ? " · so far" : ""}<span className="block tnum">{plural(m.sales.count, "bill")}</span></span>)}</div>
      </div>
      <p className="text-sm text-muted mt-4 max-w-[75ch]">{(() => {
        const above = count ? 0 : year.months.filter(m => m.purchases.total > m.sales.total).length;
        const shown = year.months.filter(m => m.sales.total || m.purchases.total).length;
        return above ? `Purchases ran above sales in ${above} of ${plural(shown, "month")}: bullion stock bought for later sales, not a loss. ` : "";
      })()}The count under each month is its sales bills.</p>
    </Card>
  );
}

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
