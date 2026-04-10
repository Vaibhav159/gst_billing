import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Users, Building2, Package, FileText,
  BarChart3, Calculator, HardDrive, LogOut, ChevronDown,
  Moon, Sun, Flame, Gem, Menu, X, TreePine, Settings, History, User, Search
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/hooks/usePermission";
import { cn } from "@/utils/utils";
import NotificationCenter from "@/components/NotificationCenter";
import { financialYears } from "@/utils/mockData";

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Customers", href: "/billing/customer/list", icon: Users },
  { label: "Businesses", href: "/billing/business/list", icon: Building2 },
  { label: "Products", href: "/billing/product/list", icon: Package },
  { label: "Invoices", href: "/billing/invoice/list", icon: FileText },
  { label: "Reports", href: "/billing/reports", icon: BarChart3 },
  { label: "GST", href: "/billing/gst-summary", icon: Calculator },
  { label: "GSTR Filing", href: "/billing/gstr-export", icon: FileText },
];

const settingsItems = [
  { label: "Settings", href: "/billing/settings", icon: Settings },
  { label: "Backup", href: "/billing/backup", icon: HardDrive },
  { label: "Audit Log", href: "/billing/audit-log", icon: History },
];

const themeOptions = [
  { id: "obsidian" as const, label: "Obsidian", icon: Moon, desc: "Rich dark gold" },
  { id: "pearl" as const, label: "Pearl", icon: Sun, desc: "Warm light" },
  { id: "sapphire" as const, label: "Sapphire", icon: Gem, desc: "Deep blue" },
  { id: "ember" as const, label: "Ember", icon: Flame, desc: "Dark coral" },
  { id: "forest" as const, label: "Forest", icon: TreePine, desc: "Deep green gold" },
];

interface TopNavbarProps {
  selectedFY: string;
  onFYChange: (fy: string) => void;
}

