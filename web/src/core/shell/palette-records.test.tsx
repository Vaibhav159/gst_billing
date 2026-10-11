import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Palette, paletteCode } from "./Palette";
import { renderApp } from "@/test/render";
import { serve, type Call } from "@/test/server";
import { PRODUCT } from "@/test/records";

const empty = { count: 0, next: null, previous: null, results: [], total_products: 0, twins: [] };
const products = Array.from({ length: 5 }, (_, index) => ({ ...PRODUCT, id: 90 + index, name: "Diamond " + (index + 1), gst_percent: "0.25" }));
const base = {
  "GET firms/": { results: [{ id: 3, name: "KIRAN GOLD HOUSE", short: "Royal", gst_number: "08VRHFA2322D1ZI", state_name: "RAJASTHAN" }] },
  "GET sales/": { count: 0, results: [] }, "GET bin/": { count: 0, results: [] },
  "GET search/quick/": { customers: [], invoices: [], products: [{ id: 200, name: "Wrong legacy product", hsn_code: "7102" }] },
  "GET purchases/": { count: 0, results: [] }, "GET suppliers/": { count: 0, results: [] },
};
beforeAll(async () => { await paletteCode.load(); });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => vi.useRealTimers());
async function type(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}
test("Ctrl K requests at most five catalog products only while typing and drops legacy quick-search products", async () => {
  const calls = serve({ ...base, "GET catalog/": { ...empty, count: 9, results: products, total_products: 9 } });
  renderApp(<Palette open onClose={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(calls.filter((call) => call.url === "catalog/")).toHaveLength(0);
  await type("d");
  expect(calls.filter((call) => call.url === "catalog/")).toHaveLength(0);
  await type("diamond");
  expect(await screen.findByRole("option", { name: /Diamond 5/ })).toBeInTheDocument();
  expect(screen.getAllByRole("option", { name: /Diamond [1-5]/ })).toHaveLength(5);
  expect(screen.queryByRole("option", { name: /Wrong legacy/ })).not.toBeInTheDocument();
  expect(calls.filter((call) => call.url === "catalog/").map((call) => call.params)).toEqual([{ q: "diamond", page_size: 5 }]);
  expect(screen.getByRole("option", { name: /Diamond 1/ })).toHaveTextContent("GST 0.25%");
});
test("stored firm short names match without a separate firm search request", async () => {
  const calls = serve({ ...base, "GET catalog/": empty });
  renderApp(<Palette open onClose={() => {}} />);
  await type("royal");
  expect(await screen.findByRole("option", { name: /KIRAN GOLD HOUSE/ })).toBeInTheDocument();
  expect(calls.filter((call) => call.url === "firms/")).toHaveLength(1);
});
test("a catalog failure offers retry without hiding matching firms", async () => {
  let attempts = 0;
  serve({ ...base, "GET catalog/": () => ++attempts === 1 ? { status: 0 } : { status: 200, data: empty } });
  renderApp(<Palette open onClose={() => {}} />);
  await type("royal");
  expect(await screen.findByRole("option", { name: /KIRAN GOLD HOUSE/ })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(attempts).toBe(2));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument());
});
test("an old catalog answer cannot replace results for newly typed text", async () => {
  let finish: ((reply: { status: number; data: unknown }) => void) | undefined;
  serve({ ...base, "GET catalog/": ({ params }: Call) => params.q === "gold" ? new Promise((resolve) => { finish = resolve; }) : { status: 200, data: { ...empty, results: [{ ...PRODUCT, name: "Silver ring" }] } } });
  renderApp(<Palette open onClose={() => {}} />);
  await type("gold");
  await waitFor(() => expect(finish).toBeDefined());
  await type("silver");
  expect(await screen.findByRole("option", { name: /Silver ring/ })).toBeInTheDocument();
  await act(async () => finish?.({ status: 200, data: { ...empty, results: [{ ...PRODUCT, name: "Gold old answer" }] } }));
  expect(screen.queryByRole("option", { name: /Gold old answer/ })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Silver ring/ })).toBeInTheDocument();
});

