// Four real logins, never a changed client permission fixture. Requires LOGINS_FILE's four roles.
const { test, expect } = require("@playwright/test");
const { SIGNED_OUT, hasLogin, opened, signIn, typesPassword } = require("./session");
const { today } = require("./sales-data");

typesPassword(test);
test.use({ storageState: SIGNED_OUT });
const fyOf = (day) => { const [y, m] = day.split("-").map(Number); const start = y - (m < 4 ? 1 : 0); return `${start}-${String(start + 1).slice(-2)}`; };

async function liveApi(page) {
  const token = await page.evaluate(() => localStorage.getItem("gst_access_token"));
  expect(Boolean(token), "signIn must establish a real JWT session").toBe(true);
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async get(path, params) {
      const response = await page.request.get(`/api/${path}${params ? `?${new URLSearchParams(params)}` : ""}`, { headers });
      expect(response.status(), `3A integration prerequisite: GET ${path} must be installed and permitted`).toBe(200);
      return response.json();
    },
    post: (path, data) => page.request.post(`/api/${path}`, { headers, data }),
  };
}
async function discover(api) {
  const firms = await api.get("businesses/", { page_size: 100 });
  expect(firms.next, "Access fixture discovery expects at most 100 firms").toBeFalsy();
  let ready = null, filed = null, unlocked = null;
  for (const firm of firms.results) {
    if (firm.name.startsWith("TEST GST RETURNS")) continue;
    const current = fyOf(today());
    for (const fy of [current, `${Number(current.slice(0, 4)) - 1}-${current.slice(2, 4)}`]) {
      const year = await api.get("gst/year/", { business_id: firm.id, fy });
      for (const row of year.months) {
        if (!ready && ["ready", "blocked"].includes(row.stage)) ready = { business: firm.id, fy: year.fy, month: row.month };
        if (!filed && ["filed", "gstr1"].includes(row.stage)) filed = { business: firm.id, fy: year.fy, month: row.month };
        if (!unlocked && row.stage === "unlocked") unlocked = { business: firm.id, fy: year.fy, month: row.month };
      }
    }
    if (ready && filed && unlocked) break;
  }
  expect(ready, "3A role fixture prerequisite: an unfiled past month").toBeTruthy();
  expect(filed, "3A role fixture prerequisite: a filed or GSTR-1-only month").toBeTruthy();
  expect(unlocked, "3A role fixture prerequisite: an unlocked month for relock permissions").toBeTruthy();
  return { ready, filed, unlocked };
}
async function open(page, m) {
  const loaded = Promise.all(["gst/year/", "gst/month/", "gst/month/gstr3b/"].map(path =>
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === `/api/${path}` && response.request().method() === "GET"
        && url.searchParams.get("business_id") === String(m.business)
        && (path === "gst/year/" ? url.searchParams.get("fy") === m.fy : url.searchParams.get("month") === m.month);
    })));
  await page.goto(`/gst?${new URLSearchParams({ firm: String(m.business), month: m.month, fy: m.fy })}`);
  for (const response of await loaded) expect(response.status(), new URL(response.url()).pathname).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#gst-ledger")).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await opened(page);
}

for (const role of ["owner", "accountant", "staff", "viewer"]) {
  test(`${role}: GST visibility and server permissions agree`, { tag: "@sandbox" }, async ({ page }) => {
    test.slow();
    expect(hasLogin(role), `Integration prerequisite: LOGINS_FILE must supply ${role}; one-user CI does not prove four-role permissions`).toBe(true);
    await page.goto("/login");
    await signIn(page, role);
    // While a password remains in its field, use waitForURL: no assertion snapshot can expose it.
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
    const api = await liveApi(page);
    expect((await api.get("me/")).role).toBe(role);
    const data = await discover(api), filer = ["owner", "accountant"].includes(role);
    // Every role can read the GST support screens and export reports, including the CA workbook.
    for (const path of ["gst/credit/", "gst/reconciliation/"]) {
      await api.get(path, { business_id: data.ready.business, fy: data.ready.fy });
    }
    for (const kind of ["sales", "purchases", "tax", "hsn", "customers", "products", "months", "ca-workbook"]) {
      await api.get(`reports/${kind}/`, { from: "2022-04-01", to: today() });
    }
    await open(page, data.ready);
    const mark = page.getByRole("button", { name: "Mark GSTR-1 filed…", exact: true });
    const file = page.getByRole("button", { name: "GSTR-3B file", exact: true });
    if (filer) {
      await expect(mark).toBeEnabled();
      await expect(file).toBeEnabled();
    } else {
      if (role === "viewer") {
        await expect(mark).toHaveCount(0);
        await expect(file).toHaveCount(0);
        await expect(page.locator("[data-actionbar]")).toHaveCount(0);
        await expect(page.getByText("You can look at every return. Downloads and marking returns filed are for the owner and the accountant.", { exact: true })).toBeVisible();
      } else {
        await expect(mark).toBeDisabled();
        await expect(file).toBeDisabled();
      }
      // Deliberately missing business: should be rejected by permission before validation, with no possible write.
      const response = await api.post("gst/filings/", { month: data.ready.month, kind: "gstr1", filed_on: today() });
      expect(response.status(), `${role} must never create a filing through the API`).toBe(403);
    }
    await open(page, data.filed);
    const unlock = page.getByRole("button", { name: /^Unlock .+…$/ });
    if (role === "owner") await expect(unlock).toBeEnabled();
    else {
      if (role === "viewer") await expect(unlock).toHaveCount(0);
      else await expect(unlock).toBeDisabled();
      const response = await api.post("gst/months/unlock/", { month: data.filed.month, reason: "Permission acceptance: no business supplied" });
      expect(response.status(), "X-3: only the owner unlocks, including through the real API").toBe(403);
    }
    await open(page, data.unlocked);
    const relock = page.getByRole("button", { name: /^Lock .+ again…$/ });
    if (filer) await expect(relock).toBeEnabled();
    else {
      if (role === "viewer") await expect(relock).toHaveCount(0);
      else await expect(relock).toBeDisabled();
      const response = await api.post("gst/months/relock/", { month: data.unlocked.month });
      expect(response.status(), `${role} must never relock through the API`).toBe(403);
    }
  });
}
