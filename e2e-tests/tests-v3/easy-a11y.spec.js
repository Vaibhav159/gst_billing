const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { measure } = require('./axe');
const { startsDrafts } = require('./bill-form-data');
const { makesBills, newBill } = require('./sales-data');
const H = require('./easy-acceptance-data');
startsDrafts(test);
makesBills(test);

// The 15 binding routes. Print intentionally uses part 1's Expert prototype, per 6-D29.
const ROUTES = [
  { route: '/e', app: () => '/e', prototype: '/e' },
  { route: '/e/new', app: () => '/e/new', prototype: '/e/new' },
  { route: '/e/new/items', app: (b, c) => `/e/new/items?customer=${c.id}`, prototype: '/e/new/items?customer=c-anil' },
  { route: '/e/new/customer', app: () => '/e/new/customer', prototype: '/e/customers/new?return=new', differences: '6-D7: the bill layout owns the /e/new/customer route.' },
  { route: '/e/saved/:id', app: (b) => `/e/saved/${b.id}`, prototype: '/e/saved/kgh-0033' },
  { route: '/e/bills', app: () => '/e/bills', prototype: '/e/bills' },
  { route: '/e/bill/:id', app: (b) => `/e/bill/${b.id}`, prototype: '/e/bill/kgh-0031' },
  { route: '/e/bill/:id/print', app: (b) => `/e/bill/${b.id}/print`, prototype: '/sales/kgh-0031/print', view: 'expert', differences: '6-D29 reuses part 1 PrintPage; bill figures come from the real fixture.' },
  { route: '/e/customers', app: () => '/e/customers', prototype: '/e/customers' },
  { route: '/e/customers/new', app: () => '/e/customers/new', prototype: '/e/customers/new' },
  { route: '/e/customers/:id/edit', app: (b, c) => `/e/customers/${c.id}/edit`, prototype: '/e/customers/c-anil/edit' },
  { route: '/e/capture', app: () => '/e/capture', prototype: '/e/capture' },
  { route: '/e/gst', app: () => '/e/gst', prototype: '/e/gst', differences: 'X-8: shared stage words; opening credit and badgstin show server words. No named CA account.' },
  { route: '/e/more', app: () => '/e/more', prototype: '/e/more', differences: 'X-9: Help names the earlier-day choice; bill rates include making.' },
  { route: '/e/profile', app: () => '/e/profile', prototype: '/e/profile', differences: 'X-14 and 4D: SMS is off; both returned tokens rotate on a password change.' },
];

