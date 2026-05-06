import { Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Moon, Sun, Flame, Gem, TreePine } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/utils/utils";
import { financialYears } from "@/utils/mockData";

const themeOptions = [
  { id: "obsidian" as const, label: "Obsidian", icon: Moon },
  { id: "pearl" as const, label: "Pearl", icon: Sun },
  { id: "sapphire" as const, label: "Sapphire", icon: Gem },
  { id: "ember" as const, label: "Ember", icon: Flame },
  { id: "forest" as const, label: "Forest", icon: TreePine },
];

interface MobileHeaderProps {
  selectedFY: string;
  onFYChange: (fy: string) => void;
}

export default function MobileHeader({ selectedFY, onFYChange }: MobileHeaderProps) {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const userInitial = user?.name?.charAt(0)?.toUpperCase() || "U";
  const [fyOpen, setFyOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const fyRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  const currentTheme = themeOptions.find((t) => t.id === theme);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fyRef.current && !fyRef.current.contains(e.target as Node)) setFyOpen(false);
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="sticky top-0 z-50 glass-nav">
      <div className="flex items-center justify-between h-14 px-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center glow-sm">
            <img src="/logo.png" alt="GST Billing" className="w-full h-full object-contain" />
          </div>
          <span className="font-display font-bold text-sm text-foreground tracking-tight">GST Billing</span>
        </Link>

        <div className="flex items-center gap-2">
          {/* FY Selector - Compact pill */}
          <div className="relative" ref={fyRef}>
            <button
              onClick={() => { setFyOpen(!fyOpen); setThemeOpen(false); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold glass-subtle text-foreground"
            >
              <span className="text-primary">FY</span>
              <span>{selectedFY}</span>
              <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", fyOpen && "rotate-180")} />
            </button>
            {fyOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-36 rounded-xl elevated-card z-50 py-1 animate-fade-in overflow-hidden">
                {financialYears.map((fy) => (
                  <button
                    key={fy}
                    onClick={() => { onFYChange(fy); setFyOpen(false); }}
                    className={cn(
                      "w-full text-left px-3.5 py-2.5 text-[12px] transition-colors",
                      fy === selectedFY ? "text-primary font-semibold bg-primary/10" : "text-foreground hover:bg-secondary/50"
                    )}
                  >
                    FY {fy}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme */}
          <div className="relative" ref={themeRef}>
            <button
              onClick={() => { setThemeOpen(!themeOpen); setFyOpen(false); }}
              className="p-2 rounded-lg glass-subtle text-foreground"
            >
              {currentTheme && <currentTheme.icon className="w-4 h-4" />}
            </button>
            {themeOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl elevated-card z-50 py-1 animate-fade-in overflow-hidden">
                {themeOptions.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTheme(t.id); setThemeOpen(false); }}
                      className={cn(
                        "w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 transition-colors text-[12px]",
                        t.id === theme ? "text-primary font-semibold bg-primary/10" : "text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Avatar */}
          <Link to="/billing/profile" className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold">
            {userInitial}
          </Link>
        </div>
      </div>
    </header>
  );
}
