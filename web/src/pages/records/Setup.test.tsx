import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import Setup from "./Setup";
import type { SetupSummary } from "@/core/api/setup";
import { NewShopGate } from "@/core/router/NewShopGate";
import { mount, VIEWER } from "@/pages/customers/testing";
import { serve, type Call } from "@/test/server";

const full = { firms: { count: 3, names: ["Kiran", "Meera", "Aarav"] }, customers: { count: 28, names: ["Anil", "Priya"] }, products: { count: 17, names: ["Gold necklace"] }, bills: { count: 332, cancelled: 2 }, people: 4, last_backup_at: null };
const empty = { firms: { count: 0, names: [] }, customers: { count: 0, names: [] }, products: { count: 0, names: [] }, bills: { count: 0, cancelled: 0 }, people: null, last_backup_at: null };
function server(data: SetupSummary = full, fail = false) {
  let prefs: Record<string, unknown> = {};
  return serve({
    "GET firms/": { results: data.firms.names.map((name, index) => ({ id: index + 1, name, short: name, gst_number: "", state_name: "" })) }, "GET shop-settings/": { default_business: null }, "GET preferences/": { data: prefs }, "GET setup/": data,
    "PATCH preferences/": ({ data: patch }: Call) => { if (fail) return { status: 0 }; prefs = { ...prefs, ...(patch as object) }; return { status: 200, data: { data: prefs } }; },
  });
}
const routes = [{ path: "/", element: <NewShopGate><p>The dashboard</p></NewShopGate> }, { path: "/setup", element: <Setup /> }, { path: "/firms/new", element: <NewShopGate><p>First business form</p></NewShopGate> }];
beforeEach(() => { localStorage.clear(); });
test("setup ticks from server counts, leaves walk-in out, and names cancelled bills separately", async () => {
  server();
  mount(routes, ["/setup"]);
  expect(await screen.findByText("You're set up")).toBeInTheDocument();
  expect(screen.getAllByText("Done")).toHaveLength(4);
  expect(screen.getByText("28 customers on file, besides walk-in sales")).toBeInTheDocument();
  expect(screen.getByText("332 sales bills made · 2 cancelled not counted")).toBeInTheDocument();
});
test("skipping and undoing a step writes only this person's preferences, never invents a completed product", async () => {
  const calls = server({ ...full, products: empty.products, bills: empty.bills });
  mount(routes, ["/setup"]);
  fireEvent.click(await screen.findByRole("button", { name: "Skip: add a product" }));
  expect(await screen.findByText("Skipped")).toBeInTheDocument();
  expect(calls.filter((call) => call.method === "PATCH").map((call) => call.data)).toEqual([{ setup: { dismissed: false, skipped: ["product"] } }]);
  fireEvent.click(screen.getByRole("button", { name: "Undo skip" }));
  await waitFor(() => expect(screen.queryByText("Skipped")).not.toBeInTheDocument());
  expect(calls.filter((call) => call.method === "PATCH").at(-1)?.data).toEqual({ setup: { dismissed: false, skipped: [] } });
});
test("a failed skip stays incomplete and retry is available", async () => {
  server({ ...full, products: empty.products }, true);
  mount(routes, ["/setup"]);
  fireEvent.click(await screen.findByRole("button", { name: "Skip: add a product" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByText("Skipped")).not.toBeInTheDocument();
});
test("an empty shop sends the owner to the welcome and keeps adding the first firm reachable", async () => {
  server(empty);
  const view = mount(routes, ["/"]);
  expect(await screen.findByRole("heading", { name: "Welcome to GST Billing" })).toBeInTheDocument();
  expect(view.router.state.location.pathname).toBe("/setup");
  expect(screen.queryByRole("button", { name: "Skip setup" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Skip: add your business" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Add your first business" }));
  expect(await screen.findByText("First business form")).toBeInTheDocument();
});
test("an empty shop tells a nonowner exactly who can add the business", async () => {
  server(empty);
  mount(routes, ["/"], { me: VIEWER });
  expect(await screen.findByText("Ask the owner to add the business first")).toBeInTheDocument();
  expect(screen.queryByText("The dashboard")).not.toBeInTheDocument();
});
test("a pending or failed firm read does not pretend the shop is empty", async () => {
  let finish: ((reply: { status: number; data?: unknown }) => void) | undefined;
  serve({ "GET firms/": () => new Promise((resolve) => { finish = resolve; }), "GET preferences/": { data: {} }, "GET shop-settings/": { default_business: null } });
  const view = mount(routes, ["/"]);
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.queryByText("Welcome to GST Billing")).not.toBeInTheDocument();
  expect(screen.queryByText("The dashboard")).not.toBeInTheDocument();
  await act(async () => finish?.({ status: 503, data: { detail: "Unavailable" } }));
  expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(view.router.state.location.pathname).toBe("/");
});
test("the established shop reuses the slim firm list without another setup request", async () => {
  const calls = server();
  mount(routes, ["/"]);
  expect(await screen.findByText("The dashboard")).toBeInTheDocument();
  expect(calls.filter((call) => call.url === "setup/")).toHaveLength(0);
  expect(calls.filter((call) => call.url === "firms/")).toHaveLength(1);
});

