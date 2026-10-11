import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { useCustomer } from "@/core/api/customers";
import { useUnfinishedBills } from "@/core/api/drafts";
import { useBillDetail } from "@/core/api/sales";
import { keptDraft } from "@/core/deviceDrafts";
import { todayIST } from "@/core/format";
import { problemOf } from "@/core/api/errors";
import { EasyPage as Page } from "./parts";
import { Button, LoadError, ListSkeleton } from "@/core/ui";
import { idParam, startDraft, startNew, startRemake, type Start } from "@/pages/sales/form/model";
import { useBillForm, type BillFormApi } from "@/pages/sales/form/useBillForm";
import { useDraftKeeping } from "@/pages/sales/form/useDraftKeeping";
import { useEasyFirm } from "./state";

export type EasyBill = { F: BillFormApi; drafts: ReturnType<typeof useDraftKeeping> };
const Context = createContext<EasyBill | null>(null);
export function useEasyBill(): EasyBill {
  const value = useContext(Context);
  if (!value) throw new Error("useEasyBill needs BillFlow");
  return value;
}
const paths = { draft: (id: string) => `/e/new/items?draft=${id}`, saved: (id: number) => `/e/saved/${id}` };
function Form({ start, formKey }: { start: Start; formKey: string }) {
  const F = useBillForm(start, formKey, { paths, paperByDate: true });
  const drafts = useDraftKeeping(F, formKey, { keepWhen: form => form.lines.some(line => (line.qty ?? 0) > 0) });
  const navigate = useNavigate();
  useEffect(() => { if (F.savedTo) navigate(F.savedTo, { replace: true }); }, [F.savedTo, navigate]);
  return <Context.Provider value={{ F, drafts }}><Outlet /></Context.Provider>;
}
function StartFlow() {
  const firm = useEasyFirm();
  const location = useLocation(); const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formKey] = useState(location.key);
  const opened = useRef<Start | null>(null);
  const deciding = opened.current === null;
  const draftId = params.get("draft");
  const local = deciding && draftId ? keptDraft(draftId) : null;
  const fresher = local && !local.synced && !local.gone ? local : null;
  const lookUp = deciding && !!draftId && !fresher && !local?.gone;
  const unfinished = useUnfinishedBills(lookUp && firm.firmId !== null, { fresh: true, businessId: firm.firmId });
  const againId = draftId ? null : idParam(params.get("again"));
  const customerId = draftId || params.has("again") ? null : idParam(params.get("customer"));
  const source = useBillDetail(deciding && firm.firmId !== null ? againId : null);
  const customer = useCustomer(deciding && firm.firmId !== null ? customerId : null);
  const full = (to: string) => navigate(to, { state: { fullView: true } });
  if (opened.current) return <Form start={opened.current} formKey={formKey} />;
  if (firm.loading) return <Page title="New bill" back="/e"><ListSkeleton what="the bill" /></Page>;
  if (firm.firmId === null) return <Page title="New bill" back="/e"><p>{firm.error ? "The firms couldn't load. Try again when the internet is back." : "No firm to bill from yet. The owner adds firms in Records."}</p></Page>;
  const needed = againId !== null ? source : customerId !== null ? customer : null;
  if (needed && (needed.isError || needed.isPaused)) {
    const problem = needed.isPaused ? { kind: "offline" as const, message: "You're offline" } : problemOf(needed.error);
    return <Page title="New bill" back="/e"><LoadError problem={problem} what="the bill" retry={() => { void needed.refetch(); }} /></Page>;
  }
  if ((lookUp && unfinished.loading) || needed?.isPending) return <Page title="New bill" back="/e"><ListSkeleton what="the bill" /></Page>;
  const draft = fresher ? { ...fresher, onDevice: true } : unfinished.bills.find(d => d.id === draftId);
  if (draftId && (!draft || draft.data.firmId !== firm.firmId || draft.business !== firm.firmId || draft.data.posOverride !== null)) {
    return <Page title="Unfinished bill" back="/e"><p>{!draft ? "This unfinished bill couldn't open here." : "This bill needs the full view."}</p><Button onClick={() => full(`/sales/new?draft=${encodeURIComponent(draftId)}`)}>Finish in the full view</Button></Page>;
  }
  if (draft) { opened.current = startDraft(draft); return <Form start={opened.current} formKey={formKey} />; }
  if (params.has("again") && (!againId || !source.data || source.data.status !== "cancelled" || source.data.business !== firm.firmId)) {
    return <Page title="Make it again" back="/e"><p>This bill can't be made again here.</p>{againId ? <Button onClick={() => full(`/sales/${againId}`)}>Open in the full view</Button> : null}</Page>;
  }
  if (params.has("customer") && (!customerId || !customer.data)) return <Page title="Who is buying?" back="/e"><p>This customer couldn't load. Go back and choose them again.</p></Page>;
  const today = todayIST();
  let start = draft ? startDraft(draft) : source.data ? startRemake(source.data, today) : startNew({ firmId: firm.firmId, firmSource: "mine", today, customer: customer.data ?? null });
  if (source.data && start.form.posOverride !== null) return <Page title="Make it again" back="/e"><p>This bill needs the full view.</p><Button onClick={() => full(`/sales/new?remake=${source.data!.id}`)}>Finish in the full view</Button></Page>;
  if (source.data) {
    // 6-D3: a copied item's weight survives; its rate is typed from the paper bill again.
    start = { ...start, form: { ...start.form, lines: start.form.lines.map(line => ({ ...line, rate: "" })) } };
  }
  opened.current = start;
  return <Form start={start} formKey={formKey} />;
}
export default function BillFlow() {
  const { can, whyNot } = useAuth();
  return can("bill.create") ? <StartFlow /> : <Page title="New bill" back="/e"><p>{whyNot("bill.create")}</p></Page>;
}
