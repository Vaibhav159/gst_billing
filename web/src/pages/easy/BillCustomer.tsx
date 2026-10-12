import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import type { Customer } from '@/core/api/customers';
import { firmListQuery } from '@/core/api/firms';
import { looksLikePhone } from '@/core/ids';
import { counterOf } from '@/core/sales/numbers';
import { ButtonLink, EmptyState, QueryView } from '@/core/ui';
import { useEasyBill } from './BillFlow';
import { CustomerForm } from './CustomerForm';
import type { CustomerFrameProps } from './CustomerParts';
import { EasyPage } from './parts';
import type { BillView } from './NewBill';

export type BillCustomerProps = { typed: string; onDirty: (dirty: boolean) => void };
// Normalize the shared customer frame’s optional Back flag at this page boundary.
function Frame({ back, ...props }: CustomerFrameProps) { return <EasyPage {...props} back={back ? true : undefined} />; }

/** The shell passes location.state.typed and its one leave guard's stable dirty setter. */
export function BillCustomer({ typed, onDirty }: BillCustomerProps) {
  const { F } = useEasyBill();
  const navigate = useNavigate(); const location = useLocation();
  const query = useQuery(firmListQuery());
  const firms = (query.data ?? []).map(f => ({ id: f.id, name: f.name, short: f.short, gstin: f.gst_number, state: f.state_name, city: f.city }));
  const firm = firms.find(f => f.id === F.f.firmId);
  const setCustomer = F.setCustomer;
  const saved = useCallback((customer: Customer) => {
    setCustomer(customer);
    navigate({ pathname: '/e/new/items', search: location.search }, { replace: true });
  }, [setCustomer, navigate, location.search]);
  if (!firm) return <EasyPage back title="New customer"><QueryView query={query} what="the firms">{() =>
    <EmptyState title="Choose a firm first" actions={<ButtonLink to="/e/more" variant="primary" size="lg">Go to More</ButtonLink>}>Choose the firm this phone bills for in More.</EmptyState>
  }</QueryView></EasyPage>;
  const phone = looksLikePhone(typed);
  return <CustomerForm key={firm.id} Frame={Frame} firm={firm} firms={firms} forBill guard={false} onDirty={onDirty}
    initialName={phone ? '' : typed} initialPhone={phone ? typed : ''}
    subtitle={`For bill ${counterOf(F.numberText) ?? F.numberText} · ${firm.short}`} onSaved={saved} />;
}
export default BillCustomer;

export function BillCustomerRoute() {
  const { onCustomerDirty } = useOutletContext<BillView>();
  const location = useLocation();
  const typed = (location.state as { typed?: string } | null)?.typed ?? '';
  return <BillCustomer typed={typed} onDirty={onCustomerDirty} />;
}
