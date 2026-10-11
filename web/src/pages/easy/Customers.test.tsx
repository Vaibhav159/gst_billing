import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { useCustomerList, toCustomer } from "@/core/api/customers";
import { api } from "@/core/api/client";
import { markSaved } from "@/pages/customers/lib";
import { ANIL, mount, serve, VIEWER } from "@/pages/customers/testing";
import type { Call } from "@/test/server";
import { CustomersBody } from "./Customers";
import { CustomerForm } from "./CustomerForm";
import type { CustomerFrameProps } from "./CustomerParts";

const firm = { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", gstin: "08ABCPK1234F1Z5", state: "RAJASTHAN", city: "Jaipur" };
const Frame = ({ title, subtitle, children, bar }: CustomerFrameProps) => <main><h1>{title}</h1><p>{subtitle}</p>{children}{bar}</main>;
const originalAdapter = api.defaults.adapter;
beforeEach(() => { (window as Window & { __phone?: boolean }).__phone = true; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T12:00:00+05:30")); });
afterEach(() => { vi.useRealTimers(); api.defaults.adapter = originalAdapter; });
function draw(ui: ReactNode, viewer = false) { return mount([{ path: "*", element: ui }], ["/e/customers/new"], { me: viewer ? VIEWER : undefined }); }
function List({ start = vi.fn() }: { start?: (id: number) => void }) {
  const [q, setQ] = useState("");
  // The body consumes Part 1's query result; 6B's 40-row parameters are integration-tested after it lands.
  const query = useCustomerList({ firmId: 3, from: "2026-04-01", to: "2026-10-12", q, gst: "any", state: "", usualFirm: null, sort: "recent" });
  return <CustomersBody Frame={Frame} firm={firm} query={query} q={q} onSearch={setQ} onStart={start} />;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method === "POST" || c.method === "PATCH");
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const form = (extra: Partial<Parameters<typeof CustomerForm>[0]> = {}) => <CustomerForm Frame={Frame} firm={firm} firms={[firm]} onSaved={vi.fn()} {...extra} />;
function typeNew() { change("Name", "Meena Jain"); change("Mobile number", "+91 94141 23456"); }

it("requires name and mobile, focuses the first field, then creates only Easy's fields with the firm's city/state", async () => {
  const saved = vi.fn();
  const calls = serve({ "GET customers/": { results: [] }, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...c.data as object, id: 12 } }) });
  draw(form({ onSaved: saved }));
  expect(screen.getByLabelText("Town or city")).toHaveValue("Jaipur");
  fireEvent.submit(document.getElementById("easy-customer-form")!);
  expect(screen.getByText("Type the customer's name, as it should appear on the bill.")).toBeVisible();
  expect(screen.getByText("Type the customer's mobile number. It's how the bill reaches them on WhatsApp.")).toBeVisible();
  expect(screen.getByLabelText("Name")).toHaveFocus();
  typeNew();
  fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(writes(calls)[0].data).toEqual({ name: "Meena Jain", mobile_number: "9414123456", city: "Jaipur", gst_number: "", address: "", state_name: "RAJASTHAN", customer_type: "", businesses: [3] });
});

