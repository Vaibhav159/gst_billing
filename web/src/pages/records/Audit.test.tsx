import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { saveFile } from "@/core/print/files";
import Audit from "./Audit";

vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));
const entry = {
  id: 9012, at: "2026-10-07T15:14:00+05:30", by: { id: 1, name: "Kailash Mehta" }, action: "updated", entity: "customer", entity_id: 7,
  kind: "records", group: "change", words: { text: "Edited customer", target: "Priya Sharma", after: "exact server suffix" }, link: "/customers/7", note: "", details: "phone",
  changes: [{ key: "mobile_number", field: "Phone", from: "98290 41122", to: "98290 41123" }], result: "reverted", can: null,
};
const page = { count: 31, next: "/api/audit/?page=2", previous: null, results: [entry], total: 5123,
  counts: { all: 5123, sales: 2101, purchases: 611, records: 1840, filing: 96, admin: 41, backup: 434 },
  people: [{ id: 1, name: "Kailash Mehta" }, { id: null, name: "Someone no longer here" }],
};
afterEach(() => { vi.clearAllMocks(); (window as unknown as { __phone?: boolean }).__phone = false; });

test("ports the server's sentence, field changes and result, and loads the next thirty on demand", async () => {
  const calls = serve({ "GET audit/": ({ params }: { params: Record<string, unknown> }) => ({ status: 200, data: Number(params.page) === 1 ? page : { ...page, next: null, counts: undefined, people: undefined, results: [{ ...entry, id: 9011, words: { text: "Made bill", target: "KGH/2026-27/31", after: "" }, link: "/sales/412", changes: [], result: null }] } }) });
  renderApp(<Audit />);
  expect(await screen.findByRole("link", { name: "Priya Sharma" })).toHaveAttribute("href", "/customers/7");
  expect(screen.getByText(/exact server suffix/)).toBeInTheDocument();
  expect(screen.getByText("98290 41122")).toHaveClass("line-through");
  expect(screen.getByText("98290 41123")).toBeInTheDocument();
  expect(screen.getByText("Reverted")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load 30 more" }));
  expect(await screen.findByRole("link", { name: "KGH/2026-27/31" })).toBeInTheDocument();
  expect(calls[1].params.counts).toBeUndefined();
});

test("address filters and person/action changes feed the same CSV filters", async () => {
  const calls = serve({ "GET audit/": { ...page, count: 1, next: null }, "GET audit/export/": new Blob(["csv"]) });
  renderApp(<Audit />, { path: "/audit?kind=records&q=Priya&entity=customer&entity_id=7&start_date=2026-03-31&end_date=2026-04-01" });
  await screen.findByRole("link", { name: "Priya Sharma" });
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "none" } });
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "change" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Export 1 entry" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Export 1 entry" }));
  await waitFor(() => expect(saveFile).toHaveBeenCalled());
  expect(calls.find((c) => c.url === "audit/export/")?.params).toEqual({ kind: "records", q: "Priya", by: "none", group: "change", entity: "customer", entity_id: 7, start_date: "2026-03-31", end_date: "2026-04-01" });
});

test("viewer sees the access explanation and makes no audit request", async () => {
  const calls = serve({ "GET audit/": page });
  renderApp(<Audit />, { me: { role: "viewer", permissions: ["view", "reports.export"] } });
  expect(screen.getByText("The audit log is for the owner and the accountant")).toBeInTheDocument();
  await waitFor(() => expect(calls).toHaveLength(0));
});

test("a phone retains labels and first-page counts; accountant cannot act", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET audit/": { ...page, results: [{ ...entry, result: null, can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect: "" } }] } });
  renderApp(<Audit />, { me: { role: "accountant", permissions: ["view", "audit.view"] } });
  expect(await screen.findByText("The owner can restore this")).toBeInTheDocument();
  expect(screen.getByLabelText("Kind of change")).toHaveTextContent("All changes · 5123");
  expect(screen.queryByRole("button", { name: /Restore Priya/ })).not.toBeInTheDocument();
});

test("server failure is retryable; an empty successful list is not shown as a loading failure", async () => {
  let fail = true;
  serve({ "GET audit/": () => fail ? { status: 500 } : { status: 200, data: { ...page, count: 0, results: [], next: null } } });
  renderApp(<Audit />);
  expect(await screen.findByText("Couldn't load the audit log")).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No changes match")).toBeInTheDocument();
});
