import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AuthContext } from "@/core/auth/AuthProvider";
import { renderApp, stubAuth } from "@/test/render";
import { serve } from "@/test/server";
import { saveFile } from "@/core/print/files";
import { prepareCaBundle } from "@/core/api/gstExports";
import { CaBundleButton } from "./CaBundleButton";
vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));
vi.mock("@/core/api/gstExports", async (original) => ({ ...await original<typeof import("@/core/api/gstExports")>(), prepareCaBundle: vi.fn() }));
const input = { businessId: 3, month: "2026-09", short: "Kiran", gstin: "08VRHFA2322D1ZI", split: false, includeGstr1: true };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T06:00:00+05:30")); vi.mocked(prepareCaBundle).mockResolvedValue({ name: "GST_Kiran_092026_for_CA.zip", blob: new Blob(["zip"]), parts: ["gstr1", "gstr3b", "excel"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

test("one press downloads one zip then records exactly its included parts", async () => {
  const calls = serve({ "POST gst/files/bundle/": {} });
  renderApp(<CaBundleButton input={input} />);
  expect(prepareCaBundle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(saveFile).toHaveBeenCalledTimes(1);
  expect(calls[0].data).toEqual({ business: 3, month: "2026-09", via: "download", parts: ["gstr1", "gstr3b", "excel"] });
});
test("staff and viewer cannot prepare a bundle; a running month also waits", () => {
  const view = renderApp(<CaBundleButton input={input} />, { me: { role: "viewer", permissions: ["view", "reports.export"] } });
  expect(screen.getByRole("button", { name: "CA bundle" })).toBeDisabled();
  view.unmount(); renderApp(<CaBundleButton input={{ ...input, month: "2026-10" }} />);
  expect(screen.getByRole("button", { name: "CA bundle" })).toBeDisabled();
  expect(prepareCaBundle).not.toHaveBeenCalled();
});
test("failed preparation preserves the action for retry and records no bundle", async () => {
  vi.mocked(prepareCaBundle).mockRejectedValueOnce(new Error("could not build"));
  const calls = serve({}); renderApp(<CaBundleButton input={input} />);
  fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The file couldn't be made");
  expect(saveFile).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
});
test("leaving the page while a bundle is being made prevents a late download", async () => {
  let finish!: (v: Awaited<ReturnType<typeof prepareCaBundle>>) => void;
  vi.mocked(prepareCaBundle).mockReturnValueOnce(new Promise((r) => { finish = r; }));
  const view = renderApp(<CaBundleButton input={input} />);
  fireEvent.click(screen.getByRole("button", { name: "CA bundle" })); view.unmount();
  await act(async () => finish({ name: "old.zip", blob: new Blob(["old"]), parts: ["excel", "gstr3b"] }));
  expect(saveFile).not.toHaveBeenCalled();
});
test("changing the month clears the previous month's preparation error", async () => {
  vi.mocked(prepareCaBundle).mockRejectedValueOnce(new Error("failed"));
  let change!: () => void;
  function Harness() { const [month, setMonth] = useState(input.month); change = () => setMonth("2026-08"); return <CaBundleButton input={{ ...input, month }} />; }
  renderApp(<Harness />); fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  await screen.findByRole("alert"); act(() => change());
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
test("a logging failure reports a downloaded zip, and a late scope's result never downloads", async () => {
  serve({ "POST gst/files/bundle/": () => ({ status: 500 }) });
  let change!: () => void;
  function Harness() { const [id, setId] = useState(3); change = () => setId(7); return <CaBundleButton input={{ ...input, businessId: id }} />; }
  renderApp(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The bundle downloaded, but its record couldn't be saved.");
  let finish!: (v: Awaited<ReturnType<typeof prepareCaBundle>>) => void;
  vi.mocked(prepareCaBundle).mockReturnValueOnce(new Promise((r) => { finish = r; }));
  fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  act(() => change());
  await act(async () => finish({ name: "old.zip", blob: new Blob(["old"]), parts: ["excel", "gstr3b"] }));
  expect(saveFile).toHaveBeenCalledTimes(1);
});
test("an old firm's late preparation error does not label the newly selected firm", async () => {
  let refuse!: (error: Error) => void; let change!: () => void;
  vi.mocked(prepareCaBundle).mockReturnValueOnce(new Promise((_resolve, reject) => { refuse = reject; }));
  function Harness() { const [id, setId] = useState(3); change = () => setId(7); return <CaBundleButton input={{ ...input, businessId: id }} />; }
  renderApp(<Harness />); fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  await waitFor(() => expect(prepareCaBundle).toHaveBeenCalledTimes(1));
  act(() => change()); await act(async () => refuse(new Error("old failure")));
  await waitFor(() => expect(screen.getByRole("button", { name: "CA bundle" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(saveFile).not.toHaveBeenCalled();
});
test("returning to the original firm never revives its abandoned bundle", async () => {
  let finish!: (v: Awaited<ReturnType<typeof prepareCaBundle>>) => void; let select!: (id: number) => void;
  vi.mocked(prepareCaBundle).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  function Harness() { const [id, setId] = useState(3); select = setId; return <CaBundleButton input={{ ...input, businessId: id }} />; }
  serve({ "POST gst/files/bundle/": {} });
  renderApp(<Harness />); fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  await waitFor(() => expect(prepareCaBundle).toHaveBeenCalledTimes(1));
  act(() => select(7)); act(() => select(3));
  await act(async () => finish({ name: "old.zip", blob: new Blob(["old"]), parts: ["gstr3b", "excel"] }));
  expect(saveFile).not.toHaveBeenCalled();
});

test("a permission loss while preparing discards the old download", async () => {
  let finish!: (v: Awaited<ReturnType<typeof prepareCaBundle>>) => void; let revoke!: () => void;
  vi.mocked(prepareCaBundle).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  function Harness() { const [owner, setOwner] = useState(true); revoke = () => setOwner(false); return <AuthContext.Provider value={stubAuth(owner ? undefined : { role: "viewer", permissions: ["view", "reports.export"] })}><CaBundleButton input={input} /></AuthContext.Provider>; }
  serve({ "POST gst/files/bundle/": {} }); renderApp(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "CA bundle" }));
  await waitFor(() => expect(prepareCaBundle).toHaveBeenCalledTimes(1)); act(() => revoke());
  await act(async () => finish({ name: "old.zip", blob: new Blob(["old"]), parts: ["gstr3b", "excel"] }));
  expect(saveFile).not.toHaveBeenCalled();
});
