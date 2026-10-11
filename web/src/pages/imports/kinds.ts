import type { Action } from '@/core/auth/permissions';
export type ImportKindOption = { value: string; label: string; permissions: Action[]; to: string };
/** Part 4 adds customers/products/firms here when their endpoints and row editors land (Ruling X-2). */
export const IMPORT_KINDS: ImportKindOption[] = [{ value: 'bills', label: 'Sales and purchase bills', permissions: ['bill.create', 'purchase.import'], to: '/import?type=purchases' }];
