import { newBillFor, rankBills, suggestions } from "./suggest";

const firms = [{ id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", gstin: "08ABCPK1234F1Z5", state: "RAJASTHAN" }, { id: 2, name: "MEERA ORNAMENTS", short: "Meera", gstin: "", state: "RAJASTHAN" }];
const ctx = { firms, today: "2026-10-08", canCreate: true };
const go = (t: string) => suggestions(t, ctx).map((s) => [s.label, s.to]);

test("a month and a way of paying go straight to that list, the firm too when named", () => {
  expect(go("udhaar sep")).toEqual([["Sales bills · September 2026 · paid by udhaar", "/sales?month=2026-09&paid=credit"]]);
  expect(go("kiran cash mar")).toEqual([["Sales bills · March 2027 · paid by cash · KIRAN GOLD HOUSE", "/sales?month=2027-03&paid=cash&firm=3"]]);
  expect(go("aug")).toEqual([
    ["Sales bills · August 2026", "/sales?month=2026-08"],
    ["Purchase bills · August 2026", "/purchases?month=2026-08"],
  ]);
  expect(go("anil")).toEqual([]);
});

test("GST words go to the returns: last month, for the firm named or for each", () => {
  expect(go("kiran gstr1")).toEqual([["GST returns · KIRAN GOLD HOUSE · Sep 2026", "/gst?firm=3&month=2026-09"]]);
  expect(go("gst aug")).toEqual([
    ["GST returns · KIRAN GOLD HOUSE · Aug 2026", "/gst?firm=3&month=2026-08"],
    ["GST returns · MEERA ORNAMENTS · Aug 2026", "/gst?firm=2&month=2026-08"],
  ]);
});

test("“new anil” asks for the name; the bill for a customer found is offered to whoever can make bills", () => {
  expect(newBillFor("new anil")).toBe("anil");
  expect(newBillFor("bill 31")).toBe("31");
  expect(newBillFor("new a")).toBeNull();
  expect(newBillFor("anil")).toBeNull();
  const found = [{ id: 7, name: "Anil Gupta" }];
  expect(suggestions("new anil", { ...ctx, customers: found }).map((s) => [s.label, s.to])).toEqual([["New bill for Anil Gupta", "/sales/new?customer=7"]]);
  expect(suggestions("new anil", { ...ctx, customers: found, canCreate: false })).toEqual([]);
});

test("a bare number puts that bill first by its counter, an exact full number first of all, then the newest", () => {
  const b = (id: number, invoice_number: string, invoice_date: string) => ({ id, invoice_number, invoice_date });
  const bills = [b(1, "KGH/2026-27/131", "2026-10-07"), b(2, "KGH/2026-27/31", "2026-09-01"), b(3, "KGH/2026-27/310", "2026-10-08"), b(4, "MO/2026-27/31", "2026-08-01")];
  expect(rankBills(bills, "31").map((x) => x.id)).toEqual([2, 4, 3, 1]);
  expect(rankBills(bills, "mo/2026-27/31").map((x) => x.id)).toEqual([4, 3, 1, 2]);
  expect(rankBills(bills, "kgh").map((x) => x.id)).toEqual([3, 1, 2, 4]);
});

/* ── Beyond the brief ── */

test("a month is its name or the start of it, three letters on: never a name that only starts like one, so Enter still opens that customer", () => {
  expect(go("sept")).toEqual([["Sales bills · September 2026", "/sales?month=2026-09"], ["Purchase bills · September 2026", "/purchases?month=2026-09"]]);
  expect(go("march udhaar")).toEqual([["Sales bills · March 2027 · paid by udhaar", "/sales?month=2027-03&paid=credit"]]);
  for (const name of ["mayank", "janki", "junaid", "mary", "augustine", "new mayank"]) expect(go(name), name).toEqual([]);
});
