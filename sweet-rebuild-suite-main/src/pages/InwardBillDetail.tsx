import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Loader2, FileWarning } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useInwardBill } from "@/hooks/useInwardBills";
import { formatCurrency, formatDate } from "@/utils/mockData";

export default function InwardBillDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { bill, loading, error } = useInwardBill(id);

  if (loading) {
    return <div className="py-20 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin inline" /></div>;
  }
  if (error || !bill) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-50" />
        {error || "Inward bill not found."}
        <div className="mt-3"><Button variant="outline" onClick={() => navigate("/billing/inward-bills")}>Back to list</Button></div>
      </div>
    );
  }

  const fileUrl = bill.source_file_url;
  const isPdf = !!fileUrl && /\.pdf(\?|$)/i.test(fileUrl);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Inward Bills", href: "/billing/inward-bills" }, { label: `#${bill.invoice_number}` }]} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/billing/inward-bills")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-xl font-semibold">#{bill.invoice_number}</h1>
            <p className="text-sm text-muted-foreground">{bill.supplier?.name || "—"} → {bill.business_name}</p>
          </div>
        </div>
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noreferrer">
            <Button variant="outline"><Download className="h-4 w-4 mr-1.5" /> Download original</Button>
          </a>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Recorded data */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4 grid grid-cols-2 gap-y-2 text-sm">
            <Meta label="Supplier" value={bill.supplier?.name || "—"} />
            <Meta label="Supplier GSTIN" value={bill.supplier?.gst_number || "—"} />
            <Meta label="Firm" value={bill.business_name} />
            <Meta label="Date" value={formatDate(bill.invoice_date)} />
            <Meta label="Tax type" value={bill.is_igst_applicable ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"} />
          </div>

          <div className="rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.line_items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.product_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.hsn_code}</TableCell>
                    <TableCell className="text-right tabular-nums">{parseFloat(l.quantity)} {l.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(parseFloat(l.rate))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(parseFloat(l.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-1 text-sm">
            <SumRow label="Taxable" value={bill.taxable} />
            {bill.is_igst_applicable ? (
              <SumRow label="IGST" value={bill.igst} />
            ) : (
              <>
                <SumRow label="CGST" value={bill.cgst} />
                <SumRow label="SGST" value={bill.sgst} />
              </>
            )}
            <div className="flex justify-between font-semibold text-base pt-1.5 border-t">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(parseFloat(bill.total_amount))}</span>
            </div>
          </div>
        </div>

        {/* Original file */}
        <div className="rounded-lg border bg-card p-2 min-h-[400px] flex flex-col">
          <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center justify-between">
            <span>Original bill</span>
            {bill.has_file && <Badge variant="outline" className="text-[10px]">on file</Badge>}
          </div>
          <div className="flex-1 flex items-center justify-center overflow-auto">
            {!fileUrl ? (
              <span className="text-sm text-muted-foreground">No file attached.</span>
            ) : isPdf ? (
              <iframe title="bill" src={fileUrl} className="w-full h-[560px] rounded" />
            ) : (
              <img src={bill.source_preview_url || fileUrl} alt="bill" className="max-w-full max-h-[560px] rounded object-contain" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{formatCurrency(parseFloat(value))}</span>
    </div>
  );
}
