import { handClock, pass } from "@/test/clock";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, matchRoutes } from "react-router";
import { useStatement } from "@/core/api/customers";
import { GSTIN_CHECK_WARNING, PAN_PROBLEM } from "@/core/ids";
import { appRoutes } from "@/core/router/routes";
import { loadedPage } from "@/core/router/lazyPage";
import CustomerForm from "./CustomerForm";
import { ANIL, liveWords, mount, NO_BILLS, serve, typeQuickly, VIEWER, type Call } from "./testing";

const routes = [
  { path: "/customers", element: <p>the list</p> },
  { path: "/customers/new", element: <CustomerForm /> },
  { path: "/customers/:id", element: <p>the customer page</p> },
  { path: "/customers/:id/edit", element: <CustomerForm /> },
  { path: "/sales/new", element: <p>the bill form</p> },
];
const NONE = { count: 0, next: null, results: [] };
vi.hoisted(() => { Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" }); });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

/**
 * For tests that type with userEvent and wait on the form's own timers (the 80 ms before ?focus= moves the cursor): a
 * clock the test moves (move), and typing that moves it only as far as each key needs. (A test that must see nothing
 * happen before a pause ends uses testing.tsx's handClock, which no real time moves.)
 */
function typingClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
const move = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const searches = (calls: Call[]) => calls.filter((c) => c.params.search).map((c) => c.params.search);

test("a new customer: a valid GSTIN fills the state, type and PAN, and the save goes back to the list", async () => {
  const calls = serve({ "GET customers/": NONE, "POST customers/": (c: Call) => ({ status: 201, data: { ...ANIL, ...(c.data as object), id: 30 } }) });
  const { router } = mount(routes, ["/customers", "/customers/new?from=list"]);
  const name = await screen.findByLabelText(/^Name/);
  expect(screen.getAllByRole("button", { name: "Save customer" })[0]).toHaveAttribute("title", "Ctrl S");
  expect(screen.getByText("Ctrl S saves")).toBeInTheDocument();
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

const NAME_PROBLEM = "Enter the customer's name, as it should print on bills.";

test("a refusal in the field the cursor is in already (Enter there, or Save or Ctrl S, which keep the cursor) is read out in a polite live region; typing empties it", async () => {
  const user = typingClock();
  const calls = serve({ "GET customers/": NONE });
  mount(routes, ["/customers/new"]);
  const name = await screen.findByLabelText(/^Name/);
  await waitFor(() => expect(name).toHaveFocus());
  const heard = liveWords();
  try {
    // Enter sends the form from the name box, and the cursor stays there: focusing it again would say nothing
    await user.keyboard("{Enter}");
    await move(100);
    expect(name).toHaveFocus();
    expect(heard.said).toEqual([NAME_PROBLEM]);
    // a click on Save keeps the cursor where it is (so an error drawn under a field can't move the button mid-click)
    await user.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
    await move(100);
    expect(name).toHaveFocus();
    expect(heard.said).toEqual([NAME_PROBLEM, NAME_PROBLEM]);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await move(100);
    expect(heard.said).toEqual([NAME_PROBLEM, NAME_PROBLEM, NAME_PROBLEM]);
    await user.type(name, "R");
    expect(document.querySelector('form [aria-live="polite"].sr-only')).toBeEmptyDOMElement();
  } finally {
    heard.stop();
  }
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("a click on Save from another field puts the cursor on the first refused one, which reads its words as it lands, and nothing comes in the live echo", async () => {
  const user = typingClock();
  serve({ "GET customers/": NONE });
  mount(routes, ["/customers/new"]);
  const name = await screen.findByLabelText(/^Name/);
  // what a screen reader reads as the cursor lands: the field's description at that moment
  let landed = "";
  name.addEventListener("focus", () => { landed = (name.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" "); });
  await user.type(screen.getByLabelText("City"), "Udaipur");
  const heard = liveWords();
  try {
    await user.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
    await move(100);
    expect(name).toHaveFocus();
    expect(landed).toBe(NAME_PROBLEM);
    expect(heard.said).toEqual([]);
  } finally {
    heard.stop();
  }
});

test("a name the server refuses after Enter in the name box is read out there too, where the cursor stays", async () => {
  const user = typingClock();
  serve({ "GET customers/": NONE, "POST customers/": () => ({ status: 400, data: { name: ["customer with this Customer Name already exists."] } }) });
  mount(routes, ["/customers/new"]);
  const name = await screen.findByLabelText(/^Name/);
  await user.type(name, "Mahesh Soni");
  const heard = liveWords();
  try {
    await user.keyboard("{Enter}");
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    await move(100);
    expect(name).toHaveFocus();
    expect(heard.said).toEqual(["There's already a customer called Mahesh Soni. Add the area or the father's name to tell them apart."]);
  } finally {
    heard.stop();
  }
});

test("customers already on file show up once typing pauses; the same name is refused, with a way to open it", async () => {
  const MAHESH = { ...ANIL, id: 12, name: "Mahesh Soni", mobile_number: "9414012345", city: "Udaipur", figures: { bills: 3, total: "1000.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: { id: 90, invoice_number: "KGH/2026-27/9", invoice_date: "2026-09-02", total_amount: "1000.00", business: 3 } } };
  const MAHESH_K = { ...ANIL, id: 13, name: "Mahesh Kumar Soni", mobile_number: "", city: "", figures: null };
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 2, next: null, results: String(c.params.search).toLowerCase().startsWith("mah") ? [MAHESH, MAHESH_K] : [] } }) });
  mount(routes, ["/customers/new"]);
  const name = await screen.findByLabelText(/^Name/);
  handClock();
  typeQuickly(name, "Mahesh");
  // nothing is asked while the name is typed ("Mah" on is long enough to ask), nor before typing has paused for 250 ms
  await pass(249, 1);
  expect(searches(calls)).toEqual([]);
  await pass(1, 1);
  expect(searches(calls)).toEqual(["Mahesh"]);
  const found = screen.getByText("Already on file? 2 customers with a name like this");
  expect(found.parentElement).toHaveTextContent("94140 12345 · Udaipur · last bill 02 Sep 2026");
  expect(found.parentElement).toHaveTextContent("No phone · no bills yet");
  typeQuickly(name, "Mahesh Soni");
  await pass(249, 1);
  expect(searches(calls)).toEqual(["Mahesh"]);
  await pass(1, 1);
  expect(screen.getByText("There's already a customer called Mahesh Soni. Add the area or the father's name to tell them apart (like Mahesh Soni, Udaipur), or open Mahesh Soni.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Mahesh Soni" })).toHaveAttribute("href", "/customers/12");
});

test("a phone or GSTIN another customer has is named, with the way to them", async () => {
  const KULKARNI = { ...ANIL, id: 9, name: "Kulkarni Jewellers", gst_number: "27XTZPS7585P1ZB", mobile_number: "9822012345" };
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: { count: 1, next: null, results: ["27XTZPS7585P1ZB", "9822012345"].includes(String(c.params.search)) ? [KULKARNI] : [] } }) });
  mount(routes, ["/customers/new"]);
  const phone = await screen.findByLabelText("Mobile number");
  handClock();
  // each is looked up once whole and once typing has paused: never at the last key, never part of one
  typeQuickly(phone, "98220 12345");
  await pass(249, 1);
  expect(searches(calls)).toEqual([]);
  await pass(1, 1);
  expect(searches(calls)).toEqual(["9822012345"]);
  expect(screen.getByText(/has this number too\. Fine for family members; if it's the same person, use Kulkarni Jewellers instead\./)).toBeInTheDocument();
  typeQuickly(screen.getByLabelText("GSTIN"), "27XTZPS7585P1ZB");
  await pass(249, 1);
  expect(searches(calls)).toEqual(["9822012345"]);
  await pass(1, 1);
  expect(searches(calls)).toEqual(["9822012345", "27XTZPS7585P1ZB"]);
  expect(screen.getByText("Kulkarni Jewellers already has this GSTIN")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Kulkarni Jewellers" })).toHaveAttribute("href", "/customers/9");
});

test("editing opens on the field a link names (?focus=pan), saves only through PATCH, and goes back to the customer", async () => {
  const user = typingClock();
  const SUNITA = { ...ANIL, id: 8, name: "Sunita Gupta" }; // his wife, on his number
  const calls = serve({
    "GET customers/7/": ANIL, "GET customers/7/statement/": { ...NO_BILLS, bills: [{ id: 1, business: 3, invoice_date: "2026-09-01", status: "active", total_amount: "1.00" }] },
    "GET customers/": (c: Call) => ({ status: 200, data: { count: 2, next: null, results: c.params.search === "9829041122" ? [ANIL, SUNITA] : [] } }),
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }),
  });
  const { router } = mount(routes, ["/customers/7", "/customers/7/edit?focus=pan"]);
  const pan = await screen.findByLabelText("PAN");
  move(80);
  await waitFor(() => expect(pan).toHaveFocus());
  expect(screen.getByRole("heading", { level: 1, name: "Edit Anil Gupta" })).toBeInTheDocument();
  expect(screen.queryByText("Has billed Anil")).not.toBeInTheDocument();
  expect(screen.queryByText("No bills yet")).not.toBeInTheDocument();
  expect(screen.queryByText(/has this number too/)).not.toBeInTheDocument();
  await user.type(pan, "abcde1234f");
  expect(screen.getByText("Unsaved changes · Ctrl S saves")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers/7"));
  expect(calls.find((c) => c.method === "PATCH")!.data).toMatchObject({ pan_number: "ABCDE1234F", mobile_number: "9829041122", businesses: [3] });
});

