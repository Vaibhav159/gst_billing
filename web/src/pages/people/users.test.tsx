import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/core/api/client";
import type { Person, PersonInput } from "@/core/api/people";
import type { Role } from "@/core/auth/role";
import { renderApp } from "@/test/render";
import { serveWith, type Call, type Reply } from "@/test/server";
import Users from "./Users";

const owner: Person = { id: 1, username: "kailash", first_name: "Kailash", last_name: "Mehta", name: "Kailash Mehta", email: "", role: "owner", role_label: "Owner", placed: true, needs_role_choice: false, active: true, stopped_at: null, stopped_by: null, usual_firm: null, last_active: null, joined: "2026-08-20", must_change_password: false, you: true };
const staff: Person = { ...owner, id: 2, username: "rakesh", first_name: "Rakesh", last_name: "Soni", name: "Rakesh Soni", role: "staff", role_label: "Counter staff", you: false, email: "rakesh@example.com" };
const stopped: Person = { ...staff, id: 3, username: "manoj", first_name: "Manoj", last_name: "Jain", name: "Manoj Jain", email: "manoj@example.com", active: false, stopped_at: "2026-10-07T15:00:00+05:30" };
let rows = [owner, staff, stopped];
let override: ((call: Call) => Reply | undefined) | undefined;
let calls: Call[];
const adapter = api.defaults.adapter;
function boot() {
  calls = serveWith((c) => {
    const special = override?.(c); if (special) return special;
    if (c.method === "GET" && c.url === "people/") return { status: 200, data: { results: rows } };
    if (c.url === "firms/") return { status: 200, data: { results: [{ id: 3, name: "KIRAN GOLD HOUSE" }, { id: 2, name: "MEERA ORNAMENTS" }] } };
    if (c.url === "audit/") return { status: 200, data: { count: 1, next: null, previous: null, results: [{ id: 9012, at: "2026-10-07T15:14:00+05:30", by: { id: 1, name: "Kailash Mehta" }, action: "updated", entity: "user", entity_id: 2, kind: "admin", words: { text: "Changed the role of", target: "Rakesh Soni", after: "" }, link: "/users", details: "Counter staff → Accountant", changes: [], can: null }] } };
    if (c.method === "POST" && c.url === "people/") {
      const { password: _password, usual_firm, ...body } = c.data as PersonInput;
      const added = { ...staff, ...body, id: 4, usual_firm: usual_firm ? { id: usual_firm, name: "MEERA ORNAMENTS", short: "Meera" } : null, name: `${body.first_name} ${body.last_name}`.trim(), must_change_password: true };
      rows = [...rows, added]; return { status: 201, data: added };
    }
    const m = /^people\/(\d+)\/(role|usual-firm|stop|allow|password)\/$/.exec(c.url);
    if (m) {
      if (m[2] === "password") { rows = rows.map((u) => u.id === Number(m[1]) ? { ...u, must_change_password: true } : u); return { status: 200, data: { detail: "New password set for Rakesh Soni. They're signed out everywhere and choose their own when they next sign in." } }; }
      const u = rows.find((r) => r.id === Number(m[1]))!;
      const body = c.data as { role?: Role; business?: number | null } | undefined;
      const next = { ...u, ...(m[2] === "usual-firm" ? { usual_firm: body!.business ? { id: body!.business, name: "MEERA ORNAMENTS", short: "Meera" } : null } : {}), ...(m[2] === "role" ? { role: body!.role!, placed: true, needs_role_choice: false } : {}), ...(m[2] === "stop" || m[2] === "allow" ? { active: m[2] === "allow" } : {}) };
      rows = rows.map((r) => r.id === u.id ? next : r); return { status: 200, data: next };
    }
    return { status: 404, data: { detail: "Not found." } };
  });
}
function ready() { act(() => vi.setSystemTime(Date.now() + 500)); }
async function openMenu(name = "Rakesh Soni") { fireEvent.click(screen.getByRole("button", { name: `More for ${name}` })); await screen.findByRole("menu"); ready(); }
async function selectMenu(name: string | RegExp) { fireEvent.click(screen.getByRole("menuitem", { name })); const dialog = await screen.findByRole("dialog"); ready(); return within(dialog); }
async function addForm() { fireEvent.click(screen.getByRole("button", { name: "Add a person" })); const d = within(await screen.findByRole("dialog")); ready(); return d; }
function fillAdd(d: ReturnType<typeof within>) {
  fireEvent.change(d.getByLabelText(/^First name/), { target: { value: "Pooja" } });
  fireEvent.change(d.getByLabelText("Last name"), { target: { value: "Shah" } });
  fireEvent.change(d.getByLabelText("Password", { exact: true }), { target: { value: "SilverLamp57" } });
  fireEvent.change(d.getByLabelText("Password again"), { target: { value: "SilverLamp57" } });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); rows = [owner, staff, stopped]; override = undefined; boot(); });
