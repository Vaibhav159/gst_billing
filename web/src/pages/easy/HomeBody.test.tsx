import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { salesServer, wirePage, wireRow } from "@/core/sales/fixtures";
import { toDraft, type UnfinishedBill } from "@/core/draftData";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { __resetDrafts } from "@/core/api/drafts";
import { useSalesPage } from "@/core/api/sales";
import { HomeBody, type HomeDue } from "./HomeBody";

const done = vi.fn();
const d: UnfinishedBill = { ...toDraft({ id: "10000000-0000-4000-8000-000000000001", business: 3,
  started_by: { id: 2, name: "Rakesh Soni" }, created_at: "2026-10-08T15:20:00+05:30", updated_at: "2026-10-08T15:20:00+05:30",
  data: { v: 1, firmId: 3, date: "2026-09-30", paper: true, customer: { id: 7, name: "Lalit Jain" }, lines: [{ name: "Gold bangles 22K", qty: null }] },
}), onDevice: false };
function Harness({ firmId = 3 as number | null, seen = true, drafts = [] as UnfinishedBill[], failDue = false }) {
  const sales = useSalesPage(firmId, { start_date: "2026-10-08", end_date: "2026-10-08", ordering: "-date" }, 50);
  const due = useQuery<HomeDue>({ queryKey: ["due-test", firmId], queryFn: async () => {
    if (failDue) throw new Error("unavailable");
    return { items: [{ kind: "unsent", count: 121 }] };
  }, enabled: firmId !== null });
  return <HomeBody sales={sales} fetchUnsent={async () => []} firmId={firmId} today="2026-10-08" welcome={{ seen, done }} drafts={{ bills: drafts, loading: false, answered: true }} due={due}
    renderRows={(rows) => <ul>{rows.map((r) => <li key={r.id}>{r.invoice_number}</li>)}</ul>}
    rates={<section aria-label="Today's rates">Not set today</section>} />;
}
beforeEach(() => { Object.assign(window, { __phone: true }); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T18:01:00+05:30")); __resetDeviceDrafts(); __resetDrafts(); done.mockClear(); });
afterEach(() => { Object.assign(window, { __phone: false }); vi.useRealTimers(); });
it("shows the server totals, six rows and a 121-bill end-of-day count; rates stay below sales", async () => {
  const page = wirePage(Array.from({ length: 50 }, (_, i) => wireRow({ id: i + 1, invoice_number: String(i + 1) })), { count: 123,
    summary: { bills: 121, total_amount: "123456.78", cancelled: 2 } });
  const s = salesServer([["GET", "sales/", () => page]]);
  renderApp(<Harness />);
  expect(await screen.findByText("Sales today")).toBeVisible();
  expect(await screen.findByText("121 not sent")).toBeVisible();
  expect(screen.getAllByText("₹1,23,456.78").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getByRole("link", { name: "See all 123 of today's bills" })).toHaveAttribute("href", "/e/bills");
  const sales = screen.getByRole("heading", { name: "Sales today" });
  expect(sales.compareDocumentPosition(screen.getByRole("region", { name: "Today's rates" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(s.calls.find((c) => c.url === "sales/")?.params).toEqual({ business_id: 3, start_date: "2026-10-08", end_date: "2026-10-08", ordering: "-date", page: 1, page_size: 50 });
});
it("does not show money or clear-all words while today's sales are unanswered", () => {
  salesServer([["GET", "sales/", () => new Promise(() => {})]]);
  renderApp(<Harness />);
  expect(screen.queryByText(/₹0/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Every bill is sent/)).not.toBeInTheDocument();
});
it("does not ask for sales before the Easy firm is known", () => {
  const s = salesServer(); renderApp(<Harness firmId={null} />);
  expect(s.calls.filter((c) => c.url === "sales/")).toEqual([]);
});
it("keeps an earlier-day draft in Easy, but visits the full view for an explicit place of supply", async () => {
  salesServer([["GET", "sales/", () => wirePage([])]]);
  renderApp(<Harness drafts={[d, { ...d, id: "other", data: { ...d.data, posOverride: "27" } }]} />);
  const finishes = screen.getAllByRole("link", { name: "Finish" });
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toHaveAttribute("href", `/e/new/items?draft=${d.id}`);
  expect(screen.getByRole("link", { name: "Finish in the full view" })).toHaveAttribute("href", "/sales/new?draft=other");
  expect(screen.getAllByText("Started 15:20 by Rakesh Soni")).toHaveLength(2);
});
it("a viewer sees role-specific welcome and cannot remove, finish or send", async () => {
  salesServer([["GET", "sales/", () => wirePage([wireRow()])]]);
  renderApp(<Harness seen={false} drafts={[d]} />, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.getByText("See today's bills.")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Finish" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bills" })).not.toBeInTheDocument();
  const fold = screen.getByRole("heading", { name: "Welcome to Easy mode" }).closest(".fold");
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(fold).toHaveAttribute("data-open", "false");
  expect(fold).toHaveAttribute("inert");
  expect(done).not.toHaveBeenCalled();
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it("staff only remove the draft they started; Undo preserves its starter and earlier date", async () => {
  const s = salesServer([["GET", "sales/", () => wirePage([])], ["DELETE", /^drafts\//, () => null], ["PUT", /^drafts\//, ({ body }) => ({ ...d, ...(body as object) })]]);
  renderApp(<Harness drafts={[d, { ...d, id: "someone-else", started_by: { id: 4, name: "Other" } }]} />, { me: { id: 2, role: "staff", permissions: ["view", "bill.create"] } });
  expect(screen.getAllByRole("button", { name: /Remove .*unfinished bill/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /Remove .*unfinished bill/ }));
  const undo = await screen.findByRole("button", { name: "Undo" });
  await act(async () => fireEvent.click(undo));
  expect(s.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ business: 3, data: { date: "2026-09-30", paper: true } });
});
it("a failed due-next read cannot say every bill is sent", async () => {
  salesServer([["GET", "sales/", () => wirePage([wireRow()])]]);
  renderApp(<Harness failDue />);
  expect(await screen.findByText(/Couldn't load the end-of-day count/)).toBeVisible();
  expect(screen.queryByText("Every bill is sent and nothing is left unfinished.")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Today's rates" })).getByText("Not set today")).toBeVisible();
});
it("retains figures but withholds the all-clear during a count refresh and after its failure", async () => {
  const zero = { items: [{ kind: "unsent", count: 0 }] };
  let rejectRefresh!: (error: Error) => void;
  const read = vi.fn().mockResolvedValueOnce(zero).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; })).mockResolvedValue(zero);
  function RefreshHome() {
    const sales = useSalesPage(3, { start_date: "2026-10-08", end_date: "2026-10-08" });
    const due = useQuery<HomeDue>({ queryKey: ["refresh-due"], queryFn: read });
    return <><button onClick={() => void due.refetch()}>Refresh count</button><HomeBody sales={sales} due={due} firmId={3} today="2026-10-08" welcome={{ seen: true, done }}
      fetchUnsent={async () => []} drafts={{ bills: [], loading: false, answered: true }} rates={null} renderRows={() => null} /></>;
  }
  salesServer([["GET", "sales/", () => wirePage([wireRow()], { summary: { bills: 1, total_amount: "1234.56", cancelled: 0 } })]]);
  renderApp(<RefreshHome />);
  const clear = "Every bill is sent and nothing is left unfinished.";
  expect(await screen.findByText(clear)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh count" }));
  await waitFor(() => expect(rejectRefresh).toBeDefined());
  expect(screen.queryByText(clear)).not.toBeInTheDocument();
  expect(within(screen.getAllByRole("region", { name: "End of the day" })[0]).getByText("₹1,234.56")).toBeVisible();
  await act(async () => rejectRefresh(new Error("unavailable")));
  await waitFor(() => expect(screen.getAllByRole("region", { name: "End of the day" })[0]).toHaveTextContent("Couldn't refresh"));
  expect(screen.queryByText(clear)).not.toBeInTheDocument();
  expect(within(screen.getAllByRole("region", { name: "End of the day" })[0]).getByText("₹1,234.56")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh count" }));
  expect(await screen.findByText(clear)).toBeVisible();
});
it("Undo is available while DELETE is still waiting for the server", async () => {
  let finish!: (value: unknown) => void;
  const s = salesServer([["GET", "sales/", () => wirePage([])], ["DELETE", /^drafts\//, () => new Promise((resolve) => { finish = resolve; })], ["PUT", /^drafts\//, ({ body }) => ({ ...d, ...(body as object) })]]);
  renderApp(<Harness drafts={[d]} />);
  fireEvent.click(screen.getByRole("button", { name: /Remove .*unfinished bill/ }));
  const undo = await screen.findByRole("button", { name: "Undo" });
  expect(s.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  fireEvent.click(undo);
  await act(async () => finish(null));
  expect(s.calls.find((c) => c.method === "PUT")?.body).toMatchObject({ business: 3, data: { date: "2026-09-30", paper: true } });
});
