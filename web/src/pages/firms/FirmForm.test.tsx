import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { serve, type Call } from "@/test/server";
import { FIRM_DETAIL } from "@/test/firmRecords";
import { mount, VIEWER } from "@/pages/customers/testing";
import FirmForm from "./FirmForm";
import { firmBody, firmErrors, paperNumberWords } from "./form";
import { toFirmDetail } from "@/core/api/firms";
const detail = toFirmDetail(FIRM_DETAIL);
const routes = [{ path: "/firms/new", element: <FirmForm /> }, { path: "/firms/:id/edit", element: <FirmForm /> }, { path: "/firms/:id", element: <p>the firm page</p> }, { path: "/setup", element: <p>the setup page</p> }];
function server(extra: Parameters<typeof serve>[0] = {}) { return serve({ "GET firms/": { results: [FIRM_DETAIL] }, "GET firms/3/": FIRM_DETAIL, "GET preferences/": { data: { defaultBusinessId: "3" } }, "GET shop-settings/": { show_bank: true }, ...extra }); }
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());
test("paper date preview uses the date's FY and never rewrites existing numbers", () => {
  expect(paperNumberWords("2027-04-01", "KGH")).toBe("Before 1 Apr 2027: 108 stays 108. From 1 Apr 2027: 108 is saved as KGH/2027-28/108");
  expect(paperNumberWords("2027-03-31", "KGH")).toContain("KGH/2026-27/108");
});
test("strict new firm GSTIN and prefix checks keep unchanged legacy values", () => {
  const old = { ...detail, gst_number: "08AAAAA0000A1Z5", invoice_prefix: "ABCDE" };
  expect(firmErrors(firmBody(old), old, [])).toEqual({});
  expect(firmErrors({ ...firmBody(detail), gst_number: "08AAAAA0000A1Z5", invoice_prefix: "AB12" }, null, [])).toMatchObject({ gst_number: "Check digit doesn't match — likely a typo.", invoice_prefix: "Use 1 to 4 capital letters, like KGH. A GST bill number can have at most 16 characters." });
  expect(firmErrors({ ...firmBody(detail), invoice_prefix: "" }, null, [])).toEqual({});
});
test("an account change waits for the bank check, shows old and new, then saves once", async () => {
  handClock();
  const calls = server({ "PUT firms/3/": ({ data }: Call) => ({ status: 200, data: { ...FIRM_DETAIL, ...(data as object), changes: [{ key: "bank_account_number", field: "Account number", from: "38741120965", to: "38741120966" }] } }) });
  const { router } = mount(routes, ["/firms/3/edit"]); await pass(1);
  fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "38741120966" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]); await pass(400);
  const dialog = screen.getByRole("dialog", { name: "Check the new bank account" });
  expect(within(dialog).getByText("38741120965 → 38741120966")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save the new account" })); await pass(1);
  expect(router.state.location.pathname).toBe("/firms/3");
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  expect(screen.getByText("Account number changed: 38741120965 → 38741120966. Every bill now prints the new account.")).toBeInTheDocument();
});
test("registry fills empty fields but never overwrites the name typed while it was waiting", async () => {
  handClock(); let finish!: (v: { status: number; data: unknown }) => void;
  const pending = new Promise<{ status: number; data: unknown }>((r) => { finish = r; });
  server({ "GET registry/08AAMFR5567K1ZG/": () => pending });
  mount(routes, ["/firms/new"]); await pass(1);
  fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "08AAMFR5567K1ZG" } }); await pass(260);
  fireEvent.change(screen.getByLabelText(/^Legal name/), { target: { value: "My legal name" } });
  finish({ status: 200, data: { gstin: "08AAMFR5567K1ZG", status: "found", registry: { active: true, legal_name: "Rathore Gems and Jewels", trade_name: "Rathore Gems", address: "21, Johari Bazar", city: "Jaipur", pin_code: "302003", registered_on: "2021-03-15" }, on_file: { firms: [], customers: [] } } }); await pass(1);
  expect(screen.getByLabelText(/^Legal name/)).toHaveValue("My legal name");
  expect(screen.getByRole("textbox", { name: "Address · required" })).toHaveValue("21, Johari Bazar");
  expect(screen.getByLabelText("City")).toHaveValue("Jaipur");
  expect(screen.getByLabelText("PIN code")).toHaveValue("302003");
});
test("a viewer gets the owner explanation without a form", async () => {
  server(); mount(routes, ["/firms/3/edit"], { me: VIEWER });
  expect(await screen.findByText("Only the owner adds or changes firms")).toBeInTheDocument();
  expect(screen.queryByLabelText(/^GSTIN/)).not.toBeInTheDocument();
});
test("saving a valid changed prefix keeps the paper date and short name in the full JSON body", async () => {
  const calls = server({ "PUT firms/3/": ({ data }: Call) => ({ status: 200, data: { ...FIRM_DETAIL, ...(data as object), changes: [] } }) });
  mount(routes, ["/firms/3/edit"]);
  fireEvent.change(await screen.findByLabelText("Number prefix"), { target: { value: "KGJ" } });
  fireEvent.change(screen.getByLabelText("Short name"), { target: { value: "KG" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(calls.find((c) => c.method === "PUT")?.data).toMatchObject({ invoice_prefix: "KGJ", short_name: "KG", paper_full_number_from: "2027-04-01" });
});

test("bad signature files keep the form and never upload", async () => {
  const calls = server(); mount(routes, ["/firms/3/edit"]);
  const pick = await screen.findByLabelText("Signature picture");
  fireEvent.change(pick, { target: { files: [new File(["gif"], "sign.gif", { type: "image/gif" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("sign.gif isn't a picture. Pick a PNG or JPG of the signature.");
  fireEvent.change(pick, { target: { files: [new File([new Uint8Array(1048577)], "large.png", { type: "image/png" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Pick one under 1 MB");
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  expect(calls.some((c) => c.method !== "GET")).toBe(false);
});
test("a selected picture goes as multipart and switching it off still wins after upload", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:signature") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const calls = server({ "PUT firms/3/": ({ data }: Call) => ({ status: 200, data: { ...FIRM_DETAIL, ...(data as object) } }), "PUT firms/3/signature/": { ...FIRM_DETAIL, signature_url: "/api/media/sign", signature_on_bills: true } });
  const { router } = mount(routes, ["/firms/3/edit"]);
  const file = new File(["synthetic picture"], "sign.png", { type: "image/png" });
  fireEvent.change(await screen.findByLabelText("Signature picture"), { target: { files: [file] } });
  expect(screen.getByRole("img", { name: /the picture uploaded/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Print the signature on bills" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/firms/3"));
  const writes = calls.filter((c) => c.method === "PUT");
  expect(writes.map((c) => c.url)).toEqual(["firms/3/", "firms/3/signature/", "firms/3/"]);
  expect((writes[1].data as FormData).get("image")).toBe(file);
  expect(writes[2].data).toMatchObject({ signature_on_bills: false });
});
test("after the firm is created but its signature fails, retry updates the same id", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:signature" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  let uploads = 0; let created = false;
  const answer = ({ data }: Call) => { created = true; return { status: 200, data: { ...FIRM_DETAIL, ...(data as object), id: 8 } }; };
  const calls = server({ "GET firms/": () => ({ status: 200, data: { results: created ? [{ ...FIRM_DETAIL, id: 8, name: "New Firm", short: "New", short_name: "", gst_number: "08AAMFR5567K1ZG", invoice_prefix: "" }] : [] } }), "POST firms/": answer, "PUT firms/8/": answer, "PUT firms/8/signature/": () => ++uploads === 1 ? { status: 503 } : { status: 200, data: { ...FIRM_DETAIL, id: 8, signature_url: "/api/media/sign" } } });
  const { router } = mount(routes, ["/firms/new?first=1"]);
  fireEvent.change(await screen.findByLabelText(/^Legal name/), { target: { value: "New Firm" } });
  fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "08AAMFR5567K1ZG" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Address · required" }), { target: { value: "A street" } });
  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9414011223" } });
  fireEvent.click(screen.getByRole("button", { name: /Signature and small print/ }));
  fireEvent.change(screen.getByLabelText("Signature picture"), { target: { files: [new File(["x"], "sign.png", { type: "image/png" })] } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save and continue" })[0]);
  expect(await screen.findByText("Firm details were saved")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Save and continue" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  expect(calls.some((c) => c.url === "firms/8/" && c.method === "PUT")).toBe(true);
});
test("an offline bank save keeps the account and the confirmation open", async () => {
  handClock(); const calls = server({ "PUT firms/3/": () => ({ status: 0 }) });
  mount(routes, ["/firms/3/edit"]); await pass(1);
  fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "38741120966" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]); await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "Save the new account" })); await pass(1);
  expect(screen.getByRole("dialog", { name: "Check the new bank account" })).toBeInTheDocument();
  expect(screen.getByLabelText("Account number")).toHaveValue("38741120966");
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
});

test("a reply for the previous GSTIN cannot fill the changed form", async () => {
  handClock(); let finish!: (v: { status: number; data: unknown }) => void;
  const pending = new Promise<{ status: number; data: unknown }>((r) => { finish = r; });
  server({ "GET registry/08AAMFR5567K1ZG/": () => pending });
  mount(routes, ["/firms/new"]); await pass(1);
  fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "08AAMFR5567K1ZG" } }); await pass(260);
  fireEvent.change(screen.getByLabelText(/^GSTIN/), { target: { value: "08VRHFA2322D1ZI" } });
  finish({ status: 200, data: { gstin: "08AAMFR5567K1ZG", status: "found", registry: { active: true, legal_name: "Earlier firm", address: "Earlier address", city: "Jaipur", pin_code: "302003" } } }); await pass(1);
  expect(screen.getByLabelText(/^Legal name/)).toHaveValue("");
  expect(screen.getByRole("textbox", { name: "Address · required" })).toHaveValue("");
});
test("editing another field preserves an unchanged historical phone verbatim", async () => {
  const calls = server({ "GET firms/3/": { ...FIRM_DETAIL, mobile_number: "legacy contact" }, "PUT firms/3/": ({ data }: Call) => ({ status: 200, data: { ...FIRM_DETAIL, ...(data as object) } }) });
  mount(routes, ["/firms/3/edit"]);
  fireEvent.change(await screen.findByLabelText("City"), { target: { value: "Jaipur" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  expect(calls.find((c) => c.method === "PUT")?.data).toMatchObject({ city: "Jaipur", mobile_number: "legacy contact" });
});

test("a signature decoding error says what the server rejected and keeps the selected picture", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:signature" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  server({ "PUT firms/3/": FIRM_DETAIL, "PUT firms/3/signature/": () => ({ status: 400, data: { image: ["sign.png isn't a picture. Pick a PNG or JPG of the signature."] } }) });
  mount(routes, ["/firms/3/edit"]);
  fireEvent.change(await screen.findByLabelText("Signature picture"), { target: { files: [new File(["not a decoded image"], "sign.png", { type: "image/png" })] } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  expect(await screen.findByText("sign.png isn't a picture. Pick a PNG or JPG of the signature.", { selector: "p[role=alert]" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /the picture uploaded/ })).toBeInTheDocument();
});

test("a bank-confirmed partial save tells the truth inside the still-open dialog", async () => {
  handClock(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:signature" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  server({ "PUT firms/3/": FIRM_DETAIL, "PUT firms/3/signature/": () => ({ status: 503 }) });
  mount(routes, ["/firms/3/edit"]); await pass(1);
  fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "38741120966" } });
  fireEvent.change(screen.getByLabelText("Signature picture"), { target: { files: [new File(["x"], "sign.png", { type: "image/png" })] } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]); await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "Save the new account" })); await pass(1);
  const dialog = screen.getByRole("dialog", { name: "Check the new bank account" });
  expect(within(dialog).getByText("Firm details were saved")).toBeInTheDocument();
  expect(dialog).not.toHaveTextContent("Nothing changed");
});
test("while a new picture is pending the first save keeps the stored switch, so a failed upload never turns the old signature on", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:signature" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const off = { ...FIRM_DETAIL, signature_url: "/api/media/old", signature_on_bills: false };
  const calls = server({ "GET firms/3/": off, "PUT firms/3/": ({ data }: Call) => ({ status: 200, data: { ...off, ...(data as object) } }), "PUT firms/3/signature/": () => ({ status: 400, data: { image: ["sign.png isn't a picture. Pick a PNG or JPG of the signature."] } }) });
  mount(routes, ["/firms/3/edit"]);
  fireEvent.change(await screen.findByLabelText("Signature picture"), { target: { files: [new File(["x"], "sign.png", { type: "image/png" })] } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  expect(await screen.findByText("Firm details were saved")).toBeInTheDocument();
  const writes = calls.filter((c) => c.method === "PUT");
  expect(writes[0].data).toMatchObject({ signature_on_bills: false });
});
test("when the upload worked but switching printing off failed, retry only switches it off and says so", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:signature" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  let puts = 0;
  const calls = server({ "PUT firms/3/": ({ data }: Call) => ++puts === 2 ? { status: 503 } : { status: 200, data: { ...FIRM_DETAIL, ...(data as object) } }, "PUT firms/3/signature/": { ...FIRM_DETAIL, signature_url: "/api/media/sign", signature_on_bills: true } });
  const { router } = mount(routes, ["/firms/3/edit"]);
  fireEvent.change(await screen.findByLabelText("Signature picture"), { target: { files: [new File(["x"], "sign.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("switch", { name: "Print the signature on bills" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  expect(await screen.findByText(/The signature was saved, but it still prints on bills/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Save firm details" })[0]);
  await waitFor(() => expect(router.state.location.pathname).toBe("/firms/3"));
  expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual(["firms/3/", "firms/3/signature/", "firms/3/", "firms/3/"]);
});
test("pasted bank and PIN numbers are kept whole, so a digit too many is refused rather than cut off", async () => {
  server();
  mount(routes, ["/firms/new"]);
  fireEvent.change(await screen.findByLabelText("Account number"), { target: { value: "1234 5678 9012 3456 789" } });
  expect(screen.getByLabelText("Account number")).toHaveValue("1234567890123456789");
  fireEvent.blur(screen.getByLabelText("Account number"));
  expect(screen.getByText("Account numbers have 9 to 18 digits; this has 19.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("IFSC"), { target: { value: "sbin0udr0145" } });
  expect(screen.getByLabelText("IFSC")).toHaveValue("SBIN0UDR0145");
  fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "3130011" } });
  expect(screen.getByLabelText("PIN code")).toHaveValue("3130011");
});
test("opening the edit form never fills it from the registry, so nothing changes until the owner types", async () => {
  const calls = server({ "GET firms/3/": { ...FIRM_DETAIL, city: "", pin_code: "" }, "GET registry/08VRHFA2322D1ZI/": { gstin: "08VRHFA2322D1ZI", status: "found", registry: { active: true, legal_name: "KIRAN GOLD HOUSE", address: "x", city: "Jaipur", pin_code: "302003" } } });
  mount(routes, ["/firms/3/edit"]);
  expect(await screen.findByLabelText("City")).toHaveValue("");
  await new Promise((done) => setTimeout(done, 700));
  expect(screen.getByLabelText("City")).toHaveValue("");
  expect(screen.getByLabelText("PIN code")).toHaveValue("");
  expect(calls.some((c) => c.url.startsWith("registry/"))).toBe(false);
});
test("a half-typed paper date keeps the saved date and says how to type it, on leaving the field", async () => {
  server();
  mount(routes, ["/firms/3/edit"]);
  const date = await screen.findByLabelText("Paper bills carry the full number from");
  Object.defineProperty(date, "validity", { configurable: true, value: { badInput: true } });
  fireEvent.change(date, { target: { value: "" } });
  fireEvent.blur(date);
  expect(screen.getByText("Type the date like 2027-04-01.")).toBeInTheDocument();
  expect(date).toHaveAttribute("aria-invalid", "true");
  const decl = screen.getByLabelText("Declaration");
  fireEvent.change(decl, { target: { value: "x".repeat(501) } });
  fireEvent.blur(decl);
  expect(screen.getByText("Keep the declaration to 500 characters.")).toBeInTheDocument();
  expect(decl).toHaveAttribute("aria-invalid", "true");
});
