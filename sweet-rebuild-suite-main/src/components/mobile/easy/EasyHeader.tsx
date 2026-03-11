import { Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { financialYears } from "@/lib/mockData";
import { useMobileMode } from "@/contexts/MobileModeContext";
import { useAuth } from "@/contexts/AuthContext";

interface EasyHeaderProps {
  selectedFY: string;
  onFYChange: (fy: string) => void;
}

export default function EasyHeader({ selectedFY, onFYChange }: EasyHeaderProps) {
  const { setMobileMode } = useMobileMode();
  const { user } = useAuth();
  const userInitial = user?.name?.charAt(0)?.toUpperCase() || "U";
  const [fyOpen, setFyOpen] = useState(false);
  const fyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fyRef.current && !fyRef.current.contains(e.target as Node)) setFyOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="sticky top-0 z-50 glass-nav">
      <div className="flex items-center justify-between h-14 px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center glow-sm">
            <img src="/logo.png" alt="GST Billing" className="w-full h-full object-contain" />
          </div>
          <span className="font-display font-bold text-sm text-foreground tracking-tight">GST Billing</span>
        </Link>

        <div className="flex items-center gap-2">
          {/* FY Selector */}
          <div className="relative" ref={fyRef}>
            <button
              onClick={() => setFyOpen(!fyOpen)}
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

          {/* Switch to Expert */}
          <button
            onClick={() => setMobileMode("expert")}
            className="p-2 rounded-lg glass-subtle text-muted-foreground hover:text-foreground transition-colors"
            title="Switch to Expert Mode"
          >
            <Wrench className="w-4 h-4" />
          </button>

          {/* Avatar */}
          <Link to="/billing/profile" className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold">
            {userInitial}
          </Link>
        </div>
      </div>
    </header>
  );
}
