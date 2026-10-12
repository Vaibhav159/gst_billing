import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { wireDetail } from "@/core/sales/fixtures";
import { formServer, mountForm } from "./testing";

beforeEach(() => {
  localStorage.clear(); __resetDeviceDrafts(); __resetDrafts();
  // The 0/100 ms assertions must stay inside the debounce even on a busy runner.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); act(() => __setNetState("online")); });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
// Let setup/answers draw by stepping fake time; never advance implicitly inside the debounce assertions.
async function drawn(check: () => void) {
  for (let left = 20; left > 0; left -= 1) {
    await advance(50);
    try { check(); return; } catch (error) { if (left === 1) throw error; }
  }
}
const checks = () => within(screen.getByRole("complementary", { name: "Bill summary" })).getByRole("list", { name: "Checks on this bill" });

test.each([0, 100, 400])("Yesterday then Ctrl S after %i ms keeps a counter bill's review available while its number waits", async (ms) => {
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/new?from=412");
  await drawn(() => expect(screen.getByText("Copied from KGH/2026-27/31")).toBeInTheDocument());
  const number = screen.getByLabelText("Bill number");
  await drawn(() => expect(number).toHaveValue("34"));
  await advance(400); // the page's click guard
  fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
  await advance(ms);
  if (ms >= 300) await drawn(() => expect(number).toHaveValue("34"));
  expect(number).toHaveValue("34");
  expect(checks()).not.toHaveTextContent("This number can't be used");
  expect(number).not.toHaveAttribute("aria-invalid", "true");
  if (ms < 300) expect(checks()).toHaveTextContent("Getting the next number");

  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  // Synchronous queries keep the assertions inside the requested 0/100 ms window.
  const review = screen.getByRole("dialog", { name: "Check the bill before saving" });
  const save = within(review).getByRole("button", { name: "Save bill" });
  if (ms < 300) {
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "Getting the next number");
    expect(within(review).getByRole("list", { name: "Checked before saving" })).toHaveTextContent("Getting the next number");
    expect(calls.filter((c) => c.url === "sales/next-number/" && c.params.invoice_date === "2026-10-07")).toHaveLength(0);
    await advance(400);
  }
  await drawn(() => expect(save).toBeEnabled());
  expect(within(review).getByText("Bill no.").parentElement).toHaveTextContent("KGH/2026-27/34");
  expect(calls.filter((c) => c.method === "POST" && c.url === "sales/")).toHaveLength(0);
});

test.each([0, 100])("a typed paper number stays checking during the date's debounce at %i ms", async (ms) => {
  const { calls } = formServer();
  mountForm("/sales/new?paper=1&firm=3&date=2026-09-29&number=35");
  await drawn(() => expect(checks()).toHaveTextContent("KGH/2026-27/35 from the paper bill is free"));
  await advance(400);
  fireEvent.change(screen.getByRole("textbox", { name: /Date on the paper bill/ }), { target: { value: "28/09/2026" } });
  await advance(ms);
  expect(checks()).toHaveTextContent("Checking that KGH/2026-27/35 is free");
  expect(checks()).not.toHaveTextContent("checked when it saves");
  expect(calls.filter((c) => c.url === "sales/check-number/" && c.params.invoice_date === "2026-09-28")).toHaveLength(0);
  await advance(400);
  await drawn(() => expect(checks()).toHaveTextContent("KGH/2026-27/35 from the paper bill is free"));
  expect(calls.filter((c) => c.url === "sales/check-number/" && c.params.invoice_date === "2026-09-28")).toHaveLength(1);
});

test.each(["28/09/2024", "28/10/2026"])("a typed number is checked when it saves, never checking, with a disallowed date %s", async (typed) => {
  const { calls } = formServer();
  mountForm("/sales/new?paper=1&firm=3&date=2026-09-29&number=35");
  await drawn(() => expect(checks()).toHaveTextContent("KGH/2026-27/35 from the paper bill is free"));
  const at = calls.length;
  fireEvent.change(screen.getByRole("textbox", { name: /Date on the paper bill/ }), { target: { value: typed } });
  await advance(400);
  expect(checks()).toHaveTextContent("checked when it saves");
  expect(checks()).not.toHaveTextContent("Checking that");
  expect(calls.slice(at).filter((c) => c.url === "sales/check-number/" || c.url === "sales/next-number/" || c.url === "sales/paper-book/")).toHaveLength(0);
});
