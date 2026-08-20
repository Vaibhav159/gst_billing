import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Search, FileText, Paperclip, Loader2, ReceiptText } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCurrency, formatDate } from "@/utils/mockData";

export default function InwardBills() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { items: businesses } = useBusinesses();
  // The global FY selector (top bar) scopes every register; this page used to
  // ignore it — "FY 2025-26" up top while July 2026 bills filled the list.
  const { selectedFY } = useOutletContext<{ selectedFY: string }>();
  const [business, setBusiness] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 400);

  // FY "2025-26" → Apr 1 2025 … Mar 31 2026. The manual date inputs override
  // their respective FY bound when set (narrowing inside or outside the FY).
  const fyRange = useMemo(() => {
    const m = /^(\d{4})-\d{2}$/.exec(selectedFY || "");
    if (!m) return null;
    const start = parseInt(m[1], 10);
    return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
  }, [selectedFY]);
  const effectiveFrom = dateFrom || fyRange?.from || "";
  const effectiveTo = dateTo || fyRange?.to || "";

  // Any filter change restarts from page 1 — page 7 of a different query is
  // meaningless and DRF would 404 past the last page.
  useEffect(() => {
    setPage(1);
  }, [business, debouncedSearch, effectiveFrom, effectiveTo]);

  const { items, count, hasNext, hasPrevious, loading, error } = useInwardBills({
    business,
    q: debouncedSearch,
    date_from: effectiveFrom,
    date_to: effectiveTo,
    page,
  });
  const totalPages = Math.max(1, Math.ceil(count / 15));

  const pager = count > 0 && (hasNext || hasPrevious || totalPages > 1) ? (
    <div className="flex items-center justify-between gap-3 pt-1">
      <Button variant="outline" size="sm" disabled={!hasPrevious || loading}
        onClick={() => setPage((p) => Math.max(1, p - 1))}>
        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        Page {page} of {totalPages} · {count} bills
      </span>
      <Button variant="outline" size="sm" disabled={!hasNext || loading}
        onClick={() => setPage((p) => p + 1)}>
        Next <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Inward Bills" }]} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-primary" /> Inward Bills
          </h1>
          <p className="text-sm text-muted-foreground">
            {count} purchase {count === 1 ? "bill" : "bills"}
            {fyRange && !dateFrom && !dateTo ? ` in FY ${selectedFY}` : " on record"}
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
          <SelectTrigger className="w-full sm:w-[190px]"><SelectValue placeholder="All firms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All firms</SelectItem>
            {businesses.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" className="w-full sm:w-[150px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
        <Input type="date" className="w-full sm:w-[150px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
      </div>

      {/* Phones get cards, matching InvoiceList. The table put Taxable / Tax /
          Total — the reason you open a register — behind a horizontal scroll. */}
      {isMobile ? (
        <div className="space-y-2.5">
          {loading ? (
            <div className="rounded-lg border bg-card py-10 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
            </div>
          ) : error ? (
            <div className="rounded-lg border bg-card py-10 text-center text-destructive">{error}</div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border bg-card py-12 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No inward bills yet. Tap <span className="font-medium">Add Inward Bill</span> to record one.
            </div>
          ) : (
            items.map((b) => {
              const tax = (parseFloat(b.cgst) + parseFloat(b.sgst) + parseFloat(b.igst)).toFixed(2);
              return (
                <button
                  key={b.id}
                  onClick={() => navigate(`/billing/inward-bills/${b.id}`)}
                  className="w-full text-left rounded-xl border bg-card p-4 space-y-2.5 active:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{b.supplier?.name || "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        #{b.invoice_number} · {formatDate(b.invoice_date)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold tabular-nums">{formatCurrency(Number(b.total_amount))}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        tax {formatCurrency(Number(tax))}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{b.business_name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="tabular-nums">taxable {formatCurrency(Number(b.taxable))}</span>
                      {b.has_file && <Paperclip className="h-3.5 w-3.5" />}
                    </span>
                  </div>
                </button>
              );
            })
          )}
          {pager}
        </div>
      ) : (
      <>
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
      {pager}
      </>
      )}
    </div>
  );
}
