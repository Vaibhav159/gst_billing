const { expect, test } = require('@playwright/test');
const { opened } = require('./session');
const { client, today, esc, afterDialog } = require('./sales-data');
const coverage = require('./easy-coverage.json');

const money = (decimal) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(decimal));
const monthName = (ym) => new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
// Match core/format.ts date(): IST calendar strings stay calendar strings, with no local Date conversion.
const date = (iso) => { const [year, month, day] = iso.split('-'); return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]} ${year}`; };
const fy = (day = today()) => { const [y, m] = day.split('-').map(Number); const a = y - (m < 4 ? 1 : 0); return `${a}-${String((a + 1) % 100).padStart(2, '0')}`; };
const fyStart = (year = fy()) => `${year.slice(0, 4)}-04-01`;
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const tab = (page, name) => page.locator('nav.phone-tabs').getByRole('link', { name: new RegExp(`^${esc(name)}(,|$)`) });
const bar = (page) => page.locator('[data-actionbar]');
const salesCard = (page) => page.locator('section', { has: page.getByRole('heading', { name: 'Sales today', exact: true }) });
const gstCard = (page) => page.locator('a[href="/e/gst"]');
const toast = (page) => page.locator('[data-sonner-toaster], .z-toast[aria-live="polite"]');
async function tap(locator) {
  await locator.click();
  // Preserve PageFrame's painted-page guard and the kit's longer opening-dialog guard.
  await Promise.all([opened(locator.page()), afterDialog(locator.page())]);
}
async function go(page, path) { await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await opened(page); }
async function check(line, assertion) {
  const row = coverage.find((r) => r.line === line);
  if (!row) throw new Error(`No prototype acceptance check at source line ${line}`);
  await test.step(`EF:${line} ${row.label}`, assertion);
  // Attach only after the assertion finishes successfully. The JSON reporter preserves this execution evidence.
  await test.info().attach('easy-checks', { body: Buffer.from(JSON.stringify({ lines: [line] })), contentType: 'application/json' });
}
async function checkGroup(lines, assertion) {
  for (const line of lines) if (!coverage.some((r) => r.line === line)) throw new Error(`Unknown source line ${line}`);
  await test.step(`EF:${lines.join(',')} ${coverage.find((r) => r.line === lines[0]).label}`, assertion);
  await test.info().attach('easy-checks', { body: Buffer.from(JSON.stringify({ lines })), contentType: 'application/json' });
}
async function scenario(request) {
  const api = client(request);
  const [me, firms] = await Promise.all([api.get('me/'), api.get('businesses/', { page_size: 100 })]);
  const firm = firms.results.find((f) => f.name.startsWith('KIRAN GOLD HOUSE'));
  expect(firm, '6A/3A sandbox seed includes KIRAN').toBeTruthy();
  return { api, me, firm, firms: firms.results };
}
const aiGuardedPages = new WeakSet();
async function preventRealAI(page) {
  if (aiGuardedPages.has(page)) return;
  // A Capture page can resume a pending read immediately on mount. Guard it before any navigation, including
  // the live idle/role/visual checks. A specialized capture fixture registered later overrides this route.
  await page.route((url) => /^\/api\/captures\/\d+\/read\/$/.test(url.pathname), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 503, json: { detail: 'AI reading is disabled during acceptance.', code: 'acceptance_ai_disabled' } });
  });
  aiGuardedPages.add(page);
}
async function easyStorage(page, { me, firm }, { welcome = false, theme = 'obsidian' } = {}) {
  await preventRealAI(page);
  await page.addInitScript(({ id, firmId, welcome, theme }) => {
    const once = 'easy-acceptance-initialized';
    if (!sessionStorage.getItem(once)) {
      sessionStorage.setItem(once, '1');
      localStorage.setItem(`gst3.easy.firm.${id}`, String(firmId));
      localStorage.setItem(`gst3.easy.welcomed.${id}`, String(!welcome));
      localStorage.setItem('gst3.theme', theme);
      localStorage.setItem('gst3.textSize', '1');
    }
    window.__easyShares = [];
    window.__easyOpened = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (value) => { window.__easyShares.push({ text: value.text, files: value.files?.map((f) => ({ name: f.name, type: f.type, size: f.size })) }); } });
    window.open = (url) => { window.__easyOpened.push(String(url)); return { closed: false, close() {} }; };
  }, { id: me.id, firmId: firm.id, welcome, theme });
}
async function customer(api, firm) {
  const suffix = String(Date.now()).slice(-8);
  const name = `Easy acceptance buyer ${suffix}`;
  return api.post('customers/', { name, mobile_number: `98${suffix}`, city: firm.city, state_name: firm.state_name || 'RAJASTHAN', gst_number: '', address: 'Synthetic acceptance address', customer_type: '', businesses: [firm.id] });
}
async function chooseBuyer(page, buyer) {
  await go(page, '/e/new');
  await page.getByLabel('Search by name or phone').fill(buyer.name);
  await tap(page.getByRole('button', { name: new RegExp(`^${esc(buyer.name)}`) }));
  await expect(page).toHaveURL(/\/e\/new\/items/);
}
async function item(page, { name = 'Easy synthetic ring', material = 'Gold 22K', category = /^Jewellery/ } = {}) {
  await tap(page.getByRole('button', { name: 'Not in the list? Add it', exact: true }));
  const dialog = page.getByRole('dialog', { name: "Add an item that isn't in the list" });
  await expect(dialog).toBeVisible();
  await opened(page);
  await dialog.getByLabel('What is it called?').fill(name);
  await tap(dialog.getByRole('button', { name: material, exact: true }));
  await tap(dialog.getByRole('radio', { name: category }));
  await tap(dialog.getByRole('button', { name: 'Add to the bill', exact: true }));
}
const weight = (page) => page.getByLabel('Weight in grams', { exact: true });
const rate = (page) => page.getByLabel(/Rate per gram/);
async function fillLine(page, grams = '12.345', rupees = '6512.50') {
  await weight(page).fill(grams); await rate(page).fill(rupees);
}
async function review(page) {
  await tap(bar(page).getByRole('button', { name: 'Check and save', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Check the bill', exact: true });
  await expect(dialog).toBeVisible(); await afterDialog(page); return dialog;
}
async function save(page, dialog) {
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/sales/');
  await dialog.getByRole('button', { name: /^Save bill / }).click();
  const saved = await response; expect(saved.status()).toBe(201);
  const bill = await saved.json(); await expect(page).toHaveURL(`/e/saved/${bill.id}`); await opened(page); return bill;
}
async function leave(page, choice = 'Keep it as an unfinished bill') {
  // 6C's landed Items header goes straight to Home; its layout owns the leave dialog.
  await tap(page.getByRole('button', { name: 'Back', exact: true }));
  const d = page.getByRole('dialog', { name: 'Keep this bill for later?' });
  await expect(d).toBeVisible(); await afterDialog(page); await tap(d.getByRole('button', { name: choice }));
  await expect(page).toHaveURL('/e');
}
async function sendBill(page) {
  await tap(page.getByRole('button', { name: 'Send the bill', exact: true }));
  const share = page.getByRole('dialog', { name: 'Your PDF is ready' });
  // PDF preparation may outlast the original user activation; wait for either real outcome.
  await expect(share.or(page.getByText(/^Sent at /))).toBeVisible();
  if (await share.isVisible()) {
    await afterDialog(page);
    await tap(share.getByRole('button', { name: 'Share', exact: true }));
  }
}
function png() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'); }
const clockPages = new WeakSet();
async function waitIdleWithoutRequests(page, milliseconds = 60_000) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  const requests = [];
  const record = (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); };
  page.on('request', record);
  if (!clockPages.has(page)) { await page.clock.install(); clockPages.add(page); }
  await page.clock.runFor(milliseconds);
  page.off('request', record);
  expect(requests, 'an idle phone never polls the API').toEqual([]);
}
module.exports = { money, monthName, date, fy, fyStart, text, tab, bar, salesCard, gstCard, toast, tap, go, check, checkGroup, scenario, preventRealAI, easyStorage, customer, chooseBuyer, item, weight, rate, fillLine, review, save, leave, sendBill, png, waitIdleWithoutRequests };
