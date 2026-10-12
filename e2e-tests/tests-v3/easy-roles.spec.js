const { test, expect } = require('@playwright/test');
const { SIGNED_OUT, hasLogin, signIn, typesPassword, opened, easyIfExpertSaved } = require('./session');
const { afterDialog, today, makesBills, newBill } = require('./sales-data');
const { startsDrafts, monthBefore } = require('./bill-form-data');
const H = require('./easy-acceptance-data');
startsDrafts(test);
makesBills(test);
typesPassword(test);
test.beforeEach(async ({ page }, info) => { test.skip(info.project.name !== 'phone', 'Easy is phone-only'); await H.preventRealAI(page); });

test('Easy acceptance: More, profile, the phone firm and returning from the full view', { tag: "@sandbox" }, async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const s = await H.scenario(request); await H.easyStorage(page, s);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await H.go(page, '/e/more');
  await H.tap(page.getByRole('button', { name: /^Text size/ })); await afterDialog(page); await H.tap(page.getByRole('radio', { name: /^Larger/ }));
  await H.check(475, async () => { expect(await page.evaluate(() => localStorage.getItem('gst3.textSize'))).toBe('1.2'); await expect(page.getByRole('button', { name: /^Text size/ })).toContainText('Larger'); });
  await H.tap(page.getByRole('button', { name: /^Text size/ })); await afterDialog(page); await H.tap(page.getByRole('radio', { name: /^Normal/ }));
  await H.check(480, async () => expect(await page.evaluate(() => localStorage.getItem('gst3.textSize'))).toBe('1'));
  await H.tap(page.getByRole('button', { name: /^Theme/ })); await afterDialog(page); await H.tap(page.getByRole('radio', { name: /^Pearl/ }));
  await H.check(484, () => expect(page.locator('html')).toHaveClass('theme-pearl'));
  await H.tap(page.getByRole('button', { name: /^Theme/ })); await afterDialog(page); await H.tap(page.getByRole('radio', { name: /^Obsidian/ }));
  await H.check(488, () => expect(page.locator('html')).toHaveClass(''));
  await H.tap(page.getByRole('button', { name: new RegExp(`^Financial year ${H.fy()}`) }));
  await H.check(490, async () => { await expect(page.getByText(/starting again at 1 each April/)).toBeVisible(); await expect(page.getByText(/Show last year's bills too/)).toBeVisible(); });
  await afterDialog(page); await H.tap(page.getByRole('dialog').getByRole('button', { name: 'Got it' }));
  await H.tap(page.getByRole('button', { name: /^How to send a bill/ }));
  await H.check(493, () => expect(page.getByText(/In lists, Sent is only a label/)).toBeVisible());
  await afterDialog(page); await H.tap(page.getByRole('dialog').getByRole('button', { name: 'Got it' }));
  await H.tap(page.getByRole('button', { name: /^Profile and password/ }));
  await H.check(497, async () => { await expect(page.getByText(/Ask the owner to set a new password for you/)).toBeVisible(); await expect(page.getByText(/a 6-digit code comes by SMS/)).toHaveCount(0); });
  let calls = 0;
  const original = await page.evaluate(() => ({ access: localStorage.getItem('gst_access_token'), refresh: localStorage.getItem('gst_refresh_token') }));
  const rotated = { access: 'synthetic-acceptance-access', refresh: 'synthetic-acceptance-refresh' };
  const authenticated = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === '/api/account/password/' && req.method() === 'POST') {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 400, json: { current: ["That isn't your current password. Check Caps Lock and try again."] } });
      expect(req.postDataJSON()).toEqual({ current: 'synthetic-current', password: 'Synthetic2026password' });
      return route.fulfill({ status: 200, json: { detail: 'Password changed. Your other devices are signed out.', changed_at: `${today()}T16:52:00+05:30`, ...rotated } });
    }
    if (req.headers().authorization === `Bearer ${rotated.access}`) {
      authenticated.push(path);
      return route.continue({ headers: { ...req.headers(), authorization: `Bearer ${original.access}` } });
    }
    return route.continue();
  });
  try {
  await page.getByLabel('Current password').fill('synthetic-wrong');
  await page.getByLabel('New password', { exact: true }).fill('Synthetic2026password');
  await page.getByLabel('New password again').fill('Synthetic2026password');
  await H.tap(page.getByRole('button', { name: 'Change password', exact: true }));
  await H.check(502, () => expect(page.getByText("That isn't your current password. Check Caps Lock and try again.")).toBeVisible());
  await page.getByLabel('Current password').fill('synthetic-current'); await H.tap(page.getByRole('button', { name: 'Change password', exact: true }));
  await H.check(505, async () => { await expect(page.getByText('Password changed. Your other devices are signed out.')).toBeVisible(); await expect(page.getByText(/Password changed at/)).toBeVisible(); await expect(H.toast(page)).not.toContainText('Password changed'); expect(await page.evaluate(() => ({ access: localStorage.getItem('gst_access_token'), refresh: localStorage.getItem('gst_refresh_token') }))).toEqual(rotated); });
  await H.tap(page.getByRole('button', { name: 'Log out of this phone' })); const logout = page.getByRole('dialog', { name: 'Log out of this phone?' });
  await H.check(510, () => expect(logout.getByText("You'll need your password to sign in again.")).toBeVisible());
  await afterDialog(page); await H.tap(logout.getByRole('button', { name: 'Stay signed in' }));
  await H.check(512, () => expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible());
  await H.go(page, '/e/customers'); expect(authenticated).toContain('/api/customers/');
  } finally {
    if (!page.isClosed()) {
      try { await page.evaluate((tokens) => { localStorage.setItem('gst_access_token', tokens.access); localStorage.setItem('gst_refresh_token', tokens.refresh); }, original); }
      finally { await page.unroute('**/api/**'); }
    }
  }
  await H.go(page, '/e/more'); await H.tap(page.getByRole('button', { name: /^Firm on this phone/ }));
  const other = s.firms.find((f) => f.name.startsWith('MEERA')); expect(other).toBeTruthy(); await afterDialog(page);
  await H.tap(page.getByRole('radio', { name: /Meera Ornaments/i }));
  await H.check(517, () => expect(H.toast(page)).not.toContainText('Now billing'));
  await H.check(518, async () => { expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`gst3.easy.firm.${id}`)), s.me.id)).toBe(other.id); await expect(page.getByRole('button', { name: /^Firm on this phone/ })).toContainText(/Meera/i); });
  await H.tap(page.getByRole('button', { name: /^Show the welcome again/ }));
  await H.check(521, async () => { await expect(page.getByRole('heading', { name: 'Welcome to Easy mode' })).toBeVisible(); const day = await s.api.get('sales/', { business_id: other.id, start_date: today(), end_date: today(), page_size: 50 }); if (!day.summary.bills) { await expect(page.getByText('No sales yet today')).toBeVisible(); await expect(H.salesCard(page)).not.toContainText('₹0'); } });
  // 6-D1: preserve the original round-trip check as a header visit, which leaves the preference Easy.
  await H.tap(page.getByRole('button', { name: 'Full view', exact: true }));
  await H.check(531, async () => { await expect(page.getByRole('link', { name: 'Back to Easy', exact: true })).toBeVisible(); expect((await s.api.get('preferences/')).data.phoneMode ?? 'easy').toBe('easy'); });
  await H.tap(page.getByRole('link', { name: 'Back to Easy', exact: true }));
  await H.check(534, async () => { await expect(page).toHaveURL('/e'); await expect(page.getByRole('heading', { level: 1 })).toContainText(/Meera/i); });
  await test.step('6-D1: More switches permanently to Expert, without a Back to Easy visit strip', async () => {
    try {
      await H.go(page, '/e/more');
      const switched = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/preferences/' && r.request().method() === 'PATCH');
      await H.tap(page.getByRole('button', { name: /^Switch to the full view/ }));
      expect((await switched).ok()).toBe(true);
      expect((await s.api.get('preferences/')).data.phoneMode).toBe('expert');
      await expect(page.getByRole('link', { name: 'Back to Easy', exact: true })).toHaveCount(0);
    } finally { await easyIfExpertSaved(request, original.access); }
    await H.go(page, '/e');
  });
  await H.check(535, async () => expect(errors).toEqual([]));
  // Another phone starts with the same login but no local Easy-firm override.
  const state = await page.context().storageState();
  for (const origin of state.origins) origin.localStorage = origin.localStorage.filter((entry) => entry.name !== `gst3.easy.firm.${s.me.id}`);
  const second = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const otherPage = await second.newPage(); await H.go(otherPage, '/e');
    const prefs = (await s.api.get('preferences/')).data;
    const settings = await s.api.get('shop-settings/');
    const fallbackId = prefs.defaultBusinessId ?? settings.default_business ?? [...s.firms].sort((a, b) => a.name.localeCompare(b.name))[0].id;
    await H.check(541, async () => { const calls = []; otherPage.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/sales/') calls.push(u.searchParams.get('business_id')); }); await otherPage.reload(); await expect(otherPage.getByRole('heading', { level: 1 })).toBeVisible(); expect(calls).toContain(String(fallbackId)); });
  } finally { await second.close(); }
});

