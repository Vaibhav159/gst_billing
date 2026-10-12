import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ShoppingBag } from 'lucide-react';
import { readStored, writeStored } from '@/core/storage';
import { useFirms, useScope } from '@/core/scope';
import { usePurchaseDetail } from '@/core/api/purchases';
import { useSupplierMemory } from '@/core/api/suppliers';
import { Page, QueryView, Banner, ButtonLink } from '@/core/ui';
import { PurchaseEditor } from './PurchaseEditor';
import { blankPurchase, fromPurchase, copyPurchase } from './model';

const idOf = (v: string | null | undefined) => v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null;
export default function PurchaseFormPage() {
  const { id } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate();
  const scope = useScope(); const { firms, loading } = useFirms();
  const editId = idOf(id); const fromId = idOf(params.get('from'));
  const source = usePurchaseDetail(editId ?? fromId);
  const memory = useSupplierMemory(fromId && source.data ? source.data.supplier.id : null, source.data?.business);
  const firm = idOf(params.get('firm')) ?? (typeof scope.firmId === 'number' ? scope.firmId : idOf(readStored('gst3.purchases.firm')) ?? 0);
  const knownFirm = firms.some(f => f.id === firm) ? firm : 0;
  const title = editId ? 'Edit purchase' : 'Add a purchase';
  const saved = (purchase: { id: number; business: number }) => { writeStored('gst3.purchases.firm', String(purchase.business)); navigate(`/purchases/${purchase.id}?saved=${editId ? 'edit' : 'new'}`, { replace: true }); };
  const render = () => {
    if (loading || scope.firmId === null) return <div aria-busy="true" className="card p-5">Loading the firms…</div>;
    if ((editId || fromId) && !source.data) return <Banner title="This purchase could not be opened"><ButtonLink to="/purchases">Back to purchases</ButtonLink></Banner>;
    if (fromId && memory.isPending) return <div aria-busy="true">Loading their next bill number…</div>;
    const initial = editId && source.data ? fromPurchase(source.data) : fromId && source.data ? copyPurchase(source.data, memory.data?.next_number ?? null)
      : { ...blankPurchase(knownFirm), supplier: idOf(params.get('supplier')) ?? 0, invoice_date: params.get('date') ?? '' };
    return <PurchaseEditor key={`${editId ?? 'new'}:${fromId ?? ''}`} initial={initial} original={editId ? source.data ?? undefined : undefined} onSaved={saved} />;
  };
  return <Page icon={ShoppingBag} title={title} phoneTitle={title} phoneSubtitle="A supplier's bill, typed by hand" breadcrumbs={[{ label: 'Purchases', to: '/purchases' }]} back="/purchases"
    context="Type a supplier's bill, or attach its photo and let it be read. On the counter phone, Capture is quicker." actions={<ButtonLink to="/purchases/capture">Capture a bill instead</ButtonLink>}>
    {editId || fromId ? <QueryView query={source} what="this purchase">{render}</QueryView> : render()}
  </Page>;
}
