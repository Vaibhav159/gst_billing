import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, Users, Package, Building2, BarChart3, Calculator, Settings, HardDrive, History, LayoutDashboard, ReceiptText } from "lucide-react";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { formatCurrency } from "@/utils/mockData";
import { cn } from "@/utils/utils";
import { useInvoices, useCustomers, useProducts, useBusinesses } from "@/hooks/useDataStore";
import api from "@/utils/api";

const pages = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, shortcut: "D" },
  { label: "Customers", href: "/billing/customer/list", icon: Users, shortcut: "C" },
  { label: "Businesses", href: "/billing/business/list", icon: Building2, shortcut: "B" },
  { label: "Products", href: "/billing/product/list", icon: Package, shortcut: "P" },
  { label: "Invoices", href: "/billing/invoice/list", icon: FileText, shortcut: "I" },
  { label: "Inward Bills", href: "/billing/inward-bills", icon: ReceiptText, shortcut: "W" },
  { label: "Reports", href: "/billing/reports", icon: BarChart3, shortcut: "R" },
  { label: "GST", href: "/billing/gst-summary", icon: Calculator, shortcut: "G" },
  { label: "GSTR-1 Filing", href: "/billing/gst-summary?tab=gstr1", icon: FileText, shortcut: "" },
  { label: "GSTR-3B Filing", href: "/billing/gst-summary?tab=gstr3b", icon: FileText, shortcut: "" },
  { label: "Backup", href: "/billing/backup", icon: HardDrive, shortcut: "" },
  { label: "Audit Log", href: "/billing/audit-log", icon: History, shortcut: "" },
  { label: "Settings", href: "/billing/settings", icon: Settings, shortcut: "S" },
  { label: "User Management", href: "/billing/users", icon: Users, shortcut: "" },
  { label: "New Invoice", href: "/billing/invoice/add", icon: FileText, shortcut: "N" },
  { label: "New Customer", href: "/billing/customer/new", icon: Users, shortcut: "" },
  { label: "New Product", href: "/billing/product/new", icon: Package, shortcut: "" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Hook signatures: useCustomers/useProducts(fy?, businessId?, enabled?),
  // useBusinesses(fy?, enabled?). Previous version passed `open` (boolean)
  // as the FY positional arg, which the hooks tried to use as an FY
  // string — and the actual `enabled` defaulted to true, so all three
  // lists were re-fetched on every mount instead of only when the palette
  // opens. Lazy + cheap now.
  const { items: invoices } = useInvoices(undefined, open);
  const { items: customers } = useCustomers(undefined, undefined, open);
  const { items: products } = useProducts(undefined, undefined, open);
  const { items: businesses } = useBusinesses(undefined, open);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Allow external trigger
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-command-palette", handler);
    return () => window.removeEventListener("open-command-palette", handler);
  }, []);

  // Server-backed quick search: the loaded lists only cover the first page,
  // so "what did we bill him last?" needs the whole database. Debounced one
  // round trip returning customers WITH their recent bills inline.
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<{ customers: any[]; invoices: any[]; products: any[] } | null>(null);
  const quickTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!open) { setQuick(null); setQuery(""); return; }
  }, [open]);
  useEffect(() => {
    clearTimeout(quickTimer.current);
    if (query.trim().length < 2) { setQuick(null); return; }
    quickTimer.current = setTimeout(() => {
      api.get<any>(`search/quick/?q=${encodeURIComponent(query.trim())}`)
        .then((r) => setQuick(r.data))
        .catch(() => setQuick(null));
    }, 220);
    return () => clearTimeout(quickTimer.current);
  }, [query]);

  const go = (href: string) => { navigate(href); setOpen(false); };
  const fmtD = (d: string) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "";

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Customer, invoice #, product, page…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {/* `group-data-[selected=true]:*` lets every sub-element flip its
            color when the parent CommandItem is highlighted. Without this
            the yellow row swallows muted-gray icons / kbd / sub-text. The
            `group` class lives on CommandItem (in components/ui/command.tsx). */}
        {quick && quick.customers.length > 0 && (
          <CommandGroup heading="Customers · with their latest bills">
            {quick.customers.map((c) => (
              <div key={`qc-${c.id}`}>
                <CommandItem value={`${c.name} qc${c.id}`} onSelect={() => go(`/billing/customer/${c.id}`)} className="gap-3">
                  <Users className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{c.state_name}</span>
                </CommandItem>
                {c.recent_invoices.map((i: any) => (
                  <CommandItem key={`qci-${i.id}`} value={`${c.name} ${i.invoice_number} qci${i.id}`} onSelect={() => go(`/billing/invoice/${i.id}`)} className="gap-3 pl-9">
                    <span className="text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">↳</span>
                    <span className="font-medium tabular-nums">{i.invoice_number}</span>
                    <span className="text-[11px] text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{fmtD(i.invoice_date)}</span>
                    <span className={cn("ml-auto text-xs font-semibold tabular-nums", i.type_of_invoice === "outward" ? "text-success" : "text-warning", "group-data-[selected=true]:text-accent-foreground")}>{formatCurrency(Number(i.total_amount))}</span>
                  </CommandItem>
                ))}
              </div>
            ))}
          </CommandGroup>
        )}
        {quick && quick.invoices.length > 0 && (
          <CommandGroup heading="Invoices · whole database">
            {quick.invoices.map((i) => (
              <CommandItem key={`qi-${i.id}`} value={`${i.invoice_number} qi${i.id}`} onSelect={() => go(`/billing/invoice/${i.id}`)} className="gap-3">
                <FileText className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
                <span className="font-medium tabular-nums">{i.invoice_number}</span>
                <span className="text-[11px] text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{fmtD(i.invoice_date)}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{i.customer_name}</span>
                <span className={cn("text-xs font-semibold tabular-nums", i.type_of_invoice === "outward" ? "text-success" : "text-warning", "group-data-[selected=true]:text-accent-foreground")}>{formatCurrency(Number(i.total_amount))}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem key={p.href} onSelect={() => go(p.href)} className="gap-3">
              <p.icon className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
              <span className="flex-1">{p.label}</span>
              {p.shortcut && (
                <kbd className="ml-auto text-[10px] font-mono bg-secondary/50 border border-border/40 px-1.5 py-0.5 rounded text-muted-foreground group-data-[selected=true]:bg-accent-foreground group-data-[selected=true]:text-accent group-data-[selected=true]:border-accent-foreground">
                  {p.shortcut}
                </kbd>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Invoices">
          {invoices.slice(0, 10).map((inv) => (
            <CommandItem key={inv.id} onSelect={() => go(`/billing/invoice/${inv.id}`)} className="gap-3">
              <FileText className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{inv.invoiceNumber}</span>
                <span className="text-[10px] text-muted-foreground ml-2 group-data-[selected=true]:text-accent-foreground/80">{inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : ""}</span>
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-[100px] group-data-[selected=true]:text-accent-foreground/80">{inv.customerName}</span>
              <span className={cn("text-xs font-semibold tabular-nums", inv.type === "OUTWARD" ? "text-success" : "text-warning", "group-data-[selected=true]:text-accent-foreground")}>{formatCurrency(inv.total)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Customers">
          {customers.map((c) => (
            <CommandItem key={c.id} onSelect={() => go(`/billing/customer/${c.id}`)} className="gap-3">
              <Users className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
              <span className="flex-1">{c.name}</span>
              {(c as any).total_revenue > 0 && <span className="text-xs font-semibold text-success tabular-nums group-data-[selected=true]:text-accent-foreground">{formatCurrency((c as any).total_revenue)}</span>}
              <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{c.state_name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Products">
          {products.map((p) => (
            <CommandItem key={p.id} onSelect={() => go(`/billing/product/${p.id}`)} className="gap-3">
              <Package className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
              <span className="flex-1">{p.name}</span>
              <span className="text-xs text-muted-foreground font-mono group-data-[selected=true]:text-accent-foreground/80">HSN: {p.hsn}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Businesses">
          {businesses.map((b) => (
            <CommandItem key={b.id} onSelect={() => go(`/billing/business/${b.id}`)} className="gap-3">
              <Building2 className="w-4 h-4 text-muted-foreground group-data-[selected=true]:text-accent-foreground" />
              <span className="flex-1">{b.name}</span>
              <span className="text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80">{b.state_name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
