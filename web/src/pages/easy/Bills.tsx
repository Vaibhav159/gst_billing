import { BillsBody } from "./BillsBody";
import { useNetwork } from "@/core/api/network";
import { ButtonLink, EmptyState, ListSkeleton, LoadError } from "@/core/ui";
import type { BillRow } from "@/core/sales/types";
import { useFlash } from "@/pages/sales/list/parts";
import { useEasyBills } from "./queries";
import { useEasyFirm } from "./state";
import { BillRows, EasyPage, NewBillButton } from "./parts";

function Rows({ bills, withDate, longDate }: { bills: BillRow[]; withDate: boolean; longDate: boolean }) {
  const flash = useFlash(bills.map((bill) => bill.id));
  return <BillRows bills={bills} flash={flash} withDate={withDate} longDate={longDate} />;
}

export default function Bills() {
  const selection = useEasyFirm();
  const { firmId, firm } = selection;
  const network = useNetwork();
  return <EasyPage title="Bills" subtitle={firm ? `${firm.name} · sales bills` : undefined} docTitle="Easy mode · Bills" bar={<NewBillButton />}>
    {firmId !== null ? <BillsBody useBills={useEasyBills} firmId={firmId} renderRows={(rows, options) => <Rows bills={rows} {...options} />} />
      : selection.loading ? <ListSkeleton rows={4} what="the firm for this phone" />
        : selection.error ? <><LoadError what="the firm for this phone" problem={selection.problem ?? { kind: network === "offline" ? "offline" : "server", message: "The firm for this phone couldn't load." }} /><ButtonLink to="/e/more" variant="primary" size="lg">Go to More</ButtonLink></>
          : <EmptyState title="Choose a firm first" actions={<ButtonLink to="/e/more" variant="primary" size="lg">Go to More</ButtonLink>}>Choose the firm this phone bills for in More.</EmptyState>}
  </EasyPage>;
}
