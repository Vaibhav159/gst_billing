// The bill form's pages (PROTO pages/sales/BillForm.jsx:20-94): /sales/new, where a link decides how a bill starts
// (?paper=1&firm=&date=&number=, ?from=, ?remake=, ?customer=, ?paid=), and who may make bills. Every bill is copied from
// the paper book first, so a new bill's number is the paper bill's: typed, or the next one confirmed.
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { FilePlus2, Lock } from "lucide-react";
import { useCustomer } from "@/core/api/customers";
import { useBillDetail } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { ROLES } from "@/core/auth/permissions";
import { cn } from "@/core/cn";
import { addMonths, monthOf, todayIST } from "@/core/format";
import { useUnsavedGuard } from "@/core/router/useUnsavedGuard";
import { useFirms, useScope } from "@/core/scope";
import { ButtonLink, Card, EmptyState, Page, Skeleton } from "@/core/ui";
import { useView } from "@/core/view";
import { DesktopForm } from "./DesktopForm";
import { PAY_KEYS } from "./fields";
import { idParam, startCopy, startNew, startPaper, startRemake, type Start } from "./model";
import { lastPaperDate } from "./paperDates";
import { parseDateText } from "./rules";
import { useBillForm } from "./useBillForm";

/** Placeholders while the form's data loads, never an empty form that fills in under the cursor (PROTO BillForm.jsx:63-83). */
export function FormLoading({ title }: { title: string }) {
  const { isPhone } = useView();
  return (
    <Page icon={FilePlus2} title={title} back breadcrumbs={[{ label: "Sales", to: "/sales" }]}>
      <div className={cn("grid gap-5", isPhone ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_300px]")} role="status" aria-label="Loading the bill form">
        <div className="flex flex-col gap-5">
          <div className="card p-5 flex flex-col gap-4">
            <Skeleton w={80} h={14} />
            <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-3")}>{[0, 1, 2].map((i) => <div key={i} className="flex flex-col gap-2"><Skeleton w={90} h={12} /><Skeleton h={44} /></div>)}</div>
            <Skeleton w={110} h={12} /><Skeleton h={44} />
          </div>
          <div className="card p-5 flex flex-col gap-3"><Skeleton w={70} h={14} />{[0, 1].map((i) => <Skeleton key={i} h={44} />)}</div>
        </div>
        {!isPhone ? <div className="card p-5 flex flex-col gap-3"><Skeleton w={120} h={14} />{[0, 1, 2].map((i) => <Skeleton key={i} h={16} />)}<Skeleton h={48} /></div> : null}
      </div>
    </Page>
  );
}

/** Someone who can't make bills is told who can, and still led somewhere useful (PROTO BillForm.jsx:21-41). */
function CantMakeBills({ params }: { params: URLSearchParams }) {
  const { me, whyNot } = useAuth();
  const customer = useCustomer(idParam(params.get("customer")));
  const fromId = idParam(params.get("from"));
  const c = customer.data;
  return (
    <Page icon={FilePlus2} title="New sales bill" breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      <Card><EmptyState icon={Lock} title="You can't make bills"
        actions={<>
          {c && c.type !== "walkin" ? <ButtonLink to={`/sales?customer=${c.id}&all=1`} variant="primary">{`${c.name}'s bills`}</ButtonLink> : null}
          {fromId ? <ButtonLink to={`/sales/${fromId}`} variant="primary">Open the bill</ButtonLink> : null}
          <ButtonLink to="/sales">Back to Sales</ButtonLink>
        </>}>
        Signed in as {me ? ROLES[me.role].label.toLowerCase() : "someone"}. {whyNot("bill.create")} You can still open, print and download every bill.
      </EmptyState></Card>
    </Page>
  );
}

/**
 * Asks before leaving with something unsaved (the message), then goes where the form is done (`goTo`: the saved bill).
 * The guard lets go first: its effects run before this one, so React Router's blocker has heard before the move.
 */
function useFormExit(unsaved: boolean, message: string, goTo: string | null): ReactNode {
  const navigate = useNavigate();
  const guard = useUnsavedGuard(!goTo && unsaved, message);
  useEffect(() => { if (goTo) navigate(goTo, { replace: true }); }, [goTo, navigate]);
  return guard;
}

const EDIT_UNSAVED = "Your changes to this bill aren't saved. Leave and lose them?";
const NEW_UNSAVED = "This bill isn't saved. Leave and lose it?";

/** The form itself, from where it starts. A new bill asks before it's left with something typed; plan Task 6 keeps it as a draft instead. */
export function BillForm({ start }: { start: Start }) {
  const F = useBillForm(start);
  const exit = useFormExit(F.dirty, F.edit ? EDIT_UNSAVED : NEW_UNSAVED, F.savedTo);
  return <DesktopForm F={F}>{exit}</DesktopForm>;
}

/**
 * How a new bill starts, from its link, once what it needs has loaded. Decided once: the form then stays, whatever the
 * queries underneath do next.
 */
function NewBillStart({ params }: { params: URLSearchParams }) {
  const opened = useRef<Start | null>(null);
  const deciding = opened.current === null;
  const { firms, loading, error } = useFirms();
  const { firmId: scopeFirm, ready } = useScope();
  const today = todayIST();
  const fromId = idParam(params.get("from"));
  const remakeId = idParam(params.get("remake"));
  const source = useBillDetail(deciding ? remakeId ?? fromId : null);
  const customerId = idParam(params.get("customer"));
  const customer = useCustomer(deciding ? customerId : null);
  const paper = params.get("paper") === "1";
  const title = paper ? "Bill from the paper book" : "New sales bill";
  if (opened.current) return <BillForm start={opened.current} />;
  if (loading || !ready || ((remakeId ?? fromId) !== null && source.isPending) || (customerId !== null && customer.isPending)) return <FormLoading title={title} />;
  if (!firms.length) {
    return (
      <Page icon={FilePlus2} title={title} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
        <Card><EmptyState icon={Lock} title={error ? "The firms couldn't load" : "No firm to bill from yet"}>
          {error ? "A bill is made in a firm's name, so the form waits for the list of firms. Try again when the internet is back." : "A bill is made in a firm's name. The owner adds firms in Records."}
        </EmptyState></Card>
      </Page>
    );
  }
  const known = (id: number | null) => id !== null && firms.some((x) => x.id === id);
  const fallback = typeof scopeFirm === "number" && known(scopeFirm) ? { firmId: scopeFirm, firmSource: "scope" as const } : { firmId: firms[0].id, firmSource: "first" as const };
  const bill = source.data ?? null;
  let start: Start;
  if (remakeId !== null && bill && bill.status === "cancelled") start = startRemake(bill, today);
  else if (fromId !== null && bill) start = startCopy(bill, today);
  else if (paper) {
    const asked = idParam(params.get("firm"));
    const firmId = known(asked) ? (asked as number) : fallback.firmId;
    // the paper bill's own date, read as the date box reads one (a day that doesn't exist isn't one), never after today
    const date = parseDateText(params.get("date") ?? "", today);
    const number = params.get("number") ?? "";
    start = startPaper({ firmId, date: date && date <= today ? date : "", number: /^\d+$/.test(number) ? number : "", remembered: lastPaperDate(firmId), lastMonth: addMonths(monthOf(today), -1) });
  } else {
    // ?paid= picks how it was paid only when it names a way a bill is paid
    start = startNew({ ...fallback, today, customer: customer.data ?? null, payment: PAY_KEYS.find((k) => k === params.get("paid")) ?? null });
  }
  opened.current = start;
  return <BillForm start={start} />;
}

/**
 * /sales/new: a new bill, a paper bill, a copy, a cancelled bill made again (bill.create). A link opened again is another
 * bill. The app's routes load it on demand (plan 1E's lazyPage), so it's this module's default.
 */
export default function NewBillPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  if (!can("bill.create")) return <CantMakeBills params={params} />;
  return <NewBillStart key={location.key} params={params} />;
}
