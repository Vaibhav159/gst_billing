import { cleanup, fireEvent, screen } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import CustomerForm from "@/pages/customers/CustomerForm";
import { ANIL, mount, serve } from "@/pages/customers/testing";
import { formServer, mountForm } from "@/pages/sales/form/testing";
import { handClock, pass } from "@/test/clock";

vi.hoisted(() => { Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }); });

beforeEach(() => {
  handClock(new Date("2026-10-08T10:00:00+05:30"));
  localStorage.clear();
  __resetDeviceDrafts();
  __resetDrafts();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("the Mac bill form names Command for adding a line and checking the bill", async () => {
  formServer();
  mountForm("/sales/new");
  await pass(400);
  expect.soft(screen.getByText(/adds a line/).querySelector("kbd")).toHaveTextContent("⌘");
  expect.soft(screen.getByText("check and save").querySelector("kbd")).toHaveTextContent("⌘");
});

test.each([false, true])("the Mac customer form names Command for save, including dirty edits (edit=%s)", async (edit) => {
  serve({ "GET customers/7/": ANIL, "GET customers/": { count: 0, next: null, results: [] } });
  mount([
    { path: "/customers/new", element: <CustomerForm /> },
    { path: "/customers/:id/edit", element: <CustomerForm /> },
  ], [edit ? "/customers/7/edit" : "/customers/new"]);
  await pass(400);
  expect.soft(screen.getAllByRole("button", { name: edit ? "Save changes" : "Save customer" })[0]).toHaveAttribute("title", "⌘ S");
  if (edit) {
    expect(screen.getByText("No changes yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Jaipur" } });
    expect(screen.getByText("Unsaved changes · ⌘ S saves")).toBeInTheDocument();
  } else expect(screen.getByText("⌘ S saves")).toBeInTheDocument();
});
