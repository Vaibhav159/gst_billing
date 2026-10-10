import type { ReactElement } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { matchRoutes } from "react-router";
import { GSTIN_CHECK_WARNING } from "@/core/ids";
import { appRoutes } from "@/core/router/routes";
import CustomerForm from "./CustomerForm";
import { ANIL, mount, NO_BILLS, serve, VIEWER, type Call } from "./testing";

const routes = [
  { path: "/customers", element: <p>the list</p> },
  { path: "/customers/new", element: <CustomerForm /> },
  { path: "/customers/:id", element: <p>the customer page</p> },
  { path: "/customers/:id/edit", element: <CustomerForm /> },
  { path: "/sales/new", element: <p>the bill form</p> },
];
const NONE = { count: 0, next: null, results: [] };
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

/**
 * For tests that wait on the form's own timers (the 250 ms pause before a search asks, the 80 ms before ?focus= moves
 * the cursor): a clock the test moves by hand, and typing that moves it only as far as each key needs.
 */
function handClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

test("a new customer: a valid GSTIN fills the state, type and PAN, and the save goes back to the list", async () => {
  const calls = serve({ "GET customers/": NONE, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...(c.data as object), id: 30 } }) });
  const { router } = mount(routes, ["/customers", "/customers/new?from=list"]);
  const name = await screen.findByLabelText(/^Name/);
  await waitFor(() => expect(name).toHaveFocus());
  await userEvent.type(name, "Kulkarni Jewellers");
  await userEvent.type(screen.getByLabelText("GSTIN"), "27xtzps7585p1zb");
  expect(screen.getByText("Valid GSTIN · Maharashtra (27) · PAN XTZPS7585P")).toBeInTheDocument();
  expect(screen.getByLabelText("State")).toHaveValue("MAHARASHTRA");
  expect(screen.getByText("Set to Maharashtra (27) from the GSTIN")).toBeInTheDocument();
  expect(screen.getByLabelText("PAN")).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Business" })).toHaveAttribute("aria-checked", "true");
  // a GSTIN that's changed again puts back what it filled in
  await userEvent.type(screen.getByLabelText("GSTIN"), "{Backspace}");
  expect(screen.getByLabelText("State")).toHaveValue("RAJASTHAN");
  expect(screen.getByRole("radio", { name: "Person" })).toHaveAttribute("aria-checked", "true");
  await userEvent.type(screen.getByLabelText("GSTIN"), "B");
  await userEvent.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers"));
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.data).toEqual({
    name: "Kulkarni Jewellers", mobile_number: "", email: "", customer_type: "business", gst_number: "27XTZPS7585P1ZB", pan_number: "XTZPS7585P",
    address: "", city: "", state_name: "MAHARASHTRA", businesses: [3, 4],
  });
});

test("a GSTIN that fails only its check character is a warning: it saves as typed and the customer stays a business", async () => {
  const calls = serve({ "GET customers/": NONE, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...(c.data as object), id: 31 } }) });
  mount(routes, ["/customers/new"]);
  await userEvent.type(await screen.findByLabelText(/^Name/), "Shree Gems");
  await userEvent.type(screen.getByLabelText("GSTIN"), "08AAAAA0000A1Z5");
  expect(screen.getByText(GSTIN_CHECK_WARNING)).toBeInTheDocument();
  expect(screen.getByLabelText("GSTIN")).not.toHaveAttribute("aria-invalid");
  const pan = screen.getByLabelText("PAN");
  expect(pan).toBeEnabled();
  expect(screen.getByText("Type the PAN: the app reads it only from a GSTIN that checks out.")).toBeInTheDocument();
  await userEvent.type(pan, "aaaaa0000a");
  await userEvent.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
  await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
  expect(calls.find((c) => c.method === "POST")!.data).toMatchObject({ gst_number: "08AAAAA0000A1Z5", customer_type: "business", pan_number: "AAAAA0000A", state_name: "RAJASTHAN" });
});

