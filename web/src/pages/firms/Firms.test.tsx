import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { toScopeFirm, useFirms } from "@/core/scope";
import { mount, VIEWER } from "@/pages/customers/testing";
import Firms from "./Firms";
import { ReturnBadge } from "./parts";
import type { ReturnState } from "@/core/api/firms";
import FirmDetail from "./FirmDetail";
import { toFirmDetail, toFirmRow, useFirmNumbers } from "@/core/api/firms";
import { FIRM_DETAIL } from "@/test/firmRecords";

const reply = (over: Record<string, unknown> = {}) => ({ ...FIRM_DETAIL, ...over });
function server(over: Parameters<typeof serve>[0] = {}) {
  return serve({ "GET firms/": { results: [FIRM_DETAIL] }, "GET firms/3/": FIRM_DETAIL, "GET preferences/": { data: { defaultBusinessId: "3" } }, "GET shop-settings/": { show_bank: true }, ...over });
}
function Numbers() { const q = useFirmNumbers(); return <p>{q.data?.[0].numbers?.next.counter}</p>; }
function Pick() { const { firms } = useFirms(); return <p>{firms.length}: {firms[0]?.short}</p>; }
beforeEach(() => localStorage.clear());
test("the slim picker reads every firm once without figures or a page limit and keeps the stored short name", async () => {
  const calls = serve({ "GET firms/": { results: Array.from({ length: 101 }, (_, i) => ({ ...FIRM_DETAIL, id: i + 1, short: "KG" })) } });
  renderApp(<><Pick /><Pick /></>);
  expect(await screen.findAllByText("101: KG")).toHaveLength(2);
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual({});
});
test("firm totals become integer paise; every deletion use is kept", () => {
  expect(toFirmDetail(reply()).figures.sales).toMatchObject({ total: 100001, tax: 3000 });
  expect(toFirmDetail(reply()).uses.captures).toBe(0);
});
test("cards ask for this FY's figures and numbers and say Open for the pre-part-3 state", async () => {
  const calls = server();
  mount([{ path: "/firms", element: <Firms /> }], ["/firms"]);
  expect(await screen.findByText("KGH/2026-27/34")).toBeInTheDocument();
  expect(screen.getAllByText("Open")).toHaveLength(2);
  expect(screen.getByText("August 2026")).toBeInTheDocument();
  expect(calls.some((c) => c.url === "firms/" && c.params.numbers === 1 && c.params.figures === 1)).toBe(true);
});
test.each(["sales", "cancelled", "purchases", "bin", "drafts", "captures", "filing_records", "filing_months", "filed_periods", "opening_credits"])("%s prevents deleting a firm", async (key) => {
  server({ "GET firms/3/": reply({ uses: { sales: 0, cancelled: 0, purchases: 0, bin: 0, drafts: 0, captures: 0, [key]: 1 } }) });
  mount([{ path: "/firms/:id", element: <FirmDetail /> }], ["/firms/3"]);
  fireEvent.click(await screen.findByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: /Delete firm/ })).toBeDisabled();
});
test("viewers see registration, live bank and numbering but cannot edit", async () => {
  server();
  mount([{ path: "/firms/:id", element: <FirmDetail /> }], ["/firms/3"], { me: VIEWER });
  expect(await screen.findByText("38741120965")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit firm details" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Open GST returns" })).toHaveAttribute("href", "/gst?firm=3");
});
test("a malformed route has no firm request", async () => {
  const calls = server();
  mount([{ path: "/firms/:id", element: <FirmDetail /> }], ["/firms/nope"]);
  expect(await screen.findByRole("heading", { name: "This firm isn't on file" })).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.url.includes("nope"))).toBe(false));
});

test.each([["future", "Not started"], ["open", "Open"], ["blocked", "GSTR-1 blocked · Bill number KGH/2026-27/17 is used twice"], ["ready", "Ready to file"], ["gstr1", "GSTR-1 filed"], ["filed", "Filed"], ["unlocked", "Unlocked"]])("%s keeps the shared filing stage", (state, words) => {
  renderApp(<ReturnBadge state={state as ReturnState} blocker="Bill number KGH/2026-27/17 is used twice" />);
  expect(screen.getByText(words)).toBeInTheDocument();
});

test("settings reads numbers without requesting FY aggregates", async () => {
  const calls = server();
  renderApp(<Numbers />);
  expect(await screen.findByText("34")).toBeInTheDocument();
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual({ numbers: 1 });
});

test.each([false, true])("the highest deleted bill is labelled and links only for the owner (viewer %s)", async (viewer) => {
  const last = { id: 205, invoice_number: "KGH/2026-27/33", invoice_date: "2026-10-01", customer_name: "Anil", status: "deleted" };
  server({ "GET firms/3/": reply({ numbers: { ...FIRM_DETAIL.numbers, last } }) });
  mount([{ path: "/firms/:id", element: <FirmDetail /> }], ["/firms/3"], viewer ? { me: VIEWER } : {});
  expect(await screen.findByText("Deleted")).toBeInTheDocument();
  if (viewer) expect(screen.queryByRole("link", { name: "KGH/2026-27/33 · Deleted" })).not.toBeInTheDocument();
  else expect(screen.getByRole("link", { name: "KGH/2026-27/33 · Deleted" })).toHaveAttribute("href", "/sales/205");
});
test("the slim picker trims stored firm names as the old list did", () => {
  expect(toScopeFirm(toFirmRow({ ...FIRM_DETAIL, name: "  KIRAN GOLD HOUSE " })).name).toBe("KIRAN GOLD HOUSE");
});
