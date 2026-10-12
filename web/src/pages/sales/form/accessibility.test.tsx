import { act, cleanup, screen, within } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { wireDetail } from "@/core/sales/fixtures";
import { handClock, pass } from "@/test/clock";
import { fakeToday, formServer, mountForm, settle } from "./testing";

vi.setConfig({ testTimeout: 20_000 });
vi.hoisted(() => { Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" }); });

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { cleanup(); (window as unknown as { __phone: boolean }).__phone = false; vi.useRealTimers(); });

test("the Windows bill form keeps Ctrl in its add-line and check-and-save hints", async () => {
  handClock(new Date("2026-10-08T10:00:00+05:30"));
  formServer();
  mountForm("/sales/new");
  await pass(400);
  expect(screen.getByText(/adds a line/).querySelector("kbd")).toHaveTextContent("Ctrl");
  expect(screen.getByText("check and save").querySelector("kbd")).toHaveTextContent("Ctrl");
});

test.each([false, true])("a missing payment is announced and returns focus to its choices (phone: %s)", async (phone) => {
  const user = fakeToday();
  (window as unknown as { __phone: boolean }).__phone = phone;
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/new?from=412");
  await settle();
  await user.keyboard("{Control>}s{/Control}");
  const review = screen.getByRole("dialog", { name: phone ? "Check the bill" : "Check the bill before saving" });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await user.click(within(review).getByRole("button", { name: "Save bill" }));
  const choices = within(review).getByRole("radiogroup", { name: "How was it paid?" });
  expect(within(review).getByRole("alert")).toHaveTextContent("Pick one to save. It goes on the bill and in your cash and bank split.");
  expect(choices).toHaveAccessibleDescription("Pick one to save. It goes on the bill and in your cash and bank split.");
  expect(within(choices).getByRole("radio", { name: "Cash" })).toHaveFocus();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});
