import type { Action } from '@/core/auth/permissions';
import { RECORD_IMPORT_OPTIONS } from '@/pages/records/RecordsImport';
export type ImportKindOption = { value: string; label: string; permissions: Action[]; to: string };
const RECORD_PERMISSION = { customers: 'customer.edit', products: 'product.edit', firms: 'firm.edit' } as const;
/** Part 2 owns /import; part 4 adds its three CRUD-backed row editors (Ruling X-2). */
export const IMPORT_KINDS: ImportKindOption[] = [
  { value: 'bills', label: 'Sales and purchase bills', permissions: ['bill.create', 'purchase.import'], to: '/import?type=purchases' },
  ...RECORD_IMPORT_OPTIONS.map(({ value, label }) => ({ value, label, permissions: [RECORD_PERMISSION[value]], to: `/import?type=${value}` })),
];