test("a PAN stored before v3 checked them (v2's imports kept “N/A”) shows as it is, says what it is from the start, and a cleared box saves", async () => {
  const calls = serve({
    "GET customers/7/": { ...ANIL, pan_number: "N/A" }, "GET customers/": NONE, "GET customers/7/statement/": NO_BILLS,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }),
  });
  const { router } = mount(routes, ["/customers/7", "/customers/7/edit"]);
  const pan = await screen.findByLabelText("PAN");
  expect(pan).toHaveValue("N/A");
  expect(pan).toHaveAccessibleDescription("“N/A” isn't a PAN. Clear it, or type the PAN.");
  // what the person types is checked as any PAN is
  await userEvent.type(pan, "x");
  await userEvent.tab();
  expect(pan).toHaveAccessibleDescription(PAN_PROBLEM);
  await userEvent.clear(pan);
  expect(pan).not.toHaveAttribute("aria-invalid");
  await userEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/customers/7"));
  expect(calls.find((c) => c.method === "PATCH")!.data).toMatchObject({ pan_number: "", name: "Anil Gupta" });
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

test("a GSTIN from the address (?gstin=) is noted as what filled Business, the state and the PAN: clearing it takes them back, but not one changed since", async () => {
  serve({ "GET customers/": NONE });
  mount(routes, ["/customers/new?gstin=27xtzps7585p1zb"]);
  const gstin = await screen.findByLabelText("GSTIN");
  await userEvent.clear(gstin);
  // a new customer's start: a person in the firm's state, with no PAN
  expect(screen.getByRole("radio", { name: "Person" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("State")).toHaveValue("RAJASTHAN");
  expect(screen.getByLabelText("PAN")).toHaveValue("");
  expect(screen.getByLabelText("PAN")).toBeEnabled();
  cleanup();
  // the state changed by hand after the GSTIN filled it stays as it was changed
  mount(routes, ["/customers/new?gstin=27xtzps7585p1zb"]);
  await userEvent.selectOptions(await screen.findByLabelText("State"), "GOA");
  await userEvent.clear(screen.getByLabelText("GSTIN"));
  expect(screen.getByLabelText("State")).toHaveValue("GOA");
  expect(screen.getByRole("radio", { name: "Person" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("PAN")).toHaveValue("");
  cleanup();
  // a PAN typed beside a GSTIN that fails its check character (one the app doesn't read a PAN from) stays too
  mount(routes, ["/customers/new?gstin=08AAAAA0000A1Z5"]);
  await userEvent.type(await screen.findByLabelText("PAN"), "aaaaa0000a");
  await userEvent.clear(screen.getByLabelText("GSTIN"));
  expect(screen.getByLabelText("PAN")).toHaveValue("AAAAA0000A");
  expect(screen.getByRole("radio", { name: "Person" })).toHaveAttribute("aria-checked", "true");
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

test("a link to this page that would start the form afresh (Ctrl K's Add a customer) asks first when something is typed: Stay keeps it, Leave starts afresh", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  serve({ "GET customers/": NONE });
  const { router } = mount(routes, ["/customers", "/customers/new?name=Rekha%20Soni"]);
  expect(await screen.findByLabelText(/^Name/)).toHaveValue("Rekha Soni");
  await userEvent.type(screen.getByLabelText("City"), "Udaipur");
  await act(async () => { await router.navigate("/customers/new"); });
  let dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
  expect(dialog).toHaveTextContent("Your changes aren't saved. Leave this page and lose them?");
  expect(screen.getByLabelText("City")).toHaveValue("Udaipur");
  act(() => { vi.advanceTimersByTime(400); }); // past the dialog's guard against a double tap's second tap
  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  // the address goes back to the form's own, and what was typed is all there
  expect(router.state.location.pathname + router.state.location.search).toBe("/customers/new?name=Rekha%20Soni");
  expect(screen.getByLabelText(/^Name/)).toHaveValue("Rekha Soni");
  expect(screen.getByLabelText("City")).toHaveValue("Udaipur");
  await act(async () => { await router.navigate("/customers/new"); });
  dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
  act(() => { vi.advanceTimersByTime(400); });
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
  await waitFor(() => expect(screen.getByLabelText("City")).toHaveValue(""));
  expect(screen.getByLabelText(/^Name/)).toHaveValue("");
  expect(router.state.location.pathname + router.state.location.search).toBe("/customers/new");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("Stay after Back goes forward to the form's own address, and the address Back went to stays in the history", async () => {
  handClock();
  serve({ "GET customers/": NONE });
  // the browser's history, which numbers its entries as the app's does (an in-memory one doesn't)
  const { router } = mount(routes, ["/customers/new?name=Rekha%20Soni"], { browser: true });
  try {
    await pass(400, 1);
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Rekha Soni");
    // Ctrl K's Add a customer with nothing typed yet: the form starts afresh at once
    await act(async () => { await router.navigate("/customers/new"); });
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Udaipur" } });
    // Back to Rekha's address would start the form afresh: it asks, and Stay goes forward to the form's own again
    act(() => { void router.navigate(-1); });
    // jsdom queues each history traversal in two timer turns; move those explicitly, including a blocked Back's return.
    await pass(4, 1);
    const dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    expect(router.state.location.search).toBe("?name=Rekha%20Soni");
    await pass(400, 1); // past the dialog's guard against a double tap's second tap
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
    await pass(4, 1);
    expect(router.state.location.search).toBe("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("Udaipur");
    // Rekha's address is still the entry before it: Back reaches it, and asks again
    act(() => { void router.navigate(-1); });
    await pass(4, 1);
    expect(router.state.location.search).toBe("?name=Rekha%20Soni");
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("Udaipur");
  } finally {
    router.dispose();
  }
});

test("a Back to another page that the guard stops, left unanswered, then a jump to an address that would start the form afresh: Stay goes to the form's own entry", async () => {
  handClock();
  serve({ "GET customers/": NONE });
  const { router } = mount(routes, ["/customers/new?name=Rekha%20Soni"], { browser: true });
  const idx = () => (window.history.state as { idx?: number } | null)?.idx;
  try {
    await pass(400, 1);
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Rekha Soni");
    // entries: Rekha's form (0), the list (1), a new customer's form (2)
    await act(async () => { await router.navigate("/customers"); });
    await act(async () => { await router.navigate("/customers/new"); });
    expect(screen.getByLabelText(/^Name/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Udaipur" } });
    // Back to the list: the page's guard stops it, and the browser is put back on the form's entry
    act(() => { void router.navigate(-1); });
    await pass(4, 1);
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(idx()).toBe(2);
    // its question left unanswered, a jump to Rekha's address on this same page, which asks too
    act(() => { void router.navigate(-2); });
    await pass(4, 1);
    expect(router.state.location.search).toBe("?name=Rekha%20Soni");
    const dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    await pass(400, 1); // past the dialog's guard against a double tap's second tap
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
    // the form's own entry, two on: never the list's, one on, which the guard would stop again
    await pass(4, 1);
    expect(router.state.location.pathname + router.state.location.search).toBe("/customers/new");
    expect(idx()).toBe(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("Udaipur");
  } finally {
    router.dispose();
  }
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

test("the app opens the form at /customers/new and /customers/:id/edit, ahead of the placeholder, without the phone's tabs", async () => {
  for (const path of ["/customers/new", "/customers/7/edit"]) {
    const m = matchRoutes(appRoutes, path)!;
    const route = m[m.length - 1].route;
    expect(await loadedPage(route.element), path).toBe(CustomerForm);
    expect(route.handle, path).toEqual({ hideNav: true });
  }
});

test("Add PAN for a stored GSTIN placeholder opens blank, explains it, and saves", async () => {
  handClock();
  const calls = serve({ "GET customers/7/": { ...ANIL, gst_number: "URP" }, "GET customers/": NONE, "GET customers/7/statement/": NO_BILLS,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }) });
  const { router } = mount(routes, ["/customers/7", "/customers/7/edit?focus=pan"]);
  await pass(400, 1);
  expect(screen.getByLabelText("GSTIN")).toHaveValue("");
  expect(screen.getByLabelText("GSTIN")).toHaveAccessibleDescription("“URP” was on file; it means no GSTIN.");
  await pass(80, 1);
  expect(screen.getByLabelText("PAN")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("PAN"), { target: { value: "ABCDE1234F" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ gst_number: "", pan_number: "ABCDE1234F" });
  expect(router.state.location.pathname).toBe("/customers/7");
});

test.each(["Anil Gupta", "ANIL GUPTA"])("editing the name as %s ignores an existing name in other letters and saves", async (name) => {
  handClock();
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": NO_BILLS,
    "GET customers/": { count: 1, next: null, results: [{ ...ANIL, id: 8, name: "ANIL GUPTA" }] },
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }) });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: name } });
  await pass(250, 1);
  expect(searches(calls)).toEqual([]);
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Jaipur" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ name, city: "Jaipur" });
});

test("an unchanged placeholder mobile saves, but a changed bad mobile is still refused", async () => {
  handClock();
  const calls = serve({ "GET customers/7/": { ...ANIL, mobile_number: "0000000000" }, "GET customers/": NONE, "GET customers/7/statement/": NO_BILLS,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }) });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  const phone = screen.getByLabelText("Mobile number");
  fireEvent.change(phone, { target: { value: "1234567890" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(phone).toHaveAttribute("aria-invalid", "true");
  expect(phone).toHaveAccessibleDescription("Indian mobile numbers start with 6, 7, 8 or 9. Check the first digit.");
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  fireEvent.change(phone, { target: { value: "0000000000" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Jaipur" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ mobile_number: "0000000000", city: "Jaipur" });
});

test("opening an edit reads its record and duplicates, never the registry (X-67); name, mobile and GSTIN searches each wait for a change", async () => {
  handClock();
  const customer = { ...ANIL, gst_number: "27XTZPS7585P1ZB", state_name: "MAHARASHTRA" };
  const calls = serve({ "GET customers/7/": customer, "GET customers/": NONE, "GET customers/7/statement/": NO_BILLS,
    "GET registry/27XTZPS7585P1ZB/": { gstin: "27XTZPS7585P1ZB", status: "unknown", reason: "", state_code: "27", state_name: "MAHARASHTRA", pan: "XTZPS7585P", registry: null, lookup: "cache", on_file: { customers: [], firms: [] } },
  });
  mount(routes, ["/customers/7/edit"]);
  await pass(1000, 1);
  expect(calls.map((c) => c.url).sort()).toEqual(["customers/7/", "customers/duplicates/", "firms/", "preferences/"]);
  expect(screen.queryByText(/^Has billed /)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Anil Kumar" } });
  await pass(249, 1);
  expect(searches(calls)).toEqual([]);
  await pass(1, 1);
  expect(searches(calls)).toEqual(["Anil Kumar"]);
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9829041133" } });
  await pass(249, 1);
  expect(searches(calls)).toEqual(["Anil Kumar"]);
  await pass(1, 1);
  expect(searches(calls)).toEqual(["Anil Kumar", "9829041133"]);
  fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "08AAGPL3375F1ZO" } });
  await pass(249, 1);
  expect(searches(calls)).toEqual(["Anil Kumar", "9829041133"]);
  await pass(1, 1);
  expect(searches(calls)).toEqual(["Anil Kumar", "9829041133", "08AAGPL3375F1ZO"]);
});

test("an earlier page's cached statement supplies Has billed notes without another statement read", async () => {
  function EarlierPage() {
    const statement = useStatement(7, { business_id: 3, start_date: "2026-04-01", end_date: "2027-03-31" });
    return statement.isSuccess ? <Link to="/customers/7/edit">Edit customer</Link> : null;
  }
  handClock();
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/": NONE, "GET customers/7/statement/": { ...NO_BILLS,
    bills: [{ id: 1, business: 3, invoice_date: "2026-09-01", status: "active", total_amount: "1.00" }] } });
  mount([{ path: "/earlier", element: <EarlierPage /> }, ...routes], ["/earlier"]);
  await pass(400, 1);
  fireEvent.click(screen.getByRole("link", { name: "Edit customer" }));
  await pass(400, 1);
  expect(screen.getByText("Has billed Anil")).toBeInTheDocument();
  // A dated, one-firm cache says nothing about another firm's whole history.
  expect(screen.queryByText("No bills yet")).not.toBeInTheDocument();
  expect(calls.filter((c) => c.url.endsWith("/statement/"))).toHaveLength(1);
});

test.each([
  ["Address", "address", "Use a shorter address."],
  ["Type", "customer_type", "Choose walk-in, person or business."],
])("a server-refused %s is focused and described at its field", async (label, key, words) => {
  handClock();
  serve({ "GET customers/": NONE, "POST customers/": () => ({ status: 400, data: { [key]: [words] } }) });
  mount(routes, ["/customers/new?name=Anil"]);
  await pass(400, 1);
  fireEvent.click(screen.getAllByRole("button", { name: "Save customer" })[0]);
  await pass(0, 1);
  const field = label === "Type" ? document.getElementById("cu-type") : screen.getByRole("textbox", { name: "Address" });
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription(words);
});


test("name and address stop at the model's 255-character limit", async () => {
  handClock();
  serve({ "GET customers/": NONE });
  mount(routes, ["/customers/new"]);
  await pass(400, 1);
  expect(screen.getByLabelText(/^Name/)).toHaveAttribute("maxlength", "255");
  expect(screen.getByRole("textbox", { name: "Address" })).toHaveAttribute("maxlength", "255");
});


test("an unchanged GSTIN accepted by the server's loose rule saves with its shape warning; changing it restores strict checking", async () => {
  handClock();
  const stored = "08INVALID000000";
  const calls = serve({ "GET customers/7/": { ...ANIL, gst_number: stored }, "GET customers/": NONE,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...ANIL, ...(c.data as object) } }) });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  const gstin = screen.getByLabelText("GSTIN");
  expect(gstin).not.toHaveAttribute("aria-invalid");
  expect(gstin).toHaveAccessibleDescription(expect.stringContaining("It was on file and saves unchanged."));
  fireEvent.change(gstin, { target: { value: "08INVALID000001" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(gstin).toHaveAttribute("aria-invalid", "true");
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  fireEvent.change(gstin, { target: { value: stored } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Jaipur" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ gst_number: stored, city: "Jaipur" });
});

test("a stored GSTIN the server would refuse says to clear it from the start", async () => {
  handClock();
  serve({ "GET customers/7/": { ...ANIL, gst_number: "08ABCDE1234A1Z" }, "GET customers/": NONE });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  expect(screen.getByLabelText("GSTIN")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("GSTIN")).toHaveAccessibleDescription("“08ABCDE1234A1Z” isn't a GSTIN. Clear it, or type the GSTIN.");
});

test.each(["", "URP"])("an unchanged business with %s on file for GSTIN saves with a warning", async (gstin) => {
  handClock();
  const customer = { ...ANIL, customer_type: "business", type: "business", gst_number: gstin };
  const calls = serve({ "GET customers/7/": customer, "GET customers/": NONE,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...customer, ...(c.data as object) } }) });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  const box = screen.getByLabelText("GSTIN");
  expect(box).toHaveValue("");
  expect(box).not.toHaveAttribute("aria-invalid");
  expect(screen.getByText("This business has no GSTIN on file. It saves unchanged; add the GSTIN before making B2B bills.")).toBeInTheDocument();
  if (gstin) expect(screen.getByText("“URP” was on file; it means no GSTIN.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Jaipur" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ gst_number: "", customer_type: "business", city: "Jaipur" });
});

test("a business whose GSTIN was just cleared still needs it before saving", async () => {
  handClock();
  const calls = serve({ "GET customers/7/": { ...ANIL, customer_type: "business", type: "business", gst_number: "27XTZPS7585P1ZB", state_name: "MAHARASHTRA" }, "GET customers/": NONE });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  const gstin = screen.getByLabelText("GSTIN");
  fireEvent.change(gstin, { target: { value: "" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(gstin).toHaveAttribute("aria-invalid", "true");
  expect(gstin).toHaveAccessibleDescription("A business customer needs its GSTIN: without one, its bills block GSTR-1. Add the GSTIN, or choose Person.");
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});

test("an unchanged stored state mismatch is a warning that saves; changing the state still has to match the GSTIN", async () => {
  handClock();
  const customer = { ...ANIL, customer_type: "business", type: "business", gst_number: "27XTZPS7585P1ZB", state_name: "RAJASTHAN" };
  const calls = serve({ "GET customers/7/": customer, "GET customers/": NONE,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...customer, ...(c.data as object) } }) });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  const state = screen.getByLabelText("State");
  expect(state).not.toHaveAttribute("aria-invalid");
  expect(state).toHaveAccessibleDescription("The GSTIN is registered in Maharashtra (27), but Rajasthan (08) is on file. It saves unchanged; check the state before making a bill.");
  fireEvent.change(state, { target: { value: "GUJARAT" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(state).toHaveAttribute("aria-invalid", "true");
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  fireEvent.change(state, { target: { value: "RAJASTHAN" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Jaipur" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ state_name: "RAJASTHAN", gst_number: "27XTZPS7585P1ZB", city: "Jaipur" });
});


test("a valid stored GSTIN with no state saves its own state, never the firm's home state", async () => {
  handClock();
  const customer = { ...ANIL, customer_type: "business", type: "business", gst_number: "27XTZPS7585P1ZB", state_name: "" };
  const calls = serve({ "GET customers/7/": customer, "GET customers/": NONE,
    "PATCH customers/7/": (c: Call) => ({ status: 200, data: { ...customer, ...(c.data as object) } }) });
  mount(routes, ["/customers/7/edit"]);
  await pass(400, 1);
  expect(screen.getByLabelText("State")).toHaveValue("MAHARASHTRA");
  expect(screen.queryByText(/Rajasthan.*on file/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Pune" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  await pass(0, 1);
  expect(calls.find((c) => c.method === "PATCH")?.data).toMatchObject({ state_name: "MAHARASHTRA", gst_number: "27XTZPS7585P1ZB" });
});
