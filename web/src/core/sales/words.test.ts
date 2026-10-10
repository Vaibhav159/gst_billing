import type { BillRow } from "./types";
import {
  billsAnd, cancelledNote, dayCount, dayGroups, dayLabel, dayOf, ewayNumberText, failText, filedRangeText, firmsWord, fyLabel, gstLabel, listFooter, PAY_FILTER,
  notMarkedSent, rateText, realReason, restoreFailure, sendFailure, sentLine, sentWhen, taxLines, timeOf, whoCan,
} from "./words";

test("cancelled bills are named apart, in the caller's words, and not at all when there are none", () => {
  expect(cancelledNote(0)).toBe("");
  expect(cancelledNote(1)).toBe("1 cancelled bill also listed");
  expect(cancelledNote(2, "not counted")).toBe("2 cancelled bills not counted");
});

test("a failure says what didn't happen and what to do; only a save says that what was typed is still there", () => {
  expect(failText({ kind: "offline", message: "You're offline" })).toEqual({ title: "Not saved: you're offline", body: "Nothing was changed. What you typed is still here. Try again when the internet is back." });
  expect(failText({ kind: "unreachable", message: "The app couldn't get through" })).toEqual({ title: "Not saved: the app couldn't get through", body: "Nothing was changed. What you typed is still here. Try again in a minute." });
  expect(failText({ kind: "server", message: "The app couldn't get through" }, "deleted")).toEqual({ title: "Not deleted: the app couldn't get through", body: "Nothing was changed. Try again in a minute." });
  expect(failText({ kind: "offline", message: "You're offline" }, "cancelled")).toEqual({ title: "Not cancelled: you're offline", body: "Nothing was changed. Try again when the internet is back." });
  // a refusal says the server's own words
  expect(failText({ kind: "conflict", message: "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be cancelled." }, "cancelled"))
    .toEqual({ title: "Not cancelled", body: "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be cancelled." });
});

test("the Paid by filter names each way as PAY does, with any and not recorded", () => {
  expect(PAY_FILTER).toEqual([
    { value: "any", label: "Paid by: any" }, { value: "cash", label: "Cash" }, { value: "bank", label: "UPI / bank" },
    { value: "credit", label: "Udhaar" }, { value: "mixed", label: "Part cash, part UPI" }, { value: "none", label: "Not recorded" },
  ]);
});

test("the GST label follows the heads actually stored, slab by slab", () => {
  const b = { line_count: 2, gst_percents: ["3"], igst: 0, cgst: 126820, sgst: 126820, interstate: false };
  expect(gstLabel(b)).toBe("3% · CGST+SGST");
  expect(gstLabel({ ...b, igst: 253640, cgst: 0, sgst: 0, interstate: true })).toBe("IGST 3%");
  expect(gstLabel({ ...b, gst_percents: ["3", "0.25"] })).toBe("3% + 0.25% · CGST+SGST");
  expect(gstLabel({ ...b, line_count: 0, gst_percents: [] })).toBe("No items");
});

test("tax lines by slab: CGST and SGST at half the rate, or IGST at the rate; the head and the rate also apart, for the printed bill's two columns", () => {
  const slab = (gst_percent: string, cgst: number, sgst: number, igst: number) => ({ gst_percent, taxable: 0, cgst, sgst, igst, tax: cgst + sgst + igst });
  expect(taxLines({ slabs: [slab("3", 126820, 126820, 0), slab("0.25", 16371, 16371, 0)], igst: 0, cgst: 143191, sgst: 143191, interstate: false })).toEqual([
    { key: "c3", head: "CGST", rate: "1.5%", label: "CGST 1.5%", value: 126820 }, { key: "s3", head: "SGST", rate: "1.5%", label: "SGST 1.5%", value: 126820 },
    { key: "c0.25", head: "CGST", rate: "0.125%", label: "CGST 0.125%", value: 16371 }, { key: "s0.25", head: "SGST", rate: "0.125%", label: "SGST 0.125%", value: 16371 },
  ]);
  expect(taxLines({ slabs: [slab("3", 0, 0, 241190)], igst: 241190, cgst: 0, sgst: 0, interstate: true })).toEqual([{ key: "i3", head: "IGST", rate: "3%", label: "IGST 3%", value: 241190 }]);
});

