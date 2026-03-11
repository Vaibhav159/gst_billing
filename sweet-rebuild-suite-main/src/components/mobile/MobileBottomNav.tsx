import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, FileText, Package, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import MobileMoreDrawer from "./MobileMoreDrawer";

const tabs = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Customers", href: "/billing/customer/list", icon: Users },
  { label: "Invoices", href: "/billing/invoice/list", icon: FileText },
  { label: "Products", href: "/billing/product/list", icon: Package },
];

export default function MobileBottomNav() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  const moreActive = ["/billing/reports", "/billing/gst-summary", "/billing/backup", "/billing/settings", "/billing/audit-log", "/billing/business"].some(
    (p) => location.pathname.startsWith(p)
  );

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 glass-nav border-t border-border/40 safe-area-bottom">
        <div className="flex items-center justify-around h-16 px-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                to={tab.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all min-w-[60px]",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <div className={cn(
                  "w-10 h-7 flex items-center justify-center rounded-lg transition-all",
                  active && "bg-primary/12"
                )}>
                  <Icon className={cn("w-5 h-5", active && "drop-shadow-sm")} />
                </div>
                <span className={cn("text-[10px] font-semibold", active && "text-primary")}>{tab.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all min-w-[60px]",
              moreActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <div className={cn(
              "w-10 h-7 flex items-center justify-center rounded-lg transition-all",
              moreActive && "bg-primary/12"
            )}>
              <MoreHorizontal className="w-5 h-5" />
            </div>
            <span className={cn("text-[10px] font-semibold", moreActive && "text-primary")}>More</span>
          </button>
        </div>
      </nav>
      <MobileMoreDrawer open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}