test("problems wait for a save, then say what to fix, and a press on one goes to its field", async () => {
  const calls = serve({ "GET customers/": NONE });
  mount(routes, ["/customers/new"]);
  const phone = await screen.findByLabelText("Mobile number");
  await userEvent.type(phone, "+91 98290 4112");
  expect(phone).toHaveValue("98290 4112");
  expect(screen.queryByText("A mobile number has 10 digits; this has 9.")).not.toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByText("A mobile number has 10 digits; this has 9.")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
  const summary = screen.getByText("2 things to fix before saving").closest("[role=status]") as HTMLElement;
  expect(screen.getByLabelText(/^Name/)).toHaveFocus();
  await userEvent.click(within(summary).getByRole("button", { name: "A mobile number has 10 digits; this has 9." }));
  expect(phone).toHaveFocus();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("customers already on file show up once typing pauses; the same name is refused, with a way to open it", async () => {
  const user = handClock();
  const MAHESH = { ...ANIL, id: 12, name: "Mahesh Soni", mobile_number: "9414012345", city: "Udaipur", figures: { bills: 3, total: "1000.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: { id: 90, invoice_number: "KGH/2026-27/9", invoice_date: "2026-09-02", total_amount: "1000.00", business: 3 } } };
  const MAHESH_K = { ...ANIL, id: 13, name: "Mahesh Kumar Soni", mobile_number: "", city: "", figures: null };
  serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 2, next: null, results: String(c.params.search).toLowerCase().startsWith("mah") ? [MAHESH, MAHESH_K] : [] } }) });
  mount(routes, ["/customers/new"]);
  await user.type(await screen.findByLabelText(/^Name/), "Mahesh");
  pass(250);
  const found = await screen.findByText("Already on file? 2 customers with a name like this");
  expect(found.parentElement).toHaveTextContent("94140 12345 · Udaipur · last bill 02 Sep 2026");
  expect(found.parentElement).toHaveTextContent("No phone · no bills yet");
  await user.type(screen.getByLabelText(/^Name/), " Soni");
  pass(250);
  expect(await screen.findByText("There's already a customer called Mahesh Soni. Add the area or the father's name to tell them apart (like Mahesh Soni, Udaipur), or open Mahesh Soni.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Mahesh Soni" })).toHaveAttribute("href", "/customers/12");
});

test("a phone or GSTIN another customer has is named, with the way to them", async () => {
  const user = handClock();
  const KULKARNI = { ...ANIL, id: 9, name: "Kulkarni Jewellers", gst_number: "27XTZPS7585P1ZB", mobile_number: "9822012345" };
  serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 1, next: null, results: ["27XTZPS7585P1ZB", "9822012345"].includes(String(c.params.search)) ? [KULKARNI] : [] } }) });
  mount(routes, ["/customers/new"]);
  await user.type(await screen.findByLabelText("Mobile number"), "98220 12345");
  pass(250);
  expect(await screen.findByText(/has this number too\. Fine for family members; if it's the same person, use Kulkarni Jewellers instead\./)).toBeInTheDocument();
  await user.type(screen.getByLabelText("GSTIN"), "27XTZPS7585P1ZB");
  pass(250);
  expect(await screen.findByText("Kulkarni Jewellers already has this GSTIN")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Kulkarni Jewellers" })).toHaveAttribute("href", "/customers/9");
});

test("editing opens on the field a link names (?focus=pan), saves only through PATCH, and goes back to the customer", async () => {
  const user = handClock();
  const SUNITA = { ...ANIL, id: 8, name: "Sunita Gupta" }; // his wife, on his number
  const calls = serve({
    "GET customers/7/": ANIL, "GET customers/7/statement/": { ...NO_BILLS, bills: [{ id: 1, business: 3, invoice_date: "2026-09-01", status: "active", total_amount: "1.00" }] },
    "GET customers/": (c: Call) => ({ status: 200, data: { count: 2, next: null, results: c.params.search === "9829041122" ? [ANIL, SUNITA] : [] } }),
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }),
  });
  const { router } = mount(routes, ["/customers/7", "/customers/7/edit?focus=pan"]);
  const pan = await screen.findByLabelText("PAN");
  pass(80);
  await waitFor(() => expect(pan).toHaveFocus());
  expect(screen.getByRole("heading", { level: 1, name: "Edit Anil Gupta" })).toBeInTheDocument();
  expect(await screen.findByText("Has billed Anil")).toBeInTheDocument();
  expect(screen.getByText("No bills yet")).toBeInTheDocument();
  // the number on file is his own: only someone else with it is named
  expect(await screen.findByText(/has this number too/)).toHaveTextContent("Sunita Gupta has this number too.");
  await user.type(pan, "abcde1234f");
  expect(screen.getByText("Unsaved changes · Ctrl S saves")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers/7"));
  expect(calls.find((c) => c.method === "PATCH")!.data).toMatchObject({ pan_number: "ABCDE1234F", mobile_number: "9829041122", businesses: [3] });
});

test("a state the server keeps in another spelling (JAMMU & KASHMIR) is its GSTIN's own state: no mismatch, and it saves in the picker's spelling", async () => {
  const KASHMIR = { ...ANIL, id: 5, name: "Kashmir Arts", gst_number: "01ABCPK1234F1ZJ", state_name: "JAMMU & KASHMIR", customer_type: "business", type: "business" };
  const calls = serve({ "GET customers/5/": KASHMIR, "GET customers/": NONE, "GET customers/5/statement/": NO_BILLS, "PATCH customers/5/": (c: Call) => ({ status: 200, data: { ...KASHMIR, ...(c.data as object) } }) });
  const { router } = mount(routes, ["/customers/5", "/customers/5/edit"]);
  expect(await screen.findByLabelText("State")).toHaveValue("JAMMU AND KASHMIR");
  expect(screen.getByText("Valid GSTIN · Jammu and Kashmir (01) · PAN ABCPK1234F")).toBeInTheDocument();
  expect(screen.queryByText(/This GSTIN is registered in/)).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers/5"));
  expect(calls.find((c) => c.method === "PATCH")!.data).toMatchObject({ gst_number: "01ABCPK1234F1ZJ", state_name: "JAMMU AND KASHMIR", customer_type: "business" });
});

