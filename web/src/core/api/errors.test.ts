import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { lineErrors, linesErrors, problemOf } from "./errors";

const cfg = {} as InternalAxiosRequestConfig;
/** The server answered with this status and body, as axios rejects it. */
const answered = (status: number, data: unknown) => new AxiosError("x", String(status), cfg, null, { status, data, statusText: "", headers: {}, config: cfg } as never);

test("a line's own error reads as its words, never “[object Object]”, and names the line's field (DRF 3.18: lines keyed by position, good lines left out)", () => {
  const p = problemOf(answered(400, { lines: { "1": { quantity: ["Type the weight in grams, like 12.345."] } } }));
  expect(p.kind).toBe("validation");
  expect(p.message).toBe("Type the weight in grams, like 12.345.");
  expect(p.fields).toEqual({ "lines.1.quantity": "Type the weight in grams, like 12.345." });
});

test("a form-wide error still comes first, and each field keeps its own words", () => {
  const p = problemOf(answered(400, {
    non_field_errors: ["Choose who this bill is for. Pick Walk-in customer for a counter sale."],
    invoice_number: ["A GST bill number can have at most 16 characters; this has 18."],
    lines: { "0": { rate: ["Type the rate per gram."] } },
  }));
  expect(p.message).toBe("Choose who this bill is for. Pick Walk-in customer for a counter sale.");
  expect(p.fields).toEqual({ invoice_number: "A GST bill number can have at most 16 characters; this has 18.", "lines.0.rate": "Type the rate per gram." });
});

test("an error about the lines as a whole is a list of words: it reads as them, under “lines”", () => {
  const p = problemOf(answered(400, { lines: ["Add at least one item: pick a product, then type its weight."] }));
  expect(p.message).toBe("Add at least one item: pick a product, then type its weight.");
  expect(p.fields).toEqual({ lines: "Add at least one item: pick a product, then type its weight." });
  expect(linesErrors(p)).toEqual(["Add at least one item: pick a product, then type its weight."]);
  expect(lineErrors(p, 0, "quantity")).toEqual([]);
});

test("the bill form's helpers give every message for one line's field, by position, and nothing for a good line", () => {
  const p = problemOf(answered(400, { lines: {
    "1": { quantity: ["Type the weight in grams, like 12.345."], rate: ["Type the rate per gram.", "Keep the rate to 3 decimals."] },
    "3": { note: ["Keep the note to 60 characters; it prints under the item."] },
  } }));
  expect(lineErrors(p, 1, "rate")).toEqual(["Type the rate per gram.", "Keep the rate to 3 decimals."]);
  expect(lineErrors(p, 1, "quantity")).toEqual(["Type the weight in grams, like 12.345."]);
  expect(lineErrors(p, 3, "note")).toEqual(["Keep the note to 60 characters; it prints under the item."]);
  expect(lineErrors(p, 0, "quantity")).toEqual([]);
  expect(linesErrors(p)).toEqual([]);
  expect(lineErrors(null, 1, "rate")).toEqual([]);
  // an older server's list aligned with the lines ({} for a good line) reads the same
  const old = problemOf(answered(400, { lines: [{}, { rate: ["Type the rate per gram."] }] }));
  expect(lineErrors(old, 1, "rate")).toEqual(["Type the rate per gram."]);
  expect(old.fields).toEqual({ "lines.1.rate": "Type the rate per gram." });
});

test("DRF's own list checks put their words inside “lines”: they read as words about the lines as a whole", () => {
  const p = problemOf(answered(400, { lines: { non_field_errors: ["This list may not be empty."] } }));
  expect(p.message).toBe("This list may not be empty.");
  expect(linesErrors(p)).toEqual(["This list may not be empty."]);
  expect(lineErrors(p, 0, "quantity")).toEqual([]);
});

test("only words read as words: a number, or a bare string inside the body, is data (v2's period lock, a 409's bill)", () => {
  // v2's period-lock 400 as DRF sends it: DRF turns the period's numbers into strings
  const lock = problemOf(answered(400, {
    detail: ["09/2026 is filed and locked for KIRAN GOLD HOUSE — this change would make the books disagree with the filed return. Unlock the month on the GST page first (the unlock is audit-logged)."],
    locked_period: { id: "7", business: "3", year: "2026", month: "9" },
  }));
  expect(lock.message).toMatch(/^09\/2026 is filed and locked for KIRAN GOLD HOUSE/);
  expect(lock.fields).toBeUndefined();
  // a refusal that names a bill but has no words of its own says the plain words, never "388" or the bill's number
  const taken = problemOf(answered(409, { code: "number_taken", bill: { id: 388, invoice_number: "KGH/2026-27/34" }, next: { counter: 35, invoice_number: "KGH/2026-27/35" } }));
  expect(taken.message).toBe("Someone changed this at the same time. Open it again.");
  expect(problemOf(answered(400, { lines: { "1": { quantity: 0 } } })).message).toBe("Something in the form needs fixing.");
});

test("a refusal's code and body come with it, for the screen that asked", () => {
  const body = {
    detail: "KGH/2026-27/34 is already used in FY 2026-27 by Anil Gupta's bill of 30 Sep 2026. The next free number is KGH/2026-27/35.",
    code: "number_taken",
    bill: { id: 388, invoice_number: "KGH/2026-27/34", invoice_date: "2026-09-30", customer_name: "Anil Gupta", status: "active" },
    next: { counter: 35, invoice_number: "KGH/2026-27/35" },
  };
  const p = problemOf(answered(409, body));
  expect(p).toMatchObject({ kind: "conflict", code: "number_taken", message: body.detail });
  expect(p.body).toEqual(body);
});

test("a deleted bill's 404 keeps its bin row", () => {
  const binned = { id: 4, original_id: 205, invoice_number: "KGH/2026-27/27" };
  const p = problemOf(answered(404, { detail: "This bill was deleted.", code: "deleted", binned }));
  expect(p).toMatchObject({ kind: "notfound", code: "deleted" });
  expect((p.body as { binned: unknown }).binned).toEqual(binned);
});

test("no answer at all has no code and no body", () => {
  expect(problemOf(new AxiosError("Network Error", "ERR_NETWORK", cfg))).toEqual({ kind: "unreachable", message: "The app couldn't get through" });
});
