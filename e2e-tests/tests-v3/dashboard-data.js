// Part 5's browser fixtures: real routed UI, synthetic contract answers, no writes.
// Keep this file separate from the real-server paper-book regression.
const { expect } = require("@playwright/test");

const DAY = "2026-10-08";
const CURRENT_FY = "2026-27";
const PAST_FY = "2025-26";
const FIRMS = [
  { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", short_name: "Kiran", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN", state_code: "08", invoice_prefix: "KGH", city: "Jaipur", paper_full_number_from: null },
  { id: 2, name: "MEERA ORNAMENTS", short: "Meera", short_name: "Meera", gst_number: "08AAKFS4821M1ZQ", state_name: "RAJASTHAN", state_code: "08", invoice_prefix: "MO", city: "Jaipur", paper_full_number_from: null },
];

function bill(index, overrides = {}) {
  return {
    id: 412 + index, business: 3, business_name: FIRMS[0].name, invoice_number: `KGH/2026-27/${31 + index}`, counter: 31 + index, fy: CURRENT_FY,
    invoice_date: DAY, created_at: `${DAY}T10:${String(42 - index).padStart(2, "0")}:00+05:30`, paper: index === 1,
    customer: { id: 7 + index, name: index ? `Dashboard customer ${index + 1}` : "Anil Gupta", gst_number: "", mobile_number: "9829041122", type: "person" },
    payment_mode: index % 2 ? "bank" : "cash", taxable: "1000.00", cgst: "15.00", sgst: "15.00", igst: "0.00", tax: "30.00", total_amount: "1030.00",
    interstate: false, gst_percents: ["3"], line_count: 1, status: "active", cancel_reason: "", sent: null, checks: [], itax: [], locked: false,
    ...overrides,
  };
}

const figures = (count, total) => ({ count, total, taxable: "1000.00", tax: "30.00" });
function dashboardAnswer({ firm = null, fy = CURRENT_FY, scenario = "dashboard", viewer = false } = {}) {
  const current = fy === CURRENT_FY;
  const quiet = scenario === "dashboard-quiet" || firm === 2;
  const bills = quiet ? [] : Array.from({ length: firm === 3 ? 4 : 6 }, (_, n) => bill(n));
  const month = current ? "2026-10" : "2026-03";
  const selected = FIRMS.filter((row) => firm === null || row.id === firm);
  return {
    today: { date: DAY, count: bills.length, total: bills.length === 6 ? "6180.00" : bills.length === 4 ? "4120.00" : "0.00",
      by_payment: bills.length ? [{ mode: "cash", total: bills.length === 6 ? "3090.00" : "2060.00" }, { mode: "bank", total: bills.length === 6 ? "3090.00" : "2060.00" }] : [],
      bills, more: 0, recent: quiet ? [bill(20, { invoice_date: "2026-09-30", paper: true }), bill(21, { invoice_date: "2026-09-29", line_count: 0, total_amount: "0.00" })] : [] },
    fy, current,
    month: { kind: current ? "so_far" : "last_of_fy", month, from: `${month}-01`, to: current ? DAY : "2026-03-31", sales: figures(31, "1250430.55"), purchases: figures(12, "1426000.00") },
    last30: current ? { from: "2026-09-09", to: DAY, sales: figures(77, "2460800.00"), purchases: figures(29, "2690100.00") } : null,
    year: { from: `${fy.slice(0, 4)}-04-01`, to: current ? DAY : "2026-03-31",
      months: Array.from({ length: current ? 7 : 12 }, (_, n) => {
        const offset = n + 3;
        return { month: `${Number(fy.slice(0, 4)) + Math.floor(offset / 12)}-${String(offset % 12 + 1).padStart(2, "0")}`,
          sales: { count: 10, total: "20000.00", tax: "582.52" }, purchases: { count: 4, total: "30000.00", tax: "873.79" } };
      }), sales: { count: current ? 70 : 120, total: current ? "140000.00" : "240000.00" }, purchases: { count: current ? 28 : 48, total: current ? "210000.00" : "360000.00" } },
    returns_year: current ? null : selected.map((row) => ({ firm: row, months_filed: 12, last_gstr3b_filed_on: "2026-04-18", cash_paid: "412880.00" })),
    // 4E's words/details names win over the illustrative title/detail in part 5.
    changes: viewer ? null : [{ id: 9120, at: `${DAY}T10:44:02+05:30`, by: { id: 2, name: "Rakesh Soni" }, kind: "sales", group: "change", action: "sent", entity: "invoice", entity_id: 412,
      words: { text: "Sent", target: "KGH/2026-27/31", after: "" }, details: "To Anil Gupta on WhatsApp", note: "", link: "/sales/412", changes: [], result: null, can: null }],
  };
}

