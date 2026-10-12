import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import More from "./More";

const state = vi.hoisted(() => ({ setFirm: vi.fn(), reset: vi.fn() }));
vi.mock("./state", async (importOriginal) => ({
  ...await importOriginal<typeof import("./state")>(),
  useEasyFirm: () => ({ firmId: 2, firm: { id: 2, name: "Anand", short: "Anand", gstin: "", state: "Rajasthan", prefix: "A" }, firms: [
    { id: 2, name: "Anand", short: "Anand", gstin: "", state: "Rajasthan", prefix: "A" },
    { id: 7, name: "Kiran", short: "Kiran", gstin: "", state: "Rajasthan", prefix: "K" },
  ], setFirm: state.setFirm, loading: false, error: false }),
  useWelcome: () => ({ seen: true, done: vi.fn(), reset: state.reset }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T10:00:00+05:30"));
  state.setFirm.mockClear(); state.reset.mockClear(); localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
test("the page wires the Easy choice and enriches it from the existing narrow firms cache", async () => {
  const calls = serve({ "GET preferences/": { data: {} }, "GET firms/": { results: [
    { id: 2, name: "Anand", short: "Anand", short_name: "Anand", gst_number: "", state_name: "Rajasthan", city: "Udaipur", invoice_prefix: "A" },
    { id: 7, name: "Kiran", short: "Kiran", short_name: "Kiran", gst_number: "", state_name: "Rajasthan", city: "Jaipur", invoice_prefix: "K" },
  ] } });
  renderApp(<More />, { path: "/e/more" });
  expect(screen.getByRole("heading", { name: "More" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Firm on this phone/ }));
  expect(await screen.findByText(/Udaipur, Rajasthan/)).toBeVisible();
  act(() => { vi.setSystemTime(Date.now() + 400); });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Which firm are you billing for?" })).getByRole("radio", { name: /Kiran/ }));
  expect(state.setFirm).toHaveBeenCalledWith(7);
  expect(calls.filter((call) => call.url === "firms/")).toHaveLength(1);
  expect(calls.some((call) => /^firms\/\d+\//.test(call.url))).toBe(false);
});
test("Show the welcome again calls 6B's reset", () => {
  serve({ "GET preferences/": { data: {} }, "GET firms/": { results: [] } });
  renderApp(<More />, { path: "/e/more" });
  fireEvent.click(screen.getByRole("button", { name: /Show the welcome again/ }));
  expect(state.reset).toHaveBeenCalledOnce();
});
test("a failed narrow firm read stays visible and Try again refetches it", async () => {
  let fails = true;
  const calls = serve({ "GET preferences/": { data: {} }, "GET firms/": () => fails
    ? { status: 503 }
    : { status: 200, data: { results: [] } } });
  renderApp(<More />, { path: "/e/more" });
  fireEvent.click(screen.getByRole("button", { name: /Firm on this phone/ }));
  const dialog = screen.getByRole("dialog", { name: "Which firm are you billing for?" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn't load the firms. Try again.");
  expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
  fails = false; act(() => { vi.setSystemTime(Date.now() + 400); });
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
  expect(calls.filter((call) => call.url === "firms/")).toHaveLength(2);
});
