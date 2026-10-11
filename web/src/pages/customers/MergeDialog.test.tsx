import { fireEvent, screen } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { toCustomer } from "@/core/api/customers";
import { ANIL, mount, serve, VIEWER, type Call } from "./testing";
import { MergeDialog } from "./MergeDialog";

const source = toCustomer({ ...ANIL, id: 31, name: "Anil G" });
const preview = { source, target: ANIL, can_merge: true, refusal: null,
  bills: { count: 3, cancelled: 1, numbers: ["KGH/2026-27/12"] }, purchases: 2, bin: 1, drafts: 1,
  changes: [], firms_added: [{ id: 4, name: "MEERA ORNAMENTS", short: "Meera" }],
  keeps: "Anil Gupta keeps its name, phone, GSTIN and address." };
const replies = () => ({ "GET customers/": { results: [ANIL] }, "GET customers/7/": ANIL,
  "GET customers/31/merge-preview/": preview,
  "POST customers/31/merge-into/": { target: 7, moved: { bills: 3, purchases: 2, bin: 1, drafts: 1 }, refiled: 0, firms_added: 1 } });
function open(me = {}) {
  return mount([{ path: "/customers/31", element: <MergeDialog source={source} initialTarget={7} onClose={() => {}} /> },
    { path: "/customers/7", element: <p>Kept customer</p> }], ["/customers/31"], { me });
}
beforeEach(() => handClock());
afterEach(() => vi.useRealTimers());

test("a warning puts the customer first but never selects them or previews until picked", async () => {
  const calls = serve(replies()); open(); await pass(400);
  expect(screen.getByRole("radio", { name: /Anil Gupta/ })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  expect(calls.some(c => c.url.includes("merge-preview"))).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: /Anil Gupta/ })); await pass();
  expect(calls.find(c => c.url.includes("merge-preview"))?.params).toEqual({ into: 7 });
  expect(screen.getByText(preview.keeps)).toBeInTheDocument();
  expect(screen.getByText(/2 purchase bills/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Merge into Anil Gupta" })).toBeDisabled();
});

test("an explicit irreversible acknowledgement sends only into once and opens the kept customer", async () => {
  const calls = serve(replies()); const { router } = open(); await pass(400);
  fireEvent.click(screen.getByRole("radio", { name: /Anil Gupta/ })); await pass();
  fireEvent.click(screen.getByRole("checkbox", { name: /can't be undone from the Audit log/ }));
  fireEvent.click(screen.getByRole("button", { name: "Merge into Anil Gupta" })); await pass();
  expect(calls.filter(c => c.method === "POST")).toMatchObject([{ url: "customers/31/merge-into/", data: { into: 7 } }]);
  expect(router.state.location.pathname).toBe("/customers/7");
});

test.each(["month_closed", "sent_changes", "walkin"])("a %s refusal stays in server words and never enables merge", async code => {
  const detail = "The paper copy the customer has wouldn't match your return.";
  const calls = serve({ ...replies(), "GET customers/31/merge-preview/": { ...preview, can_merge: false, refusal: { code, detail, months: [], bills: [] } } });
  open(); await pass(400); fireEvent.click(screen.getByRole("radio", { name: /Anil Gupta/ })); await pass();
  expect(screen.getByText(detail)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Merge into Anil Gupta" })).toBeDisabled();
  expect(calls.some(c => c.method === "POST")).toBe(false);
});

test("a late conflict clears acknowledgement and reloads the preview without an automatic retry", async () => {
  const calls = serve({ ...replies(), "POST customers/31/merge-into/": (_c: Call) => ({ status: 409, data: { code: "month_closed", detail: "September is filed and locked." } }) });
  open(); await pass(400); fireEvent.click(screen.getByRole("radio", { name: /Anil Gupta/ })); await pass();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Merge into Anil Gupta" })); await pass();
  expect(screen.getByText("September is filed and locked.")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(calls.filter(c => c.url.endsWith("merge-preview/")).length).toBe(2);
  expect(calls.filter(c => c.method === "POST")).toHaveLength(1);
});

test("a viewer cannot open the merge dialog or ask for a preview", async () => {
  const calls = serve(replies()); open(VIEWER); await pass(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.filter(c => c.url.includes("merge") || c.url === "customers/")).toHaveLength(0);
});
