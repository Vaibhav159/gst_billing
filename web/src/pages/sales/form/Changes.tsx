// "What changes", in the review of a change to a saved bill (PROTO pages/sales/BillForm.jsx:858-871): each change as
// before → after, exact to the paisa, and, when the customer has the old bill and its total changes, that the bill's page
// sends the corrected one (1B's saved panel offers it, one press after Save).
import { inr } from "@/core/format";
import { sentWhen } from "@/core/sales/words";
import type { BillFormApi } from "./useBillForm";

export function Changes({ F }: { F: BillFormApi }) {
  if (!F.edit) return null;
  const old = F.sentNote;
  const who = old ? (old.customer.type === "walkin" ? "the customer" : old.customer.name) : "";
  return (
    <div className="rounded-ctl border border-brand-line bg-brand-tint px-4 py-3 flex flex-col gap-2">
      <p className="caps" id="rv-changes">What changes</p>
      {F.changes.length ? (
        <ul className="flex flex-col gap-1" aria-labelledby="rv-changes">
          {/* keyed by place: two lines of one product share a change's name ("Gold Ring 22K weight") */}
          {F.changes.map(([k, a, b], i) => (
            <li key={i} className="text-sm">
              <span className="text-fg2">{k}:</span> <span className="line-through text-muted">{a}</span> <span aria-hidden="true">→</span><span className="sr-only">becomes</span> <span className="font-medium">{b}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-fg2">Nothing has changed yet. Go back and edit, or close this.</p>}
      {old?.sent ? (
        <p className="text-sm border-t border-brand-line pt-2">
          {`You sent ${who} this bill ${sentWhen(old.sent)}, with ${inr(old.total_amount)}. After saving, send the corrected one from the bill's page.`}
        </p>
      ) : null}
    </div>
  );
}
