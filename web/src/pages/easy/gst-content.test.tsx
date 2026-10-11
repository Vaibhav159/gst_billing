import { screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderApp } from "@/test/render";
import { easyGst, OPENING_WORDS } from "./gst";
import { gstFixture } from "./gst.fixture";
import { GstContent, GstCardContent } from "./GstContent";
const props = { firmName: "KIRAN GOLD HOUSE", today: "2026-10-08", current: { month: "2026-10", tax: 880071, bills: 3 }, previous: easyGst(gstFixture()) };
describe("Easy GST", () => {
  test("owner sees server figures, both due dates, overflow and a full-view visit", () => {
    const visit = vi.fn(); renderApp(<GstContent {...props} onVisit={visit} />);
    expect(screen.getByText(OPENING_WORDS)).toBeVisible();
    expect(screen.getByText("₹10,378.76")).toBeVisible(); expect(screen.getByText("₹2,120.00")).toBeVisible();
    expect(screen.getByText("Due 11 Oct")).toBeVisible(); expect(screen.getByText("Due 20 Oct")).toBeVisible();
    expect(screen.getByText("12 more bills in the full view.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Anita Mehta/ })).toHaveAttribute("href", "/e/bill/388");
    fireEvent.click(screen.getByRole("button", { name: "Fix it in the full view" }));
    expect(visit).toHaveBeenCalledWith("/gst?firm=3&month=2026-09&fix=1");
  });
  test("staff sees bills to tell the owner, no edit button", () => {
    renderApp(<GstContent {...props} onVisit={vi.fn()} />, { me: { role: "staff", permissions: ["view", "bill.create"] } });
    expect(screen.getByText(/Tell the owner: bill 17 \(Anita Mehta\)/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Fix it in the full view" })).not.toBeInTheDocument();
  });
  test.each(["future", "open", "gstr1", "filed", "unlocked", "ready"] as const)("shows shared %s words, never substitutes Ready", (stage) => {
    const labels = { future: "–", open: "Open", gstr1: "GSTR-1 filed", filed: "Filed", unlocked: "Unlocked", ready: "Ready" };
    renderApp(<GstContent {...props} previous={easyGst(gstFixture(stage))} onVisit={vi.fn()} />);
    expect(screen.getByTestId("easy-gst-stage")).toHaveTextContent(labels[stage]);
    if (stage === "filed") expect(screen.getByText("Filed 19 Oct 2026")).toBeVisible();
  });
  test.each(["gstr1", "filed", "unlocked"] as const)("%s with live blockers describes corrections and preserves the filing", (stage) => {
    const row = gstFixture(stage); row.checks = gstFixture().checks;
    renderApp(<GstContent {...props} previous={easyGst(row)} onVisit={vi.fn()} />);
    expect(screen.getByText("These checks are for the books now. Review the correction in the full view.")).toBeVisible();
    expect(screen.queryByText(/your CA can't file/)).not.toBeInTheDocument();
  });
  test("legacy filing shows no invented due or filed date", () => {
    const row = gstFixture("filed"); row.record = { ...row.record, gstr1: null, gstr3b: null, legacy: true };
    renderApp(<GstContent {...props} previous={easyGst(row)} onVisit={vi.fn()} />);
    expect(screen.getAllByText("Filed before the app kept filing records")).toHaveLength(2);
    expect(screen.queryByText(/^Due /)).not.toBeInTheDocument();
  });
  test("the Home card links to GST and preserves exact current-month money", () => {
    renderApp(<GstCardContent {...props} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/e/gst");
    expect(screen.getByText("₹8,800.71")).toBeVisible();
    expect(screen.getByText(/return is held up/)).toBeVisible();
  });
});
