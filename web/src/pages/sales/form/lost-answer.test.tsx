import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { AxiosError } from "axios";
import { __resetDrafts } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { refuse, wireDetail } from "@/core/sales/fixtures";
import { fakeToday, formServer, mountForm } from "./testing";

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { cleanup(); vi.useRealTimers(); act(() => __setNetState("online")); });

test.each([false, true])("a fast save with a lost answer keeps one draft id and offers the saved bill (keep before retry: %s)", async (keepBeforeRetry) => {
  const user = fakeToday();
  const made: string[] = [];
  let claimed: string | null = null;
  const bill = { id: 501, invoice_number: "KGH/2026-27/34", invoice_date: "2026-10-08", customer_name: "Anil Gupta", status: "active" };
  const { calls } = formServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["POST", "sales/", ({ body }) => {
      const b = body as { invoice_number: string; draft_id: string | null };
      if (claimed && b.draft_id === claimed) return refuse(409, { detail: "This unfinished bill was saved as KGH/2026-27/34 already.", code: "draft_saved", bill });
      if (made.includes(b.invoice_number)) return refuse(409, { detail: "KGH/2026-27/34 is already used.", code: "number_taken", bill, next: { counter: 35, invoice_number: "KGH/2026-27/35" } });
      made.push(b.invoice_number);
      claimed = b.draft_id;
      throw new AxiosError("Network Error", "ERR_NETWORK");
    }],
    ["PUT", /^drafts\/[0-9a-f-]+\/$/, () => { throw new AxiosError("Network Error", "ERR_NETWORK"); }],
  ]);
  const { router } = mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await within(dialog).findByRole("button", { name: "Try again" });
  const firstPost = calls.findIndex((c) => c.method === "POST");
  expect(calls.slice(0, firstPost).some((c) => c.method === "PUT")).toBe(false);
  if (keepBeforeRetry) await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await user.click(within(dialog).getByRole("button", { name: "Try again" }));
  const open = await within(dialog).findByRole("link", { name: "Open KGH/2026-27/34" });
  expect(open).toHaveAttribute("href", "/sales/501");
  expect(within(dialog).queryByRole("button", { name: /^Save as/ })).not.toBeInTheDocument();
  expect(made).toEqual(["34"]);
  expect(claimed).toMatch(/^[0-9a-f-]{36}$/);
  expect(router.state.location.search).toBe(`?draft=${claimed}`);
  expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { draft_id: string }).draft_id)).toEqual([claimed, claimed]);
  if (keepBeforeRetry) {
    const keeps = calls.filter((c) => c.method === "PUT");
    expect(keeps.length).toBeGreaterThan(0);
    expect(keeps.every((c) => c.url === `drafts/${claimed}/`)).toBe(true);
  }
});