afterEach(() => { cleanup(); api.defaults.adapter = adapter; vi.useRealTimers(); vi.restoreAllMocks(); (window as unknown as { __phone?: boolean }).__phone = false; });

it("shows roles without asking for private people or audit to non-owners", async () => {
  renderApp(<Users />, { me: { role: "staff", permissions: ["view"] } });
  expect(await screen.findByText("Only the owner manages users")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "What each role can do" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add a person" })).not.toBeInTheDocument();
  expect(calls).toHaveLength(0);
});
it("lists active and stopped people, explains own-role restriction, and filters locally", async () => {
  renderApp(<Users />); await screen.findByText("Rakesh Soni", { selector: "span.font-medium" });
  expect(screen.getByRole("button", { name: /Role for Kailash Mehta/ })).toBeDisabled();
  expect(screen.getByText("You can't change your own role. Another owner can.")).toBeInTheDocument();
  expect(screen.getByText("Can't sign in · 1")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "rakesh@example.com" } });
  expect(screen.queryByText("Manoj Jain")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value: "owner" } });
  expect(screen.getByText("Nobody matches")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "people/")).toHaveLength(1);
});
it("adds with the verbatim payload, asks for password confirmation, and clears secrets on close", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2");
  const d = await addForm(); fillAdd(d);
  fireEvent.change(d.getByLabelText("Password again"), { target: { value: "wrong" } });
  fireEvent.click(d.getByRole("button", { name: "Add Pooja" }));
  expect(d.getByText("The two passwords don't match. Type it again.")).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  fireEvent.change(d.getByLabelText("Password again"), { target: { value: "SilverLamp57" } });
  fireEvent.click(d.getByRole("button", { name: "Add Pooja" }));
  await waitFor(() => expect(calls.find((c) => c.method === "POST")?.data).toEqual({ first_name: "Pooja", last_name: "Shah", username: "pooja_s", email: "", role: "staff", usual_firm: null, password: "SilverLamp57" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const again = await addForm(); expect(again.getByLabelText("Password", { exact: true })).toHaveValue("");
});
it("retains names and passwords after a server field refusal and retries only on request", async () => {
  override = (c) => c.method === "POST" && c.url === "people/" ? { status: 400, data: { username: ["@pooja_s is taken by Pooja Shah. Try another."] } } : undefined;
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); const d = await addForm(); fillAdd(d);
  fireEvent.click(d.getByRole("button", { name: "Add Pooja" }));
  expect(await d.findByText("@pooja_s is taken by Pooja Shah. Try another.", { selector: "p" })).toBeInTheDocument();
  expect(d.getByLabelText("Password", { exact: true })).toHaveValue("SilverLamp57");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});
it("only confirms a role on selection; owner promotion needs acknowledgment and shows gains and losses", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2");
  fireEvent.click(screen.getByRole("button", { name: /Role for Rakesh Soni/ })); await screen.findByRole("menu");
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: /^Owner/ })); const d = within(await screen.findByRole("dialog")); ready();
  expect(d.getByText(/Will be able to:/)).toBeInTheDocument();
  expect(d.getByRole("button", { name: "Change role" })).toBeDisabled();
  fireEvent.click(d.getByRole("checkbox")); fireEvent.click(d.getByRole("button", { name: "Change role" }));
  await waitFor(() => expect(calls.find((c) => c.url === "people/2/role/")?.data).toEqual({ role: "owner" }));
});
it("places an unplaced editor even when Counter staff is selected again", async () => {
  rows = [owner, { ...staff, placed: false, needs_role_choice: true }]; renderApp(<Users />);
  await screen.findByText("Counter staff · not placed yet");
  fireEvent.click(screen.getByRole("button", { name: /Role for Rakesh Soni/ })); await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitem", { name: /^Counter staff/ })); const d = within(await screen.findByRole("dialog")); ready();
  fireEvent.click(d.getByRole("button", { name: "Change role" }));
  await waitFor(() => expect(calls.find((c) => c.url === "people/2/role/")?.data).toEqual({ role: "staff" }));
});
it("sets a usual firm as a default, without representing it as an access restriction", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu(); const d = await selectMenu(/^Change usual firm/);
  expect(d.getByText(/They can switch firms any time/)).toBeInTheDocument();
  await waitFor(() => expect(d.getByLabelText("Usually works for")).toBeEnabled());
  fireEvent.change(d.getByLabelText("Usually works for"), { target: { value: "2" } }); fireEvent.click(d.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.url === "people/2/usual-firm/")?.data).toEqual({ business: 2 }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Role for Rakesh Soni/ }).closest("tr")).toHaveTextContent("Meera"));
});
it("confirms stop and allow with history-preserving effects", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu(); const stop = await selectMenu(/^Stop Rakesh signing in/);
  expect(stop.getByText(/They're signed out everywhere/)).toHaveTextContent("their bills and history stay");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  fireEvent.click(stop.getByRole("button", { name: "Stop Rakesh signing in" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await openMenu(); const allow = await selectMenu(/^Let Rakesh back in/);
  expect(allow.getByText(/their old password works/)).toBeInTheDocument(); fireEvent.click(allow.getByRole("button", { name: "Let them back in" }));
  await waitFor(() => expect(calls.some((c) => c.url === "people/2/allow/")).toBe(true));
});
it("keeps a failed change open and reports the server's own-account conflict", async () => {
  override = (c) => c.url === "people/2/stop/" ? { status: 409, data: { code: "own_account", detail: "You can't stop yourself. Another owner can." } } : undefined;
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu(); const d = await selectMenu(/^Stop Rakesh signing in/);
  fireEvent.click(d.getByRole("button", { name: "Stop Rakesh signing in" }));
  expect(await d.findByText("You can't stop yourself. Another owner can.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument(); expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});
it("sends the owner-set password and says the person chooses their own next time", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu(); const d = await selectMenu(/^Set a new password/);
  expect(d.getByText(/they choose their own when they next sign in/)).toBeInTheDocument();
  fireEvent.change(d.getByLabelText("Password", { exact: true }), { target: { value: "SilverLamp57" } });
  fireEvent.change(d.getByLabelText("Password again"), { target: { value: "SilverLamp57" } });
  fireEvent.click(d.getByRole("button", { name: "Set password" }));
  await waitFor(() => expect(calls.find((c) => c.url === "people/2/password/")?.data).toEqual({ password: "SilverLamp57" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Role for Rakesh Soni/ }).closest("tr")).toHaveTextContent("New password"));
});
it("opens a person's audit history only on request", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2");
  expect(calls.filter((c) => c.url === "audit/" && c.params.entity_id)).toHaveLength(0);
  await openMenu(); const d = await selectMenu("Recent changes…");
  expect(await d.findByText("Counter staff → Accountant")).toBeInTheDocument();
  expect(calls.find((c) => c.url === "audit/" && c.params.entity_id === 2)?.params.entity).toBe("user");
});
it("uses phone rows and a person sheet with the same actions", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true; renderApp(<Users />);
  fireEvent.click(await screen.findByRole("button", { name: /Rakesh Soni Counter staff/ })); const d = within(await screen.findByRole("dialog")); ready();
  expect(d.getByText("@rakesh · rakesh@example.com")).toBeInTheDocument();
  expect(d.getByRole("button", { name: "Change usual firm" })).toBeInTheDocument();
  expect(d.getByRole("button", { name: "Set a new password" })).toBeInTheDocument();
});
it("flashes a changed row using the kit's existing new-row treatment", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2");
  fireEvent.click(screen.getByRole("button", { name: /Role for Rakesh Soni/ })); await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitem", { name: /^Accountant/ })); const d = within(await screen.findByRole("dialog")); ready();
  fireEvent.click(d.getByRole("button", { name: "Change role" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Role for Rakesh Soni: Accountant/ }).closest("tr")).toHaveClass("anim-flash"));
});
it("returns to the phone person sheet showing the changed role", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true; renderApp(<Users />);
  fireEvent.click(await screen.findByRole("button", { name: /Rakesh Soni Counter staff/ })); ready();
  fireEvent.click(screen.getByRole("button", { name: /Role for Rakesh Soni/ })); await screen.findByRole("menu"); ready();
  fireEvent.click(screen.getByRole("menuitem", { name: /^View only/ }));
  const confirm = within(await screen.findByRole("dialog", { name: "Rakesh Soni: Counter staff → View only" })); ready();
  fireEvent.click(confirm.getByRole("button", { name: "Change role" }));
  expect(await screen.findByRole("button", { name: /Role for Rakesh Soni: View only/ })).toBeInTheDocument();
});
it("returns to the phone person sheet after canceling a role change", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true; renderApp(<Users />);
  fireEvent.click(await screen.findByRole("button", { name: /Rakesh Soni Counter staff/ })); ready();
  fireEvent.click(screen.getByRole("button", { name: /Role for Rakesh Soni/ })); await screen.findByRole("menu"); ready();
  fireEvent.click(screen.getByRole("menuitem", { name: /^View only/ }));
  const confirm = within(await screen.findByRole("dialog", { name: "Rakesh Soni: Counter staff → View only" })); ready();
  fireEvent.click(confirm.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("button", { name: /Role for Rakesh Soni: Counter staff/ })).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
});
it("gives an unplaced person's row a Choose a role action", async () => {
  rows = [owner, { ...staff, placed: false, needs_role_choice: true }]; renderApp(<Users />);
  expect(await screen.findByRole("button", { name: /Role for Rakesh Soni/ })).toHaveTextContent("Choose a role");
});
it("can return someone's usual firm to the shop default with business null", async () => {
  rows = [owner, { ...staff, usual_firm: { id: 2, name: "MEERA ORNAMENTS", short: "Meera" } }];
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu(); const d = await selectMenu(/^Change usual firm/);
  await waitFor(() => expect(d.getByLabelText("Usually works for")).toBeEnabled());
  fireEvent.change(d.getByLabelText("Usually works for"), { target: { value: "" } }); fireEvent.click(d.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.url === "people/2/usual-firm/")?.data).toEqual({ business: null }));
});
it("shows the owner's own password link and explains why self-stop is unavailable", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu("Kailash Mehta");
  expect(screen.getByRole("menuitem", { name: /Change your password/ })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /Stop yourself signing in/ })).toBeDisabled();
  expect(screen.getByText("You can't stop yourself. Another owner can.")).toBeInTheDocument();
});
it("shows the common-password server refusal without pretending the common list passed locally", async () => {
  override = (c) => c.url === "people/2/password/" ? { status: 400, data: { password: ["It needs: not a common password."] } } : undefined;
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); await openMenu(); const d = await selectMenu(/^Set a new password/);
  fireEvent.change(d.getByLabelText("Password", { exact: true }), { target: { value: "SilverLamp57" } });
  fireEvent.change(d.getByLabelText("Password again"), { target: { value: "SilverLamp57" } });
  expect(d.getByText("Not a common password · checked when saved")).toBeInTheDocument();
  fireEvent.click(d.getByRole("button", { name: "Set password" }));
  expect(await d.findByText("It needs: not a common password.", { selector: "#pw-set-password-error" })).toBeInTheDocument();
  expect(d.getByLabelText("Password", { exact: true })).toHaveValue("SilverLamp57");
});
it("retains the add form while offline and never queues the password for retry", async () => {
  renderApp(<Users />); await screen.findByText("Can sign in · 2"); const d = await addForm(); fillAdd(d);
  override = (c) => c.method === "POST" ? { status: 0 } : undefined;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent.click(d.getByRole("button", { name: "Add Pooja" }));
  expect(await d.findByText("You're offline, so this wasn't saved")).toBeInTheDocument();
  expect(d.getByLabelText("Password", { exact: true })).toHaveValue("SilverLamp57");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});
