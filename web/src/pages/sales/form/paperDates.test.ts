import { lastPaperDate, rememberPaperDate } from "./paperDates";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

test("each firm's last paper bill date is kept for this tab; storage that's unreadable or refused only forgets it", () => {
  expect(lastPaperDate(3)).toBe("");
  rememberPaperDate(3, "2026-09-24");
  rememberPaperDate(2, "2026-09-30");
  rememberPaperDate(3, "2026-09-25");
  // no firm, or no date: nothing to keep
  rememberPaperDate(null, "2026-09-01");
  rememberPaperDate(2, "");
  expect([lastPaperDate(3), lastPaperDate(2), lastPaperDate(null)]).toEqual(["2026-09-25", "2026-09-30", ""]);
  expect(JSON.parse(sessionStorage.getItem("gst3.paperDates") ?? "")).toEqual({ 3: "2026-09-25", 2: "2026-09-30" });
  sessionStorage.setItem("gst3.paperDates", "{not json");
  expect(lastPaperDate(3)).toBe("");
  vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
  expect(() => rememberPaperDate(3, "2026-09-26")).not.toThrow();
});
