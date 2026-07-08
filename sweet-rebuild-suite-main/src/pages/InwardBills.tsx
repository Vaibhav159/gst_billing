import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, FileText, Paperclip, Loader2, ReceiptText } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useBusinesses } from "@/hooks/useDataStore";
import { useInwardBills } from "@/hooks/useInwardBills";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatCurrency, formatDate } from "@/utils/mockData";

export default function InwardBills() {
  const navigate = useNavigate();
  const { items: businesses } = useBusinesses();
  const [business, setBusiness] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);

  const { items, count, loading, error } = useInwardBills({
    business,
    q: debouncedSearch,
    date_from: dateFrom,
    date_to: dateTo,
  });

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Inward Bills" }]} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" /> Inward Bills
          </h1>
          <p className="text-sm text-muted-foreground">
            {count} purchase {count === 1 ? "bill" : "bills"} on record
          </p>
        </div>
        <Button onClick={() => navigate("/billing/inward-bills/add")}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Inward Bill
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search supplier or invoice #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={business} onValueChange={setBusiness}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="All firms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All firms</SelectItem>
            {businesses.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" className="w-[150px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
        <Input type="date" className="w-[150px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Firm</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-destructive">{error}</TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No inward bills yet. Click <span className="font-medium">Add Inward Bill</span> to record one.
                </TableCell>
              </TableRow>
            ) : (
              items.map((b) => {
                const tax = (
                  parseFloat(b.cgst) + parseFloat(b.sgst) + parseFloat(b.igst)
                ).toFixed(2);
                return (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/billing/inward-bills/${b.id}`)}
                  >
                    <TableCell className="font-medium">{b.invoice_number}</TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate">{b.supplier?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{b.supplier?.gst_number || ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">{b.business_name}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{formatDate(b.invoice_date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(parseFloat(b.taxable))}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(parseFloat(tax))}
                      <Badge variant="outline" className="ml-1.5 text-[10px] px-1">
                        {b.is_igst_applicable ? "IGST" : "C+S"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCurrency(parseFloat(b.total_amount))}
                    </TableCell>
                    <TableCell>{b.has_file && <Paperclip className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
