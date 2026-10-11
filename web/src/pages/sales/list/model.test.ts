import { gstRateParam, orderingOf, queryOf, readList, sortOf, writeList } from "./model";

const ctx = { today: "2026-10-08", fy: "2026-27", isPhone: false };
const read = (q: string, c = ctx) => readList(new URLSearchParams(q), c);

test("the address says the list: the year on a desktop, this month on a phone, and the prototype's own link words", () => {
  expect(read("").month).toBe("all");
  expect(read("", { ...ctx, isPhone: true }).month).toBe("2026-10");
  expect(read("when=today").month).toBe("today");
  expect(read("when=month").month).toBe("2026-10");
  expect(read("all=1").month).toBe("years");
  expect(read("dups=1")).toMatchObject({ month: "years", quality: "dups" });
  // a link that asks for something gets the whole year, a phone too
  expect(read("customer=7", { ...ctx, isPhone: true })).toMatchObject({ month: "all", customer: 7 });
  expect(read("start_date=2026-09-01&end_date=2026-09-15")).toMatchObject({ month: "all", from: "2026-09-01", to: "2026-09-15" });
  expect(read("segment=b2c&gst_rate=0.03")).toMatchObject({ segment: "b2cs", gstRate: "3" });
  expect(read("paid=bogus&status=bogus&sort=bogus")).toMatchObject({ paid: "any", status: "any", sort: { key: "date", dir: "desc" } });
});

test("a GST rate reads as a percent from either kind of link", () => {
  expect(gstRateParam("3")).toBe("3");
  expect(gstRateParam("0.03")).toBe("3");
  expect(gstRateParam("0.25")).toBe("0.25");
  expect(gstRateParam("0.0025")).toBe("0.25");
  expect(gstRateParam("1.5")).toBe("1.5");
  expect(gstRateParam("x")).toBeNull();
  // a rate that's no slab either way stays as written: never a guess by its size (AGENTS.md: no magnitude tests for rates)
  expect(gstRateParam("7")).toBe("7");
  expect(gstRateParam("0.07")).toBe("0.07");
  expect(gstRateParam("2.5%")).toBe("2.5");
});

test("writing keeps the drill-down words and drops the link words the list now holds itself", () => {
  const p = writeList(new URLSearchParams("when=today&dups=1&firm=3"), { ...read("when=today&dups=1"), status: "cancelled", sort: sortOf("number") });
  expect(Object.fromEntries(p)).toEqual({ dups: "1", firm: "3", month: "today", status: "cancelled", sort: "number" });
  expect(orderingOf({ key: "total", dir: "desc" })).toBe("-total");
});

test("what the server is asked: the period, the filters as flags, and a search that looks through the whole year", () => {
  const ask = (q: string, typed = "") => queryOf(read(q), { today: "2026-10-08", fy: "2026-27", q: typed });
  expect(ask("").query).toEqual({ ordering: "-date", fy: "2026-27" });
  expect(ask("month=today&status=unsent").query).toEqual({ ordering: "-date", unsent: true, start_date: "2026-10-08", end_date: "2026-10-08" });
  expect(ask("month=2026-09&paid=none&customer=7&sort=-total").query).toEqual({ ordering: "-total", month: "2026-09", payment_mode: "none", customer_id: 7 });
  expect(ask("month=years&status=cancelled&no_hsn=1").query).toEqual({ ordering: "-date", status: "cancelled", no_hsn: true });
  expect(ask("start_date=2026-09-01").query).toEqual({ ordering: "-date", start_date: "2026-09-01" });
  expect(ask("month=2026-09", "anil")).toEqual({ effMonth: "all", widened: true, query: { ordering: "-date", fy: "2026-27", q: "anil" } });
  expect(ask("month=2026-09&only=1", "anil")).toMatchObject({ effMonth: "2026-09", widened: false, query: { month: "2026-09", q: "anil" } });
});
