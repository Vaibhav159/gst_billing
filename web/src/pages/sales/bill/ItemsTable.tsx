import { cn } from "@/core/cn";
import { qty } from "@/core/format";
import type { Line } from "@/core/sales/types";
import { rateText } from "@/core/sales/words";
import { Money, Table, Td, Th, Tr } from "@/core/ui";
import { useBoxWidth } from "@/core/useBoxWidth";

/** A line as the table shows it: a saved bill's line, or the bill form's while it's reviewed (plan 1D). */
export type ItemLine = Pick<Line, "product_name" | "hsn_code" | "quantity" | "unit" | "rate" | "gst_percent" | "taxable" | "tax" | "note"> & { id?: number | string };

/** One line: the item (and its note), HSN, weight or quantity, the rate as written, the value before GST, and its GST. */
export function ItemRow({ line: l, igst, compact }: { line: ItemLine; igst: boolean; compact: boolean }) {
  return (
    <Tr>
      <Td>
        <span className="font-medium">{l.product_name}</span>
        {compact ? <span className={cn("block text-xs tnum", l.hsn_code ? "text-muted" : "text-neg")}>{l.hsn_code ? `HSN ${l.hsn_code}` : "HSN missing"}</span> : null}
        {l.note ? <span className="block text-xs text-muted">{l.note}</span> : null}
      </Td>
      {compact ? null : <Td className={cn("tnum", l.hsn_code ? "text-fg2" : "text-neg")}>{l.hsn_code || "Missing"}</Td>}
      <Td align="right" className="whitespace-nowrap">{qty(Number(l.quantity), l.unit)}</Td>
      <Td align="right" className="whitespace-nowrap">{rateText(l.rate)}<span className="text-muted text-xs"> /{l.unit}</span></Td>
      <Td align="right"><Money value={l.taxable} strong /></Td>
      <Td align="right"><Money value={l.tax} /><span className="block text-xs text-muted whitespace-nowrap">{igst ? `IGST ${l.gst_percent}%` : compact ? `${l.gst_percent}%` : `${l.gst_percent}% · CGST+SGST`}</span></Td>
    </Tr>
  );
}

/**
 * A bill's items (PROTO sales/parts.jsx:644-676), without the prototype's Making column: making is inside the rate
 * (design §2). Narrow places put the HSN under the item, so nothing scrolls sideways; the box's width comes from
 * useBoxWidth (@/core/useBoxWidth, Ruling 1E-3), wide until it's measured. The heads are the ones stored.
 */
export function ItemsTable({ bill, label = "Items on this bill" }: { bill: { lines: ItemLine[]; igst: number; cgst: number; sgst: number; interstate: boolean }; label?: string }) {
  const igst = bill.igst > 0 || (bill.interstate && !(bill.cgst + bill.sgst));
  const [box, w] = useBoxWidth();
  const compact = w < 800;
  return (
    <div ref={box}>
      <Table label={label}>
        <thead>
          <tr><Th className={compact ? "" : "min-w-[180px]"}>Item</Th>{compact ? null : <Th>HSN</Th>}<Th align="right">Weight or qty</Th><Th align="right">Rate</Th><Th align="right">Before GST</Th><Th align="right">GST</Th></tr>
        </thead>
        <tbody>{bill.lines.map((l, i) => <ItemRow key={l.id ?? i} line={l} igst={igst} compact={compact} />)}</tbody>
      </Table>
    </div>
  );
}
