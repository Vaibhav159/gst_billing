// Runs after 5A rates, 5B dashboard slots, and corrected 4C product mapper land.
const { expect } = require('@playwright/test');
const { opened, easyIfExpertSaved, savedToken } = require('./session');
const { client, afterDialog } = require('./sales-data');
const { startsDrafts, pickByKeyboard } = require('./bill-form-data');
const quoted = { 'gold-24K': '71040.00', 'gold-22K': '65125.00', 'gold-18K': '53280.00', 'silver-999': '78500.00', 'silver-925': '72610.00' };
let original = null;
let product = null;
function ratesScenario(test) {
startsDrafts(test);
test.beforeEach(async ({ request }, info) => {
  const api = client(request); original = (await api.get('rates/')).latest;
  // Fresh CI has no board; this normal POST establishes one there too.
  await api.post('rates/', { quoted });
  if (info.project.name === 'phone') await api.patch('preferences/', { phoneMode: 'expert' });
});
test.afterEach(async ({ request }, info) => {
  const api = client(request);
  try { if (product) await api.del(`catalog/${product.id}/`); }
  finally {
    product = null;
    try { if (original) await api.post('rates/', { quoted: original.quoted }); }
    finally { original = null; if (info.project.name === 'phone') await easyIfExpertSaved(request, savedToken()); }
  }
});
}
async function open(page, theme, path) {
  await page.addInitScript(t => localStorage.setItem('gst3.theme', t), theme);
  await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await opened(page);
}
async function pickProduct(page, phone, name) {
  if (phone) {
    await page.getByRole('button', { name: 'Add item', exact: true }).click(); await afterDialog(page);
    await page.getByRole('textbox', { name: 'Search products' }).fill(name);
    await page.getByRole('button', { name: new RegExp('^' + name) }).click();
  } else {
    await page.getByRole('combobox', { name: 'Line 1 product' }).fill(name); await pickByKeyboard(page, name);
  }
}
async function makeProduct(api) {
  product = await api.post('catalog/', { name: `Rates check ${Date.now()}`, hsn_code: '711319', gst_percent: '3', unit: 'gms', kind: 'gold', purity: '22K', usual_rate: null, purchase_only: false, description: '' });
  return product;
}
module.exports = { quoted, ratesScenario, open, pickProduct, makeProduct };
