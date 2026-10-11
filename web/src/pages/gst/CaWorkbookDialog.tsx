import { useMemo } from "react";
import { useCaWorkbook, type WorkbookScope } from "@/core/api/gstExports";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button, Dialog, QueryView } from "@/core/ui";
import { workbookSheets, type CaWorkbook } from "@/core/excel/caWorkbook";
import { WorkbookDialog } from "./WorkbookDialog";

function Loaded({ data, onClose }: { data: CaWorkbook; onClose: () => void }) {
  const sheets = useMemo(() => workbookSheets(data), [data]);
  return <WorkbookDialog open onClose={onClose} sheets={sheets} file={data.file}
    description="A summary, each firm month by month with sales and purchases, GSTR-1, GSTR-3B, and amendments when any. Sales and purchases are never added together."
    audit={`CA workbook, ${data.scope}, ${data.period}`} permission="reports.export" />;
}
export function CaWorkbookDialog({ open, onClose, ...scope }: WorkbookScope & { open: boolean; onClose: () => void }) {
  const { can, whyNot } = useAuth(); const allowed = can("reports.export");
  const query = useCaWorkbook(scope, open && allowed);
  if (!open) return null;
  if (!allowed) return <Dialog open onClose={onClose} title="Excel for the CA"><p>{whyNot("reports.export")}</p></Dialog>;
  if (query.data && !query.isError) return <Loaded key={JSON.stringify(scope)} data={query.data} onClose={onClose} />;
  return <Dialog open onClose={onClose} title="Excel for the CA" footer={<Button onClick={onClose}>Close</Button>}>
    <QueryView query={query} what="the CA workbook">{() => <Button onClick={() => void query.refetch()}>Load the workbook again</Button>}</QueryView>
  </Dialog>;
}
