import { expect, test } from "vitest";
import { serve, serveWith } from "@/test/server";
import { checkRecordRows, saveRecordRows } from "./recordsImport";

test("product rates use the allowlist: 0.25 stays 0.25 and 0.18 becomes 18; explicit product fields survive", async () => {
  const calls = serve({ "GET catalog/": { results: [], next: null }, "POST catalog/": { id: 9 } });
  const rows = await checkRecordRows("products", [{ name: "Diamond", hsn_code: "7102", gst_percent: "0.25", unit: "CTS", kind: "diamond", purity: "VVS1", usual_rate: "600.125", purchase_only: "Yes" }, { name: "Pouch", hsn_code: "4819", gst_percent: "0.18", unit: "NOS" }]);
  expect(rows.map((row) => row.state)).toEqual(["ready", "ready"]);
  const result = await saveRecordRows("products", rows);
  expect(result.saved).toBe(2);
  expect(calls.filter((call) => call.method === "POST").map((call) => call.data)).toEqual([
    { name: "Diamond", hsn_code: "7102", gst_percent: "0.25", unit: "ct", kind: "diamond", purity: "VVS1", usual_rate: "600.125", purchase_only: true, description: "" },
    { name: "Pouch", hsn_code: "4819", gst_percent: "18", unit: "nos", kind: null, purity: "", usual_rate: null, purchase_only: false, description: "" },
  ]);
});

test("invalid HSN, off-slab rate and invalid bought-only switch are fix rows and cause no request", async () => {
  const calls = serve({});
  const rows = await checkRecordRows("products", [
    { name: "Short HSN", hsn_code: "711", gst_percent: "3" },
    { name: "Wrong rate", hsn_code: "7113", gst_percent: "2.5%" },
    { name: "Wrong flag", hsn_code: "7113", gst_percent: "3", purchase_only: "maybe" },
  ]);
  expect(rows.map((row) => row.state)).toEqual(["fix", "fix", "fix"]);
  expect(calls).toHaveLength(0);
});

