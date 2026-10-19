import { describe, expect, it } from "vitest";
import { isCounterCustomer, taxWarnings } from "./taxWarnings";

const buyer = { name: "Anil Gupta", gst_number: "", address: "12 Bapu Bazaar, Udaipur", pan_number: "ABCDE1234F" };
const sale = (over: Record<string, unknown> = {}) =>
  ({ type: "OUTWARD", subtotal: 10_000, total: 10_300, paymentMode: "bank", customer: buyer, ...over }) as Parameters<typeof taxWarnings>[0];
const keys = (input: Parameters<typeof taxWarnings>[0]) => taxWarnings(input).map((w) => w.key);

describe("taxWarnings: the buyer's name and address (GST Rule 46(f))", () => {
  it("warns at a taxable value of ₹50,000 to a buyer without a GSTIN and no address", () => {
    expect(keys(sale({ subtotal: 50_000, total: 51_500, customer: { ...buyer, address: " " } }))).toEqual(["buyer_address"]);
  });

  it("says nothing at ₹49,999.99", () => {
    expect(keys(sale({ subtotal: 49_999.99, total: 51_499.99, customer: { ...buyer, address: "" } }))).toEqual([]);
  });

  it("names the buyer and asks for the address", () => {
    const [w] = taxWarnings(sale({ subtotal: 60_000, total: 61_800, customer: { ...buyer, address: null } }));
    expect(w.text).toContain("Anil Gupta");
    expect(w.text).toContain("Rule 46(f)");
  });

  it("warns for a general counter customer even with an address, and asks for the buyer's own record", () => {
    const [w] = taxWarnings(sale({ subtotal: 60_000, total: 61_800, customer: { ...buyer, name: "Cash", address: "Shop" } }));
    expect(w.key).toBe("buyer_address");
    expect(w.text).toContain("buyer's own customer record");
  });

  it("says nothing for a buyer with a GSTIN, even with no address", () => {
    expect(keys(sale({ subtotal: 90_000, total: 92_700, customer: { ...buyer, gst_number: "08AAGPL3375F1ZO", address: "" } }))).toEqual([]);
  });

  it("counts a placeholder like URP as no GSTIN", () => {
    expect(keys(sale({ subtotal: 90_000, total: 92_700, customer: { ...buyer, gst_number: "URP", address: "" } }))).toEqual(["buyer_address"]);
  });
});

describe("taxWarnings: cash of ₹2,00,000 or more (Income Tax Sec 269ST)", () => {
  it("warns when the payment is cash and the total is ₹2,00,000", () => {
    expect(keys(sale({ subtotal: 194_174.76, total: 200_000, paymentMode: "cash" }))).toEqual(["cash_2_lakh"]);
  });

  it("says nothing at ₹1,99,999.99 in cash, or at ₹2,00,000 by bank or mixed", () => {
    expect(keys(sale({ subtotal: 194_174.75, total: 199_999.99, paymentMode: "cash" }))).toEqual([]);
    expect(keys(sale({ subtotal: 194_174.76, total: 200_000, paymentMode: "bank" }))).toEqual([]);
    expect(keys(sale({ subtotal: 194_174.76, total: 200_000, paymentMode: "mixed" }))).toEqual([]);
  });
});

describe("taxWarnings: the buyer's PAN (Income Tax Rule 114B)", () => {
  it("warns above ₹2,00,000 when the buyer has neither a PAN nor a GSTIN", () => {
    expect(keys(sale({ subtotal: 195_000, total: 200_850, customer: { ...buyer, pan_number: "" } }))).toEqual(["pan"]);
  });

  it("says nothing at exactly ₹2,00,000, with a PAN, or with a GSTIN", () => {
    expect(keys(sale({ subtotal: 194_174.76, total: 200_000, customer: { ...buyer, pan_number: "" } }))).toEqual([]);
    expect(keys(sale({ subtotal: 195_000, total: 200_850 }))).toEqual([]);
    expect(keys(sale({ subtotal: 195_000, total: 200_850, customer: { ...buyer, pan_number: "", gst_number: "08AAGPL3375F1ZO" } }))).toEqual([]);
  });
});

describe("taxWarnings: when it says nothing at all", () => {
  it("never warns on a purchase", () => {
    expect(keys(sale({ type: "INWARD", subtotal: 300_000, total: 309_000, paymentMode: "cash", customer: { name: "Cash" } }))).toEqual([]);
  });

  it("waits for a customer", () => {
    expect(keys(sale({ subtotal: 300_000, total: 309_000, paymentMode: "cash", customer: undefined }))).toEqual([]);
  });

  it("can give all three at once, in the order the form lists them", () => {
    expect(keys(sale({ subtotal: 300_000, total: 309_000, paymentMode: "cash", customer: { name: "Walk-in Customer", address: "", pan_number: "" } })))
      .toEqual(["buyer_address", "cash_2_lakh", "pan"]);
  });

  it("doesn't call an address or PAN missing when the record it has doesn't include them", () => {
    // The form can hold a stub of a customer it didn't load (name and GSTIN only). A counter name still counts for
    // both: such a record never holds the buyer's own address or PAN.
    expect(keys(sale({ subtotal: 300_000, total: 309_000, customer: { name: "Anil Gupta", gst_number: "" } }))).toEqual([]);
    expect(keys(sale({ subtotal: 300_000, total: 309_000, customer: { name: "Cash", gst_number: "" } }))).toEqual(["buyer_address", "pan"]);
  });
});

describe("isCounterCustomer", () => {
  it("knows the names people give a general counter customer", () => {
    for (const n of ["Cash", "cash sale", "CASH SALES", "Walk-in", "walk in customer", "Walkin", "Counter", "Counter Sale", "Customer"])
      expect(isCounterCustomer(n)).toBe(true);
  });

  it("doesn't mistake a real name that only contains those words", () => {
    for (const n of ["Cashew Traders", "Anil Gupta", "Counter Point Jewellers", ""]) expect(isCounterCustomer(n)).toBe(false);
  });
});