test.describe('The actual owner, accountant, counter-staff and viewer sessions', () => {
  test.use({ storageState: SIGNED_OUT });
  for (const role of ['owner', 'accountant', 'staff', 'viewer']) {
    test(`${role}: Easy permissions and plain GST words`, { tag: "@sandbox" }, async ({ page, request }) => {
      test.setTimeout(90_000);
      expect(hasLogin(role), `Acceptance requires LOGINS_FILE with ${role}; CI's one user is not a four-role pass`).toBe(true);
      const owner = await H.scenario(request);
      const { firm: blocked } = await H.blockedFirm(owner.api, owner.firms);
      const bill = await newBill(owner.api, { firm: owner.firm });
      await page.goto('/login'); await opened(page); await signIn(page, role); await page.waitForURL((u) => u.pathname !== '/login');
      const token = await page.evaluate(() => localStorage.getItem('gst_access_token'));
      const headers = { Authorization: `Bearer ${token}` };
      const meResponse = await request.get('/api/me/', { headers }); expect(meResponse.ok()).toBe(true); const me = await meResponse.json();
      expect(me.role).toBe(role);
      await easyIfExpertSaved(request, token);
      await page.evaluate(({ id, firm }) => { localStorage.setItem(`gst3.easy.firm.${id}`, String(firm)); localStorage.removeItem(`gst3.easy.welcomed.${id}`); }, { id: me.id, firm: blocked.id });
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await H.go(page, '/e');
      const mayBill = role === 'owner' || role === 'staff';
      await expect(H.bar(page).getByRole('button', { name: 'New bill', exact: true }))[mayBill ? 'toBeEnabled' : 'toBeDisabled']();
      if (role === 'viewer') {
        await H.check(608, async () => { await expect(page.getByText("See today's bills.")).toBeVisible(); await expect(page.getByText('Make a bill in two steps.')).toHaveCount(0); });
        await H.check(609, () => expect(H.bar(page).getByRole('button', { name: 'New bill', exact: true })).toBeDisabled());
        await H.check(610, () => expect(page.getByRole('button', { name: /^Send / })).toHaveCount(0));
      }
      if (role === 'staff') await H.check(553, async () => { await expect(H.gstCard(page)).toContainText('the owner is fixing'); await expect(H.gstCard(page)).not.toContainText('Fix it'); });
      await H.go(page, `/e/bill/${bill.id}`);
      if (role !== 'owner') await H.check(547, async () => { await expect(page.getByText('Made a mistake? Ask the owner to cancel it.')).toBeVisible(); await expect(page.getByText('Need to change it? Ask the owner.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Open in the full view' })).toHaveCount(0); });
      await H.go(page, '/e/gst');
      await expect(page.getByRole('button', { name: 'Share these figures with your CA' })).toBeEnabled();
      if (role !== 'owner') await H.check(556, async () => { await expect(page.getByText(/^Tell the owner:/).first()).toBeVisible(); await expect(page.getByRole('button', { name: 'Fix it in the full view' })).toHaveCount(0); });
      const captures = await owner.api.get('captures/', { status: 'waiting' });
      const ready = captures.results.find(capture => capture.status === 'ready' && capture.business);
      expect(ready, 'The purchase seed supplies a ready capture for the role action').toBeTruthy();
      await page.evaluate(({ id, firm }) => localStorage.setItem(`gst3.easy.firm.${id}`, String(firm)), { id: me.id, firm: ready.business });
      await H.go(page, '/e/capture');
      const photo = page.getByLabel('Take a photo', { exact: true });
      await expect(photo)[role === 'viewer' ? 'toBeDisabled' : 'toBeEnabled']();
      await expect(page.getByRole('button', { name: 'Fill them in now in the full view' }))[role === 'viewer' ? 'toHaveCount' : 'toBeVisible'](...(role === 'viewer' ? [0] : []));
      if (role === 'viewer') {
        const refused = await request.post('/api/captures/', { headers, multipart: { files: { name: 'synthetic.png', mimeType: 'image/png', buffer: H.png() } } });
        expect(refused.status()).toBe(403);
      }
      if (role === 'staff') {
        await H.go(page, '/e/new'); await H.tap(page.getByRole('button', { name: /^Walk-in customer/i })); await H.tap(page.getByRole('button', { name: 'Not in the list? Add it' }));
        const d = page.getByRole('dialog', { name: "Add an item that isn't in the list" }); await afterDialog(page);
        await H.check(567, async () => { await expect(d.getByText('Used on this bill only. The owner adds products to the list.')).toBeVisible(); await expect(d.getByLabel('Also keep it in the item list')).toHaveCount(0); });
        await d.getByLabel('What is it called?').fill('Silver synthetic bichhiya'); await H.tap(d.getByRole('button', { name: 'Silver', exact: true })); await H.tap(d.getByRole('radio', { name: /^Jewellery/ })); await H.tap(d.getByRole('button', { name: 'Add to the bill' }));
        await H.check(575, () => expect(page.getByText('On this bill only · HSN 7113 · GST 3%')).toBeVisible());
        await H.check(576, async () => expect(errors).toEqual([]));
      }
      if (role === 'viewer') {
        await page.evaluate((id) => localStorage.removeItem(`gst3.easy.firm.${id}`), me.id);
        await H.go(page, '/e');
        await H.check(607, () => expect(page.getByRole('heading', { level: 1 })).toContainText(/Aarav/i));
      }
    });
  }
});
