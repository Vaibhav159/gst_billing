import { tick } from "@/test/clock";
import { act, fireEvent, screen } from "@testing-library/react";
import { salesServer, refuse, wireRow } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import { useToast } from "@/core/ui";
import { renderApp } from "@/test/render";
import { useSendBill, useSendReady } from "./useSendBill";
import { WhatsAppDialog } from "./WhatsAppDialog";

vi.mock("./deliver", () => ({ deliver: vi.fn(async () => ({ via: "whatsapp", file: false })) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function ToastButton() { const { show } = useToast(); return <button onClick={() => show({ title: "Saved", duration: 6000 })}>Show toast</button>; }
function MoreToasts() { const { show } = useToast(); return <button onClick={() => { for (let i = 0; i < 3; i++) show({ title: `Another ${i}` }); }}>Other toasts</button>; }
function hidden(value: boolean) { vi.spyOn(document, "hidden", "get").mockReturnValue(value); fireEvent(document, new Event("visibilitychange")); }

test("a toast pauses while the tab is hidden, resumes with its remaining time, and starts paused if already hidden", async () => {
  renderApp(<ToastButton />);
  fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  await tick(2000); hidden(true); await tick(60000);
  expect(screen.getByText("Saved")).toBeInTheDocument();
  hidden(false); await tick(3999);
  expect(screen.getByText("Saved")).toBeInTheDocument();
  await tick(171); expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  hidden(true); fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  await tick(60000); expect(screen.getByText("Saved")).toBeInTheDocument();
});

test("a toast stays paused when the tab is hidden after pointer leave, and when focus remains after returning", async () => {
  renderApp(<ToastButton />); fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  const toast = screen.getByText("Saved").parentElement!.parentElement!;
  fireEvent.pointerEnter(toast); hidden(true); fireEvent.pointerLeave(toast);
  await tick(60000); expect(screen.getByText("Saved")).toBeInTheDocument();
  act(() => screen.getByRole("button", { name: "Dismiss" }).focus()); hidden(false);
  await tick(60000); expect(screen.getByText("Saved")).toBeInTheDocument();
});

function Send({ id = 412 }: { id?: number }) { const send = useSendBill(); const ready = useSendReady(); return <button disabled={!ready} onClick={() => void send(toBillRow(wireRow({ id })))}>{id === 412 ? "Send it" : `Send ${id}`}</button>; }
test("a refused send record without Mark as sent times out as other failure toasts do", async () => {
  salesServer([["POST", "sales/412/sent/", () => refuse(403, { detail: "You can't change this bill." })]]);
  renderApp(<Send />); await tick(10);
  fireEvent.click(screen.getByRole("button", { name: "Send it" })); await tick(10);
  expect(screen.getByText("Not marked as sent")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  await tick(10170);
  expect(screen.queryByText("Not marked as sent")).not.toBeInTheDocument();
});

test("Not marked as sent keeps its only Mark as sent action until dismissed", async () => {
  salesServer([["POST", "sales/412/sent/", () => refuse(500, {})]]);
  renderApp(<><Send /><MoreToasts /></>); await tick(10);
  fireEvent.click(screen.getByRole("button", { name: "Send it" })); await tick(10);
  expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Other toasts" }));
  expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
  await tick(60000);
  expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); await tick(170);
  expect(screen.queryByText("Not marked as sent")).not.toBeInTheDocument();
});

test("WhatsApp uses possessive names ending in s for the saved number", () => {
  salesServer();
  const bill = toBillRow(wireRow()); Object.assign(bill.customer, { name: "Mehta & Sons", mobile_number: "" });
  renderApp(<WhatsAppDialog bill={bill} onClose={() => {}} />);
  expect(screen.getByRole("checkbox", { name: /^Save it to Mehta & Sons' record/ })).toBeInTheDocument();
});

test("two failed bills keep both Mark as sent actions despite their shared toast title", async () => {
  const { calls } = salesServer([["POST", "sales/412/sent/", () => refuse(500, {})], ["POST", "sales/413/sent/", () => refuse(500, {})]]);
  renderApp(<><Send /><Send id={413} /></>); await tick(10);
  fireEvent.click(screen.getByRole("button", { name: "Send it" })); await tick(10);
  fireEvent.click(screen.getByRole("button", { name: "Send 413" })); await tick(10);
  expect(screen.getAllByRole("button", { name: "Mark as sent" })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Mark as sent" })[0]); await tick(200);
  expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["sales/412/sent/", "sales/413/sent/", "sales/412/sent/"]);
  expect(screen.getAllByRole("button", { name: "Mark as sent" })).toHaveLength(2);
});
