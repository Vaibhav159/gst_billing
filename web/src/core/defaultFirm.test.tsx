import { act, screen, waitFor } from "@testing-library/react";
import { ScopeProvider, useScope } from "@/core/scope";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";

const firms = { results: [{ id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", gst_number: "", state_name: "" }, { id: 4, name: "MEERA ORNAMENTS", short: "Meera", gst_number: "", state_name: "" }] };
function ReadScope() {
  const scope = useScope();
  return <><output aria-label="Scope">{JSON.stringify({ firmId: scope.firmId, defaultFirmId: scope.defaultFirmId, defaultReady: scope.defaultReady, failed: Boolean(scope.defaultProblem) })}</output><button onClick={() => scope.setFirmId("all")}>All firms</button></>;
}
const read = () => JSON.parse(screen.getByLabelText("Scope").textContent ?? "{}");
beforeEach(() => localStorage.clear());
test.each([
  [{ defaultBusinessId: "4" }, 3, 4],
  [{}, 4, 4],
  [{ defaultBusinessId: "99" }, 99, 3],
])("default order is personal, shop, first firm, ignoring ids no longer on file: %j / %s", async (prefs, shop, expected) => {
  serve({ "GET firms/": firms, "GET preferences/": { data: prefs }, "GET shop-settings/": { default_business: shop } });
  renderApp(<ScopeProvider><ReadScope /></ScopeProvider>);
  await waitFor(() => expect(read()).toMatchObject({ firmId: expected, defaultFirmId: expected, defaultReady: true }));
});
test("an explicit all-firms pick survives the defaults arriving, but retains the bill default separately", async () => {
  localStorage.setItem("gst3.scope.1", "all");
  let finish: ((value: { status: number; data: unknown }) => void) | undefined;
  serve({ "GET firms/": firms, "GET preferences/": { data: {} }, "GET shop-settings/": () => new Promise((resolve) => { finish = resolve; }) });
  renderApp(<ScopeProvider><ReadScope /></ScopeProvider>);
  await waitFor(() => expect(finish).toBeDefined());
  expect(read()).toMatchObject({ firmId: "all", defaultFirmId: null, defaultReady: false });
  await act(async () => finish?.({ status: 200, data: { default_business: 4 } }));
  await waitFor(() => expect(read()).toMatchObject({ firmId: "all", defaultFirmId: 4, defaultReady: true }));
});
test("a failed default read is exposed, so a new bill cannot silently use the first firm", async () => {
  serve({ "GET firms/": firms, "GET preferences/": { data: {} }, "GET shop-settings/": () => ({ status: 503, data: { detail: "Unavailable" } }) });
  renderApp(<ScopeProvider><ReadScope /></ScopeProvider>);
  await waitFor(() => expect(read()).toMatchObject({ defaultFirmId: null, defaultReady: false, failed: true }));
});

test("a failed firm list is exposed without an indefinite unknown scope", async () => {
  serve({ "GET firms/": () => ({ status: 503, data: { detail: "Unavailable" } }), "GET preferences/": { data: {} }, "GET shop-settings/": { default_business: null } });
  renderApp(<ScopeProvider><ReadScope /></ScopeProvider>);
  await waitFor(() => expect(read()).toMatchObject({ defaultFirmId: null, defaultReady: false, failed: true }));
  expect(read().firmId).toBe("all");
});


test("an unread personal default cannot be guessed from shop settings", async () => {
  const calls = serve({ "GET firms/": firms, "GET preferences/": () => ({ status: 503, data: { detail: "Unavailable" } }), "GET shop-settings/": { default_business: 4 } });
  renderApp(<ScopeProvider><ReadScope /></ScopeProvider>);
  await waitFor(() => expect(read()).toMatchObject({ defaultFirmId: null, defaultReady: false, failed: true }));
  expect(calls.some((call) => call.url === "shop-settings/")).toBe(false);
});
