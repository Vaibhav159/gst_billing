// The bills the sales specs need, made and removed through the API as the signed-in user (the saved session's token).
// Firms, customers and numbers are read at runtime: no spec assumes a seed id (CI's database has no bills).
const { expect } = require("@playwright/test");
const { savedToken } = require("./session");

/** Today in India, as the server dates bills. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Latest earlier day the form accepts: current/previous FY, skipping whole filed months. */
async function latestOpenPaperDay(api, firmId, on = today()) {
  const [year, month, date] = on.split("-").map(Number);
  const firstYear = year - (month < 4 ? 1 : 0) - 1;
  const earliest = `${firstYear}-04-01`;
  let prior = new Date(Date.UTC(year, month - 1, date - 1));
  while (prior.toISOString().slice(0, 10) >= earliest) {
    // UTC arithmetic preserves the IST calendar date supplied by today().
    const day = prior.toISOString().slice(0, 10);
    const book = await api.get("sales/paper-book/", { business_id: firmId, month: day.slice(0, 7) });
    if (!book.locked) return { day, book };
    prior = new Date(Date.UTC(prior.getUTCFullYear(), prior.getUTCMonth(), 0));
  }
  throw new Error(`No open paper day before ${on} in the current or previous financial year for firm ${firmId}.`);
}

/** A text as a regular expression that matches it literally. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** /api/ as the signed-in user: each call's JSON, after checking it went through (del with check: false never fails). */
function client(request) {
  const headers = { Authorization: `Bearer ${savedToken()}` };
  const call = async (method, path, data, check = true) => {
    const r = await request.fetch(`/api/${path}`, { method, headers, data });
    if (check) expect(r.ok(), `${method} ${path} answered ${r.status()}: ${await r.text()}`).toBe(true);
    return r.ok() && r.status() !== 204 ? r.json() : null;
  };
  return {
    get: (path, params) => call("GET", params ? `${path}?${new URLSearchParams(params)}` : path),
    post: (path, data) => call("POST", path, data),
    put: (path, data) => call("PUT", path, data),
    patch: (path, data) => call("PATCH", path, data),
    del: (path, data, { check = true } = {}) => call("DELETE", path, data, check),
  };
}

/** The first firm the app lists. */
async function firstFirm(api) {
  const { results } = await api.get("businesses/", { page_size: 100 });
  expect(results.length, "a firm to make bills in").toBeGreaterThan(0);
  return results[0];
}

const mobile = (c) => /^[6-9]\d{9}$/.test(String(c.mobile_number || "").replace(/\D/g, "").slice(-10));
/** A customer to bill and send to: not the walk-in record, with a mobile number (CI's TEST CUSTOMER). */
async function someCustomer(api) {
  const { results } = await api.get("customers/", { page_size: 50 });
  const c = results.find((x) => x.type !== "walkin" && mobile(x));
  expect(c, "a customer with a mobile number").toBeTruthy();
  return c;
}

/** A walk-in record with no number on it, made once where the database has none (CI's has none). */
async function walkIn(api) {
  const { results } = await api.get("customers/", { type: "walkin", page_size: 20 });
  return results.find((x) => !mobile(x))
    ?? api.post("customers/", { name: "Walk-in Customer (e2e)", customer_type: "walkin", state_name: "RAJASTHAN" });
}

/** The bills made in the test running now, for makesBills to send to the bin after it. */
const made = [];

/** The item on newBill's one line: a page draws it only from the bill's own answer, never from a list's row. */
const TEST_ITEM = "Gold Ring 22K (e2e)";

/**
 * A bill for today in the firm's series at its next free number, one 3% line unless `lines` (the contract's line inputs)
 * says otherwise, from the paper book when `paper`: { id, number, counter, business, firmName, customerName }. Each is
 * noted, so makesBills can send it to the bin after the test.
 */
async function newBill(api, { firm, customer, rate = "6500.000", lines, paper = false } = {}) {
  const f = firm ?? (await firstFirm(api));
  const c = customer ?? (await someCustomer(api));
  const day = today();
  const next = await api.get("sales/next-number/", { business_id: f.id, invoice_date: day });
  const bill = await api.post("sales/", {
    business: f.id, customer: c.id, invoice_number: next.invoice_number, invoice_date: day, payment_mode: "cash", place_of_supply: null, notes: "", paper,
    lines: lines ?? [{ product_name: TEST_ITEM, hsn_code: "711319", gst_percent: "3", quantity: "1.000", unit: "gms", rate, note: "" }],
  });
  const b = { id: bill.id, number: bill.invoice_number, counter: bill.counter, business: f.id, firmName: f.name, customerName: c.name };
  made.push(b);
  return b;
}

/** A bill made another way (saved in the bill form), noted as newBill notes its own: makesBills sends it to the bin. */
function noteBill(id, number) {
  made.push({ id, number });
}

/** To the bin, as every spec leaves the bills it made (the number stays used, so no gap opens); a bill gone already is fine. */
async function removeBill(api, id) {
  await api.del(`sales/${id}/`, { reason: "Test bill" }, { check: false });
}

/**
 * For a file whose tests make bills, called at its top level: after each test, every bill it made goes to the bin, one
 * renumbered first getting its number back, so the series keeps no gap. A test.afterEach, not each test's finally: a test
 * that times out has its request disposed before a finally could use it, which would leave a live bill or a gap. A bill
 * the server won't check or take (a 429 once the user's requests for the day are used up, a 5xx) doesn't stop the rest:
 * every noted bill is tried, the notes are emptied, then the hook fails once, naming every bill still live or unchecked.
 */
function makesBills(test) {
  test.afterEach(async ({ request }) => {
    const headers = { Authorization: `Bearer ${savedToken()}` };
    const call = (method, path, data) => request.fetch(`/api/${path}`, { method, headers, data });
    const failures = [];
    for (const b of made.splice(0)) {
      try {
        const now = await call("GET", `sales/${b.id}/`);
        // a 404 is a bill in the bin already: its test deleted it
        if (now.status() !== 404) {
          const text = await now.text();
          expect(now.ok(), `couldn't be checked before it goes to the bin: ${now.status()} ${text}`).toBe(true);
          if (JSON.parse(text).invoice_number !== b.number) {
            const back = await call("POST", `sales/${b.id}/renumber/`, { invoice_number: b.number });
            expect(back.ok(), `didn't get its number back: ${back.status()} ${await back.text()}`).toBe(true);
          }
          const gone = await call("DELETE", `sales/${b.id}/`, { reason: "Test bill" });
          expect(gone.ok() || gone.status() === 404, `didn't go to the bin: ${gone.status()} ${await gone.text()}`).toBe(true);
        }
      } catch (error) {
        failures.push(`test bill ${b.number} (${b.id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures, `Test bills still live or unchecked:\n${failures.join("\n")}`).toEqual([]);
  });
}

/** A dialog drops a click within 350 ms of opening (the kit's guard against the click that opened it). */
async function afterDialog(page) {
  await page.waitForTimeout(400);
}

module.exports = { today, latestOpenPaperDay, esc, client, firstFirm, someCustomer, walkIn, TEST_ITEM, newBill, noteBill, removeBill, makesBills, afterDialog };
