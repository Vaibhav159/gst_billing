import { useNavigate, useParams } from 'react-router';
import { SearchX } from 'lucide-react';
import { useBillDetail } from '@/core/api/sales';
import { problemOf } from '@/core/api/errors';
import { useAuth } from '@/core/auth/AuthProvider';
import { ButtonLink, EmptyState, QueryView, useDocTitle } from '@/core/ui';
import { idParam } from '@/pages/sales/form/model';
import { CancelBill, MakeAgain, PaperBill, PrintButton, SendBig, SendTo } from './parts';
import { paidWords } from './state';
import { SavedBody } from './Saved';

function Missing({ deleted = false }: { deleted?: boolean }) {
  return <div className="min-h-full grid place-items-center px-4"><EmptyState icon={SearchX}
    title={<span role="heading" aria-level={1} data-page-title="" tabIndex={-1} className="outline-none">{deleted ? 'This bill was deleted' : "We can't find this bill"}</span>}
    actions={<ButtonLink to="/e/bills" variant="primary" size="lg">Go to Bills</ButtonLink>}>
    {deleted ? "It's in the Audit log, where the owner can restore it." : 'It may have been made on another phone. Bills shows every bill of this firm.'}
  </EmptyState></div>;
}
/** Reads the canonical detail cache populated by saving; every action is 6B's shared part. */
export function SavedRoute() {
  const { id: raw } = useParams();
  const id = idParam(raw ?? null);
  const query = useBillDetail(id);
  const navigate = useNavigate(); const { can } = useAuth();
  const bill = query.data;
  useDocTitle(bill ? `Bill ${bill.counter ?? bill.invoice_number} ${bill.status === 'cancelled' ? 'cancelled' : 'saved'}` : 'Bill not found');
  if (id === null || query.isError && problemOf(query.error).kind === 'notfound') return <Missing />;
  return <QueryView query={query} what="the saved bill">{saved => saved ?
    <SavedBody bill={saved} paymentWords={paidWords(saved.payment_mode)} canCreate={can('bill.create')} canSend={can('bill.send')}
      onNew={() => { if (can('bill.create')) navigate('/e/new'); }}
      paper={<PaperBill bill={saved} />} sendTo={<SendTo bill={saved} />} send={<SendBig bill={saved} />}
      print={<PrintButton bill={saved} />} cancel={<CancelBill bill={saved} />} again={<MakeAgain bill={saved} />} />
    : <Missing deleted />}</QueryView>;
}
export default SavedRoute;