it("avoids existing usernames ignoring case and preserves a hand-edited username", async () => {
  rows = [owner, { ...staff, username: "POOJA_S" }]; renderApp(<Users />); await screen.findByText("Can sign in · 2"); const d = await addForm();
  fireEvent.change(d.getByLabelText(/^First name/), { target: { value: "Pooja" } });
  fireEvent.change(d.getByLabelText("Last name"), { target: { value: "Shah" } });
  expect(d.getByLabelText(/^Username/)).toHaveValue("pooja_s2");
  fireEvent.change(d.getByLabelText(/^Username/), { target: { value: "my.counter" } });
  fireEvent.change(d.getByLabelText("Last name"), { target: { value: "Sisodia" } });
  expect(d.getByLabelText(/^Username/)).toHaveValue("my.counter");
});

it("shows lock and relock for owner/accountant, but unlocking only for the owner", () => {
  renderApp(<Users />, { me: { role: "staff", permissions: ["view"] } });
  const lock = within(screen.getByRole("row", { name: /^Lock or relock a month/ })).getAllByRole("cell").slice(1);
  const unlock = within(screen.getByRole("row", { name: /^Unlock a filed month/ })).getAllByRole("cell").slice(1);
  expect(lock.map(cell => within(cell).queryByLabelText("Yes") !== null)).toEqual([true, true, false, false]);
  expect(unlock.map(cell => within(cell).queryByLabelText("Yes") !== null)).toEqual([true, false, false, false]);
  expect(screen.queryByText("Lock or unlock a month")).not.toBeInTheDocument();
});
it.each([
  ["accountant", "Owner", "Will be able to:"],
  ["owner", "Accountant", "Will no longer:"],
] as const)("changing %s to %s explains the separate unlock right", async (from, to, heading) => {
  rows = [owner, { ...staff, role: from, role_label: from === "owner" ? "Owner" : "Accountant" }];
  renderApp(<Users />); await screen.findByText("Can sign in · 2");
  fireEvent.click(screen.getByRole("button", { name: /Role for Rakesh Soni/ })); await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${to}`) }));
  const dialog = within(await screen.findByRole("dialog"));
  const effect = dialog.getByText(heading).closest("p");
  expect(effect).toHaveTextContent("unlock a filed month");
  expect(effect).not.toHaveTextContent("lock or relock a month");
});
