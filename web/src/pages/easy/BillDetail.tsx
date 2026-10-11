import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { SearchX } from "lucide-react";
import { problemOf } from "@/core/api/errors";
import { useBill } from "@/core/api/sales";
import { date, fyOf, todayIST } from "@/core/format";
import type { BillDetail as Bill } from "@/core/sales/types";
import { timeOf } from "@/core/sales/words";
import { Banner, ButtonLink, EmptyState, ListSkeleton, QueryView, Skeleton, StaleNote } from "@/core/ui";
import { BillDetailBody } from "./BillDetailBody";
import { CancelBill, EasyPage, MakeAgain, PrintButton, SendBig, SendTo } from "./parts";

function OneBill({ bill, note }: { bill: Bill; note?: ReactNode }) {
  const navigate = useNavigate();
  const no = String(bill.counter ?? bill.invoice_number);
  const older = bill.fy !== fyOf(todayIST());
  return <EasyPage back title={`Bill ${no}`} subtitle={`${date(bill.invoice_date)} · ${timeOf(bill.created_at)}${older ? ` · FY ${bill.fy}` : ""}`} docTitle={`Bill ${no}`}>
    {note}
    <BillDetailBody bill={bill} onFullView={(path) => navigate(path, { state: { fullView: true } })}
      sendTo={<SendTo bill={bill} />} send={<SendBig bill={bill} />} print={<PrintButton bill={bill} />}
      cancel={<CancelBill bill={bill} />} remake={<MakeAgain bill={bill} />} />
  </EasyPage>;
}

export default function BillDetail() {
  const { id = "" } = useParams();
  const parsed = /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : null;
  const query = useBill(parsed);
  if (parsed === null || (query.isError && problemOf(query.error).kind === "notfound")) return <EasyPage back title="Bill not found">
    <EmptyState icon={SearchX} title="We can't find this bill" actions={<ButtonLink to="/e/bills" variant="primary" size="lg">Go to Bills</ButtonLink>}>
      It may have been made on another phone, or the link is old.
    </EmptyState>
  </EasyPage>;
  const note = query.isError ? <StaleNote problem={problemOf(query.error)} what="this bill" retry={() => void query.refetch()} busy={query.isFetching} /> : null;
  if (query.data?.kind === "bill") return <OneBill bill={query.data.bill} note={note} />;
  if (query.data?.kind === "deleted") return <EasyPage back title={`Bill ${query.data.binned.invoice_number}`}>
    {note}
    <Banner tone="neg" title="This bill was deleted"><span className="text-md">{query.data.binned.customer.name} · {date(query.data.binned.invoice_date)}. Its number stays used.</span></Banner>
    <ButtonLink to="/e/bills" variant="primary" size="lg">Go to Bills</ButtonLink>
  </EasyPage>;
  return <EasyPage back title="Bill"><QueryView query={query} what="this bill" skeleton={<div className="flex flex-col gap-4"><Skeleton w="100%" h={170} className="!rounded-card" /><ListSkeleton rows={3} what="the bill" /></div>}>{() => null}</QueryView></EasyPage>;
}
