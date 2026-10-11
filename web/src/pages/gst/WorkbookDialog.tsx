import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useView } from "@/core/view";
import { cn } from "@/core/cn";
import { groupIN, plural } from "@/core/format";
import { Button, Dialog, FailNote, Tabs } from "@/core/ui";
import { excelBlob, type Sheet } from "@/core/excel/writer";
import { saveFile } from "@/core/print/files";
import { logReport } from "@/core/api/gstExports";

function column(index: number) { let s = ""; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
const KIND = { title: "bg-brand-tint text-brand font-semibold", band: "bg-raised font-semibold", sub: "bg-field text-fg2", head: "bg-raised text-fg2 font-semibold text-center text-2xs uppercase tracking-caps", total: "bg-raised font-semibold border-t-2 border-t-line", data: "", blank: "", fail: "text-neg font-semibold" };
function previewValue(value: string | number, numeric?: boolean) {
  const match = numeric && /^(-?)(\d+)(\.\d+)?$/.exec(String(value));
  return match && Number.isSafeInteger(Number(match[2])) ? `${match[1] ? "−" : ""}${groupIN(Number(match[2]))}${match[3] || ""}` : value;
}

export function SheetGrid({ sheet, limit = 90 }: { sheet: Sheet; limit?: number }) {
  const rows = sheet.rows.slice(0, limit); const more = sheet.rows.length - rows.length;
  return <div className="scroll-x rounded-ctl border border-line max-h-[56vh] overflow-y-auto bg-card" role="region" aria-label={`Preview ${sheet.name}`} tabIndex={0}>
    <table className="border-collapse text-xs tnum" aria-label={`Sheet ${sheet.name}`} style={{ minWidth: sheet.cols.reduce((a, c) => a + c, 40) }}>
      <thead className="sticky top-0 z-[1]"><tr><th scope="col" className="sticky left-0 bg-raised border border-line w-10 text-muted font-normal"><span className="sr-only">Row</span></th>
        {sheet.cols.map((w, i) => <th key={i} scope="col" className="bg-raised border border-line text-muted font-normal px-1" style={{ width: w }}>{column(i)}</th>)}
      </tr></thead>
      <tbody>{rows.map((row, index) => {
        const used = row.cells.reduce((n, cell) => n + (cell.span || 1), 0);
        return <tr key={index}><th scope="row" className="sticky left-0 bg-raised border border-line text-muted font-normal text-center w-10">{index + 1}</th>
          {row.cells.map((cell, i) => <td key={i} colSpan={cell.span || 1} className={cn("border border-rule px-2 py-1 whitespace-nowrap", KIND[cell.kind || row.kind], cell.num && "text-right", cell.center && "text-center")}>{previewValue(cell.v, cell.num)}</td>)}
          {used < sheet.cols.length ? <td colSpan={sheet.cols.length - used} className="border border-rule" /> : null}
        </tr>;
      })}{more > 0 ? <tr><th scope="row" className="sticky left-0 bg-raised border border-line"><span className="sr-only">More</span></th><td colSpan={sheet.cols.length} className="px-3 py-2 text-muted italic">… {plural(more, "more row")} in the file</td></tr> : null}</tbody>
    </table>
  </div>;
}

type Props = { open: boolean; onClose: () => void; file: string; description: string; sheets: Sheet[]; audit: string; permission: "gst.download" | "reports.export" };
export function WorkbookDialog({ open, onClose, file, description, sheets, audit, permission }: Props) {
  const { isPhone } = useView(); const { can, whyNot } = useAuth();
  const allowed = can(permission); const [tab, setTab] = useState(0); const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState<{ file: string; sheets: Sheet[]; blob: Blob } | null>(null);
  const [failed, setFailed] = useState(false); const [logFailed, setLogFailed] = useState(false);
  const [logging, setLogging] = useState(false); const busy = useRef(false); const generation = useRef(0);
  useEffect(() => { setTab(0); }, [open, file]);
  useEffect(() => {
    let current = true; generation.current += 1; busy.current = false; setLogging(false); setReady(null); setFailed(false); setLogFailed(false);
    if (open && allowed && sheets.length) void excelBlob(sheets).then((blob) => { if (current) setReady({ file, sheets, blob }); }, () => { if (current) setFailed(true); });
    return () => { current = false; generation.current += 1; };
  }, [open, allowed, file, sheets, attempt]);
  const sheet = sheets[Math.min(tab, sheets.length - 1)];
  const fileReady = ready?.file === file && ready.sheets === sheets;
  const download = () => {
    if (!allowed || !fileReady || !ready || busy.current) return;
    const began = generation.current;
    saveFile(ready.blob, file); busy.current = true; setLogging(true); setLogFailed(false);
    void logReport(audit, file).catch(() => { if (generation.current === began) setLogFailed(true); }).finally(() => { if (generation.current === began) { busy.current = false; setLogging(false); } });
  };
  return <Dialog open={open} onClose={onClose} size="xl" title={file} description={description}
    footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Download} disabled={!allowed || !fileReady} loading={logging} onClick={download}>Download Excel</Button></>}>
    <div className="flex flex-col gap-3">
      {sheets.length > 1 ? <Tabs tabs={sheets.map((s, i) => ({ value: i, label: s.name }))} value={Math.min(tab, sheets.length - 1)} onChange={setTab} label="Sheets in the file" idBase="xl" panelId="xl-panel" /> : <p className="caps">Sheet · {sheet?.name}</p>}
      {sheet ? <div id="xl-panel" role={sheets.length > 1 ? "tabpanel" : undefined} aria-labelledby={sheets.length > 1 ? `xl-${Math.min(tab, sheets.length - 1)}` : undefined}><SheetGrid sheet={sheet} limit={isPhone ? 40 : 90} /></div> : null}
      {sheet?.note ? <p className="text-sm text-muted">{sheet.note}</p> : null}
      {!allowed ? <p className="text-sm text-muted">{whyNot(permission)}</p> : null}
      <FailNote error={failed ? { title: "The file couldn't be made", body: "Something went wrong while making it. Nothing is lost; try again in a minute." } : null} onRetry={() => setAttempt((n) => n + 1)} />
      {logFailed ? <p role="alert" className="text-sm text-neg">The file downloaded, but the Audit log couldn't record it.</p> : null}
    </div>
  </Dialog>;
}
