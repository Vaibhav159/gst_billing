// The bills the sales specs need, made and removed through the API as the signed-in user (the saved session's token).
// Firms, customers and numbers are read at runtime: no spec assumes a seed id (CI's database has no bills).
const { expect } = require("@playwright/test");
const { savedToken } = require("./session");

/** Today in India, as the server dates bills. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

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

/** A bill for today in the firm's series at its next free number, one 3% line unless `lines` (the contract's line inputs) says otherwise: { id, number, counter, business, firmName, customerName }. */
async function newBill(api, { firm, customer, rate = "6500.000", lines } = {}) {
  const f = firm ?? (await firstFirm(api));
  const c = customer ?? (await someCustomer(api));
  const day = today();
  const next = await api.get("sales/next-number/", { business_id: f.id, invoice_date: day });
  const bill = await api.post("sales/", {
    business: f.id, customer: c.id, invoice_number: next.invoice_number, invoice_date: day, payment_mode: "cash", place_of_supply: null, notes: "",
    lines: lines ?? [{ product_name: "Gold Ring 22K (e2e)", hsn_code: "711319", gst_percent: "3", quantity: "1.000", unit: "gms", rate, note: "" }],
  });
  return { id: bill.id, number: bill.invoice_number, counter: bill.counter, business: f.id, firmName: f.name, customerName: c.name };
}

/** To the bin, as every spec leaves the bills it made (the number stays used, so no gap opens); a bill gone already is fine. */
async function removeBill(api, id) {
  await api.del(`sales/${id}/`, { reason: "Test bill" }, { check: false });
}

/** A dialog drops a click within 350 ms of opening (the kit's guard against the click that opened it). */
async function afterDialog(page) {
  await page.waitForTimeout(400);
}

module.exports = { today, client, firstFirm, someCustomer, walkIn, newBill, removeBill, afterDialog };
