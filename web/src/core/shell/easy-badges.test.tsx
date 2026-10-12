import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { dueNextKeys, type DueData } from "@/core/api/dashboard";
import { AuthContext } from "@/core/auth/AuthProvider";
import { wireRates } from "@/core/rates/testing";
import { wirePage } from "@/core/sales/fixtures";
import { ScopeProvider, useScope, type FirmId } from "@/core/scope";
import { ToastProvider } from "@/core/ui";
import Home from "@/pages/easy/Home";
import { setEasyPref, useEasyFirm } from "@/pages/easy/state";
import { stubAuth, testQueryClient } from "@/test/render";
import { serve, type Answer, type Call, type Reply } from "@/test/server";
import { badgeCode, PhoneShell } from "./PhoneShell";

const firms = { results: [
  { id: 3, name: "Anand", short: "Anand", gst_number: "", state_name: "Rajasthan" },
  { id: 4, name: "Kiran", short: "Kiran", gst_number: "", state_name: "Rajasthan" },
] };
const due = (firm: FirmId, count: number): DueData => ({ today: "2026-10-12", returns: null, items: [{
  kind: "unsent", count, title: `${count} of today's bills haven't been sent`, detail: "", due: null,
  firm: typeof firm === "number" ? firm : null, month: null, draft_id: null, from: null, to: null, badge: null,
}] });

function Surface() {
  const [easy, setEasy] = useState(true);
  const { firmId, setFirmId } = useScope();
  const selection = useEasyFirm();
  return <PhoneShell easy={easy}><main>
    <output aria-label="Full-view firm">{firmId}</output>
    <button onClick={() => selection.setFirm(4)}>Bill for Kiran</button>
    <button onClick={() => setFirmId(3)}>Full view for Anand</button>
    <button onClick={() => setEasy(value => !value)}>Toggle full view</button>
    {easy ? <Home /> : <p>Full view</p>}
  </main></PhoneShell>;
}
function mount(fullFirm: FirmId = "all", overrides: Record<string, Answer> = {}) {
  localStorage.setItem("gst3.scope.1", String(fullFirm));
  const qc = testQueryClient();
  qc.setQueryData(dueNextKeys.one(fullFirm), due(fullFirm, 99));
  const calls = serve({
    "GET preferences/": { data: { phoneMode: "easy", defaultBusinessId: "3" } },
    "GET firms/": firms,
    "GET shop-settings/": { default_business: 3 },
    "GET sales/": wirePage([]),
    "GET drafts/": { count: 0, results: [] },
    "GET rates/": wireRates(),
    "GET due-next/": (call: Call) => ({ status: 200, data: due(Number(call.params.business_id), 6) }),
    ...overrides,
  });
  const router = createMemoryRouter([{ path: "*", element: <ScopeProvider><Surface /></ScopeProvider> }], { initialEntries: ["/e"] });
  render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}>
    <ToastProvider><RouterProvider router={router} /></ToastProvider>
  </AuthContext.Provider></QueryClientProvider>);
  return { qc, calls };
}
beforeAll(async () => { await badgeCode.load(); });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setEasyPref("firm", 1, null); setEasyPref("welcomed", 1, true);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T18:01:00+05:30"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

test.each(["all", 4] as const)("a cold Easy Home fills its own badges while full-view scope is %s", async fullFirm => {
  const h = mount(fullFirm);
  expect(await screen.findByText("6 not sent")).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Bills, 6 not sent" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Bills, 99 not sent" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Full-view firm")).toHaveTextContent(String(fullFirm));
  expect(h.calls.filter(call => call.url === "due-next/")).toEqual([expect.objectContaining({ params: { business_id: 3 } })]);
  expect(h.qc.getQueryData(dueNextKeys.one(3))).toEqual(due(3, 6));
});

test("an Easy firm switch clears the previous badge until its own answer arrives and preserves full-view scope", async () => {
  let finish!: (reply: Reply) => void;
  const h = mount("all", { "GET due-next/": (call: Call) => Number(call.params.business_id) === 4
    ? new Promise<Reply>(resolve => { finish = resolve; }) : { status: 200, data: due(3, 6) } });
  const bills = await screen.findByRole("link", { name: "Bills, 6 not sent" });
  const tabs = screen.getByRole("navigation", { name: "Tabs" });
  bills.focus();
  fireEvent.click(screen.getByRole("button", { name: "Bill for Kiran" }));
  expect(within(tabs).getByRole("link", { name: "Bills" })).toBe(bills);
  expect(bills).toHaveFocus();
  expect(screen.getByLabelText("Full-view firm")).toHaveTextContent("all");
  expect(localStorage.getItem("gst3.scope.1")).toBe("all");
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => { finish({ status: 200, data: due(4, 9) }); });
  expect(await screen.findByRole("link", { name: "Bills, 9 not sent" })).toBe(bills);
  expect(screen.getByRole("navigation", { name: "Tabs" })).toBe(tabs);
  expect(h.calls.filter(call => call.url === "due-next/").map(call => call.params)).toEqual([{ business_id: 3 }, { business_id: 4 }]);

  fireEvent.click(screen.getByRole("button", { name: "Toggle full view" }));
  expect(await screen.findByRole("link", { name: "Bills, 99 not sent" })).toHaveAttribute("href", "/sales");
  fireEvent.click(screen.getByRole("button", { name: "Full view for Anand" }));
  expect(await screen.findByRole("link", { name: "Bills, 6 not sent" })).toHaveAttribute("href", "/sales");
  fireEvent.click(screen.getByRole("button", { name: "Toggle full view" }));
  expect(await screen.findByRole("link", { name: "Bills, 9 not sent" })).toHaveAttribute("href", "/e/bills");
  expect(screen.getByLabelText("Full-view firm")).toHaveTextContent("3");
  expect(h.calls.filter(call => call.url === "due-next/")).toHaveLength(2);
});

test("an unresolved Easy firm never borrows the full-view badges or asks for all firms", async () => {
  let finish!: (reply: Reply) => void;
  const h = mount("all", { "GET firms/": () => new Promise<Reply>(resolve => { finish = resolve; }) });
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole("link", { name: "Bills" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Bills, 99 not sent" })).not.toBeInTheDocument();
  expect(h.calls.some(call => call.url === "due-next/")).toBe(false);
  await act(async () => { finish({ status: 200, data: firms }); });
  expect(await screen.findByRole("link", { name: "Bills, 6 not sent" })).toBeInTheDocument();
  expect(h.calls.filter(call => call.url === "due-next/")).toEqual([expect.objectContaining({ params: { business_id: 3 } })]);
});
