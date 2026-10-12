import { AlertTriangle, Check, ChevronRight, FileCheck2, Landmark, Lock, LockOpen } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import type { DashboardData, ReturnsData } from "@/core/dashboard/types";
import { Due } from "@/core/due/Due";
import { date, fyMonths, inr, monthLabel, plural } from "@/core/format";
import { Badge, ButtonLink, Card, ListRow, Money, Table, Td, Th, Tr } from "@/core/ui";

export function PastReturnsCard({ rows, fy, phone = false }: { rows: NonNullable<DashboardData["returns_year"]>; fy: string; phone?: boolean }) {
  const march = fyMonths(fy)[11];
  return (
    <Card title={`FY ${fy} returns`} subtitle="A past year: every month's returns, firm by firm" pad={false}
      actions={phone ? null : <ButtonLink to="/gst" variant="link" iconRight={ChevronRight}>Open GST returns</ButtonLink>}>
      {phone ? <div className="mt-1">
        {rows.map(r => <ListRow key={r.firm.id} to={`/gst?firm=${r.firm.id}&month=${march}`} title={r.firm.name}
          className="dashboard-return-row [&_.line-clamp-2]:line-clamp-none"
          subtitle={<><span className="block">{r.months_filed === 12 ? "All 12 filed and locked" : `${r.months_filed} of 12 filed`}</span><span className="block">{r.last_gstr3b_filed_on ? `GSTR-3B filed ${date(r.last_gstr3b_filed_on)}` : "—"}</span></>}
          right={<Money value={r.cash_paid} />} rightSub="tax paid in cash" />)}
      </div> : <Table label={`FY ${fy} returns by firm`} className="mt-2">
        <thead><tr><Th>Firm</Th><Th>Months filed</Th><Th>Last return</Th><Th align="right">Tax paid in cash over the year</Th><Th align="right"><span className="sr-only">Open</span></Th></tr></thead>
        <tbody>{rows.map(r => <Tr key={r.firm.id}>
          <Td><span className="block font-medium">{r.firm.name}</span><span className="block text-xs text-muted tnum">{r.firm.gst_number}</span></Td>
          <Td>{r.months_filed === 12 ? <Badge tone="file" icon={Lock}>All 12 filed and locked</Badge> : <Badge tone="amber">{r.months_filed} of 12 filed</Badge>}</Td>
          <Td className="text-fg2">{r.last_gstr3b_filed_on ? `GSTR-3B filed ${date(r.last_gstr3b_filed_on)}` : "—"}</Td>
          <Td align="right"><Money value={r.cash_paid} strong /></Td>
          <Td align="right"><ButtonLink size="sm" variant="ghost" to={`/gst?firm=${r.firm.id}&month=${march}`}>View</ButtonLink></Td>
        </Tr>)}</tbody>
      </Table>}
      {phone ? <div className="border-t border-rule px-4"><Link to="/gst" className="link inline-flex items-center gap-1 min-h-12"><Landmark size={16} aria-hidden="true" />GST returns</Link></div> : null}
    </Card>
  );
}

export function ReturnsCard({ returns: data, today, phone = false }: { returns: ReturnsData; today: string; phone?: boolean }) {
  const files = useAuth().can("gst.file");
  return (
    <Card title={`${monthLabel(data.month, { long: true })} returns`}
      subtitle={<><Due today={today} iso={data.gstr1_due} label="GSTR-1" /> · <Due today={today} iso={data.gstr3b_due} label={phone ? "3B" : "GSTR-3B"} /></>} pad={false}
      actions={phone ? null : <ButtonLink to="/gst" variant="link" iconRight={ChevronRight}>Open GST returns</ButtonLink>}>
      {phone ? <div className="mt-1">
        {data.firms.map(({ firm, stage, cash }) => <ListRow key={firm.id} to={`/gst?firm=${firm.id}&month=${data.month}${stage === "blocked" && files ? "&fix=1" : ""}`} title={firm.name} className="dashboard-return-row"
          subtitle={stage === "blocked" ? (files ? "Blocked · tap to fix" : "Blocked · the owner is fixing it") : stage === "filed" ? "Filed and locked" : stage === "gstr1" ? "GSTR-1 filed · GSTR-3B next" : stage === "unlocked" ? "Unlocked for a correction" : "Ready to file"}
          right={<Money value={cash} />} rightSub="cash to pay" />)}
      </div> : <Table label="Returns by firm" className="mt-2">
        <thead><tr><Th>Firm</Th><Th>GSTR-1 · sales</Th><Th>GSTR-3B · summary</Th><Th align="right">Tax to pay in cash</Th><Th align="right"><span className="sr-only">Action</span></Th></tr></thead>
        <tbody>{data.firms.map(({ firm, stage, blockers, purchases_to_check, cash, credit_used, carry_on }) => <Tr key={firm.id}>
          <Td><span className="block font-medium">{firm.name}</span><span className="block text-xs text-muted tnum">{firm.gst_number}</span></Td>
          <Td>{stage === "filed" ? <Badge tone="file" icon={Lock}>Filed</Badge>
            : stage === "gstr1" ? <Badge tone="file" icon={FileCheck2}>Filed</Badge>
              : stage === "unlocked" ? <Badge tone="brand" icon={LockOpen}>Unlocked</Badge>
                : stage === "blocked" ? <Badge tone="neg" icon={AlertTriangle}>Blocked · {plural(blockers, "check")} {blockers === 1 ? "fails" : "fail"}</Badge>
                  : <Badge tone="sale" icon={Check}>Ready to file</Badge>}</Td>
          <Td>{stage === "filed" ? <Badge tone="file" icon={Lock}>Filed</Badge>
            : stage === "unlocked" ? <Badge tone="brand" icon={LockOpen}>Unlocked</Badge>
              : stage === "blocked" ? <span className="text-muted">After GSTR-1</span>
                : purchases_to_check ? <Badge tone="brand" icon={AlertTriangle}>{plural(purchases_to_check, "purchase")} to check</Badge>
                  : <Badge tone="sale" icon={Check}>Ready</Badge>}</Td>
          <Td align="right"><Money value={cash} strong />{cash === 0
            ? <span className="block text-xs text-muted">Credit covers it · {inr(carry_on)} carries on</span>
            : <span className="block text-xs text-muted">after {inr(credit_used)} of credit</span>}</Td>
          <Td align="right">{!files || stage === "filed"
            ? <ButtonLink size="sm" variant="ghost" to={`/gst?firm=${firm.id}&month=${data.month}`}>View</ButtonLink>
            : stage === "blocked" ? <ButtonLink size="sm" variant="primary" to={`/gst?firm=${firm.id}&month=${data.month}&fix=1`}>Fix the problem</ButtonLink>
              : <ButtonLink size="sm" to={`/gst?firm=${firm.id}&month=${data.month}`}>{stage === "gstr1" ? "File GSTR-3B" : "Review and file"}</ButtonLink>}</Td>
        </Tr>)}</tbody>
      </Table>}
      {phone ? <div className="border-t border-rule px-4"><Link to="/gst" className="link inline-flex items-center gap-1 min-h-12"><Landmark size={16} aria-hidden="true" />GST returns</Link></div> : null}
    </Card>
  );
}
