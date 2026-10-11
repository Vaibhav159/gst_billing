import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { SearchX } from "lucide-react";
import type { Customer } from "@/core/api/customers";
import { firmListQuery } from "@/core/api/firms";
import { useNetwork } from "@/core/api/network";
import { ButtonLink, EmptyState, ListSkeleton, LoadError, QueryView, useToast } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { firstName, useBack, useRouteCustomer } from "@/pages/customers/lib";
import { EasyPage } from "./parts";
import { useEasyFirm } from "./state";
import { useEasyCustomers } from "./queries";
import { CustomerForm } from "./CustomerForm";
import { CustomersBody } from "./Customers";

/** 4C's narrow picker read is already cached by useFirms; its city is intentionally absent from the legacy Firm mapper. */
function useCustomerFirms() {
  const selection = useEasyFirm();
  const { firmId } = selection;
  const query = useQuery(firmListQuery());
  const firms = (query.data ?? []).map((f) => ({ id: f.id, name: f.name, short: f.short, gstin: f.gst_number, state: f.state_name, city: f.city }));
  return { selection, firmId, firm: firms.find((f) => f.id === firmId), firms, query };
}
function NoFirm() {
  return <EmptyState title="Choose a firm first" actions={<ButtonLink to="/e/more" variant="primary" size="lg">Go to More</ButtonLink>}>Choose the firm this phone bills for in More.</EmptyState>;
}
function FirmWait({ state }: { state: ReturnType<typeof useCustomerFirms> }) {
  const net = useNetwork();
  if (state.selection.loading) return <ListSkeleton rows={4} what="the firm for this phone" />;
  if (state.selection.error) return <>
    <LoadError what="the firm for this phone" problem={state.selection.problem ?? { kind: net === "offline" ? "offline" : "server", message: "The firm for this phone couldn't load." }} />
    <ButtonLink to="/e/more" variant="primary" size="lg">Go to More</ButtonLink>
  </>;
  return <QueryView query={state.query} what="the firms">{() => <NoFirm />}</QueryView>;
}
export function Customers() {
  const state = useCustomerFirms();
  const { firmId, firm } = state;
  const [q, setQ] = useState("");
  const term = useDebounced(q, 300);
  const query = useEasyCustomers(firmId, term);
  const navigate = useNavigate();
  if (!firm) return <EasyPage title="Customers"><FirmWait state={state} /></EasyPage>;
  return <CustomersBody key={firm.id} Frame={EasyPage} firm={firm} query={query} q={q} onSearch={setQ} onStart={(id) => navigate(`/e/new/items?customer=${id}`)} />;
}
export function CustomerNew() {
  const state = useCustomerFirms();
  const { firm, firms } = state;
  const [params] = useSearchParams();
  const back = useBack("/e/customers");
  const { show } = useToast();
  if (!firm) return <EasyPage back title="New customer"><FirmWait state={state} /></EasyPage>;
  const saved = (customer: Customer) => { show({ title: `${customer.name} added`, body: `Tap ${firstName(customer.name)} in the list to make a bill.` }); back(); };
  return <CustomerForm key={firm.id} Frame={EasyPage} firm={firm} firms={firms} initialName={params.get("name") ?? ""} initialPhone={params.get("phone") ?? ""} onSaved={saved} />;
}
export function CustomerEdit() {
  const { one, missing } = useRouteCustomer();
  const state = useCustomerFirms();
  const { firm, firms } = state;
  const back = useBack("/e/customers");
  if (missing || one.data?.type === "walkin") {
    const walkin = one.data?.type === "walkin";
    return <EasyPage back title="Change details"><EmptyState icon={SearchX} title={walkin ? "Walk-in customers have no details to change" : "We can't find this customer"}
      actions={<ButtonLink to="/e/customers" variant="primary" size="lg">Go to Customers</ButtonLink>}>
      {walkin ? "They buy without a name or phone. To keep their details, add them as a customer." : "The link may be old. Customers lists everyone."}
    </EmptyState></EasyPage>;
  }
  if (!firm) return <EasyPage back title="Change details"><FirmWait state={state} /></EasyPage>;
  if (!one.data || one.isPlaceholderData) return <EasyPage back title="Change details"><QueryView query={one} what="this customer">{() => <ListSkeleton rows={4} what="the customer" />}</QueryView></EasyPage>;
  return <CustomerForm key={one.data.id} Frame={EasyPage} firm={firm} firms={firms} existing={one.data} onSaved={back} />;
}
export default Customers;
