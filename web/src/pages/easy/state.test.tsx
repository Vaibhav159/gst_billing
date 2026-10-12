import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { toShopSettings } from "@/core/sales/wire";
import { __setNetState } from "@/core/api/network";
import { salesServer } from "@/core/sales/fixtures";
import { blankLine, startNew } from "@/pages/sales/form/model";
import { defaultFirmId } from "@/core/scope";
import { usePrefs } from "@/core/prefs";
import { easyFirmId, thisYear, lastYear, earlyInYear, weightSlip, unusual, useEasyFirm, useWelcome, setEasyPref } from "./state";

const firms = [{ id: 3, name: "Kiran", short: "Kiran", gstin: "", state: "Rajasthan" }, { id: 8, name: "Aarav", short: "Aarav", gstin: "", state: "Rajasthan" }];
afterEach(async () => { await act(async () => __setNetState("online")); });
describe("Easy state", () => {
  it.each([null, 8])("keeps an unread personal default unknown unless this phone picked %s", async (picked) => {
    const me = picked === null ? 92 : 93;
    if (picked !== null) setEasyPref("firm", me, picked);
    serve({
      "GET firms/": { results: firms },
      "GET preferences/": () => ({ status: 503, data: { detail: "Unavailable" } }),
      "GET shop-settings/": { default_business: 3 },
    });
    function Probe() {
      const f = useEasyFirm();
      const { unavailable } = usePrefs();
      return <output data-prefs-unavailable={Boolean(unavailable)}>{f.loading ? "waiting" : "settled"}:{f.firmId ?? "none"}:{String(f.error)}</output>;
    }
    renderApp(<Probe />, { me: { id: me } });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute("data-prefs-unavailable", "true");
      expect(screen.getByRole("status")).toHaveTextContent(picked === null ? "settled:none:true" : "settled:8:false");
    });
  });
  it("uses the phone pick then personal, shop, alphabetical; ignores vanished firms", () => {
    expect(easyFirmId(firms, 3, "8", 8)).toBe(3);
    expect(easyFirmId(firms, 99, "3", 8)).toBe(3);
    expect(defaultFirmId(firms, "99", 3)).toBe(3);
    expect(defaultFirmId(firms, null, 99)).toBe(8);
    expect(defaultFirmId([], "3", 3)).toBeNull();
    expect(toShopSettings({ default_business: 8 }).default_business).toBe(8);
    expect(firms[0].id).toBe(3);
  });
  it("keeps fiscal boundaries on March 31 and April 1", () => {
    expect(thisYear("2026-03-31")).toEqual({ fy: "2025-26", from: "2025-04-01", to: "2026-03-31" });
    expect(lastYear("2026-04-01")).toEqual({ fy: "2025-26", from: "2025-04-01", to: "2026-03-31" });
    expect(earlyInYear("2026-05-31")).toBe(true);
    expect(earlyInYear("2026-06-01")).toBe(false);
  });
  it("keeps visit-only preferences reactive and isolated by person when writes fail", async () => {
    salesServer();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    function Probe() {
      const firm = useEasyFirm(); const welcome = useWelcome();
      return <><output>{firm.firmId ?? "waiting"}:{String(welcome.seen)}</output><button onClick={() => { firm.setFirm(2); welcome.done(); }}>Choose</button><button onClick={() => welcome.reset()}>Show welcome again</button></>;
    }
    renderApp(<Probe />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3:false"));
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2:true"));
    expect(localStorage.getItem("gst3.easy.welcomed.1")).toBeNull();
    act(() => setEasyPref("welcomed", 2, true));
    expect(screen.getByRole("status")).toHaveTextContent("2:true");
    fireEvent.click(screen.getByRole("button", { name: "Show welcome again" }));
    expect(screen.getByRole("status")).toHaveTextContent("2:false");
    set.mockRestore();
  });
  it.each([["gms", 1000, false], ["g", 1001, true], ["ct", 100, false], ["ct", 101, true], ["pcs", 12345, false]] as const)("checks %s %s", (unit, qty, warned) => {
    expect(Boolean(weightSlip({ name: "Ring", unit, qty }))).toBe(warned);
  });
  it("offers decimal fixes only for whole weights", () => {
    expect(weightSlip({ name: "Ring", unit: "gms", qty: 12345 })?.fix).toBe(12.345);
    expect(weightSlip({ name: "Ring", unit: "gms", qty: 1234.5 })?.fix).toBeNull();
  });
  it("waits for the shop default, then explains offline instead of guessing a firm", async () => {
    let finish!: (value: unknown) => void;
    salesServer([["GET", "preferences/", () => ({ data: {} })], ["GET", "shop-settings/", () => new Promise(resolve => { finish = resolve; })]]);
    function Probe() { const f = useEasyFirm(); return <output>{f.firms.length}:{f.loading ? "waiting" : "settled"}:{f.firmId ?? "none"}:{String(f.error)}</output>; }
    renderApp(<Probe />, { me: { id: 91 } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^[1-9]:waiting:none:false$/));
    act(() => __setNetState("offline"));
    expect(screen.getByRole("status")).toHaveTextContent("settled:none:true");
    await act(async () => { finish({ default_business: 2 }); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("settled:2:false"));
  });
  it("asks for HSN slabs, weight, rate, mixed cash and twin, but leaves address a note", () => {
    const form = startNew({ firmId: 3, firmSource: "mine", today: "2026-10-12" }).form;
    form.payment = "mixed";
    form.lines = [{ ...blankLine(), key: "a", name: "Ring", hsn: "7113", gst: "0.25", qty: 12345 }];
    const notes = unusual(form, { total: 20000000, inter: true, twin: "Same total on this day", itax: [{ kind: "b2c_address", short: "Address", text: "Name and address needed" }], rates: { a: { text: "Rates here are per gram", tick: "Yes, this rate is right" } } });
    expect(notes.filter(n => n.tick).map(n => n.id)).toEqual(["rate-a", "weight-a", "gst-a", "cash-part", "twin"]);
    expect(notes.find(n => n.id === "b2c_address")?.tick).toBeUndefined();
    expect(notes.find(n => n.id === "igst")?.tick).toBeUndefined();
    form.lines[0] = { ...form.lines[0], hsn: "7102", gst: "0.25", qty: 1 };
    expect(unusual(form, { total: 1 }).some(n => n.id.startsWith("gst"))).toBe(false);
  });
});