test("customers skip matching normalized phones and duplicate rows in the file", async () => {
  const calls = serve({ "GET customers/": { results: [{ id: 7, name: "Anil", mobile_number: "9829041122", gst_number: "" }], next: null } });
  const rows = await checkRecordRows("customers", [{ name: "Anil G", mobile_number: "+91 98290 41122" }, { name: "New", mobile_number: "9414123456" }, { name: "New again", mobile_number: "9414123456" }]);
  expect(rows.map((row) => row.state)).toEqual(["skip", "ready", "skip"]);
  expect(rows[0].note).toContain("Already a customer: Anil");
  expect(rows[2].note).toBe("Listed twice in the file. Will be skipped.");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("customer placeholders become blank, valid GSTIN supplies PAN and state, no arbitrary Rajasthan default", async () => {
  const calls = serve({ "GET customers/": { results: [], next: null }, "POST customers/": { id: 8 } });
  const rows = await checkRecordRows("customers", [
    { name: "Person", mobile_number: "9414123456", gst_number: "URP" },
    { name: "Business", mobile_number: "9414123457", gst_number: "08AAMFR5567K1ZG", address: "1 Test Road" },
  ]);
  await saveRecordRows("customers", rows);
  const bodies = calls.filter((call) => call.method === "POST").map((call) => call.data);
  expect(bodies[0]).toMatchObject({ gst_number: "", state_name: "", customer_type: "person" });
  expect(bodies[0]).not.toHaveProperty("businesses");
  expect(bodies[1]).toMatchObject({ gst_number: "08AAMFR5567K1ZG", state_name: "RAJASTHAN", pan_number: "AAMFR5567K", customer_type: "business" });
});

const firm = {
  id: 3, name: "Kiran", short_name: "KG", gst_number: "08VRHFA2322D1ZI", address: "Old address", city: "Udaipur", pin_code: "313001", mobile_number: "9414122018", email: "old@example.in",
  bank_name: "Old bank", bank_account_number: "123456789", bank_ifsc_code: "SBIN0000001", bank_branch_name: "Old branch", invoice_prefix: "KGH", paper_full_number_from: "2027-04-01", signature_on_bills: false, jurisdiction: "Udaipur", declaration: "Stored declaration",
};

const newFirm = { name: "New firm", gst_number: "08AAMFR5567K1ZG", address: "12 Test Road", mobile_number: "+91 94141 22018" };

test("firms import creates missing firms with exact FirmBody keys and safe defaults", async () => {
  const calls = serve({ "GET firms/": { results: [] }, "POST firms/": { id: 4 } });
  const rows = await checkRecordRows("firms", [newFirm]);
  expect(rows[0].state).toBe("ready");
  expect((await saveRecordRows("firms", rows)).saved).toBe(1);
  expect(calls.find((call) => call.method === "POST")?.data).toEqual({
    ...newFirm, mobile_number: "9414122018", short_name: "", city: "", pin_code: "", email: "",
    bank_name: "", bank_account_number: "", bank_ifsc_code: "", bank_branch_name: "", invoice_prefix: "",
    paper_full_number_from: null, signature_on_bills: true, jurisdiction: "", declaration: "",
  });
  expect(calls.every((call) => call.url === "firms/")).toBe(true);
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});

test("firm columns preserve optional settings without sending derived identity fields", async () => {
  const calls = serve({ "GET firms/": { results: [] }, "POST firms/": { id: 4 } });
  const { id: _id, signature_on_bills: _signature, ...fields } = firm;
  const rows = await checkRecordRows("firms", [{ ...fields, gst_number: firm.gst_number.toLowerCase(), bank_ifsc_code: "sbin0000001", invoice_prefix: "kgh", signature_on_bills: "No", state_name: "File state", pan_number: "File PAN" }]);
  expect((await saveRecordRows("firms", rows)).saved).toBe(1);
  expect(calls.find((call) => call.method === "POST")?.data).toEqual({ ...fields, signature_on_bills: false });
});

test("firms skip existing GSTIN or normalized name and repeated file identities", async () => {
  const calls = serve({ "GET firms/": { results: [firm] } });
  const rows = await checkRecordRows("firms", [
    { ...newFirm, name: "Different spelling", gst_number: firm.gst_number },
    { ...newFirm, name: "  kIrAn  " },
    { ...newFirm, name: "  KIRAN  " },
    { ...newFirm, name: "Repeated GSTIN" },
  ]);
  expect(rows.map((row) => row.state)).toEqual(["skip", "skip", "skip", "skip"]);
  expect(rows[0].note).toBe("Already a firm: Kiran. Will be skipped.");
  expect(rows[1].note).toBe("Already a firm: Kiran. Will be skipped.");
  expect(rows[2].note).toBe("Listed twice in the file. Will be skipped.");
  expect(rows[3].note).toBe("Listed twice in the file. Will be skipped.");
  expect(calls.every((call) => call.method === "GET" && call.url === "firms/")).toBe(true);
});

test.each([
  ["name", "", "Enter the firm's legal name"],
  ["gst_number", "", "Enter the firm's GSTIN"],
  ["gst_number", "08AAMFR5567K1Z0", "Check digit doesn't match — likely a typo."],
  ["address", "", "Enter the address printed on bills."],
  ["mobile_number", "", "Enter a phone number for bills."],
  ["mobile_number", "abc", "Enter a phone number for bills."],
  ["mobile_number", "123", "A mobile number has 10 digits"],
  ["pin_code", "123", "A PIN code has 6 digits"],
  ["bank_account_number", "123", "Account numbers have 9 to 18 digits"],
  ["bank_ifsc_code", "SBIN0000", "An IFSC has 11 characters"],
  ["invoice_prefix", "TOOLONG", "Use 1 to 4 capital letters"],
  ["paper_full_number_from", "2027-02-30", "Type the date like 2027-04-01."],
  ["paper_full_number_from", "1999-12-31", "Pick a date from 2000 to 2099."],
  ["signature_on_bills", "maybe", "Signature on bills must be Yes or No."],
])("firm %s=%s needs a fix before any request", async (key, value, message) => {
  const calls = serve({});
  const rows = await checkRecordRows("firms", [{ ...newFirm, [key]: value }]);
  expect(rows[0].state).toBe("fix");
  expect(rows[0].note).toContain(message);
  expect(calls).toHaveLength(0);
});

test("a firm added after preview is skipped rather than updated or posted again", async () => {
  let gets = 0;
  const calls = serve({ "GET firms/": () => ({ status: 200, data: { results: gets++ ? [{ ...newFirm, id: 4 }] : [] } }) });
  const rows = await checkRecordRows("firms", [newFirm]);
  expect(rows[0].state).toBe("ready");
  const result = await saveRecordRows("firms", rows);
  expect(result.saved).toBe(0);
  expect(result.rows[0].state).toBe("skip");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("a partial import reports every completed row, stops on failure and does not retry an ambiguous write", async () => {
  let posts = 0;
  const calls = serveWith((call) => call.method === "GET" ? { status: 200, data: { results: [], next: null } }
    : ++posts === 1 ? { status: 201, data: { id: 1 } } : { status: 0 });
  const rows = await checkRecordRows("products", ["A", "B", "C"].map((name) => ({ name, hsn_code: "7113", gst_percent: "3" })));
  const result = await saveRecordRows("products", rows);
  expect(result.saved).toBe(1);
  expect(result.rows.map((row) => row.state)).toEqual(["saved", "uncertain", "ready"]);
  expect(result.rows[1].note).toContain("Check the rows again before another import");
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
});

test("a duplicate added after preview is skipped when the import checks again", async () => {
  let gets = 0;
  const calls = serve({ "GET catalog/": () => ({ status: 200, data: { results: gets++ ? [{ id: 1, name: "Gold" }] : [], next: null } }) });
  const rows = await checkRecordRows("products", [{ name: "Gold", hsn_code: "7113", gst_percent: "3" }]);
  const result = await saveRecordRows("products", rows);
  expect(result.saved).toBe(0);
  expect(result.rows[0].state).toBe("skip");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("duplicate search follows every page rather than losing a match on the second page", async () => {
  serveWith((call) => ({ status: 200, data: call.params.page === 1 ? { results: [], next: "next" } : { results: [{ id: 7, name: "gold" }], next: null } }));
  const rows = await checkRecordRows("products", [{ name: "Gold", hsn_code: "7113", gst_percent: "3" }]);
  expect(rows[0].state).toBe("skip");
});
