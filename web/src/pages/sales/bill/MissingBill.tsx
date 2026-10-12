import { ReceiptText } from "lucide-react";
import { ButtonLink, Card, EmptyState, Page } from "@/core/ui";

/** No bill has this id (PROTO sales/BillForm.jsx:85-94). */
export function MissingBill({ id }: { id: string }) {
  return (
    <Page icon={ReceiptText} title="Bill not found" breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      <Card><EmptyState icon={ReceiptText} title="This bill isn't here" actions={<><ButtonLink to="/sales" variant="primary">Go to Sales</ButtonLink><ButtonLink to="/audit">Open the Audit log</ButtonLink></>}>
        No sales bill has the id “{id}”. It may have been deleted; deleted bills can be restored from the Audit log.
      </EmptyState></Card>
    </Page>
  );
}
