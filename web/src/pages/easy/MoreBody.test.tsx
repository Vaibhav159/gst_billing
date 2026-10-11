import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { renderApp, stubAuth } from "@/test/render";
import { serve } from "@/test/server";
import { MoreBody, type MoreBodyProps } from "./MoreBody";

const firms = [
  { id: 2, name: "Anand", short: "Anand", gstin: "27AAAAA0000A1Z5", state: "Maharashtra", prefix: "A" },
  { id: 7, name: "Kiran", short: "Kiran", gstin: "", state: "Maharashtra", prefix: "K" },
];
function Location() { const location = useLocation(); return <output aria-label="Path">{location.pathname}</output>; }
function mount(signOut = vi.fn(async () => {}), extra: Partial<MoreBodyProps> = {}) {
  const setFirm = vi.fn(); const resetWelcome = vi.fn();
  const result = renderApp(<AuthContext.Provider value={{ ...stubAuth(), signOut }}><MoreBody firms={firms} firm={firms[0]} setFirm={setFirm} resetWelcome={resetWelcome} {...extra} /><Location /></AuthContext.Provider>, { path: "/e/more" });
  return { ...result, setFirm, resetWelcome, signOut };
}
function opened() { act(() => { vi.setSystemTime(Date.now() + 400); }); }
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-04-01T00:10:00+05:30"));
  serve({ "GET preferences/": { data: { phoneMode: "easy" } }, "PATCH preferences/": { data: { phoneMode: "expert" } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("More's switch saves the person's preference before navigating", async () => {
  let finish!: (value: { status: number; data: unknown }) => void;
  const calls = serve({ "GET preferences/": { data: { phoneMode: "easy" } }, "PATCH preferences/": () => new Promise((resolve) => { finish = resolve; }) });
  mount(); fireEvent.click(screen.getByRole("button", { name: /Switch to the full view/ }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByLabelText("Path")).toHaveTextContent("/e/more");
  expect(calls.find((call) => call.method === "PATCH")?.data).toEqual({ phoneMode: "expert" });
  await act(async () => { finish({ status: 200, data: { data: { phoneMode: "expert" } } }); });
  expect(screen.getByLabelText("Path")).toHaveTextContent(/^\/$/);
});
test("a refused mode switch keeps More open and offers another try", async () => {
  serve({ "GET preferences/": { data: { phoneMode: "easy" } }, "PATCH preferences/": () => ({ status: 503 }) });
  mount(); fireEvent.click(screen.getByRole("button", { name: /Switch to the full view/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was changed. Try again in a minute.");
  expect(screen.getByLabelText("Path")).toHaveTextContent("/e/more");
  expect(screen.getByRole("button", { name: /Switch to the full view/ })).not.toBeDisabled();
});
test("a firm selection calls Easy state alone and says the choice is local", () => {
  localStorage.setItem("gst3.scope.1", "all"); const { setFirm } = mount();
  fireEvent.click(screen.getByRole("button", { name: /Firm on this phone/ })); opened();
  const dialog = screen.getByRole("dialog", { name: "Which firm are you billing for?" });
  expect(dialog).toHaveTextContent("Only this phone changes. Other phones keep their own firm.");
  expect(within(dialog).getByRole("radio", { name: /Anand/ })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(within(dialog).getByRole("radio", { name: /Kiran/ }));
  expect(setFirm).toHaveBeenCalledWith(7); expect(localStorage.getItem("gst3.scope.1")).toBe("all");
});
test.each([["Theme", "Theme on this phone", "Pearl", "gst3.theme", "pearl"], ["Text size", "Text size on this phone", "Larger", "gst3.textSize", "1.2"]])("%s keeps the device setting", (label, title, pick, key, value) => {
  mount(); fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) })); opened();
  fireEvent.click(within(screen.getByRole("dialog", { name: title })).getByRole("radio", { name: new RegExp(`^${pick} `) }));
  expect(localStorage.getItem(key)).toBe(value);
});
test("help teaches typed paper rates and the earlier-day choice", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "How to make a bill" }));
  const help = screen.getByRole("dialog", { name: "How to make a bill" });
  expect(help).toHaveTextContent("Rate per gram, as on the paper bill"); expect(help).toHaveTextContent("Making is included in this rate.");
  expect(help).toHaveTextContent("A bill from an earlier day"); expect(help).not.toHaveTextContent("rate comes from today's rate board");
});
test("April's year explanation uses IST and the welcome reset returns Home", () => {
  const { resetWelcome } = mount(); fireEvent.click(screen.getByRole("button", { name: /Financial year 2026-27/ }));
  expect(screen.getByRole("dialog", { name: "Financial year 2026-27" })).toHaveTextContent("In April and May that's already ticked for you.");
  opened(); fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  fireEvent.click(screen.getByRole("button", { name: /Show the welcome again/ }));
  expect(resetWelcome).toHaveBeenCalledOnce(); expect(screen.getByLabelText("Path")).toHaveTextContent(/^\/e$/);
});
test("logout asks first and a failed signout remains retryable", async () => {
  const signOut = vi.fn(async () => { throw new Error("offline"); }); mount(signOut);
  fireEvent.click(screen.getByRole("button", { name: "Log out" }));
  const dialog = screen.getByRole("dialog", { name: "Log out of this phone?" });
  expect(signOut).not.toHaveBeenCalled(); opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Log out" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Log out" })).not.toBeDisabled());
  expect(screen.getByLabelText("Path")).toHaveTextContent("/e/more");
});

test("firms loading is explained inside the picker without disabling other More actions", () => {
  mount(undefined, { firms: [], firm: null, loading: true });
  expect(screen.getByRole("button", { name: /Switch to the full view/ })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Firm on this phone/ }));
  const dialog = screen.getByRole("dialog", { name: "Which firm are you billing for?" });
  expect(within(dialog).getByRole("status")).toHaveTextContent("Getting firms…");
  expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
});
test.each([false, true])("a failed firm read offers retry and preserves cached choices=%s", (cached) => {
  const onRetry = vi.fn(); const { setFirm } = mount(undefined, { firms: cached ? firms : [], firm: cached ? firms[0] : null, error: "Couldn't load the firms. Try again.", onRetry });
  fireEvent.click(screen.getByRole("button", { name: /Firm on this phone/ })); opened();
  const dialog = screen.getByRole("dialog", { name: "Which firm are you billing for?" });
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Couldn't load the firms. Try again.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" })); expect(onRetry).toHaveBeenCalledOnce();
  expect(within(dialog).queryAllByRole("radio")).toHaveLength(cached ? 2 : 0);
  if (cached) { fireEvent.click(within(dialog).getByRole("radio", { name: /Kiran/ })); expect(setFirm).toHaveBeenCalledWith(7); }
});
