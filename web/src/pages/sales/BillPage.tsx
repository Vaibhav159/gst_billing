import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { billQuery, cachedBillNumber, useBill } from "@/core/api/sales";
import { cn } from "@/core/cn";
import { LoadError, Page, Skeleton } from "@/core/ui";
import { useView } from "@/core/view";
import { DeletedBill } from "./bill/DeletedBill";
import { DesktopBill } from "./bill/DesktopBill";
import { MissingBill } from "./bill/MissingBill";
import { PhoneBill } from "./bill/PhoneBill";

/** While the bill loads: its number already when a list or search on this device has it (part 0 carry), else "Sales bill". */
export function DetailLoading({ title, problem, retry }: { title: string; problem?: ApiProblem | null; retry?: () => void }) {
  const { isPhone } = useView();
  return (
    <Page icon={ReceiptText} title={title} back breadcrumbs={[{ label: "Sales", to: "/sales" }]}>
      {problem ? <LoadError problem={problem} retry={retry} what="this bill" /> : (
        <div className={cn("grid gap-5", isPhone ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_340px]")} role="status" aria-label="Loading the bill">
          <div className="flex flex-col gap-5">
            <div className="card p-5 flex flex-col gap-3"><Skeleton w={90} h={14} />{[0, 1].map((i) => <Skeleton key={i} h={20} />)}</div>
            <div className="card p-5 flex flex-col gap-3"><Skeleton w={70} h={14} /><Skeleton h={16} /><Skeleton w="60%" h={16} /></div>
          </div>
          <div className="card p-5 flex flex-col gap-3"><Skeleton w={120} h={12} /><Skeleton w={200} h={30} />{[0, 1, 2].map((i) => <Skeleton key={i} h={16} />)}</div>
          <p className="sr-only">Loading the bill</p>
        </div>
      )}
    </Page>
  );
}

/** /sales/:id: the bill, its deleted state, or that it isn't here. */
export default function BillPage() {
  const { id: raw = "" } = useParams();
  const qc = useQueryClient();
  const net = useNetwork();
  const { isPhone } = useView();
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const q = useBill(id);
  if (id === null) return <MissingBill id={raw} />;
  const early = cachedBillNumber(qc, id) ?? "Sales bill";
  if (q.isPending) {
    // offline before anything came: say so, rather than load for good
    return q.isPaused && net === "offline" ? <DetailLoading title={early} problem={{ kind: "offline", message: "You're offline" }} /> : <DetailLoading title={early} />;
  }
  if (q.isError) {
    const p = problemOf(q.error);
    // Try again asks again through the client, as every page's does (Ruling 1B-11): the bill is all this page shows now
    return p.kind === "notfound" ? <MissingBill id={raw} /> : <DetailLoading title={early} problem={p} retry={() => { void qc.refetchQueries({ queryKey: billQuery(id).queryKey }); }} />;
  }
  if (q.data.kind === "deleted") return <DeletedBill b={q.data.binned} />;
  return isPhone ? <PhoneBill b={q.data.bill} /> : <DesktopBill b={q.data.bill} />;
}