test("the server's refusal shows under its field, and a lost connection keeps what was typed with Try again", async () => {
  let online = false;
  serve({
    "GET customers/": NONE,
    "POST customers/": () => (online ? { status: 400, data: { pan_number: ["A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F)."] } } : { status: 0 }),
  });
  mount(routes, ["/customers/new"]);
  await userEvent.type(await screen.findByLabelText(/^Name/), "Rekha Soni");
  await userEvent.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Not saved: the app couldn't get through");
  expect(screen.getByLabelText(/^Name/)).toHaveValue("Rekha Soni");
  online = true;
  await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  // under the field, and in the list of what to fix
  await waitFor(() => expect(document.getElementById("cu-pan-error")).toHaveTextContent("A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F)."));
  expect(screen.getByLabelText("PAN")).toHaveFocus();
  expect(screen.queryByText("Not saved: the app couldn't get through")).not.toBeInTheDocument();
});

test("?return= hands the new customer back to the form that asked for one", async () => {
  serve({ "GET customers/": NONE, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...(c.data as object), id: 44 } }) });
  const { router } = mount(routes, ["/customers/new?return=%2Fsales%2Fnew%3Fpaper%3D1&name=Rekha%20Soni"]);
  expect(await screen.findByLabelText(/^Name/)).toHaveValue("Rekha Soni");
  await userEvent.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/new"));
  expect(router.state.location.search).toBe("?paper=1&customer=44");
});

test("?gstin= starts a business in the GSTIN's state with its PAN, as typing it would", async () => {
  serve({ "GET customers/": NONE });
  const { router } = mount(routes, ["/customers/new?gstin=27xtzps7585p1zb"]);
  expect(await screen.findByLabelText("GSTIN")).toHaveValue("27XTZPS7585P1ZB");
  expect(screen.getByLabelText("State")).toHaveValue("MAHARASHTRA");
  expect(screen.getByLabelText("PAN")).toHaveValue("XTZPS7585P");
  expect(screen.getByRole("radio", { name: "Business" })).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByText(/This GSTIN is registered in/)).not.toBeInTheDocument();
  // another GSTIN in the address starts the form again
  await act(async () => { await router.navigate("/customers/new?gstin=08AAAAA0000A1Z5"); });
  expect(screen.getByLabelText("GSTIN")).toHaveValue("08AAAAA0000A1Z5");
  expect(screen.getByLabelText("State")).toHaveValue("RAJASTHAN");
  expect(screen.getByLabelText("PAN")).toHaveValue("");
});

test("leaving with changes asks first", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  serve({ "GET customers/": NONE });
  const { router } = mount(routes, ["/customers", "/customers/new"]);
  await userEvent.type(await screen.findByLabelText(/^Name/), "Rekha");
  await act(async () => { await router.navigate("/customers"); });
  const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
  act(() => { vi.advanceTimersByTime(400); }); // past the dialog's guard against a double tap's second tap
  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(router.state.location.pathname).toBe("/customers/new");
});

test("a viewer is told who may add customers, and gets no form", async () => {
  serve({});
  mount(routes, ["/customers/new"], { me: VIEWER });
  expect(await screen.findByText("You can't add or change customers")).toBeInTheDocument();
  expect(screen.getByText("Only the owner, the accountant and counter staff can add or change customers. Ask the owner if you need it.")).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
});

test("the walk-in record can't be edited, and says what to do instead", async () => {
  serve({ "GET customers/1/": { ...ANIL, id: 1, name: "Walk-in Customer", customer_type: "walkin", type: "walkin" } });
  mount(routes, ["/customers/1/edit"]);
  expect(await screen.findByText("The walk-in record can't be edited")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add a customer" })).toHaveAttribute("href", "/customers/new?from=list");
});

test("an address that names no customer says so, without asking the server", async () => {
  const calls = serve({ "GET customers/99/": () => ({ status: 404, data: { detail: "Not found." } }) });
  mount(routes, ["/customers/c-anil/edit"]);
  expect(await screen.findByRole("heading", { level: 1, name: "This customer isn't on file" })).toBeInTheDocument();
  expect(calls.filter((c) => c.url.startsWith("customers/"))).toEqual([]);
  cleanup();
  mount(routes, ["/customers/99/edit"]);
  expect(await screen.findByRole("heading", { level: 1, name: "This customer isn't on file" })).toBeInTheDocument();
});

test("the app opens the form at /customers/new and /customers/:id/edit, ahead of the placeholder, without the phone's tabs", () => {
  for (const path of ["/customers/new", "/customers/7/edit"]) {
    const m = matchRoutes(appRoutes, path)!;
    const route = m[m.length - 1].route;
    expect((route.element as ReactElement).type, path).toBe(CustomerForm);
    expect(route.handle, path).toEqual({ hideNav: true });
  }
});