async function targets(page) {
  return page.locator('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="checkbox"], [tabindex="0"]').evaluateAll((elements) => {
    const seen = new Set(); const small = [];
    for (const element of elements) {
      let target = element;
      if (element.matches('input[type="checkbox"], input[type="radio"], input[type="file"]')) {
        const label = element.closest('label') || [...document.querySelectorAll('label')].find((l) => l.htmlFor && l.htmlFor === element.id);
        if (label) target = label;
      }
      if (seen.has(target)) continue; seen.add(target);
      const style = getComputedStyle(target); const box = target.getBoundingClientRect();
      if (!box.width || !box.height || style.display === 'none' || style.visibility === 'hidden' || target.closest('[inert],[aria-hidden="true"]')) continue;
      if (box.width < 43.9 || box.height < 43.9) small.push({ name: target.getAttribute('aria-label') || target.textContent?.trim().slice(0, 100) || target.tagName, width: box.width, height: box.height });
    }
    return small;
  });
}
async function prototypeShot(browser, info, screen, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  try {
    // Local UMD files avoid CDN dependency and keep prototype capture reproducible.
    const v2 = path.resolve(__dirname, '../../sweet-rebuild-suite-main/node_modules');
    await context.route('https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js', (route) => route.fulfill({ path: path.join(v2, 'react/umd/react.production.min.js'), contentType: 'application/javascript' }));
    await context.route('https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js', (route) => route.fulfill({ path: path.join(v2, 'react-dom/umd/react-dom.production.min.js'), contentType: 'application/javascript' }));
    await context.addInitScript(({ screen, width, theme }) => {
      window.__PROTO_CAPTURE__ = { view: screen.view || 'easy', path: screen.prototype, role: 'owner', width, theme, height: 'auto', sim: screen.sim || 'normal' };
      localStorage.setItem('gstproto.introSeen', 'true');
      localStorage.setItem('gstproto.easy.welcomed.u-owner', 'true');
      localStorage.setItem('gstproto.textSize', '1');
    }, { screen: { view: screen.view, prototype: screen.prototype, sim: screen.sim }, width, theme });
    const page = await context.newPage();
    const file = process.env.EASY_PROTOTYPE_FILE || '/home/ubuntu/projects/gst-billing-sandbox/ui-prototype/dist/gst-billing-prototype.html';
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator(`[data-view="${screen.view || 'easy'}"]`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.getAnimations().every(animation =>
      animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
    const output = info.outputPath('prototype.png'); await page.screenshot({ path: output, fullPage: true }); return output;
  } finally { await context.close(); }
}

for (const width of [390, 320]) for (const theme of ['obsidian', 'pearl']) for (const screen of ROUTES) {
  test(`Easy visual ${screen.route} ${width} ${theme}: WCAG, targets and prototype pair`, async ({ page, request, browser }, info) => {
    test.skip(info.project.name !== 'phone', 'the phone project measures both requested widths');
    test.setTimeout(120_000);
    const s = await H.scenario(request); const c = await H.customer(s.api, s.firm); const b = await newBill(s.api, { firm: s.firm, customer: c });
    await page.setViewportSize({ width, height: 844 }); await H.easyStorage(page, s, { theme });
    await H.go(page, screen.app(b, c));
    await expect(page).toHaveURL((u) => u.pathname === screen.app(b, c).split('?')[0]);
    expect(await measure(page)).toEqual([]);
    expect(await targets(page), 'every phone target is at least 44×44').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const app = info.outputPath('app.png'); await page.screenshot({ path: app, fullPage: true });
    const prototype = await prototypeShot(browser, info, screen, width, theme);
    const result = { route: screen.route, state: 'base', width, theme, app, prototype, reviewed: false, differences: screen.differences || 'Seed names, dates, numbers and amounts differ; compare hierarchy, layout, spacing, tokens and accessible controls.' };
    const manifest = info.outputPath('shot.json'); await fs.writeFile(manifest, JSON.stringify(result, null, 2));
    await info.attach('Easy screenshot pair', { path: manifest, contentType: 'application/json' });
  });
}

const STATES = [
  {
    route: '/e/new/items', state: 'review', prototype: '/e/new/items?customer=c-anil&item=p-necklace&weight=1&rate=100000&pay=cash&show=check',
    differences: '6-D3/6-D4: no making field; the rate is typed from the paper bill; the check sentence names the paper number. Synthetic customer and line differ from prototype seed.',
    async prepare(page, s, c) {
      await H.chooseBuyer(page, c); await H.item(page); await H.fillLine(page, '1', '1000');
      await H.tap(page.getByRole('radio', { name: 'Cash', exact: true })); await H.review(page);
      await expect(page.getByRole('dialog', { name: 'Check the bill', exact: true })).toBeVisible();
    },
  },
  {
    route: '/e/customers', state: 'error', prototype: '/e/customers', sim: 'error',
    differences: 'Real-app customers transport returns a synthetic 503; the prototype uses its error simulation. Compare the in-place message, recovery control, layout and tokens.',
    async prepare(page) {
      await page.route((url) => url.pathname === '/api/customers/', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 503, json: { detail: 'Synthetic acceptance failure.' } });
      });
      await H.go(page, '/e/customers');
      await expect(page.getByRole('alert').filter({ hasText: /Couldn't load/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    },
  },
];
for (const width of [390, 320]) for (const theme of ['obsidian', 'pearl']) for (const screen of STATES) {
  test(`Easy visual ${screen.route} ${screen.state} ${width} ${theme}: WCAG, targets and prototype pair`, async ({ page, request, browser }, info) => {
    test.skip(info.project.name !== 'phone', 'the phone project measures both requested widths');
    test.setTimeout(120_000);
    const s = await H.scenario(request); const c = await H.customer(s.api, s.firm);
    await page.setViewportSize({ width, height: 844 }); await H.easyStorage(page, s, { theme });
    await screen.prepare(page, s, c);
    await expect(page).toHaveURL((url) => url.pathname === screen.route);
    expect(await measure(page)).toEqual([]);
    expect(await targets(page), 'every phone target is at least 44×44 in the visible state').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const app = info.outputPath('app.png'); await page.screenshot({ path: app, fullPage: true });
    const prototype = await prototypeShot(browser, info, screen, width, theme);
    const result = { route: screen.route, state: screen.state, width, theme, app, prototype, reviewed: false, differences: screen.differences };
    const manifest = info.outputPath('shot.json'); await fs.writeFile(manifest, JSON.stringify(result, null, 2));
    await info.attach('Easy screenshot pair', { path: manifest, contentType: 'application/json' });
  });
}

module.exports = { ROUTES, STATES };
