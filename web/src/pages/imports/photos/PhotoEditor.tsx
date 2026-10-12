import { useEffect, useMemo, useState } from 'react';
import { useCustomerSearch, type Customer } from '@/core/api/customers';
import { useSupplier } from '@/core/api/suppliers';
import { problemOf } from '@/core/api/errors';
import { paiseToDecimal, todayIST, toPaise } from '@/core/format';
import { lineFigures } from '@/core/sales/maths';
import { toPurchaseRead } from '@/core/purchases/wire';
import type { PurchaseInput } from '@/core/purchases/types';
import { useDebounced } from '@/core/useDebounced';
import { Banner, Button, SearchInput } from '@/core/ui';
import { PurchaseEditor } from '@/pages/purchases/form/PurchaseEditor';
import { fromRead } from '@/pages/purchases/form/model';
import { BillEditor } from '../BillEditor';
import { checkBill, withEdits, type BillEdit, type ParsedBill } from '../model';
import type { Read } from '../batch';
import type { PhotoEditorProps } from './PhotoImport';
import { totalOf, type PhotoRow } from './model';

type ReviewedLine = { product_name: string; hsn_code: string; gst_percent: string; unit: string; quantity?: string; rate?: string; amount_only?: boolean; taxable?: string };
/** A printed rate follows its own read line by item name, never by position: deleted or moved lines keep theirs, new ones have none. */
export function readLines(lines: ReviewedLine[], read: Read): Read['lines'] {
  const used = new Set<number>(), nameOf = (name: string) => name.trim().toLowerCase();
  const printedFor = (name: string) => { const i = read.lines.findIndex((l, n) => !used.has(n) && nameOf(l.product_name) === nameOf(name)); if (i < 0) return ''; used.add(i); return read.lines[i].printed_rate ?? ''; };
  return lines.map((line) => ({ product_name: line.product_name, hsn_code: line.hsn_code, gst_percent: line.gst_percent, unit: line.unit,
    printed_rate: printedFor(line.product_name), amount_only: Boolean(line.amount_only), quantity: line.amount_only ? null : line.quantity ?? null, rate: line.amount_only ? null : line.rate ?? null,
    taxable: line.amount_only ? line.taxable ?? '0.00' : paiseToDecimal(lineFigures({ quantity: line.quantity ?? '', rate: line.rate ?? '', gst_percent: line.gst_percent }, false)?.taxable ?? 0) }));
}
function changedRow(row: PhotoRow, read: Read, patch: Partial<PhotoRow> = {}): PhotoRow {
  const next = { ...row, ...patch, read, problems: [], duplicate: null, credit: null };
  return { ...next, read: { ...read, lines_total: paiseToDecimal(totalOf(next)) } };
}
/** The decoded purchase editor is shared with typed bills; the import keeps the raw cached read. */
export function PhotoEditor(props: PhotoEditorProps) {
  if (!props.row.read) return <Banner title="Read this bill before editing it" />;
  return props.row.kind === 'purchase' ? <PurchasePhotoEditor {...props} /> : <OtherPhotoEditor {...props} />;
}
function PurchasePhotoEditor({ row, onApply, onClose }: PhotoEditorProps) {
  const read = row.read!;
  const decoded = useMemo(() => toPurchaseRead(read), [read]);
  const initial = useMemo(() => ({ ...fromRead(decoded, row.firmId ?? 0), supplier: row.partyId ?? decoded.supplier.id ?? 0,
    itc_eligible: row.itcEligible, itc_month: row.itcMonth, buyer_ack: row.buyerAck }), [decoded, row.firmId, row.partyId, row.itcEligible, row.itcMonth, row.buyerAck]);
  const [pending, setPending] = useState<PurchaseInput | null>(null);
  const supplier = useSupplier(pending?.supplier ?? null);
  useEffect(() => {
    if (!pending || !supplier.isSuccess || supplier.isFetching || supplier.data.supplier.id !== pending.supplier) return;
    const who = supplier.data.supplier;
    setPending(null);
    onApply(changedRow(row, { ...read, supplier: { id: who.id, name: who.name, gst_number: who.gst_number, state_code: who.state_code, city: who.city },
      buyer: { ...read.buyer, gst_number: pending.buyer_gstin }, invoice_number: pending.invoice_number, invoice_date: pending.invoice_date,
      payment_mode: pending.payment_mode, lines: readLines(pending.lines, read) }, { firmId: pending.business, partyId: who.id, partyResolved: true,
      buyerAck: pending.buyer_ack, itcEligible: pending.itc_eligible, itcMonth: pending.itc_month ?? null }));
  }, [pending, supplier.isSuccess, supplier.isFetching, supplier.data, onApply, row, read]);
  return <>
    {supplier.isError && pending ? <Banner tone="neg" title="The supplier couldn't be checked" actions={<Button onClick={() => void supplier.refetch()}>Try again</Button>}>{problemOf(supplier.error).message}</Banner> : null}
    {pending && !supplier.isError ? <p role="status">Checking the supplier…</p> : null}
    <fieldset disabled={Boolean(pending)} className="min-w-0 border-0 p-0 m-0">
      <PurchaseEditor key={row.id} initial={initial} read={decoded} onSaved={() => {}} onReview={body => { if (!pending) setPending(body); }} />
    </fieldset>
    <Button onClick={onClose}>Cancel</Button>
  </>;
}
function parsedPhoto(row: PhotoRow): ParsedBill {
  const read = row.read!, party = row.kind === 'sale' ? read.buyer : read.supplier;
  return { key: row.id, sheet: row.file.name, kind: row.kind === 'sale' ? 'sale' : 'purchase', number: read.invoice_number, date: read.invoice_date ?? '',
    party: party.name, gstin: party.gst_number, payment: read.payment_mode, rows: [], dates: new Set(read.invoice_date ? [read.invoice_date] : []), parties: new Set([party.name.trim().toLowerCase()]), payments: new Set(read.payment_mode ? [read.payment_mode] : []),
    lines: read.lines.map((line, i) => ({ n: i + 1, item: line.product_name, hsn: line.hsn_code, slab: line.gst_percent ?? '', slabShown: '', qty: line.amount_only ? '' : line.quantity ?? '',
      unit: line.unit, price: line.amount_only ? '' : line.rate ?? '', taxable: toPaise(line.taxable) ?? 0, cgst: 0, sgst: 0, igst: 0, total: 0 })) };
}
function OtherPhotoEditor({ row, onApply, onClose }: PhotoEditorProps) {
  const bill = useMemo(() => parsedPhoto(row), [row]);
  const [errors, setErrors] = useState<string[]>([]), [search, setSearch] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const term = useDebounced(search.trim()), query = useCustomerSearch(term, { figures: false, enabled: row.kind === 'sale' });
  const partySelection = useMemo(() => customer ? { party: customer.name, gstin: customer.gst_number } : undefined, [customer]);
  const apply = (edit: BillEdit) => {
    const changed = withEdits(bill, edit), identity = customer ? { name: customer.name, gst_number: customer.gst_number, id: customer.id } : { name: bill.party, gst_number: bill.gstin, id: row.partyId };
    const sameParty = changed.party === identity.name && changed.gstin === identity.gst_number;
    const partyId = sameParty ? identity.id : null;
    const checked = checkBill(changed, { firmId: row.kind === 'interfirm' ? row.buyerFirmId : row.firmId, today: todayIST(), partyId: partyId ?? undefined, canSale: true, canPurchase: true, requireQuantityRate: row.kind === 'interfirm' });
    setErrors(checked.problems.map(problem => problem.detail));
    if (checked.problems.length) return;
    const read = row.read!;
    onApply(changedRow(row, { ...read, invoice_number: changed.number.trim(), invoice_date: checked.invoiceDate!, payment_mode: checked.payment, lines: readLines(checked.lines, read),
      ...(row.kind === 'sale' ? { buyer: { ...read.buyer, name: changed.party, gst_number: changed.gstin } } : {}) },
      row.kind === 'sale' ? { partyId, partyResolved: sameParty ? Boolean(customer) || row.partyResolved : false } : {}));
  };
  return <>
    {row.kind === 'sale' ? <div className="flex flex-col gap-2"><SearchInput value={search} onChange={setSearch} label="Find a customer already on file" placeholder="Name, phone or GSTIN" />
      {query.isError ? <Banner tone="neg" title="The customers couldn't be checked">{problemOf(query.error).message}</Banner> : null}
      {query.data?.filter(person => person.type !== 'walkin').map(person => <Button key={person.id} onClick={() => setCustomer(person)}>Use {person.name}</Button>)}
    </div> : null}
    {errors.length ? <Banner tone="neg" title="Check these details"><ul>{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></Banner> : null}
    <BillEditor bill={bill} partySelection={partySelection} partyReadOnly={row.kind === 'interfirm'} onApply={apply} onUndo={() => onApply(row)} onClose={onClose} />
  </>;
}
export default PhotoEditor;