const dueItem = (kind, title, overrides = {}) => ({ kind, title, detail: "Synthetic dashboard acceptance fixture", due: null, count: 1, firm: null, month: null, draft_id: null, from: null, to: null, badge: null, ...overrides });
const ITEMS = [
  dueItem("blocker", "2 problems stop Kiran's September GSTR-1", { due: "2026-10-11", count: 2, firm: 3, month: "2026-09", badge: "home_dot", detail: "KIRAN GOLD HOUSE · September 2026 GSTR-1 can't be filed until they're fixed" }),
  dueItem("file_gstr1", "File September GSTR-1 for MEERA ORNAMENTS", { due: "2026-10-11", firm: 2, month: "2026-09", detail: "Every check passes · ready for the portal" }),
  dueItem("pay_3b", "Pay ₹1,33,902.11 GSTR-3B tax in cash", { due: "2026-10-20", count: 2, firm: 3, month: "2026-09", detail: "September · Kiran ₹98,410.00 · Meera ₹35,492.11" }),
  dueItem("open_blocker", "1 October bill needs fixing before October's GSTR-1", { due: "2026-11-11", firm: 3, month: "2026-10" }),
  dueItem("captures", "3 captured bills to fill in", { count: 3, detail: "Photos of supplier bills waiting to become purchases" }),
  dueItem("drafts", "2 unfinished bills", { count: 2, draft_id: "832e8a87-b3f1-42c0-a1be-ed3f8c182701", detail: "Saved as you typed; open to finish or discard" }),
  dueItem("review", "1 purchase bill needs a check", { detail: "Read from a photo; confirm the GST rate" }),
];

function dueAnswer({ firm = null, viewer = false, returns = true } = {}) {
  return { today: DAY, items: viewer ? [] : ITEMS.filter((row) => firm === null || row.firm === null || row.firm === firm), returns: returns ? {
    month: "2026-09", gstr1_due: "2026-10-11", gstr3b_due: "2026-10-20",
    firms: FIRMS.filter((row) => firm === null || row.id === firm).map((row) => ({ firm: row, stage: row.id === 3 ? "blocked" : "ready", blockers: row.id === 3 ? 2 : 0,
      purchases_to_check: row.id === 3 ? 0 : 1, output: "131510.40", cash: row.id === 3 ? "98410.00" : "35492.11", credit_used: row.id === 3 ? "33100.40" : "96018.29", carry_on: "0.00", gstr1: null, gstr3b: null })),
  } : null };
}

const RATE_ROWS = [
  { key: "gold-24K", label: "Gold 24K", sub: "999", per: 10, per_label: "10 g" },
  { key: "gold-22K", label: "Gold 22K", sub: "916", per: 10, per_label: "10 g" },
  { key: "gold-18K", label: "Gold 18K", sub: "750", per: 10, per_label: "10 g" },
  { key: "silver-999", label: "Silver 999", sub: "fine", per: 1000, per_label: "kg" },
  { key: "silver-925", label: "Silver 925", sub: "sterling", per: 1000, per_label: "kg" },
];
function board(on, id) {
  return { id, on, set_at: `${on}T10:12:00+05:30`, set_by: { id: 1, name: "Kailash Mehta" },
    quoted: { "gold-24K": "71040.00", "gold-22K": "65125.00", "gold-18K": "53280.00", "silver-999": "78500.00", "silver-925": "72610.00" },
    per_gram: { "gold-24K": "7104.000", "gold-22K": "6512.500", "gold-18K": "5328.000", "silver-999": "78.500", "silver-925": "72.610" } };
}