test("an e-way bill number reads in fours, as it's read out; none stays empty", () => {
  expect(ewayNumberText("123456789012")).toBe("1234 5678 9012");
  expect(ewayNumberText("")).toBe("");
});

test("a rate reads as stored: two decimals, a third only when it isn't 0", () => {
  expect(rateText("6512.500")).toBe("₹6,512.50");
  expect(rateText("999.995")).toBe("₹999.995");
  expect(rateText("4150")).toBe("₹4,150.00");
  expect(rateText("")).toBe("—");
});

test("times are India's, whatever the device's zone; a send says when, today or another day", () => {
  expect(timeOf("2026-10-08T10:42:05.123456+05:30")).toBe("10:42");
  expect(timeOf("2026-10-08T05:12:05Z")).toBe("10:42");
  expect(sentWhen({ at: "2026-10-08T12:09:00+05:30" }, "2026-10-08")).toBe("at 12:09");
  expect(sentWhen({ at: "2026-09-10T18:02:00+05:30" }, "2026-10-08")).toBe("on 10 Sep at 18:02");
  expect(sentLine({ at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T15:00:00+05:30", count: 3, via: "whatsapp", to: "9829041122" }, "2026-10-08"))
    .toBe("WhatsApp at 12:09 to +91 98290 41122 · 3 times");
});

test("on a device set to another zone, a send's time and day are still India's", () => {
  vi.stubEnv("TZ", "America/Los_Angeles");
  try {
    expect(new Date("2026-10-08T19:30:00Z").getDate()).toBe(8); // the stub took: this clock is at 12:30 on 8 Oct, India at 01:00 on 9 Oct
    expect(timeOf("2026-10-09T01:00:00+05:30")).toBe("01:00");
    expect(dayOf("2026-10-09T01:00:00+05:30")).toBe("2026-10-09");
    expect(sentWhen({ at: "2026-10-09T01:00:00+05:30" }, "2026-10-09")).toBe("at 01:00");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("day rows: today, yesterday, then the weekday; the last day loaded isn't counted until all of it is", () => {
  expect(dayLabel("2026-10-08", "2026-10-08")).toBe("Today, 08 Oct 2026");
  expect(dayLabel("2026-10-07", "2026-10-08")).toBe("Yesterday, 07 Oct 2026");
  expect(dayLabel("2026-10-06", "2026-10-08")).toBe("Tuesday, 06 Oct 2026");
  const row = (id: number, invoice_date: string, total_amount: number, status: "active" | "cancelled" = "active") => ({ id, invoice_date, total_amount, status }) as BillRow;
  const groups = dayGroups([row(1, "2026-10-08", 8708321), row(2, "2026-10-08", 3155604), row(3, "2026-10-08", 100, "cancelled"), row(4, "2026-10-07", 500)], "2026-10-08", false);
  expect(groups.map((g) => [g.label, g.count, g.cancelled, g.partial])).toEqual([["Today, 08 Oct 2026", 2, 1, false], ["Yesterday, 07 Oct 2026", 1, 0, true]]);
  expect(dayCount(groups[0])).toBe("2 bills · ₹1,18,639.25 · 1 cancelled");
});

test("counting says cancelled bills apart and never adds them in", () => {
  expect(billsAnd([{ status: "active" }, { status: "active" }, { status: "cancelled" }])).toBe("2 bills and 1 cancelled bill");
  const visible = [...Array.from({ length: 39 }, () => ({ status: "active" })), { status: "cancelled" }];
  expect(listFooter(105, 1, visible)).toEqual({ text: "Showing the newest 39 of 105 bills · 1 cancelled bill also listed", more: "Show all 105 bills", rest: "bills" });
  expect(listFooter(105, 1, visible, { step: true }).more).toBe("Show more · 66 bills left");
  expect(listFooter(3, 1, [{ status: "active" }, { status: "active" }, { status: "active" }])).toEqual({ text: "Showing all 3 bills", more: "Show the cancelled bill too", rest: "cancelled" });
  expect(listFooter(2, 0, [{ status: "cancelled" }, { status: "cancelled" }], { cancelledOnly: true })).toEqual({ text: "Showing all 2 cancelled bills", more: null, rest: null });
});

test("a reason someone typed, never the old “No reason given”", () => {
  expect(realReason("No reason given")).toBe("");
  expect(realReason(" Entered twice ")).toBe("Entered twice");
});

test("a send or an Undo that didn't go through: offline, the server, or the server's own reason", () => {
  expect(sendFailure({ kind: "offline", message: "" })).toEqual({ tone: "neg", title: "Not sent: you're offline", body: "Nothing was marked as sent. Send it when the internet is back." });
  expect(sendFailure({ kind: "unreachable", message: "" })).toEqual({ tone: "neg", title: "The bill wasn't sent", body: "Nothing was marked as sent. Try again in a minute." });
  // a refusal says the server's own words (contract §2.10)
  expect(sendFailure({ kind: "conflict", message: "KGH/2026-27/31 is cancelled, so it can't be sent." }))
    .toEqual({ tone: "neg", title: "The bill wasn't sent", body: "KGH/2026-27/31 is cancelled, so it can't be sent." });
  expect(restoreFailure({ kind: "unreachable", message: "" }, "KGH/2026-27/27").body).toBe("KGH/2026-27/27 stays deleted. Restore it from the Audit log in a minute.");
  expect(restoreFailure({ kind: "offline", message: "" }, "KGH/2026-27/27"))
    .toEqual({ tone: "neg", title: "Not restored: you're offline", body: "KGH/2026-27/27 stays deleted. Restore it from the Audit log when you're back online." });
  // a refusal says the server's own words (contract §3.2)
  expect(restoreFailure({ kind: "conflict", message: "KGH/2026-27/27 is back already: it was restored from the Audit log." }, "KGH/2026-27/27"))
    .toEqual({ tone: "neg", title: "Not restored", body: "KGH/2026-27/27 is back already: it was restored from the Audit log." });
  expect(restoreFailure({ kind: "unreachable", message: "" }, "3 bills", true))
    .toEqual({ tone: "neg", title: "Not restored", body: "3 bills stay deleted. Restore them from the Audit log in a minute." });
});

test("a send whose WhatsApp chat opened but whose record didn't land says so, never that the bill wasn't sent (Ruling 1B-14)", () => {
  expect(notMarkedSent({ kind: "unreachable", message: "" }, "KGH/2026-27/31")).toEqual({
    tone: "neg", title: "Not marked as sent", body: "WhatsApp opened, but the app couldn't get through, so KGH/2026-27/31 isn't marked as sent.", again: true,
  });
  expect(notMarkedSent({ kind: "offline", message: "" }, "KGH/2026-27/31")).toMatchObject({ title: "Not marked as sent", again: true });
  // a refusal says the server's own words, and marking it again wouldn't change them
  expect(notMarkedSent({ kind: "conflict", message: "KGH/2026-27/31 is cancelled, so it can't be sent." }, "KGH/2026-27/31"))
    .toEqual({ tone: "neg", title: "Not marked as sent", body: "KGH/2026-27/31 is cancelled, so it can't be sent.", again: false });
  expect(notMarkedSent({ kind: "forbidden", message: "Only the owner and counter staff can send bills. Ask the owner if you need it." }, "KGH/2026-27/31").again).toBe(false);
});

test("scope words: filed months, how many firms, the year, and who can", () => {
  const m = (month: string, locked: boolean) => ({ month, bills: 1, locked });
  expect(filedRangeText([m("2026-04", true), m("2026-05", true), m("2026-08", true), m("2026-09", false)])).toBe("April to August");
  expect(filedRangeText([m("2026-09", false)])).toBe("");
  expect(firmsWord(3)).toBe("all three firms");
  expect(firmsWord(2)).toBe("both firms");
  expect(fyLabel("2025-26")).toBe("FY 2025-26 (1 Apr 2025 to 31 Mar 2026)");
  expect(whoCan("bill.create")).toBe("the owner and counter staff");
  expect(whoCan("bill.edit")).toBe("the owner");
  // only those two: for an action the accountant or a viewer may do, its role words would differ from whyNot's
  // @ts-expect-error customer.edit isn't one of the actions whoCan words
  whoCan("customer.edit");
});
