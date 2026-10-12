import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RotateCcw, UserPlus } from 'lucide-react';
import { searchTerm, useWalkin, type Customer } from '@/core/api/customers';
import { useNetwork } from '@/core/api/network';
import { useAuth } from '@/core/auth/AuthProvider';
import { counterOf } from '@/core/sales/numbers';
import { Button } from '@/core/ui';
import { useDebounced } from '@/core/useDebounced';
import { hasContent } from '@/pages/sales/form/model';
import { useEasyBill } from './BillFlow';
import { EasyPage, FirmPill, LoadInside } from './parts';
import { useEasyCustomerSearch, useEasyRecentCustomers } from './queries';
import { maskPhone } from './state';
import { WhoIsBuying } from './WhoIsBuying';

/** This child consumes the one form mounted by 6B's BillFlow. The parent owns all leaving decisions. */
export function WhoRoute() {
  const { F } = useEasyBill();
  const { can, whyNot } = useAuth();
  const navigate = useNavigate(); const location = useLocation();
  const network = useNetwork();
  const [typed, setTyped] = useState('');
  const term = searchTerm(typed);
  const recent = useEasyRecentCustomers(F.f.firmId);
  const search = useEasyCustomerSearch(F.f.firmId, typed);
  // Registered after the hook's own debounce: never show the previous term's answer while typing.
  // This gates only presentation; the shared hook remains the sole request owner.
  const settled = useDebounced(term, 300);
  const walkin = useWalkin(F.f.firmId !== null);
  const canCreate = can('bill.create'); const canAdd = can('customer.edit') && canCreate;
  const q = typed.trim();
  const fresh = !F.f.customer && !F.f.lines.some(hasContent);
  const loading = fresh && ((recent.isPending && recent.data === undefined) || (walkin.isPending && walkin.data === undefined)) && network !== 'offline';
  const failed = recent.isError || walkin.isError || (Boolean(q) && search.isError);
  const failure = network === 'offline' ? "You're offline. These are the customers already on this phone; make the bill now and save it when the internet is back."
    : failed ? "The customer list can't be refreshed right now. Make the bill now; if it doesn't save, try again in a minute." : '';
  const searchNote = term.length < 2 ? 'Type at least 2 characters to search.'
    : settled !== term || search.isPending ? 'Searching…'
    : search.isError && search.data === undefined ? "The customer search couldn't load. Try again." : '';
  const pick = (customer: Customer) => {
    if (!canCreate) return;
    F.setCustomer(customer);
    navigate({ pathname: '/e/new/items', search: location.search });
  };
  const add = (text = '') => {
    if (canAdd) navigate({ pathname: '/e/new/customer', search: location.search }, { state: { typed: text } });
  };
  const origin = F.start.origin;
  return <EasyPage back title="New bill" subtitle={F.waitingForNext ? 'Getting the next number' : `Bill No. ${counterOf(F.numberText) ?? F.numberText}`} docTitle="New bill · who is buying"
    bar={canAdd ? <Button disabled={loading} variant="outline" size="xl" icon={UserPlus} full onClick={() => add()}>New customer</Button> : null}>
    <FirmPill firm={{ name: F.firmName }} />
    {origin?.kind === 'remake' && origin.reason === 'Wrong customer' ? <p className="flex items-start gap-2 text-md text-fg2"><RotateCcw size={18} className="text-brand shrink-0 mt-0.5" aria-hidden="true" />Making bill {counterOf(origin.number) ?? origin.number} again: pick the right customer. The items and payment are kept.</p> : null}
    {recent.isError && recent.data === undefined && !q ? <LoadInside load={recent} what="your customers" /> :
      <WhoIsBuying firmName={F.firmName} selected={F.f.customer} recent={recent.data ?? []}
        matches={q && settled === term && !searchNote ? search.data ?? null : null}
        typed={typed} searchNote={searchNote} loading={loading} failure={failure} walkin={walkin.data ?? null}
        maskPhone={maskPhone} canAdd={canAdd} canCreate={canCreate} whyCreate={whyNot('bill.create')}
        onType={setTyped} onPick={pick} onNew={add} />}
    {q && search.isError && search.data === undefined ? <LoadInside load={search} what="your customers" /> : null}
  </EasyPage>;
}
export default WhoRoute;
