import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { WorkbookDialog } from "./WorkbookDialog";
import { excelBlob, type Sheet } from "@/core/excel/writer";
import { saveFile } from "@/core/print/files";

vi.mock("@/core/excel/writer", () => ({ excelBlob: vi.fn() }));
vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));
const sheets: Sheet[] = [{ name: "Summary", cols: [170, 112], rows: [{ kind: "data", cells: [{ v: "Sales" }, { v: "80396.81", num: true }] }] },
  { name: "KIRAN", cols: [100], rows: [{ kind: "data", cells: [{ v: "6.400" }] }] }];
const props = { open: true, onClose: vi.fn(), file: "GST_Report.xlsx", description: "Sales and purchases", sheets, audit: "CA workbook, All firms, Sep 2026", permission: "reports.export" as const };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.mocked(excelBlob).mockReset().mockResolvedValue(new Blob(["xlsx"])); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "Download Excel" })).toBeEnabled()); act(() => { vi.setSystemTime(Date.now() + 400); }); }

test("preview tabs use the exact workbook rows; only downloading logs the export", async () => {
  const calls = serve({ "POST audit-logs/log/": {} });
  renderApp(<WorkbookDialog {...props} />);
  expect(screen.getByRole("table", { name: "Sheet Summary" })).toHaveTextContent("80,396.81");
  await ready();
  expect(calls).toHaveLength(0);
  fireEvent.click(screen.getByRole("tab", { name: "KIRAN" }));
  expect(screen.getByRole("table", { name: "Sheet KIRAN" })).toHaveTextContent("6.400");
  fireEvent.click(screen.getByRole("button", { name: "Download Excel" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), "GST_Report.xlsx");
  expect(calls[0].data).toEqual({ action: "exported", entity: "report", entity_id: 0, entity_name: "CA workbook, All firms, Sep 2026", details: "GST_Report.xlsx" });
});

test("a rejected file build keeps the preview and retries without an audit row", async () => {
  vi.mocked(excelBlob).mockRejectedValueOnce(new Error("failed"));
  const calls = serve({}); renderApp(<WorkbookDialog {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The file couldn't be made");
  expect(calls).toHaveLength(0); expect(saveFile).not.toHaveBeenCalled();
  act(() => { vi.setSystemTime(Date.now() + 400); });
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await ready();
  expect(screen.getByRole("table", { name: "Sheet Summary" })).toBeInTheDocument();
});

test("a late file build for an old preview cannot enable the new file", async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(excelBlob).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  let change!: () => void;
  function Harness() { const [changed, setChanged] = useState(false); change = () => setChanged(true); return <WorkbookDialog {...props} file={changed ? "Other.xlsx" : props.file} sheets={changed ? [sheets[1]] : sheets} />; }
  renderApp(<Harness />);
  vi.mocked(excelBlob).mockReturnValueOnce(new Promise(() => {}));
  act(() => change());
  await act(async () => finish(new Blob(["old"])));
  expect(screen.getByRole("button", { name: "Download Excel" })).toBeDisabled();
});

test("reconciliation downloads need gst.download while report exports allow a viewer", async () => {
  const auth = { role: "viewer" as const, permissions: ["view", "reports.export"] as ("view" | "reports.export")[] };
  const view = renderApp(<WorkbookDialog {...props} permission="gst.download" />, { me: auth });
  expect(screen.getByRole("button", { name: "Download Excel" })).toBeDisabled();
  expect(excelBlob).not.toHaveBeenCalled();
  view.unmount(); renderApp(<WorkbookDialog {...props} />, { me: auth }); await ready();
});

test("an audit failure says the file downloaded after saving it exactly once", async () => {
  serve({ "POST audit-logs/log/": () => ({ status: 500 }) });
  renderApp(<WorkbookDialog {...props} />); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Download Excel" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The file downloaded, but the Audit log couldn't record it.");
  expect(saveFile).toHaveBeenCalledTimes(1);
});
test("a previous workbook's failed audit never labels a newer preview", async () => {
  let refuse!: (value: { status: number }) => void;
  serve({ "POST audit-logs/log/": () => new Promise((resolve) => { refuse = resolve; }) });
  let change!: () => void;
  function Harness() { const [file, setFile] = useState(props.file); change = () => setFile("New.xlsx"); return <WorkbookDialog {...props} file={file} />; }
  renderApp(<Harness />); await ready(); fireEvent.click(screen.getByRole("button", { name: "Download Excel" }));
  await waitFor(() => expect(refuse).toBeDefined()); act(() => change());
  await act(async () => refuse({ status: 500 }));
  expect(screen.queryByText("The file downloaded, but the Audit log couldn't record it.")).not.toBeInTheDocument();
});
