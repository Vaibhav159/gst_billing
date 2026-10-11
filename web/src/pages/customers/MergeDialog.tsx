import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowRight, GitMerge } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useCustomer, type Customer } from "@/core/api/customers";
import { useMergeCandidates, useMergeCustomer, useMergePreview } from "@/core/api/customerMerge";
import { problemOf } from "@/core/api/errors";
import { cn } from "@/core/cn";
import { plural } from "@/core/format";
import { mobileDigits, stateLabel } from "@/core/ids";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { Badge, Banner, Button, Checkbox, Dialog, FailNote, QueryView, SearchInput, useToast } from "@/core/ui";
import { markSaved } from "./lib";

type Props = { source: Customer; initialTarget?: number; onClose: () => void };
export function MergeDialog(props: Props) {
  const { can } = useAuth();
  return can("customer.merge") && props.source.type !== "walkin" ? <MergeContent {...props} /> : null;
}
function MergeContent({ source, initialTarget, onClose }: Props) {
  const navigate = useNavigate();
  const { show } = useToast();
  const { isPhone } = useView();
  const [q, setQ] = useState("");
  const term = useDebounced(q);
  const candidates = useMergeCandidates(term);
  const suggested = useCustomer(initialTarget ?? null);
  const [target, setTarget] = useState<Customer | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pv = useMergePreview(source.id, target?.id ?? null);
  const merge = useMergeCustomer();
  const running = useRef(false);
  const busy = merge.isPending;
  const rows = [...(!q && suggested.data ? [suggested.data] : []), ...(candidates.data ?? [])]
    .filter((c, i, all) => c.id !== source.id && c.type !== "walkin" && all.findIndex(x => x.id === c.id) === i).slice(0, 8);
  const ready = Boolean(target && pv.isSuccess && !pv.isFetching && pv.data?.can_merge && ack);
  const go = async () => {
    if (!ready || !target || running.current) return;
    running.current = true; setError(null);
    try {
      const result = await merge.mutateAsync({ source: source.id, target: target.id });
      markSaved("customer", result.target);
      show({ title: `${source.name} merged into ${target.name}`, body: `${plural(result.moved.bills, "bill")} now show under ${target.name}. Recorded in the Audit log.` });
      onClose(); navigate(`/customers/${result.target}`, { replace: true });
    } catch (e) {
      setError(problemOf(e).message); setAck(false); void pv.refetch();
    } finally { running.current = false; }
  };
  const why = (c: Customer) => c.gst_number && c.gst_number === source.gst_number ? "Same GSTIN"
    : mobileDigits(c.mobile_number) && mobileDigits(c.mobile_number) === mobileDigits(source.mobile_number) ? "Same phone"
      : c.id === initialTarget ? "From the warning" : "";
  return <Dialog open onClose={() => { if (!running.current) onClose(); }} size="lg" title={`Merge ${source.name} into another customer`}
    description={`${source.name} is removed; its bills move to the customer you keep.`}
    footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon={GitMerge} disabled={!ready} loading={busy} onClick={() => void go()}>{busy ? "Merging…" : target ? `Merge into ${target.name}` : "Merge"}</Button></>}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p id="merge-pick" className="text-sm font-medium text-fg2">Keep this customer</p>
        <SearchInput value={q} onChange={setQ} placeholder="Name, phone or GSTIN" label="Find the customer to keep" />
        <QueryView query={candidates} what="customers to keep">{() => q !== term ? <p role="status">Searching…</p> :
          <div role="radiogroup" aria-labelledby="merge-pick" className="flex flex-col rounded-ctl border border-line divide-y divide-rule max-h-[260px] overflow-y-auto">
            {rows.length ? rows.map(c => <label key={c.id} className={cn("flex items-center gap-3 px-3.5 text-left transition-colors", isPhone ? "min-h-14 py-2" : "min-h-12 py-2", target?.id === c.id ? "bg-brand-sel" : "hover:bg-raised")}>
              <input type="radio" name="merge-target" checked={target?.id === c.id} aria-checked={target?.id === c.id} disabled={busy} onChange={() => { setTarget(c); setAck(false); setError(null); }} />
              <span className="flex-1 min-w-0"><span className="block font-medium truncate">{c.name}</span><span className="block text-sm text-muted truncate">{[c.mobile_number || "No phone", c.gst_number].filter(Boolean).join(" · ")}</span></span>
              {why(c) ? <Badge tone="brand">{why(c)}</Badge> : null}
            </label>) : <p className="px-4 py-6 text-center text-muted">No customer matches “{q}”.</p>}
          </div>}
        </QueryView>
      </div>
      {target ? <QueryView query={pv} what="what the merge changes">{p => <div key={target.id} className="flex flex-col gap-3 anim-rise">
        <div className={cn("grid gap-2 items-stretch", isPhone ? "grid-cols-1" : "grid-cols-[1fr_auto_1fr]")}>
          <div className="rounded-ctl border border-neg-line bg-neg-tint/40 px-3.5 py-2.5"><p className="caps">Removed</p><p className="font-medium mt-0.5">{p.source.name}</p><p className="text-sm text-muted">{[p.source.mobile_number || "No phone", p.source.gst_number || "No GSTIN", stateLabel(p.source.state_name)].join(" · ")}</p></div>
          {!isPhone ? <span className="self-center text-muted"><ArrowRight size={18} aria-hidden="true" /></span> : null}
          <div className="rounded-ctl border border-sale-line bg-sale-tint/40 px-3.5 py-2.5"><p className="caps">Kept</p><p className="font-medium mt-0.5">{p.target.name}</p><p className="text-sm text-muted">{[p.target.mobile_number || "No phone", p.target.gst_number || "No GSTIN", stateLabel(p.target.state_name)].join(" · ")}</p></div>
        </div>
        {!p.can_merge ? <Banner tone="neg" icon={AlertTriangle} title="Can't merge">{p.refusal?.detail}</Banner> : <>
          <ul className="flex flex-col gap-1.5 text-fg2">
            <li>{plural(p.bills.count, "sales bill")} move to {p.target.name}{p.bills.cancelled ? ` (and ${plural(p.bills.cancelled, "cancelled bill")})` : ""}: {p.bills.numbers.join(", ")}.</li>
            {p.purchases ? <li>{plural(p.purchases, "purchase bill")} move too.</li> : null}
            {p.bin ? <li>{plural(p.bin, "deleted bill")} in the bin move too.</li> : null}
            {p.drafts ? <li>{plural(p.drafts, "unfinished bill")} move too.</li> : null}
            {p.changes.map(x => <li key={x.bill.id}>{x.bill.invoice_number}: {x.words}</li>)}
            {p.firms_added.length ? <li>{p.firms_added.map(f => f.short).join(", ")} can bill {p.target.name} from now on.</li> : null}
            <li>{p.keeps}</li>
          </ul>
          <Checkbox label={`I understand ${source.name} will be removed, and this can't be undone from the Audit log.`} checked={ack} onChange={setAck} disabled={busy} />
        </>}
      </div>}</QueryView> : null}
      <FailNote error={error ? { title: "Not merged", body: error } : null} />
    </div>
  </Dialog>;
}
