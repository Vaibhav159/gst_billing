import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, Users, Package, Building2, BarChart3, Calculator, Settings, HardDrive, History, LayoutDashboard } from "lucide-react";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { formatCurrency } from "@/lib/mockData";
import { useInvoices, useCustomers, useProducts, useBusinesses } from "@/hooks/useDataStore";

const pages = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Customers", href: "/billing/customer/list", icon: Users },
  { label: "Businesses", href: "/billing/business/list", icon: Building2 },
  { label: "Products", href: "/billing/product/list", icon: Package },
  { label: "Invoices", href: "/billing/invoice/list", icon: FileText },
  { label: "Reports", href: "/billing/reports", icon: BarChart3 },
  { label: "GST Summary", href: "/billing/gst-summary", icon: Calculator },
  { label: "Backup", href: "/billing/backup", icon: HardDrive },
  { label: "Audit Log", href: "/billing/audit-log", icon: History },
  { label: "Settings", href: "/billing/settings", icon: Settings },
  { label: "New Invoice", href: "/billing/invoice/add", icon: FileText },
  { label: "New Customer", href: "/billing/customer/new", icon: Users },
  { label: "New Product", href: "/billing/product/new", icon: Package },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { items: invoices } = useInvoices();
  const { items: customers } = useCustomers();
  const { items: products } = useProducts();
  const { items: businesses } = useBusinesses();

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

  const go = (href: string) => { navigate(href); setOpen(false); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search invoices products, pages..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem key={p.href} onSelect={() => go(p.href)} className="gap-3">
              <p.icon className="w-4 h-4 text-muted-foreground" />
              <span>{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Invoices">
          {invoices.slice(0, 8).map((inv) => (
            <CommandItem key={inv.id} onSelect={() => go(`/billing/invoice/${inv.id}`)} className="gap-3">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1">{inv.invoiceNumber}</span>
              <span className="text-xs text-muted-foreground">{inv.customerName}</span>
              <span className="text-xs font-semibold tabular-nums">{formatCurrency(inv.total)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Customers">
          {customers.map((c) => (
            <CommandItem key={c.id} onSelect={() => go(`/billing/customer/${c.id}`)} className="gap-3">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.state_name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Products">
          {products.map((p) => (
            <CommandItem key={p.id} onSelect={() => go(`/billing/product/${p.id}`)} className="gap-3">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1">{p.name}</span>
              <span className="text-xs text-muted-foreground font-mono">HSN: {p.hsn}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Businesses">
          {businesses.map((b) => (
            <CommandItem key={b.id} onSelect={() => go(`/billing/business/${b.id}`)} className="gap-3">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1">{b.name}</span>
              <span className="text-xs text-muted-foreground">{b.state_name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
