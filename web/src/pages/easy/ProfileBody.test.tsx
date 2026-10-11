import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ProfileBody, type EasyProfile } from "./ProfileBody";

const person: EasyProfile = { username: "kailash", first_name: "Kailash", last_name: "Mehta", role: "owner", role_label: "Owner", usual_firm: { id: 2, name: "Anand", short: "Anand" }, sms_reset: false };
function mount({ dirty = false, profile = person, signOut = vi.fn(async () => {}) } = {}) {
  const router = createMemoryRouter([
    { path: "/e/profile", element: <ProfileBody person={profile} firm={{ id: 7, name: "Kiran" }} dirty={dirty} signOut={signOut} passwordForm={<div>Shared password form</div>} /> },
    { path: "/e/more", element: <div>More page</div> },
  ], { initialEntries: ["/e/profile"] });
  return { ...render(<RouterProvider router={router} />), router, signOut };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-04-01T00:10:00+05:30")); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function opened() { act(() => { vi.setSystemTime(Date.now() + 400); }); }
test("profile distinguishes the usual firm and this phone without editable identity controls", () => {
  mount(); expect(screen.getByText("Kailash Mehta")).toBeVisible(); expect(screen.getByText("Usually works for")).toBeVisible();
  expect(screen.getByText("Anand")).toBeVisible(); expect(screen.getByText("On this phone")).toBeVisible(); expect(screen.getByText("Kiran")).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.getByText(/Only the owner changes roles and names/)).toBeVisible();
});
test.each(["owner", "staff"] as const)("SMS-off %s sees the real recovery route", (role) => {
  mount({ profile: { ...person, role } });
  expect(screen.getByText(/Password codes by SMS aren't switched on yet/)).toHaveTextContent("Ask the owner to set a new password for you. If you are the owner, ask the person who looks after the app.");
  expect(screen.queryByText(/6-digit/)).not.toBeInTheDocument();
});
test("an unsaved password blocks route navigation until Leave is confirmed", async () => {
  const { router } = mount({ dirty: true }); await act(async () => { await router.navigate("/e/more"); });
  const dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
  expect(dialog).toHaveTextContent("Your new password isn't saved. Leave and lose it?");
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
  expect(await screen.findByText("More page")).toBeVisible();
});
test("logout asks before signing out and keeps a failure in the confirmation", async () => {
  const signOut = vi.fn(async () => { throw new Error("offline"); }); mount({ signOut });
  fireEvent.click(screen.getByRole("button", { name: "Log out of this phone" }));
  const dialog = screen.getByRole("dialog", { name: "Log out of this phone?" });
  expect(signOut).not.toHaveBeenCalled(); opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Log out" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong");
  expect(signOut).toHaveBeenCalledOnce();
});