export default function TopNavbar({ selectedFY, onFYChange }: TopNavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { user, logout: authLogout } = useAuth();
  const { canManageUsers } = usePermission();
  const [themeOpen, setThemeOpen] = useState(false);
  const [fyOpen, setFyOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const fyRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fyRef.current && !fyRef.current.contains(e.target as Node)) setFyOpen(false);
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  const handleLogout = () => { authLogout(); navigate("/login"); };
  const currentTheme = themeOptions.find((t) => t.id === theme);
  const userInitial = user?.username?.charAt(0)?.toUpperCase() || "U";
  const userName = user?.username || "User";

  return (
    <nav className="sticky top-0 z-50 w-full glass-nav">
      <div className="flex h-16 items-center px-6 gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 mr-6 shrink-0 group">
          <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center glow-sm transition-all group-hover:glow-primary group-hover:scale-105">
            <img src="/logo.png" alt="GST Billing" className="w-full h-full object-contain" />
          </div>
          <div className="hidden lg:block">
            <span className="font-display font-bold text-sm text-foreground tracking-tight">GST Billing</span>
            <span className="block text-[10px] text-muted-foreground -mt-0.5">Pro Suite</span>
          </div>
        </Link>

        {/* Desktop Nav - only show on xl+ */}
        <div className="hidden xl:flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-200 relative whitespace-nowrap shrink-0",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                <Icon className={cn("w-4 h-4", active && "drop-shadow-sm")} />
                <span>{item.label}</span>
                {active && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5 ml-auto shrink-0">
          {/* Search trigger - only on xl+ */}
          <button
            onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
            className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl text-[12px] text-muted-foreground glass-subtle hover:bg-secondary/50 transition-all"
            title="Search (⌘K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
            <kbd className="ml-1 text-[10px] font-mono bg-secondary/60 px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>

          {/* Notification Center */}
          <NotificationCenter />

          {/* FY Selector */}
          <div className="relative" ref={fyRef}>
            <button
              onClick={() => { setFyOpen(!fyOpen); setThemeOpen(false); }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-medium glass-subtle text-foreground hover:bg-secondary/50 transition-all"
            >
              <span className="text-primary font-semibold text-[11px] uppercase tracking-wider">FY</span>
              <span>{selectedFY}</span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", fyOpen && "rotate-180")} />
            </button>
            {fyOpen && (
              <div className="absolute right-0 top-full mt-2 w-40 max-w-[calc(100vw-1rem)] rounded-xl elevated-card z-50 py-1.5 animate-fade-in overflow-hidden">
                {financialYears.map((fy) => (
                  <button
                    key={fy}
                    onClick={() => { onFYChange(fy); setFyOpen(false); }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-[13px] transition-colors",
                      fy === selectedFY
                        ? "text-primary font-semibold bg-primary/10"
                        : "text-foreground hover:bg-secondary/50"
                    )}
                  >
                    FY {fy}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <div className="relative" ref={themeRef}>
            <button
              onClick={() => { setThemeOpen(!themeOpen); setFyOpen(false); }}
              className="flex items-center gap-2 p-2.5 rounded-xl glass-subtle text-foreground hover:bg-secondary/50 transition-all"
              title="Change theme"
            >
              {currentTheme && <currentTheme.icon className="w-4 h-4" />}
            </button>
            {themeOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 max-w-[calc(100vw-1rem)] rounded-xl elevated-card z-50 py-1.5 animate-fade-in overflow-hidden">
                {themeOptions.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTheme(t.id); setThemeOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-3 flex items-center gap-3 transition-colors",
                        t.id === theme
                          ? "text-primary font-semibold bg-primary/10"
                          : "text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <div>
                        <p className="text-[13px]">{t.label}</p>
                        <p className="text-[10px] text-muted-foreground">{t.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* User / Profile - visible on sm+ */}
          <div className="relative hidden sm:block" ref={profileRef}>
            <button
              onClick={() => { setProfileOpen(!profileOpen); setFyOpen(false); setThemeOpen(false); }}
              aria-label="User profile menu"
              className="flex items-center gap-3 pl-3 ml-1 border-l border-border/40 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-xs font-bold glow-sm">
                {userInitial}
              </div>
              <span className="text-[13px] font-medium text-foreground hidden xl:block max-w-[100px] truncate">{userName}</span>
              <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform hidden xl:block", profileOpen && "rotate-180")} />
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 max-w-[calc(100vw-1rem)] rounded-xl elevated-card z-50 py-1.5 animate-fade-in overflow-hidden">
                <Link
                  to="/billing/profile"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border/40 hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold">{userInitial}</div>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{userName}</p>
                    <p className="text-[10px] text-muted-foreground">View profile</p>
                  </div>
                </Link>
                {settingsItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setProfileOpen(false)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors",
                        active
                          ? "text-primary font-semibold bg-primary/10"
                          : "text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  );
                })}
                {canManageUsers && (
                  <Link to="/billing/users" onClick={() => setProfileOpen(false)}
                    className={cn("w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors", isActive("/billing/users") ? "text-primary font-semibold bg-primary/10" : "text-foreground hover:bg-secondary/50")}>
                    <Users className="w-4 h-4" /> User Management
                  </Link>
                )}
                <div className="border-t border-border/40 mt-1 pt-1">
                  <button
                    onClick={() => { setProfileOpen(false); handleLogout(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Small screen user icon + logout (below sm) */}
          <div className="flex sm:hidden items-center gap-2 pl-3 ml-1 border-l border-border/40">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-xs font-bold glow-sm">
              {userInitial}
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Compact menu trigger (below xl) */}
          <button
            className="xl:hidden p-2 rounded-xl text-muted-foreground hover:bg-secondary/50"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Compact nav panel (below xl) */}
      {mobileOpen && (
        <div className="xl:hidden elevated-card m-4 mt-0 p-4 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-1.5 animate-fade-in">
          {[...navItems, ...settingsItems].map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-[13px] font-medium transition-all",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
