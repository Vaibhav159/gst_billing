import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { serve, type Call } from "@/test/server";
import { toOpeningCredit } from "@/core/api/gstCredit";
import { effectWire, openingWire } from "@/core/gst/creditFixtures";
import { OpeningCreditDialog } from "./OpeningCreditDialog";

const props = { opening: toOpeningCredit(openingWire), businessId: 3, firmName: "KIRAN GOLD HOUSE", firmGstin: "08VRHFA2322D1ZI", open: true, onClose: vi.fn() };
function edit(text: string) { fireEvent.change(screen.getByLabelText("IGST credit"), { target: { value: text } }); }
function mount() { renderApp(<OpeningCreditDialog {...props} />); vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30")); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00+05:30")); props.onClose.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("opening credit", () => {
  it("previews server effects before saving and invalidates a preview when a balance changes", async () => {
    const calls = serve({ "PUT gst/opening-credit/": (c: Call) => ({ status: 200, data: c.params.preview ? effectWire : { opening: openingWire, effect: effectWire } }) });
    mount();
    edit("1.23");
    expect(screen.getByRole("button", { name: "Save opening credit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await screen.findByText("What this changes");
    expect(screen.getByText(/Credit carried out of May 2025/)).toHaveTextContent("₹16,000.00 → ₹16,001.23");
    expect(screen.getByText(/Tax to pay in cash for May 2025/)).toHaveTextContent("₹12.50 → ₹11.27");
    expect(screen.getByText(/Filed months keep their figures as filed/)).toHaveTextContent("2 filed months (Jun 2025 to Jul 2025)");
    expect(screen.getByText("Changing this moves the credit in every month before June 2025; that month's GSTR-3B is filed, so its figures stay as filed.", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(1);
    edit("2.34");
    expect(screen.queryByText("What this changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save opening credit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await screen.findByText("What this changes");
    fireEvent.click(screen.getByRole("button", { name: "Save opening credit" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(calls.map(c => c.params.preview)).toEqual([1, 1, undefined]);
    expect(calls[2].data).toEqual({ business: 3, igst: "2.34", cgst: "9500.00", sgst: "9500.00" });
  });
  it("names the current month returned by preview when no GSTR-3B is filed", async () => {
    serve({ "PUT gst/opening-credit/": { ...effectWire, reaches: "2026-10", cash: { ...effectWire.cash, month: "2026-10" }, filed_differ: { count: 0, from: null, to: null } } });
    renderApp(<OpeningCreditDialog {...props} opening={{ ...props.opening, first_filed_3b: null }} />);
    vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30"));
    edit("1.23"); fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await screen.findByText("What this changes");
    expect(screen.getByText("Changing this moves the credit in every month.", { exact: true })).toBeVisible();
    expect(screen.getByText(/Credit carried out of October 2026/)).toBeVisible();
    expect(screen.getByText("No filed month comes out differently.")).toBeVisible();
  });
  it("names the first filed GSTR-3B even when it is the first ledger month", async () => {
    serve({ "PUT gst/opening-credit/": { ...effectWire, reaches: "2025-03", cash: { ...effectWire.cash, month: "2025-03" } } });
    renderApp(<OpeningCreditDialog {...props} opening={{ ...props.opening, first_filed_3b: "2025-04" }} />);
    vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30"));
    edit("1.23"); fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await screen.findByText("What this changes");
    expect(screen.getByText("Changing this moves the credit in every month before April 2025; that month's GSTR-3B is filed, so its figures stay as filed.", { exact: true })).toBeVisible();
    expect(screen.getByText(/Credit carried out of March 2025/)).toBeVisible();
  });
  it("lets the owner explicitly save an untyped zero opening", async () => {
    const calls = serve({ "PUT gst/opening-credit/": (c: Call) => ({ status: 200, data: c.params.preview ? effectWire : { opening: openingWire, effect: effectWire } }) });
    renderApp(<OpeningCreditDialog {...props} opening={{ ...props.opening, typed: false, igst: 0, cgst: 0, sgst: 0, total: 0 }} />);
    vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30"));
    fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await screen.findByText("What this changes");
    fireEvent.click(screen.getByRole("button", { name: "Save opening credit" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(calls[1].data).toEqual({ business: 3, igst: "0.00", cgst: "0.00", sgst: "0.00" });
  });
  it.each([["", "Type the IGST balance, or 0."], ["-1", "A credit balance can't be below zero."], ["1.234", "Type the IGST balance, or 0."]])("keeps invalid %s visible and refuses a preview", (input, error) => {
    const calls = serve({}); mount(); edit(input);
    expect(screen.getByLabelText("IGST credit")).toHaveValue(input);
    expect(screen.getByLabelText("IGST credit")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(error)).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview the change" })).toBeDisabled();
    expect(calls).toEqual([]);
  });
  it("ties server validation to the field and preserves entered balances", async () => {
    serve({ "PUT gst/opening-credit/": () => ({ status: 400, data: { igst: ["A credit balance can't be below zero."] } }) });
    mount(); edit("1.23"); fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await waitFor(() => expect(screen.getByLabelText("IGST credit")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("IGST credit")).toHaveValue("1.23");
    expect(screen.getByRole("button", { name: "Save opening credit" })).toBeDisabled();
  });
  it("fails offline once, keeps typed balances, and never closes", async () => {
    const calls = serve({ "PUT gst/opening-credit/": (c: Call) => ({ status: c.params.preview ? 200 : 0, data: effectWire }) });
    mount(); edit("1.23"); fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await screen.findByText("What this changes");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Save opening credit" }));
    await screen.findByText("You're offline, so this wasn't saved");
    expect(screen.getByLabelText("IGST credit")).toHaveValue("1.23");
    expect(calls).toHaveLength(2); expect(props.onClose).not.toHaveBeenCalled();
  });
  it("locks fields and dismissal while a preview is pending", async () => {
    let resolve!: (x: { status: number; data: typeof effectWire }) => void;
    serve({ "PUT gst/opening-credit/": () => new Promise(r => { resolve = r; }) });
    mount(); edit("1.23"); fireEvent.click(screen.getByRole("button", { name: "Preview the change" }));
    await waitFor(() => expect(screen.getByLabelText("IGST credit")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" }); expect(props.onClose).not.toHaveBeenCalled();
    resolve({ status: 200, data: effectWire }); await screen.findByText("What this changes");
  });
  it("does not expose opening edits to an accountant with gst.file", () => {
    serve({}); renderApp(<OpeningCreditDialog {...props} />, { me: { role: "accountant", permissions: ["view", "gst.file"] } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