/** Browser-only Expert preference; it never changes the signed-in user's saved mode. */
async function expertOnThisPage(page, { theme = "obsidian", firm = "all", fy = CURRENT_FY } = {}) {
  await page.addInitScript(({ theme, firm, fy }) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("gst3.scope.") || key.startsWith("gst3.prefs.")) localStorage.removeItem(key);
    const token = localStorage.getItem("gst_access_token");
    try {
      const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const id = JSON.parse(atob(part)).user_id;
      localStorage.setItem(`gst3.scope.${id}`, String(firm));
      localStorage.setItem(`gst3.prefs.${id}`, JSON.stringify({ phoneMode: "expert" }));
    } catch { /* A signed-out role test receives its preferences after sign-in. */ }
    localStorage.setItem("mobile-mode", "expert");
    localStorage.setItem("gst3.theme", theme);
    localStorage.setItem("gst3.fy", fy);
  }, { theme, firm, fy });
  await page.route((url) => url.pathname === "/api/preferences/", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { data: { phoneMode: "expert" } } }) : route.abort("blockedbyclient"));
}

async function fixtureDashboard(page, { scenario = "dashboard", theme = "obsidian", viewer = false } = {}) {
  const fy = scenario === "dashboard-past-year" ? PAST_FY : CURRENT_FY;
  // Keep the fixture's calendar while Date.now advances past the page's click guard.
  await page.clock.install({ time: new Date(`${DAY}T12:00:00+05:30`) });
  await expertOnThisPage(page, { theme, fy });
  const calls = [];
  await page.route((url) => ["/api/dashboard/", "/api/due-next/", "/api/rates/", "/api/businesses/", "/api/firms/", "/api/setup/"].includes(url.pathname), async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
    const firm = url.searchParams.has("business_id") ? Number(url.searchParams.get("business_id")) : null;
    if (url.pathname === "/api/dashboard/") return route.fulfill({ json: dashboardAnswer({ firm, fy: url.searchParams.get("fy") || CURRENT_FY, scenario, viewer }) });
    if (url.pathname === "/api/due-next/") return route.fulfill({ json: dueAnswer({ firm, viewer, returns: url.searchParams.get("returns") === "1" }) });
    if (url.pathname === "/api/rates/") {
      const stale = scenario === "dashboard-rates";
      const latest = board(stale ? "2026-10-07" : DAY, 41);
      return route.fulfill({ json: { today: DAY, rows: RATE_ROWS, latest, set_today: !stale, previous: board("2026-10-06", 40), ...(url.searchParams.has("date") ? { in_force: latest } : {}) } });
    }
    if (url.pathname === "/api/setup/") return route.fulfill({ json: { firms: { count: 2, names: FIRMS.map((row) => row.name) }, customers: { count: 30, names: ["Anil Gupta"] }, products: { count: 5, names: ["Gold Ring"] }, bills: { count: 600, cancelled: 0 }, people: viewer ? null : 4, last_backup_at: null } });
    return route.fulfill({ json: { count: FIRMS.length, next: null, previous: null, results: FIRMS } });
  });
  return { calls, path: fy === PAST_FY ? `/?fy=${fy}` : "/" };
}

async function dueText(page) {
  const card = page.getByRole("region", { name: "Due next", exact: true });
  await expect(card).toBeVisible();
  const more = card.getByRole("button", { name: /^Show \d+ more$/ });
  if (await more.count()) await more.click();
  return (await card.innerText()).replace(/₹[\d,]+(?:\.\d+)?/g, "₹…");
}

module.exports = { DAY, CURRENT_FY, PAST_FY, FIRMS, ITEMS, fixtureDashboard, expertOnThisPage, dueText };