it("patches only edited visible fields, preserving hidden PAN, firms and legacy phone/GSTIN/type", async () => {
  const existing = toCustomer({ ...ANIL, mobile_number: "bad old number", gst_number: "123", customer_type: "business", businesses: [3, 4], pan_number: "N/A" });
  const calls = serve({ "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...existing, ...c.data as object } }) });
  const saved = vi.fn(); draw(form({ existing, onSaved: saved }));
  change("Address · optional", "");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(writes(calls)[0]).toMatchObject({ method: "PATCH", url: "customers/7/", data: { address: "" } });
});

it("makes no PATCH for an unchanged existing customer", async () => {
  const calls = serve({}); const saved = vi.fn(); draw(form({ existing: toCustomer(ANIL), onSaved: saved }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(writes(calls)).toEqual([]);
});

it("names an on-file phone and lets the bill flow use it without creating anything", async () => {
  handClock();
  const calls = serve({ "GET customers/": { results: [ANIL] } }); const saved = vi.fn();
  draw(form({ onSaved: saved, forBill: true }));
  change("Mobile number", "98290 41122");
  await pass(300, 5);
  expect(screen.getByText(/98290 41122 is Anil Gupta's number/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use Anil" }));
  await pass(0, 2);
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  expect(writes(calls)).toEqual([]);
});

it("uses shared GSTIN validation, retains checksum warnings, and sends the registered state", async () => {
  const saved = vi.fn(); const calls = serve({ "GET customers/": { results: [] }, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...c.data as object } }) });
  draw(form({ onSaved: saved })); typeNew();
  change("GST number · only for shops and companies", "27AAPFU0939F1Z0");
  expect(screen.getByText(/last character doesn't match/)).toBeVisible();
  expect(screen.getByText(/shop in Maharashtra/)).toHaveTextContent("Bills to it charge IGST, the GST for sales to another state.");
  fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(writes(calls)[0].data).toMatchObject({ state_name: "MAHARASHTRA", customer_type: "", gst_number: "27AAPFU0939F1Z0" });
});

it("keeps typed fields and exposes both visible and unrepresented server errors", async () => {
  serve({ "GET customers/": { results: [] }, "POST customers/": () => ({ status: 400, data: { name: ["Name is already taken"], state_name: ["Choose the state"], email: ["Email is invalid"] } }) });
  draw(form()); typeNew(); fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
  expect(await screen.findByText("Name is already taken")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Choose the state");
  expect(screen.getByRole("alert")).toHaveTextContent("Email is invalid");
  expect(screen.getByLabelText("Name")).toHaveValue("Meena Jain");
  expect(screen.getByLabelText("Name")).toHaveFocus();
});

it("offline never queues a save and keeps the form for a manual retry", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  try {
    const calls = serve({ "POST customers/": () => ({ status: 0 }) }); draw(form()); typeNew();
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    expect(await screen.findByText("Not saved yet: you're offline.")).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("Meena Jain");
    expect(screen.getByRole("button", { name: "Save again" })).toBeEnabled();
    expect(writes(calls)).toHaveLength(1);
  } finally { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); }
});

it("viewer cannot save even by submitting the form directly", async () => {
  const calls = serve({}); draw(form(), true); typeNew();
  expect(screen.getByRole("button", { name: "Save customer" })).toBeDisabled();
  fireEvent.submit(document.getElementById("easy-customer-form")!);
  expect(writes(calls)).toEqual([]);
});

it("drops walk-in, opens the customer's action sheet with tel link, and uses server figures", async () => {
  const start = vi.fn(); serve({ "GET customers/": { count: 2, next: null, results: [{ ...ANIL, figures: { bills: 18, total: "10203.99", last_bill: { id: 4, invoice_date: "2026-10-11", total_amount: "103.99" } } }, { ...ANIL, id: 1, name: "Walk-in Customer", type: "walkin" }] } });
  draw(<List start={start} />);
  const row = await screen.findByRole("button", { name: /Anil Gupta/ });
  expect(screen.queryByText("Walk-in Customer")).not.toBeInTheDocument();
  expect(row).toHaveTextContent("₹103.99"); fireEvent.click(row);
  vi.setSystemTime(new Date(Date.now() + 400));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("link", { name: "Call 98290 41122" })).toHaveAttribute("href", "tel:+919829041122");
  expect(dialog).toHaveTextContent("18 · ₹10,203.99");
  expect(within(dialog).getByRole("link", { name: "See Anil's bills" })).toHaveAttribute("href", "/e/bills?q=Anil%20Gupta");
  fireEvent.click(within(dialog).getByRole("button", { name: "New bill for Anil" }));
  expect(start).toHaveBeenCalledWith(7);
});

it("loads the next page only on a press and keeps the original row and scroll container", async () => {
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 2, next: c.params.page === 1 ? "?page=2" : null, results: [{ ...ANIL, id: c.params.page === 1 ? 7 : 8, name: c.params.page === 1 ? "Anil Gupta" : "Meena Jain" }] } }) });
  draw(<List />); const row = await screen.findByRole("button", { name: /Anil Gupta/ });
  const section = row.closest("section")!; section.scrollTop = 190;
  expect(calls.filter((c) => c.url === "customers/")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Show 40 more" }));
  await screen.findByRole("button", { name: /Meena Jain/ });
  expect(screen.getByRole("button", { name: /Anil Gupta/ })).toBe(row);
  expect(row.closest("section")).toBe(section); expect(section.scrollTop).toBe(190);
  expect(calls.filter((c) => c.url === "customers/")).toHaveLength(2);
});

it("shows a loading state instead of an empty list, and viewer has no write actions", async () => {
  serve({ "GET customers/": () => new Promise(() => {}) }); draw(<List />, true);
  expect(screen.getByRole("status")).toHaveTextContent("Loading customers");
  expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add a customer" })).not.toBeInTheDocument();
});

it("pins a just-added customer on this visit", async () => {
  markSaved("easy-customer", 7);
  serve({ "GET customers/": { count: 2, next: null, results: [{ ...ANIL, id: 8, name: "Meena Jain" }, ANIL] } });
  draw(<List />); await screen.findByText("Just added");
  expect(screen.getAllByRole("button").find((b) => b.hasAttribute("data-row"))).toHaveTextContent("Anil Gupta");
});

it("asks before leaving typed customer details", async () => {
  serve({}); const { router } = draw(form()); change("Name", "Meena Jain");
  await act(async () => { await router.navigate("/e/bills"); });
  expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toHaveTextContent("This customer isn't saved yet. Leave and lose what you typed?");
});

it("a failed customer read never says no customers yet", async () => {
  serve({ "GET customers/": () => ({ status: 503 }) }); draw(<List />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the customer list");
  expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(screen.queryByText("No customers yet")).not.toBeInTheDocument();
});


it("keeps the server refusal when this device still thinks customer editing is allowed", async () => {
  serve({ "GET customers/": { results: [] }, "POST customers/": () => ({ status: 403, data: { detail: "Your role changed. Ask the owner to check it." } }) });
  draw(form()); typeNew(); fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your role changed. Ask the owner to check it.");
  expect(screen.getByLabelText("Name")).toHaveValue("Meena Jain");
});
