const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

function listed(ci) {
  const env = { ...process.env };
  if (ci) env.CI = 'true'; else delete env.CI;
  const report = JSON.parse(execFileSync(process.execPath, [require.resolve('@playwright/test/cli'),
    'test', '-c', 'v3.config.js', '--list', '--reporter=json'], {
    cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }));
  const specs = [];
  function walk(suites) {
    for (const suite of suites) {
      specs.push(...(suite.specs || []));
      walk(suite.suites || []);
    }
  }
  walk(report.suites);
  return specs;
}

test('CI keeps real billing, purchase, GST and accessibility coverage without sandbox or long acceptance cases', () => {
  const specs = listed(true);
  for (const title of [
    'desktop: a counter bill by keyboard alone, from the customer box to Save',
    'typed purchase saves exact tax, edits, and adds another from the same supplier',
    'nil return files in stages, keeps portal carry, unlocks, relocks and removes only its own records',
    'Easy: both themes at 320 and 390 px keep Step 1, items and review accessible',
  ]) assert.ok(specs.some(s => s.title === title), `Missing CI coverage: ${title}`);
  assert.ok(specs.every(s => !(s.tags || []).some(tag => ['sandbox', 'acceptance'].includes(tag))));
  assert.ok(!specs.some(s => /one financial year at a time|three idle minutes|180 seconds|GST visibility and server permissions/.test(s.title)));
  assert.ok(specs.length < 100, 'Keep the one-worker CI subset within its measured 25-minute budget');
});

test('sandbox acceptance still collects the seeded, four-role and long-running tests', () => {
  const specs = listed(false);
  for (const title of [
    'GST figures, portal sections and WCAG 2.2 AA in both themes',
    'owner: GST visibility and server permissions agree',
    'owner: Everyday actions follow the role and the bill stays readable',
    'a typed late bill saves into the earliest open credit month',
  ]) {
    const spec = specs.find(s => s.title === title);
    assert.ok(spec, `Missing acceptance coverage: ${title}`);
    assert.ok(spec.tags.includes('sandbox'), `Sandbox prerequisite must be explicit: ${title}`);
  }
  assert.ok(specs.some(s => s.title.includes('one financial year at a time') && s.tags.includes('acceptance')));
});
