import type { ReactNode } from 'react';
import type { PurchaseRead, PurchaseRef, ReadGroup } from '@/core/purchases/types';
import { PurchaseEditor } from './PurchaseEditor';
import { blankPurchase, fromRead } from './model';

export type PurchaseCaptureFormProps = {
  captureId: number;
  businessId: number | null;
  /** Accepted reading, already decoded through toPurchaseRead (money in paise). */
  read: PurchaseRead | null;
  confirmed: Partial<Record<ReadGroup, boolean>>;
  onConfirm: (group: ReadGroup) => void;
  disabled?: boolean;
  photo?: ReactNode;
  onFocusGroup?: (group: ReadGroup | 'buyer') => void;
  onSaved: (bill: PurchaseRef) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

/** The capture shell owns read acceptance; key by capture + accepted revision to replace the form.
 * Ordinary refreshes keep this instance, values and confirmations. This form owns the one leave guard.
 */
export function PurchaseCaptureForm({ captureId, businessId, read, onSaved, ...bindings }: PurchaseCaptureFormProps) {
  const business = businessId ?? read?.buyer.business ?? 0;
  return <PurchaseEditor initial={read ? fromRead(read, business) : blankPurchase(business)} read={read ?? undefined} capture={captureId}
    {...bindings} onSaved={p => onSaved({ id: p.id, invoice_number: p.invoice_number, invoice_date: p.invoice_date,
      supplier_name: p.supplier.name, total_amount: p.total_amount, business_name: p.business_name })} />;
}
