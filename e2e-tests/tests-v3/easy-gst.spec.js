const { test, expect } = require('@playwright/test');
const { today } = require('./sales-data');
const { monthBefore } = require('./bill-form-data');
const H = require('./easy-acceptance-data');

const SHARE = 'Share these figures with your CA';
const heads = (cgst, sgst, total) => ({ igst: '0.00', cgst, sgst, total });
const zero = () => heads('0.00', '0.00', '0.00');
// Wire objects, not already parsed paise: 3C readGst and the real sales reader must convert them.
function monthWire(s, stage = 'ready') {
  const month = monthBefore(today());
  const current = today().slice(0, 7);
  const person = { id: s.me.id, name: 'Synthetic GST operator' };
  const filing = (kind, id) => ({ id, business: s.firm.id, month, kind, filed_on: today(), arn: `SYNTHETIC-${kind}`,
    cash: kind === 'gstr3b' ? heads('1060.00', '1060.00', '2120.00') : null,
    cash_worked_out: kind === 'gstr3b' ? heads('1060.00', '1060.00', '2120.00') : null,
    late_fee: null, interest: null, credit_left: kind === 'gstr3b' ? zero() : null,
    marked_by: person, marked_at: `${today()}T10:00:00+05:30`, updated_by: null, updated_at: null, legacy: false });
  const filed = stage === 'filed' || stage === 'unlocked';
  return { business: s.firm.id, firm: { id: s.firm.id, name: s.firm.name, short: 'Synthetic', gst_number: s.firm.gst_number, state_code: '08' },
    month, fy: H.fy(`${month}-01`), stage, running: null,
    due: { gstr1: `${current}-11`, gstr3b: `${current}-20`, file_from: `${current}-01` },
    record: { gstr1: filed ? filing('gstr1', 910001) : null, gstr1a: null, gstr3b: filed ? filing('gstr3b', 910002) : null,
      legacy: false, unlocked: stage === 'unlocked' ? { at: `${today()}T11:00:00+05:30`, by: person, reason: 'Synthetic correction' } : null,
      relocked: null, locked_by: stage === 'filed' ? person : null, locked_on: stage === 'filed' ? today() : null },
    late: null, checks: { blockers: [], notes: [], passes: [] }, gstr1: null,
    gstr3b: { output: heads('5189.38', '5189.38', '10378.76'), credit: heads('4129.38', '4129.38', '8258.76'),
      carry_in: zero(), cash: heads('1060.00', '1060.00', '2120.00'), carry_on: zero(), used: heads('4129.38', '4129.38', '8258.76'),
      amendments_in: [], late_bills: 0, to_confirm: 0, opening_missing: false, filed },
    since_filing: null, amendments: null, amended_in: null, download: null, prev_gstr3b_missing: null };
}
function salesWire(s) {
  return { count: 1, next: null, previous: null, results: [{ id: 920001, business: s.firm.id, business_name: s.firm.name,
    invoice_number: `SYN/${H.fy()}/1`, counter: 1, fy: H.fy(), invoice_date: today(), created_at: `${today()}T10:00:00+05:30`, paper: false,
    customer: { id: 920002, name: 'Synthetic GST buyer', gst_number: '', mobile_number: '', type: 'person' }, payment_mode: 'cash',
    taxable: '10703.00', cgst: '160.55', sgst: '160.54', igst: '0.00', tax: '321.09', total_amount: '11024.09',
    interstate: false, gst_percents: ['3'], line_count: 1, status: 'active', cancel_reason: '', sent: null, checks: [], itax: [], locked: false }],
    summary: { of: 'active', bills: 1, taxable: '10703.00', cgst: '160.55', sgst: '160.54', igst: '0.00', tax: '321.09', total_amount: '11024.09', average: null, cancelled: 0 } };
}
async function fixture(page, request, { stage = 'ready', held = false } = {}) {
  const s = await H.scenario(request);
  await H.easyStorage(page, s);
  const payload = monthWire(s, stage);
  const state = { payload, mode: 'ok', reads: [], writes: [] };
  let release;
  const gate = held ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  state.release = () => { if (release) { release(); release = null; } };
  await page.route('**/api/gst/month/**', async route => {
    const req = route.request(); const url = new URL(req.url());
    expect(req.method()).toBe('GET');
    expect(url.searchParams.get('business_id')).toBe(String(s.firm.id));
    expect(url.searchParams.get('month')).toBe(payload.month);
    state.reads.push(url.pathname + url.search);
    await gate;
    if (state.mode === 'offline') return route.abort('internetdisconnected');
    if (state.mode === 'reject') return route.fulfill({ status: 400, json: { detail: 'The synthetic GST month was refused. Try again.' } });
    return route.fulfill({ status: 200, json: state.payload });
  });
  await page.route('**/api/sales/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/sales/' || url.searchParams.get('month') !== today().slice(0, 7)) return route.continue();
    expect(route.request().method()).toBe('GET');
    expect(url.searchParams.get('business_id')).toBe(String(s.firm.id));
    return route.fulfill({ status: 200, json: salesWire(s) });
  });
  page.on('request', req => { if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/api/')) state.writes.push(`${req.method()} ${new URL(req.url()).pathname}`); });
  return { s, state };
}
async function ready(page) {
  await H.go(page, '/e/gst');
  await expect(page.getByRole('button', { name: SHARE })).toBeVisible();
  await expect(page.locator('main')).toContainText('₹321.09');
  await expect(page.locator('main')).toContainText('₹10,378.76');
  await expect(page.locator('main')).toContainText('₹2,120.00');
}
function returnBox(page) { return page.locator('section[aria-labelledby="easy-ret-t"]'); }
async function noShareClaim(page) {
  await expect(H.toast(page)).not.toContainText('Figures shared with your CA');
  await expect(page.getByRole('button', { name: SHARE })).not.toHaveAttribute('aria-busy', 'true');
}

test.describe('Easy GST wrapper browser boundaries', () => {
  test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'phone', 'The Easy wrapper is a phone route'); });

  test('Easy GST wrapper: native cancellation makes no success claim or fallback', { tag: "@sandbox" }, async ({ page, request }) => {
    const { state } = await fixture(page, request); await ready(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async value => { window.__easyShares.push(value); throw new DOMException('Cancelled', 'AbortError'); } }));
    await H.tap(page.getByRole('button', { name: SHARE }));
    await expect.poll(() => page.evaluate(() => window.__easyShares.length)).toBe(1);
    await noShareClaim(page);
    await expect(H.toast(page)).not.toContainText("Figures weren't shared");
    expect(await page.evaluate(() => window.__easyOpened)).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  test('Easy GST wrapper: native rejection is explained and the next share can succeed', { tag: "@sandbox" }, async ({ page, request }) => {
    const { state } = await fixture(page, request); await ready(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new Error('Synthetic native refusal'); } }));
    await H.tap(page.getByRole('button', { name: SHARE }));
    await expect(H.toast(page)).toContainText("Figures weren't shared");
    await expect(H.toast(page)).toContainText("The share sheet couldn't open. Try again.");
    await noShareClaim(page);
    expect(await page.evaluate(() => window.__easyOpened)).toEqual([]);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async value => { window.__easyShares.push(value); } }));
    await H.tap(page.getByRole('button', { name: SHARE }));
    await expect(H.toast(page)).toContainText('Figures shared with your CA');
    expect(state.writes).toEqual([]);
  });

  test('Easy GST wrapper: unsupported phone opens WhatsApp without a recipient or success claim', { tag: "@sandbox" }, async ({ page, request }) => {
    const { s, state } = await fixture(page, request); await ready(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
    await H.tap(page.getByRole('button', { name: SHARE }));
    const opened = await page.evaluate(() => window.__easyOpened);
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.origin).toBe('https://wa.me'); expect(url.pathname).toBe('/');
    expect(url.searchParams.get('text')).toContain(s.firm.name);
    expect(url.searchParams.get('text')).toContain('₹321.09');
    expect(url.searchParams.get('text')).toContain(H.date(state.payload.due.gstr1));
    await noShareClaim(page);
    expect(await page.evaluate(() => window.__easyShares)).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  test('Easy GST wrapper: loading retains skeletons and withholds figures and sharing', { tag: "@sandbox" }, async ({ page, request }) => {
    const { state } = await fixture(page, request, { held: true });
    try {
      await H.go(page, '/e/gst');
      await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
      await expect(page.getByRole('button', { name: SHARE })).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('₹0.00');
      await expect(page.locator('main')).not.toContainText('₹10,378.76');
    } finally { state.release(); }
    await expect(page.getByRole('button', { name: SHARE })).toBeVisible();
    await expect(page.locator('main')).toContainText('₹10,378.76');
  });

  test('Easy GST wrapper: offline return read says what is unavailable without invented totals', { tag: "@sandbox" }, async ({ page, request, context }) => {
    const { state } = await fixture(page, request, { held: true });
    try {
      await H.go(page, '/e/gst');
      await expect.poll(() => state.reads.length).toBeGreaterThan(0);
      await context.setOffline(true); state.mode = 'offline'; state.release();
      await expect(page.getByText("You're offline", { exact: true }).last()).toBeVisible();
      await expect(page.getByText(/Last month's return can't load without the internet/)).toBeVisible();
      await expect(page.getByRole('button', { name: SHARE })).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('₹0.00');
    } finally { state.mode = 'ok'; state.release(); await context.setOffline(false); }
  });

  test('Easy GST wrapper: a refused return preserves server words and recovers on Try again', { tag: "@sandbox" }, async ({ page, request }) => {
    const { state } = await fixture(page, request); state.mode = 'reject';
    await H.go(page, '/e/gst');
    await expect(page.getByText('The synthetic GST month was refused. Try again.')).toBeVisible();
    await expect(page.getByRole('button', { name: SHARE })).toHaveCount(0);
    const before = state.reads.length;
    state.mode = 'ok'; await H.tap(page.getByRole('button', { name: 'Try again', exact: true }));
    await expect(page.getByRole('button', { name: SHARE })).toBeVisible();
    expect(state.reads.length).toBeGreaterThan(before);
    await expect(page.locator('main')).toContainText('₹10,378.76');
  });

  test('Easy GST wrapper: filed return shows both recorded filing dates', { tag: "@sandbox" }, async ({ page, request }) => {
    await fixture(page, request, { stage: 'filed' }); await ready(page);
    await expect(page.getByTestId('easy-gst-stage')).toHaveText('Filed');
    await expect(returnBox(page).getByText(`Filed ${H.date(today())}`, { exact: true })).toHaveCount(2);
    await expect(returnBox(page)).not.toContainText('Filed before the app kept filing records');
    await expect(returnBox(page)).not.toContainText("can't file");
  });

  test('Easy GST wrapper: legacy filed return never invents filing dates', { tag: "@sandbox" }, async ({ page, request }) => {
    const { state } = await fixture(page, request, { stage: 'filed' });
    state.payload.record = { ...state.payload.record, legacy: true, gstr1: null, gstr3b: null };
    await ready(page);
    await expect(page.getByTestId('easy-gst-stage')).toHaveText('Filed');
    await expect(returnBox(page).getByText('Filed before the app kept filing records', { exact: true })).toHaveCount(2);
    await expect(returnBox(page).getByText(`Filed ${H.date(today())}`, { exact: true })).toHaveCount(0);
    await expect(returnBox(page).getByText(/^Due /)).toHaveCount(0);
  });

  test('Easy GST wrapper: unlocked corrections keep filed history and use the shared stage', { tag: "@sandbox" }, async ({ page, request }) => {
    const { s, state } = await fixture(page, request, { stage: 'unlocked' });
    state.payload.checks.blockers = [{ kind: 'hsn', blocks: true, text: 'A synthetic item has no HSN code.', detail: '',
      bills: [{ id: 920001, invoice_number: `SYN/${H.fy()}/1`, invoice_date: `${state.payload.month}-09`, customer_name: 'Synthetic GST buyer', status: 'active', total_amount: '11024.09' }],
      more_bills: 0, customer: null, suggested: null }];
    await ready(page);
    await expect(page.getByTestId('easy-gst-stage')).toHaveText('Unlocked');
    await expect(returnBox(page).getByText(`Filed ${H.date(today())}`, { exact: true })).toHaveCount(2);
    const canEdit = s.me.permissions === '*' || s.me.permissions?.includes('bill.edit');
    await expect(returnBox(page)).toContainText(canEdit ? 'These checks are for the books now. Review the correction in the full view.' : 'The filed record stays as it was.');
    await expect(returnBox(page)).not.toContainText("can't file");
    await expect(page.locator('a[href="/e/bill/920001"]')).toContainText('Synthetic GST buyer');
  });
});

// /e is deliberately unavailable on desktop. The phone fallback is exercised through its button above.
test('Easy GST desktop boundary: redirect Easy without sharing', { tag: "@sandbox" }, async ({ page, request }, info) => {
  test.skip(info.project.name !== 'phone', 'The phone acceptance project also measures the desktop boundary');
  await page.setViewportSize({ width: 1280, height: 900 });
  const { state } = await fixture(page, request);
  await page.goto('/e/gst');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: SHARE })).toHaveCount(0);
  expect(await page.evaluate(() => window.__easyOpened)).toEqual([]);
  expect(await page.evaluate(() => window.__easyShares)).toEqual([]);
  expect(state.writes).toEqual([]);
});
