import { test } from 'node:test';
import assert from 'node:assert/strict';
import salesData from '../tests-v3/sales-data.js';

for (const [today, locked, expected, months] of [
  ['2026-10-12', [], '2026-10-11', ['2026-10']],
  ['2026-10-01', ['2026-09'], '2026-08-31', ['2026-09', '2026-08']],
  ['2026-10-12', ['2026-10', '2026-09'], '2026-08-31', ['2026-10', '2026-09', '2026-08']],
  ['2026-01-01', ['2025-12'], '2025-11-30', ['2025-12', '2025-11']],
  ['2026-04-01', ['2026-03'], '2026-02-28', ['2026-03', '2026-02']],
  ['2024-03-01', [], '2024-02-29', ['2024-02']],
]) {
  test(`latest open paper day for ${today} with ${locked.length} locked months`, async () => {
    const calls = [];
    const open = { locked: false, next: { counter: 31 } };
    const api = { get: async (path, params) => {
      assert.equal(path, 'sales/paper-book/');
      assert.equal(params.business_id, 3);
      calls.push(params.month);
      return locked.includes(params.month) ? { locked: true } : open;
    } };
    const result = await salesData.latestOpenPaperDay(api, 3, today);
    assert.equal(result.day, expected);
    assert.equal(result.book, open);
    assert.deepEqual(calls, months);
  });
}

test('all eligible earlier months locked fails instead of skipping or using an older FY', async () => {
  const months = [];
  const api = { get: async (_path, params) => { months.push(params.month); return { locked: true }; } };
  await assert.rejects(() => salesData.latestOpenPaperDay(api, 3, '2026-04-01'), /No open paper day before 2026-04-01 in the current or previous financial year/);
  assert.equal(months.length, 12);
  assert.equal(months[0], '2026-03');
  assert.equal(months.at(-1), '2025-04');
});
